import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NON_GRANTABLE, ROLE_PERMISSIONS, allPermissions, effectivePermissions, setRoleOverrides, type Principal, type RoleCode, type RoleOverrides } from '@ecolemanager/shared';
import { sharedPool } from './shared-pool';
import { AuditService } from './audit.service';

export const ROLE_META: Record<string, { fr: string; en: string; scope: string; editable: boolean }> = {
  root_super_admin: { fr: 'Super-Admin racine', en: 'Root Super-Admin', scope: 'global', editable: false },
  tenant_super_admin: { fr: 'Super-Admin d’établissement', en: 'School Super-Admin', scope: 'tenant', editable: true },
  admin: { fr: 'Admin', en: 'Admin', scope: 'tenant', editable: true },
  head: { fr: 'Directeur / Proviseur / Doyen', en: 'Head / Principal / Dean', scope: 'tenant', editable: true },
  teacher: { fr: 'Professeur', en: 'Teacher', scope: 'tenant', editable: true },
  education_assistant: { fr: 'Assistant d’éducation', en: 'Education assistant', scope: 'tenant', editable: true },
  accountant: { fr: 'Comptable / Intendance', en: 'Accountant / Bursar', scope: 'tenant', editable: true },
  student: { fr: 'Élève / Étudiant', en: 'Student', scope: 'tenant', editable: true },
  guardian: { fr: 'Parent / Tuteur', en: 'Parent / Guardian', scope: 'tenant', editable: true },
  inspector: { fr: 'Inspecteur (accès limité dans le temps)', en: 'Inspector (time-limited access)', scope: 'tenant', editable: true },
  visitor: { fr: 'Visiteur', en: 'Visitor', scope: 'none', editable: false },
};

/** Permissions of the roles. The defaults are data in packages/shared/src/rbac.ts; the root super-admin can grant or revoke any permission per role (kept in
 *  role_permission_overrides) and the change applies at once, platform-wide. The root keeps every right and 'tenants:manage' can never be granted. */
@Injectable()
export class PermissionsService {
  private mem: { role_code: string; permission: string; granted: boolean }[] = [];
  private loadedAt = 0;
  private userOv = new Map<string, { tenant: string; grant: string[]; revoke: string[] }>();
  private flags = new Map<string, { tenant: string; must_change_password: boolean; locked: boolean; locked_reason: string | null; flagged_at: string }>();
  constructor(private readonly audit: AuditService) {}

  /** Called by the guard before each decision (at most one query every 5 s). A failing load keeps the last known rules. */
  async refresh(force = false): Promise<void> {
    if (!force && Date.now() - this.loadedAt < 5000) return;
    this.loadedAt = Date.now();
    try {
      const p = sharedPool();
      const rows = p ? (await p.query('SELECT role_code, permission, granted FROM role_permission_overrides')).rows as typeof this.mem : this.mem;
      const o: RoleOverrides = {};
      for (const r of rows) { const e = (o[r.role_code as RoleCode] ??= { grant: [], revoke: [] }); (r.granted ? e.grant : e.revoke).push(r.permission); }
      setRoleOverrides(o);
      if (p) {
        const ov = new Map<string, { tenant: string; grant: string[]; revoke: string[] }>();
        for (const r of (await p.query('SELECT user_id, tenant_slug, permission, granted FROM user_permission_overrides')).rows) { const e = ov.get(r.user_id) ?? { tenant: r.tenant_slug, grant: [], revoke: [] }; (r.granted ? e.grant : e.revoke).push(r.permission); ov.set(r.user_id, e); }
        this.userOv = ov;
        const fl = new Map<string, { tenant: string; must_change_password: boolean; locked: boolean; locked_reason: string | null; flagged_at: string }>();
        for (const r of (await p.query('SELECT user_id, tenant_slug, must_change_password, locked, locked_reason, flagged_at FROM user_flags WHERE must_change_password OR locked')).rows) fl.set(r.user_id, { tenant: r.tenant_slug, must_change_password: r.must_change_password, locked: r.locked, locked_reason: r.locked_reason, flagged_at: new Date(r.flagged_at).toISOString() });
        this.flags = fl;
      }
    } catch { /* keep the previous rules */ }
  }

  // ---- one person -------------------------------------------------------------------------------------------------------------------------------
  /** Puts this person's own grants and withdrawals on the principal (only inside the school they were set for). */
  applyTo(p: Principal, tenant: string | undefined): void {
    const e = this.userOv.get(p.id); if (!e || e.tenant !== tenant) return;
    p.extraGrant = e.grant.filter((x) => !NON_GRANTABLE.includes(x)); p.extraRevoke = e.revoke;
  }
  flagsOf(id: string, tenant: string | undefined) { const f = this.flags.get(id); return f && f.tenant === tenant ? f : null; }
  userRights(id: string, tenant: string) { const e = this.userOv.get(id); return e && e.tenant === tenant ? { grant: [...e.grant], revoke: [...e.revoke] } : { grant: [], revoke: [] }; }

  async setUserRights(tenant: string, actor: string, userId: string, grant: string[], revoke: string[]) {
    const known = new Set(allPermissions());
    for (const x of [...grant, ...revoke]) if (!known.has(x) || NON_GRANTABLE.includes(x)) throw new BadRequestException(`unknown or reserved permission: ${x}`);
    const g = [...new Set(grant)].filter((x) => !revoke.includes(x)); const r = [...new Set(revoke)];
    const pool = sharedPool();
    if (!pool) { if (g.length || r.length) this.userOv.set(userId, { tenant, grant: g, revoke: r }); else this.userOv.delete(userId); }
    else {
      const c = await pool.connect();
      try {
        await c.query('BEGIN'); await c.query('DELETE FROM user_permission_overrides WHERE user_id = $1', [userId]);
        for (const x of g) await c.query('INSERT INTO user_permission_overrides(user_id, tenant_slug, permission, granted, updated_by) VALUES ($1,$2,$3,TRUE,$4)', [userId, tenant, x, actor]);
        for (const x of r) await c.query('INSERT INTO user_permission_overrides(user_id, tenant_slug, permission, granted, updated_by) VALUES ($1,$2,$3,FALSE,$4)', [userId, tenant, x, actor]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
      await this.refresh(true);
    }
    await this.audit.log({ actorId: actor, tenant, action: 'user.rights.update', entity: 'user', entityId: userId, details: { granted: g.length, withdrawn: r.length } });
    return { grant: g, revoke: r };
  }

  async setFlags(tenant: string, actor: string, userId: string, patch: { must_change_password?: boolean; locked?: boolean; locked_reason?: string | null }) {
    const cur = this.flags.get(userId); const next = { tenant, must_change_password: patch.must_change_password ?? cur?.must_change_password ?? false, locked: patch.locked ?? cur?.locked ?? false,
      locked_reason: patch.locked === false ? null : (patch.locked_reason ?? cur?.locked_reason ?? null), flagged_at: new Date().toISOString() };
    const pool = sharedPool();
    if (pool) {
      await pool.query(`INSERT INTO user_flags(user_id, tenant_slug, must_change_password, locked, locked_reason, flagged_at, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5,NOW(),$6,NOW())
        ON CONFLICT (user_id) DO UPDATE SET must_change_password = EXCLUDED.must_change_password, locked = EXCLUDED.locked, locked_reason = EXCLUDED.locked_reason, flagged_at = CASE WHEN EXCLUDED.must_change_password AND NOT user_flags.must_change_password THEN NOW() ELSE user_flags.flagged_at END, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [userId, tenant, next.must_change_password, next.locked, next.locked_reason, actor]);
      await this.refresh(true);
    } else if (next.must_change_password || next.locked) this.flags.set(userId, next); else this.flags.delete(userId);
    return this.flagsOf(userId, tenant) ?? { must_change_password: false, locked: false, locked_reason: null };
  }

  async matrix() {
    await this.refresh(true);
    const roles = Object.keys(ROLE_META).map((code) => {
      const eff = effectivePermissions(code as RoleCode); const def = ROLE_PERMISSIONS[code as RoleCode] ?? [];
      return { code, label_fr: ROLE_META[code].fr, label_en: ROLE_META[code].en, scope: ROLE_META[code].scope, editable: ROLE_META[code].editable,
        permissions: eff, changed: eff.length !== def.length || eff.some((x) => !def.includes(x)) };
    });
    return { roles, permissions: allPermissions().map((code) => ({ code, group: code.split(':')[0] })) };
  }

  private editable(code: string) {
    const m = ROLE_META[code]; if (!m) throw new NotFoundException('unknown role');
    if (!m.editable) throw new BadRequestException('this role cannot be modified');
  }
  async setRole(actor: string, code: string, permissions: unknown) {
    this.editable(code);
    if (!Array.isArray(permissions) || permissions.some((x) => typeof x !== 'string')) throw new BadRequestException('permissions must be a list of permission codes');
    const known = new Set(allPermissions()); const want = [...new Set(permissions as string[])];
    const bad = want.filter((x) => !known.has(x)); if (bad.length) throw new BadRequestException(`unknown permission: ${bad.slice(0, 3).join(', ')}`);
    const def = ROLE_PERMISSIONS[code as RoleCode] ?? [];
    const rows = [...want.filter((x) => !def.includes(x)).map((x) => ({ role_code: code, permission: x, granted: true })), ...def.filter((x) => !want.includes(x)).map((x) => ({ role_code: code, permission: x, granted: false }))];
    await this.store(code, rows, actor);
    await this.audit.log({ actorId: actor, action: 'role.permissions.update', entity: 'role', entityId: code, details: { granted: rows.filter((r) => r.granted).length, revoked: rows.filter((r) => !r.granted).length } });
    await this.refresh(true);
    return (await this.matrix()).roles.find((r) => r.code === code);
  }
  async reset(actor: string, code: string) {
    this.editable(code);
    await this.store(code, [], actor);
    await this.audit.log({ actorId: actor, action: 'role.permissions.reset', entity: 'role', entityId: code });
    await this.refresh(true);
    return (await this.matrix()).roles.find((r) => r.code === code);
  }
  private async store(code: string, rows: { role_code: string; permission: string; granted: boolean }[], actor: string) {
    const p = sharedPool();
    if (!p) { this.mem = [...this.mem.filter((r) => r.role_code !== code), ...rows]; return; }
    const c = await p.connect();
    try {
      await c.query('BEGIN');
      await c.query('DELETE FROM role_permission_overrides WHERE role_code = $1', [code]);
      for (const r of rows) await c.query('INSERT INTO role_permission_overrides(role_code, permission, granted, updated_by) VALUES ($1,$2,$3,$4)', [r.role_code, r.permission, r.granted, actor]);
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
}
