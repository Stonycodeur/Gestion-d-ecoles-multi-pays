import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { Principal } from '@ecolemanager/shared';
import { AccountsAdminService, CREATABLE_ROLES } from '../admin/accounts.service';

/** Seniority inside a school: a person manages only accounts of a lower level than their own. */
const RANK: Record<string, number> = { tenant_super_admin: 5, admin: 4, head: 3, accountant: 2, teacher: 2, education_assistant: 2, student: 1, guardian: 1, inspector: 1 };
const rankOf = (roles: string[]) => Math.max(0, ...roles.map((r) => RANK[r] ?? 0));

/** User administration for the people who run a school. Same operations as the root's account screen, but fenced to one school and to lower roles. */
@Injectable()
export class SchoolUsersService {
  constructor(private readonly accounts: AccountsAdminService) {}

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
    return { ...row, ...(extra ?? {}), manageable: row.id !== p.id && (p.isRoot || rankOf(p.roles) > (RANK[row.role] ?? 0)) };
  }
  async create(slug: string, p: Principal, b: any) {
    if (!this.assignable(p).includes(b?.role)) throw new ForbiddenException(`you may create: ${this.assignable(p).join(', ') || 'nothing'}`);
    return this.accounts.create(p.id, { ...b, school_slug: slug });
  }
  async setActive(slug: string, p: Principal, id: string, active: unknown) { await this.target(slug, p, id); return this.accounts.setActive(p.id, id, active); }
  async resetPassword(slug: string, p: Principal, id: string, b: any) { await this.target(slug, p, id); return this.accounts.resetPassword(p.id, id, b); }
  async closeSessions(slug: string, p: Principal, id: string) { await this.target(slug, p, id); return this.accounts.closeSessions(p.id, id); }
  async trash(slug: string, p: Principal, id: string) { await this.target(slug, p, id); return this.accounts.trash(p.id, id); }
}

