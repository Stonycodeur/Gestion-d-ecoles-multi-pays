import { BadRequestException, Injectable } from '@nestjs/common';
import { GeoAdminService } from '../geo/geo-admin.service';
import { TenantsService } from '../school/tenants.service';
import { AccountsAdminService } from './accounts.service';

export const RETENTION_DAYS = 90;
export type TrashKind = 'school' | 'account' | 'geo';
export interface TrashItem { kind: TrashKind; id: string; label: string; detail: string; deleted_at: string; deleted_by: string | null; purge_at: string; overdue: boolean }
const KINDS: TrashKind[] = ['school', 'account', 'geo'];

/** One trash for everything the root can delete: schools, accounts and geography. Items are kept 90 days, then flagged "overdue"; nothing is erased without an explicit action. */
@Injectable()
export class TrashService {
  constructor(private readonly geo: GeoAdminService, private readonly tenants: TenantsService, private readonly accounts: AccountsAdminService) {}

  private item(kind: TrashKind, id: string, label: string, detail: string, at: Date | string, by: string | null): TrashItem {
    const d = new Date(at); const purge = new Date(d.getTime() + RETENTION_DAYS * 86_400_000);
    return { kind, id, label, detail, deleted_at: d.toISOString(), deleted_by: by, purge_at: purge.toISOString(), overdue: purge.getTime() < Date.now() };
  }
  async list(kind?: string): Promise<TrashItem[]> {
    if (kind !== undefined && kind !== '' && !KINDS.includes(kind as TrashKind)) throw new BadRequestException(`kind must be one of ${KINDS.join(', ')}`);
    const want = (k: TrashKind) => !kind || kind === k;
    const out: TrashItem[] = [];
    if (want('school')) for (const s of await this.tenants.trashed().catch(() => [])) out.push(this.item('school', s.slug, s.name, `${s.slug} · ${s.country_code}${s.city ? ` · ${s.city}` : ''}`, s.deleted_at, s.deleted_by));
    if (want('account')) for (const a of await this.accounts.listTrashed()) out.push(this.item('account', a.id, a.email, `${a.role ?? '—'}${a.school_name ? ` · ${a.school_name}` : ''}`, a.deleted_at, a.deleted_by));
    if (want('geo')) for (const g of await this.geo.listTrash()) out.push(this.item('geo', g.id, g.label, g.detail, g.deleted_at, g.deleted_by));
    return out.sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  }
  private kind(k: string): TrashKind { if (!KINDS.includes(k as TrashKind)) throw new BadRequestException(`kind must be one of ${KINDS.join(', ')}`); return k as TrashKind; }
  restore(actor: string, kind: string, id: string) {
    switch (this.kind(kind)) { case 'school': return this.tenants.restore(actor, id); case 'account': return this.accounts.restore(actor, id); default: return this.geo.restore(actor, id); }
  }
  purge(actor: string, kind: string, id: string, confirm?: string) {
    switch (this.kind(kind)) { case 'school': return this.tenants.purge(actor, id, confirm); case 'account': return this.accounts.purge(actor, id); default: return this.geo.purge(actor, id); }
  }
  /** "Empty the trash": accounts and geography. A school is never emptied in bulk; each one needs its code typed. */
  async empty(actor: string) {
    let purged = 0; const failed: string[] = [];
    for (const i of await this.list()) {
      if (i.kind === 'school') continue;
      try { await this.purge(actor, i.kind, i.id); purged++; } catch { failed.push(i.label); }
    }
    return { purged, failed };
  }
}
