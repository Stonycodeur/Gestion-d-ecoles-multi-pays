import { satisfies, compareVersions } from './semver.ts';
import { HOOK_EVENTS, validateManifest } from './modules.ts';

/** Phase 6b (spec 6.19): marketplace rules. Pure and deterministic: used by submission, approval and installation. */
export const DANGEROUS_PERMISSIONS = ['modules:manage', 'audit:read', 'admins:create', 'marketplace:install', 'inspectors:manage', 'billing:write', 'ministry:send', 'ministry:prepare', 'gps:read', 'gps:configure', 'predictive:read'];
const FORBIDDEN_SOURCE = [/\brequire\b/, /\bimport\b/, /\bprocess\b/, /\beval\b/, /\bFunction\b/, /\bconstructor\b/, /\bglobalThis\b/, /__proto__/, /\bfetch\b/, /\bsetTimeout\b/, /\bsetInterval\b/, /\bWebAssembly\b/];
export interface Review { ok: boolean; errors: string[]; compatible: boolean; risk: 'low' | 'high'; manual_review_required: boolean; findings: string[] }
export interface SubmittedModule { manifest: unknown; handlers_source?: Record<string, string> }

/** Automated review: manifest validity, core compatibility, declared permissions, hook names, static scan of handler sources. The real isolation is the sandbox at run time. */
export function reviewSubmission(sub: SubmittedModule, coreVersion: string, reservedNames: string[] = []): Review {
  const errors = validateManifest(sub.manifest); const findings: string[] = [];
  const m = (sub.manifest ?? {}) as Record<string, any>;
  const compatible = !errors.length && satisfies(coreVersion, String(m.core_version));
  if (!errors.length && !compatible) errors.push(`incompatible with core ${coreVersion} (requires ${m.core_version})`);
  if (typeof m.name === 'string' && reservedNames.includes(m.name)) errors.push('name is reserved by a first-party module');
  let risky = false;
  for (const p of (m.permissions ?? []) as string[]) {
    if (p === '*' || p.endsWith(':*')) { risky = true; findings.push(`wildcard permission ${p}`); }
    else if (DANGEROUS_PERMISSIONS.includes(p)) { risky = true; findings.push(`sensitive permission ${p}`); }
  }
  const src = sub.handlers_source ?? {};
  for (const [ev, h] of Object.entries((m.hooks ?? {}) as Record<string, string>)) {
    if (!(HOOK_EVENTS as readonly string[]).includes(ev)) continue;
    if (typeof src[h] !== 'string' || !src[h]!.trim()) errors.push(`handler ${h} (hook ${ev}) has no source`);
  }
  for (const [name, code] of Object.entries(src)) {
    if (typeof code !== 'string' || code.length > 20000) { errors.push(`handler ${name}: source missing or longer than 20 KB`); continue; }
    for (const re of FORBIDDEN_SOURCE) if (re.test(code)) { risky = true; findings.push(`handler ${name} uses forbidden construct ${re.source}`); }
  }
  const forbidden = findings.some((f) => f.includes('forbidden construct'));
  if (forbidden) errors.push('handler source uses forbidden constructs');
  return { ok: !errors.length, errors, compatible, risk: risky ? 'high' : 'low', manual_review_required: risky, findings };
}
/** Permissions the school must (re-)accept: all of them at install, only the new ones at update. */
export const addedPermissions = (oldPerms: string[], newPerms: string[]): string[] => newPerms.filter((p) => !oldPerms.includes(p));
export const consentCovers = (accepted: unknown, required: string[]): boolean => Array.isArray(accepted) && required.every((p) => accepted.includes(p));
export const isUpgrade = (current: string, next: string): boolean => compareVersions(next, current) > 0;
export function ratingSummary(ratings: number[]): { count: number; average: number | null } {
  if (ratings.some((r) => !Number.isInteger(r) || r < 1 || r > 5)) throw new Error('ratings are integers from 1 to 5');
  return { count: ratings.length, average: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null };
}
