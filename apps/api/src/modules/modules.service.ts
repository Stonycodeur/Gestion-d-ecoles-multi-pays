import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { poolConfig } from '../core/db-config';
import { Pool } from 'pg';
import { runSandboxed } from './sandbox';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MemoryEnablementStore, ModuleRegistry, validateManifest, type EnablementStore, type HookHandler, type ModuleManifest } from '@ecolemanager/shared';

export const CORE_VERSION = '0.1.0';

/** Loads module packages from MODULES_DIR (default packages/modules). Adding a module = drop a package here + enable it for a tenant. */
/** Enablement per school is kept in memory for speed and written through to public.feature_flags, so it survives restarts. */
class PersistentStore implements EnablementStore {
  private readonly mem = new MemoryEnablementStore();
  constructor(private readonly pool: Pool | undefined, private readonly log: Logger) {}
  get(t: string, n: string) { return this.mem.get(t, n); }
  listEnabled(t: string) { return this.mem.listEnabled(t); }
  set(t: string, n: string, v: { enabled: boolean; config: Record<string, unknown> }) {
    this.mem.set(t, n, v);
    if (!this.pool) return;
    this.pool.query(`INSERT INTO feature_flags(tenant_id, module_name, enabled, config) SELECT id, $2, $3, $4 FROM tenants WHERE slug = $1
      ON CONFLICT (tenant_id, module_name) DO UPDATE SET enabled = EXCLUDED.enabled, config = EXCLUDED.config`, [t, n, v.enabled, JSON.stringify(v.config)])
      .catch((e: Error) => this.log.warn(`feature flag not persisted: ${e.message}`));
  }
  async load() {
    if (!this.pool) return 0;
    const r = await this.pool.query('SELECT t.slug, f.module_name, f.enabled, f.config FROM feature_flags f JOIN tenants t ON t.id = f.tenant_id');
    for (const x of r.rows) this.mem.set(x.slug, x.module_name, { enabled: x.enabled, config: x.config ?? {} });
    return r.rowCount ?? 0;
  }
}

@Injectable()
export class ModulesService implements OnModuleInit {
  private readonly log = new Logger('ModulesService');
  readonly pool = process.env.DATABASE_URL ? new Pool(poolConfig()) : undefined;
  private readonly store = new PersistentStore(this.pool, this.log);
  readonly registry = new ModuleRegistry(CORE_VERSION, this.store);
  readonly loadErrors: string[] = [];

  constructor() {
    const dir = resolve(process.env.MODULES_DIR ?? join(__dirname, '../../../../packages/modules'));
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const base = join(dir, entry.name);
      try {
        const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as ModuleManifest;
        const errs = validateManifest(manifest);
        if (errs.length) throw new Error(errs.join('; '));
        const handlers: Record<string, HookHandler> = manifest.entry ? (require(join(base, manifest.entry)).handlers ?? {}) : {};
        this.registry.register(manifest, handlers);
        this.log.log(`module loaded: ${manifest.name}@${manifest.version}`);
      } catch (e) {
        const msg = `${entry.name}: ${e instanceof Error ? e.message : String(e)}`;
        this.loadErrors.push(msg);
        this.log.warn(`module skipped: ${msg}`);
      }
    }
  }

  /** Registers an approved third-party module: its handlers only run inside the sandbox. */
  registerThirdParty(manifest: ModuleManifest, sources: Record<string, string>) {
    const handlers: Record<string, HookHandler> = {};
    for (const h of Object.values(manifest.hooks ?? {})) {
      const src = sources[h as string]; if (typeof src !== 'string') throw new Error(`missing source for ${h}`);
      handlers[h as string] = (payload, ctx) => runSandboxed(src, payload, ctx.config);
    }
    this.registry.register(manifest, handlers);
  }

  async onModuleInit() {
    if (!this.pool) return;
    try {
      // third-party modules first (flags may refer to them), then the persisted per-school flags
      const r = await this.pool.query(`SELECT DISTINCT ON (v.module_name) v.manifest, v.handlers_source FROM marketplace_versions v JOIN marketplace_modules m ON m.name = v.module_name
        WHERE v.status = 'published' AND m.status = 'published' ORDER BY v.module_name, v.submitted_at DESC`);
      for (const x of r.rows) { try { this.registerThirdParty(x.manifest, x.handlers_source ?? {}); } catch (e) { this.log.warn(`marketplace module skipped: ${(e as Error).message}`); } }
      const n = await this.store.load(); this.log.log(`module flags loaded: ${n}`);
    } catch (e) { this.log.warn(`module persistence unavailable: ${(e as Error).message}`); }
  }
}
