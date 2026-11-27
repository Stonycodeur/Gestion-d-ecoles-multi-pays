import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { sharedPool } from '../core/shared-pool';
import { AuditService } from '../core/audit.service';
import { DEFAULT_DIGITS, GeoService, fold, type OverlayRow } from './geo.service';

const text = (v: unknown, what: string, opt = false, max = 80): string => {
  if ((v === undefined || v === null || v === '') && opt) return '';
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw new BadRequestException(`${what} is required (max ${max} characters)`);
  return v.trim();
};
const exists = () => new ConflictException({ message: 'exists', statusCode: 409 });
const inTrash = () => new ConflictException({ message: 'in_trash', statusCode: 409 });
const inUse = () => new ConflictException({ message: 'has_children', statusCode: 409 });

export interface TrashEntry { kind: 'geo'; id: string; label: string; detail: string; deleted_at: string; deleted_by: string | null }

/** Add, rename and trash continents, countries, provinces and cities (root super-admin). The bundled dataset is never modified: edits live in geo_entries.
 *  Creating something that already exists answers 409 `exists` (or `in_trash` when a trashed entry holds the name) so the screen can say so. */
@Injectable()
export class GeoAdminService {
  private mem: OverlayRow[] = []; private seq = 1;
  constructor(private readonly geo: GeoService, private readonly audit: AuditService) { geo.setLoader(() => this.all()); }

  private async all(): Promise<OverlayRow[]> {
    const p = sharedPool(); if (!p) return this.mem.map((r) => ({ ...r }));
    return (await p.query('SELECT id::int AS id, kind, code, parent, data, deleted_at, deleted_by FROM geo_entries')).rows;
  }
  private async put(kind: OverlayRow['kind'], code: string, parent: string, data: Record<string, any>, del: string | null = null): Promise<void> {
    const p = sharedPool();
    if (p) {
      await p.query(`INSERT INTO geo_entries(kind, code, parent, data, deleted_at, deleted_by) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (kind, code, parent) DO UPDATE SET data = EXCLUDED.data, deleted_at = EXCLUDED.deleted_at, deleted_by = EXCLUDED.deleted_by`,
        [kind, code, parent, JSON.stringify(data), del ? new Date() : null, del]);
    } else {
      const old = this.mem.find((r) => r.kind === kind && r.code === code && r.parent === parent);
      const row: OverlayRow = { id: old?.id ?? this.seq++, kind, code, parent, data, deleted_at: del ? new Date().toISOString() : null, deleted_by: del };
      if (old) Object.assign(old, row); else this.mem.push(row);
    }
    await this.geo.refresh(true);
  }
  private async schoolsIn(country: string, region?: string): Promise<number> {
    const p = sharedPool(); if (!p) return 0;
    const r = region === undefined
      ? await p.query('SELECT count(*)::int AS n FROM public.tenants WHERE country_code = $1 AND deleted_at IS NULL', [country])
      : await p.query('SELECT count(*)::int AS n FROM public.tenants WHERE country_code = $1 AND region = $2 AND deleted_at IS NULL', [country, region]);
    return r.rows[0].n as number;
  }
  private guardName(clash: boolean, kind: OverlayRow['kind'], code: string, parent: string) {
    if (clash) throw exists();
    const t = this.geo.rowOf(kind, code, parent); if (t?.deleted_at && !t.data.purged) throw inTrash();
  }

  // ----- continents
  async createContinent(actor: string, b: any) {
    await this.geo.refresh(true);
    const code = typeof b?.code === 'string' ? b.code.trim().toUpperCase() : '';
    if (!/^[A-Z]{2,3}$/.test(code)) throw new BadRequestException('code must be 2 or 3 letters');
    const fr = text(b?.fr, 'fr'); const en = text(b?.en ?? b?.fr, 'en'); const ar = text(b?.ar, 'ar', true);
    this.guardName(this.geo.continents().some((k) => k.code === code || fold(k.fr) === fold(fr) || fold(k.en) === fold(en)), 'continent', code, '');
    await this.put('continent', code, '', { fr, en, ...(ar ? { ar } : {}), custom: true });
    await this.audit.log({ actorId: actor, action: 'geo.continent.create', entity: 'continent', entityId: code });
    return { code, fr, en, ar: ar || en };
  }
  async updateContinent(actor: string, code: string, b: any) {
    await this.geo.refresh(true);
    const cur = this.geo.continents().find((k) => k.code === code); if (!cur) throw new NotFoundException('unknown continent');
    const fr = text(b?.fr ?? cur.fr, 'fr'); const en = text(b?.en ?? cur.en, 'en'); const ar = text(b?.ar ?? cur.ar, 'ar', true);
    if (this.geo.continents().some((k) => k.code !== code && (fold(k.fr) === fold(fr) || fold(k.en) === fold(en)))) throw exists();
    const old = this.geo.rowOf('continent', code, '');
    await this.put('continent', code, '', { ...(old?.data ?? {}), fr, en, ...(ar ? { ar } : {}) });
    await this.audit.log({ actorId: actor, action: 'geo.continent.update', entity: 'continent', entityId: code });
    return { code, fr, en, ar };
  }
  async trashContinent(actor: string, code: string) {
    await this.geo.refresh(true);
    const cur = this.geo.continents().find((k) => k.code === code); if (!cur) throw new NotFoundException('unknown continent');
    if (this.geo.countries(code).length) throw inUse();
    await this.put('continent', code, '', { ...(this.geo.rowOf('continent', code, '')?.data ?? {}), label: cur.fr }, actor);
    await this.audit.log({ actorId: actor, action: 'geo.continent.trash', entity: 'continent', entityId: code });
    return { trashed: true };
  }

  // ----- countries
  private countryFields(b: any, cur?: Record<string, any>) {
    const out: Record<string, any> = {};
    if (b?.n !== undefined || !cur) out.n = text(b?.n, 'n');
    if (b?.fr !== undefined || !cur) out.fr = text(b?.fr ?? b?.n, 'fr');
    if (b?.k !== undefined || !cur) { const k = text(b?.k, 'k'); if (!this.geo.continents().some((x) => x.code === k)) throw new BadRequestException('unknown continent'); out.k = k; }
    if (b?.ph !== undefined || !cur) { const ph = String(b?.ph ?? '').replace(/^\+/, '').trim(); if (!/^[0-9]{1,4}$/.test(ph)) throw new BadRequestException('ph: dialling code, 1 to 4 digits'); out.ph = ph; }
    if (b?.cur !== undefined && b.cur !== '') { const c = String(b.cur).trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(c)) throw new BadRequestException('cur: ISO 4217 code'); out.cur = c; }
    if (b?.tz !== undefined && b.tz !== '') { const z = String(b.tz).trim(); if (!/^[A-Za-z_]+(\/[A-Za-z_0-9+-]+)*$/.test(z) || z.length > 40) throw new BadRequestException('tz: IANA time zone'); out.tz = z; }
    if (b?.cap !== undefined) out.cap = text(b.cap, 'cap', true);
    if (b?.d !== undefined) {
      const [lo, hi] = Array.isArray(b.d) ? b.d.map(Number) : [NaN, NaN];
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 3 || hi > 15 || lo > hi) throw new BadRequestException('d: [min, max] digits between 3 and 15');
      out.d = [lo, hi];
    }
    return out;
  }
  async createCountry(actor: string, b: any) {
    await this.geo.refresh(true);
    const code = typeof b?.code === 'string' ? b.code.trim().toUpperCase() : '';
    if (!/^[A-Z]{2}$/.test(code)) throw new BadRequestException('code must be the 2-letter ISO code');
    const f = this.countryFields({ ...b, d: b?.d ?? DEFAULT_DIGITS });
    const all = this.geo.countries();
    this.guardName(all.some((c) => c.c === code || fold(c.n) === fold(f.n) || fold(c.fr) === fold(f.fr)), 'country', code, '');
    await this.put('country', code, '', { ...f, custom: true });
    await this.audit.log({ actorId: actor, action: 'geo.country.create', entity: 'country', entityId: code });
    return this.geo.country(code);
  }
  async updateCountry(actor: string, iso: string, b: any) {
    await this.geo.refresh(true);
    const cur = this.geo.country(iso);
    const f = this.countryFields(b, cur as any);
    if (this.geo.countries().some((c) => c.c !== cur.c && ((f.n && fold(c.n) === fold(f.n)) || (f.fr && fold(c.fr) === fold(f.fr))))) throw exists();
    await this.put('country', cur.c, '', { ...(this.geo.rowOf('country', cur.c, '')?.data ?? {}), ...f });
    await this.audit.log({ actorId: actor, action: 'geo.country.update', entity: 'country', entityId: cur.c });
    return this.geo.country(cur.c);
  }
  async trashCountry(actor: string, iso: string) {
    await this.geo.refresh(true);
    const cur = this.geo.country(iso);
    if (await this.schoolsIn(cur.c)) throw inUse();
    await this.put('country', cur.c, '', { ...(this.geo.rowOf('country', cur.c, '')?.data ?? {}), label: cur.fr }, actor);
    await this.audit.log({ actorId: actor, action: 'geo.country.trash', entity: 'country', entityId: cur.c });
    return { trashed: true };
  }

  // ----- provinces
  async createRegion(actor: string, iso: string, b: any) {
    await this.geo.refresh(true);
    const c = this.geo.country(iso); const name = text(b?.name, 'name'); const key = `c:${fold(name)}`;
    this.guardName(this.geo.effRegions(c.c).some((r) => fold(r.name) === fold(name)), 'region', key, c.c);
    await this.put('region', key, c.c, { n: name, custom: true });
    await this.audit.log({ actorId: actor, action: 'geo.region.create', entity: 'region', entityId: `${c.c}:${name}` });
    return { name };
  }
  private region(iso: string, id: number) {
    const r = this.geo.effRegions(iso).find((x) => x.id === id); if (!r) throw new NotFoundException('unknown region');
    return r;
  }
  async updateRegion(actor: string, iso: string, id: number, b: any) {
    await this.geo.refresh(true);
    const c = this.geo.country(iso); const r = this.region(c.c, id); const name = text(b?.name, 'name');
    if (this.geo.effRegions(c.c).some((x) => x.key !== r.key && fold(x.name) === fold(name))) throw exists();
    await this.put('region', r.key, c.c, { ...(this.geo.rowOf('region', r.key, c.c)?.data ?? {}), n: name });
    await this.audit.log({ actorId: actor, action: 'geo.region.update', entity: 'region', entityId: `${c.c}:${name}` });
    return { id, name };
  }
  async trashRegion(actor: string, iso: string, id: number) {
    await this.geo.refresh(true);
    const c = this.geo.country(iso); const r = this.region(c.c, id);
    if (await this.schoolsIn(c.c, r.name)) throw inUse();
    await this.put('region', r.key, c.c, { ...(this.geo.rowOf('region', r.key, c.c)?.data ?? {}), label: r.name }, actor);
    await this.audit.log({ actorId: actor, action: 'geo.region.trash', entity: 'region', entityId: `${c.c}:${r.name}` });
    return { trashed: true };
  }

  // ----- cities
  async createCity(actor: string, iso: string, b: any) {
    await this.geo.refresh(true);
    const c = this.geo.country(iso); const reg = this.region(c.c, Number(b?.region_id)); const name = text(b?.name, 'name');
    const code = `${reg.key}|${fold(name)}`;
    this.guardName(this.geo.cities(c.c, reg.id, name, 1e9).some((x) => fold(x.name) === fold(name)), 'city', code, c.c);
    await this.put('city', code, c.c, { name, region: reg.name, rk: reg.key, custom: true });
    await this.audit.log({ actorId: actor, action: 'geo.city.create', entity: 'city', entityId: `${c.c}:${name}` });
    return { name, region: reg.name };
  }
  async trashCity(actor: string, iso: string, b: any) {
    await this.geo.refresh(true);
    const c = this.geo.country(iso); const reg = this.region(c.c, Number(b?.region_id)); const name = text(b?.name, 'name');
    const hit = this.geo.cities(c.c, reg.id, name, 1e9).find((x) => fold(x.name) === fold(name)); if (!hit) throw new NotFoundException('unknown city');
    const code = `${reg.key}|${fold(name)}`;
    const old = this.geo.rowOf('city', code, c.c);
    await this.put('city', code, c.c, { ...(old?.data ?? { name: hit.name, region: reg.name, rk: reg.key }), label: hit.name }, actor);
    await this.audit.log({ actorId: actor, action: 'geo.city.trash', entity: 'city', entityId: `${c.c}:${hit.name}` });
    return { trashed: true };
  }

  // ----- trash
  async listTrash(): Promise<TrashEntry[]> {
    await this.geo.refresh(true);
    const KIND: Record<string, string> = { continent: 'Continent', country: 'Pays', region: 'Province', city: 'Ville' };
    return this.geo.trashedRows().map((r) => ({
      kind: 'geo' as const, id: String(r.id), label: String(r.data.label ?? r.data.n ?? r.data.name ?? r.data.fr ?? r.code),
      detail: `${KIND[r.kind]}${r.parent ? ` · ${r.parent}` : ''}`, deleted_at: new Date(r.deleted_at as string).toISOString(), deleted_by: r.deleted_by,
    })).sort((a, b) => b.deleted_at.localeCompare(a.deleted_at));
  }
  private trashed(id: string): OverlayRow {
    const r = this.geo.rowById(Number(id));
    if (!r || !r.deleted_at || r.data.purged) throw new NotFoundException('not in the trash');
    return r;
  }
  async restore(actor: string, id: string) {
    await this.geo.refresh(true);
    const r = this.trashed(id);
    await this.put(r.kind, r.code, r.parent, r.data, null);
    await this.audit.log({ actorId: actor, action: `geo.${r.kind}.restore`, entity: r.kind, entityId: r.code });
    return { restored: true };
  }
  /** Entries added by hand are deleted for good. A bundled entry cannot disappear from the dataset: it stays hidden and leaves the trash. */
  async purge(actor: string, id: string) {
    await this.geo.refresh(true);
    const r = this.trashed(id);
    const p = sharedPool();
    if (r.data.custom) {
      if (p) await p.query('DELETE FROM geo_entries WHERE id = $1', [r.id]);
      else this.mem = this.mem.filter((x) => x.id !== r.id);
      await this.geo.refresh(true);
    } else await this.put(r.kind, r.code, r.parent, { ...r.data, purged: true }, r.deleted_by ?? actor);
    await this.audit.log({ actorId: actor, action: `geo.${r.kind}.purge`, entity: r.kind, entityId: r.code });
    return { purged: true };
  }
}
