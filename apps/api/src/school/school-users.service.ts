import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NON_GRANTABLE, allPermissions, effectivePermissions, principalHas, type Principal, type RoleCode } from '@ecolemanager/shared';
import { AuditService } from '../core/audit.service';
import { PermissionsService } from '../core/permissions.service';
import { TenantDb } from '../pedagogy/tenant-db.service';
import { AccountsAdminService, CREATABLE_ROLES } from '../admin/accounts.service';

/** Seniority inside a school: a person manages only accounts of a lower level than their own. */
const RANK: Record<string, number> = { tenant_super_admin: 5, admin: 4, head: 3, accountant: 2, teacher: 2, education_assistant: 2, student: 1, guardian: 1, inspector: 1 };
const rankOf = (roles: string[]) => Math.max(0, ...roles.map((r) => RANK[r] ?? 0));

/** User administration for the people who run a school. Same operations as the root's account screen, but fenced to one school and to lower roles. */
@Injectable()
export class SchoolUsersService {
  constructor(private readonly accounts: AccountsAdminService, private readonly perms: PermissionsService, private readonly db: TenantDb, private readonly audit: AuditService) {}

  private async rows(slug: string) { return (await this.accounts.list(slug)).filter((r: any) => !r.is_root); }
  private async target(slug: string, p: Principal, id: string, allowSelf = false) {
    const row = (await this.rows(slug)).find((r: any) => r.id === id);
    if (!row) throw new NotFoundException('unknown account in this school');
    if (!allowSelf && row.id === p.id) throw new ForbiddenException('you cannot do this to your own account');
    if (!p.isRoot && rankOf(p.roles) <= (RANK[row.role] ?? 0)) throw new ForbiddenException('this account is at your level or above');
    return row;
  }
  /** Roles this person may hand out: strictly below their own level. */
  assignable(p: Principal) { return CREATABLE_ROLES.filter((r) => p.isRoot || (RANK[r] ?? 0) < rankOf(p.roles)); }

  async list(slug: string, p: Principal) {
    const rows = await this.rows(slug); const mine = rankOf(p.roles);
    return { assignable_roles: this.assignable(p), users: rows.map((r: any) => ({ ...r, manageable: r.id !== p.id && (p.isRoot || mine > (RANK[r.role] ?? 0)) })) };
  }
  async detail(slug: string, p: Principal, id: string) {
    const row = await this.target(slug, p, id, true);
    const extra = await this.accounts.detail(id).catch(() => null);
    const f = this.perms.flagsOf(id, slug);
    return { ...row, ...(extra ?? {}), locked: f?.locked ?? false, locked_reason: f?.locked_reason ?? null, must_change_password: f?.must_change_password ?? false, manageable: row.id !== p.id && (p.isRoot || rankOf(p.roles) > (RANK[row.role] ?? 0)) };
  }
  async create(slug: string, p: Principal, b: any) {
    if (!this.assignable(p).includes(b?.role)) throw new ForbiddenException(`you may create: ${this.assignable(p).join(', ') || 'nothing'}`);
    return this.accounts.create(p.id, { ...b, school_slug: slug });
  }
  async setActive(slug: string, p: Principal, id: string, active: unknown) { await this.target(slug, p, id); return this.accounts.setActive(p.id, id, active); }
  async resetPassword(slug: string, p: Principal, id: string, b: any) { await this.target(slug, p, id); return this.accounts.resetPassword(p.id, id, b); }
  async closeSessions(slug: string, p: Principal, id: string) { await this.target(slug, p, id); return this.accounts.closeSessions(p.id, id); }
  async trash(slug: string, p: Principal, id: string) { await this.target(slug, p, id); return this.accounts.trash(p.id, id); }

  // ---- individual rights, locking, forced password change, history, "view as" ------------------------------------------------------------------
  /** What this person has through their role, what was added or withdrawn for them alone, and what the caller may hand out (never more than the caller holds). */
  async rights(slug: string, p: Principal, id: string) {
    const row = await this.target(slug, p, id);
    const mine = this.perms.userRights(id, slug);
    const grantable = allPermissions().filter((x) => !NON_GRANTABLE.includes(x) && (p.isRoot || principalHas(p, x)));
    return { role: row.role, role_permissions: effectivePermissions(row.role as RoleCode), grant: mine.grant, revoke: mine.revoke, grantable, all: allPermissions().filter((x) => !NON_GRANTABLE.includes(x)) };
  }
  async setRights(slug: string, p: Principal, id: string, b: any) {
    const row = await this.target(slug, p, id);
    const list = (x: unknown, n: string): string[] => { if (x === undefined) return []; if (!Array.isArray(x) || x.some((v) => typeof v !== 'string')) throw new BadRequestException(`${n} must be a list of permission codes`); return x as string[]; };
    const grant = list(b?.grant, 'grant'); const revoke = list(b?.revoke, 'revoke');
    const roleHas = new Set(effectivePermissions(row.role as RoleCode));
    for (const x of grant) { if (!p.isRoot && !principalHas(p, x)) throw new ForbiddenException(`you cannot give a right you do not hold: ${x}`); if (roleHas.has(x)) throw new BadRequestException(`already part of the role: ${x}`); }
    for (const x of revoke) if (!roleHas.has(x)) throw new BadRequestException(`not part of the role, nothing to withdraw: ${x}`);
    return this.perms.setUserRights(slug, p.id, id, grant, revoke);
  }
  async setLocked(slug: string, p: Principal, id: string, locked: unknown, reason: unknown) {
    if (typeof locked !== 'boolean') throw new BadRequestException('locked must be boolean');
    await this.target(slug, p, id);
    const f = await this.perms.setFlags(slug, p.id, id, { locked, locked_reason: typeof reason === 'string' ? reason.trim().slice(0, 200) || null : null });
    if (locked) await this.accounts.closeSessions(p.id, id).catch(() => undefined);   // the lock refuses every call at once; closing sessions also stops the refresh
    await this.audit.log({ actorId: p.id, tenant: slug, action: locked ? 'user.lock' : 'user.unlock', entity: 'user', entityId: id });
    return { locked: f.locked };
  }
  async forcePasswordChange(slug: string, p: Principal, id: string, on: unknown) {
    if (typeof on !== 'boolean') throw new BadRequestException('must_change_password must be boolean');
    await this.target(slug, p, id);
    const f = await this.perms.setFlags(slug, p.id, id, { must_change_password: on });
    await this.audit.log({ actorId: p.id, tenant: slug, action: on ? 'user.force_password_change' : 'user.cancel_force_password_change', entity: 'user', entityId: id });
    return { must_change_password: f.must_change_password };
  }
  async history(slug: string, p: Principal, id: string) { await this.target(slug, p, id, true); return this.accounts.loginHistory(id); }

  /** Called by the person themselves after changing their password: lifts the forced change once the identity provider shows the password really changed. */
  async passwordChanged(slug: string, p: Principal) {
    const f = this.perms.flagsOf(p.id, slug); if (!f?.must_change_password) return { must_change_password: false };
    const at = await this.accounts.authUpdatedAt(p.id);
    if (at && at.getTime() <= new Date(f.flagged_at).getTime()) throw new BadRequestException('the password has not been changed yet');
    await this.perms.setFlags(slug, p.id, p.id, { must_change_password: false });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'user.password_changed', entity: 'user', entityId: p.id });
    return { must_change_password: false };
  }

  /** Read-only "view as": the principal of a lower-ranked person of this school, built from the same directory the sign-in token comes from. */
  async viewAsPrincipal(slug: string, caller: Principal, id: string): Promise<Principal> {
    const row = await this.target(slug, caller, id);
    const d = (await this.db.run(slug, (q) => q('SELECT class_ids, child_ids, student_id FROM directory WHERE user_id = $1', [id])))[0] ?? {};
    return { id, roles: [row.role as RoleCode], isRoot: false, tenantId: slug, classIds: d.class_ids?.length ? d.class_ids : undefined, childIds: d.child_ids?.length ? d.child_ids : undefined, studentId: d.student_id ?? undefined, impersonatedBy: caller.id };
  }
}

