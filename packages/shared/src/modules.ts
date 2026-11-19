import { isValidRange, satisfies } from './semver.ts';
import { parseVersion } from './semver.ts';

export const HOOK_EVENTS = [
  'onStudentCreated', 'onGradeSubmitted', 'onExamCompleted',
  'onAbsenceRecorded', 'onPaymentConfirmed', 'onGameCompleted',
] as const;
export type HookEvent = (typeof HOOK_EVENTS)[number];

export interface ModuleManifest {
  name: string;
  version: string;
  core_version: string;
  description: string;
  permissions: string[];
  hooks?: Partial<Record<HookEvent, string>>;
  config_schema?: Record<string, unknown>;
  /** Mobile screens exposed when the module is active for the tenant. */
  mobile_screens?: string[];
  /** Path of the compiled entry (exports `handlers`), relative to the module folder. */
  entry?: string;
}

export function validateManifest(m: unknown): string[] {
  const errors: string[] = [];
  if (typeof m !== 'object' || m === null) return ['manifest must be an object'];
  const x = m as Record<string, unknown>;
  if (typeof x.name !== 'string' || !/^module-[a-z0-9-]+$/.test(x.name)) errors.push('name must match module-[a-z0-9-]+');
  if (typeof x.version !== 'string') errors.push('version required');
  else { try { parseVersion(x.version); } catch { errors.push('version must be semver x.y.z'); } }
  if (typeof x.core_version !== 'string' || !isValidRange(x.core_version)) errors.push('core_version must be a valid range');
  if (typeof x.description !== 'string' || !x.description) errors.push('description required');
  if (!Array.isArray(x.permissions) || !x.permissions.every((p) => typeof p === 'string' && /^[a-z_]+:[a-z_*]+$/.test(p))) {
    errors.push('permissions must be strings like "module:action"');
  }
  if (x.hooks !== undefined) {
    if (typeof x.hooks !== 'object' || x.hooks === null) errors.push('hooks must be an object');
    else for (const [ev, h] of Object.entries(x.hooks)) {
      if (!(HOOK_EVENTS as readonly string[]).includes(ev)) errors.push(`unknown hook event ${ev}`);
      if (typeof h !== 'string' || !h) errors.push(`hook ${ev} must name a handler`);
    }
  }
  if (x.config_schema !== undefined && (typeof x.config_schema !== 'object' || x.config_schema === null)) errors.push('config_schema must be an object');
  return errors;
}

export type HookHandler = (payload: any, ctx: { tenantId: string; config: Record<string, unknown> }) => unknown | Promise<unknown>;

export interface EnablementStore {
  get(tenantId: string, name: string): { enabled: boolean; config: Record<string, unknown> } | undefined;
  set(tenantId: string, name: string, v: { enabled: boolean; config: Record<string, unknown> }): void;
  listEnabled(tenantId: string): string[];
}

export class MemoryEnablementStore implements EnablementStore {
  private m = new Map<string, { enabled: boolean; config: Record<string, unknown> }>();
  get(t: string, n: string) { return this.m.get(`${t}|${n}`); }
  set(t: string, n: string, v: { enabled: boolean; config: Record<string, unknown> }) { this.m.set(`${t}|${n}`, v); }
  listEnabled(t: string) {
    return [...this.m.entries()].filter(([k, v]) => k.startsWith(`${t}|`) && v.enabled).map(([k]) => k.split('|')[1]);
  }
}

export interface HookResult { module: string; ok: boolean; value?: unknown; error?: string }

/**
 * Module Registry (spec 4.4). Adding a module = register(manifest, handlers) + enable(tenant).
 * The core never imports a module directly.
 */
export class ModuleRegistry {
  private modules = new Map<string, { manifest: ModuleManifest; handlers: Record<string, HookHandler> }>();
  private readonly coreVersion: string;
  private readonly store: EnablementStore;
  constructor(coreVersion: string, store: EnablementStore = new MemoryEnablementStore()) {
    this.coreVersion = coreVersion;
    this.store = store;
  }

  register(manifest: ModuleManifest, handlers: Record<string, HookHandler> = {}): void {
    const errs = validateManifest(manifest);
    if (errs.length) throw new Error(`Invalid manifest: ${errs.join('; ')}`);
    if (!satisfies(this.coreVersion, manifest.core_version)) {
      throw new Error(`${manifest.name} requires core ${manifest.core_version}, running ${this.coreVersion}`);
    }
    for (const h of Object.values(manifest.hooks ?? {})) {
      if (h && typeof handlers[h] !== 'function') throw new Error(`${manifest.name}: missing handler ${h}`);
    }
    this.modules.set(manifest.name, { manifest, handlers });
  }

  unregister(name: string): void { this.modules.delete(name); }
  has(name: string): boolean { return this.modules.has(name); }
  list(): ModuleManifest[] { return [...this.modules.values()].map((m) => m.manifest); }

  enable(tenantId: string, name: string, config: Record<string, unknown> = {}): void {
    const m = this.modules.get(name);
    if (!m) throw new Error(`Unknown module ${name}`);
    this.store.set(tenantId, name, { enabled: true, config: { ...((m.manifest.config_schema as Record<string, unknown>) ?? {}), ...config } });
  }
  disable(tenantId: string, name: string): void {
    const cur = this.store.get(tenantId, name);
    this.store.set(tenantId, name, { enabled: false, config: cur?.config ?? {} });
  }
  isEnabled(tenantId: string, name: string): boolean { return this.store.get(tenantId, name)?.enabled === true; }
  config(tenantId: string, name: string): Record<string, unknown> { return this.store.get(tenantId, name)?.config ?? {}; }

  /** What the mobile app calls to show/hide screens. */
  activeFor(tenantId: string): { name: string; version: string; permissions: string[]; mobile_screens: string[] }[] {
    return this.store.listEnabled(tenantId)
      .map((n) => this.modules.get(n)?.manifest)
      .filter((m): m is ModuleManifest => !!m)
      .map((m) => ({ name: m.name, version: m.version, permissions: m.permissions, mobile_screens: m.mobile_screens ?? [] }));
  }

  /** Runs hooks of enabled modules only; one failing module never blocks the others. */
  async emit(tenantId: string, event: HookEvent, payload: unknown, exclude: string[] = []): Promise<HookResult[]> {
    const out: HookResult[] = [];
    for (const [name, { manifest, handlers }] of this.modules) {
      if (exclude.includes(name)) continue;
      const handlerName = manifest.hooks?.[event];
      if (!handlerName || !this.isEnabled(tenantId, name)) continue;
      try {
        out.push({ module: name, ok: true, value: await handlers[handlerName](payload, { tenantId, config: this.config(tenantId, name) }) });
      } catch (e) {
        out.push({ module: name, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }

  /** Runs the hook of ONE module (when enabled). Used by core services that feed a module its own payload. */
  async emitTo(tenantId: string, event: HookEvent, moduleName: string, payload: unknown): Promise<HookResult | null> {
    const m = this.modules.get(moduleName);
    const handlerName = m?.manifest.hooks?.[event];
    if (!m || !handlerName || !this.isEnabled(tenantId, moduleName)) return null;
    try {
      return { module: moduleName, ok: true, value: await m.handlers[handlerName](payload, { tenantId, config: this.config(tenantId, moduleName) }) };
    } catch (e) {
      return { module: moduleName, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
