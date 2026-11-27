import { Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export interface GeoCountry { c: string; i3: string; n: string; fr: string; nat: string; k: string; sr: string; cap: string; cur: string; ph: string; tz: string | null; em: string; la: string | null; lo: string | null; d: [number, number]; custom?: boolean }
export interface GeoRegion { id: number; c: string; n: string; t: string; la: string | null; lo: string | null; ci: [string, string | null, string | null][] }
export interface OverlayRow { id: number; kind: 'continent' | 'country' | 'region' | 'city'; code: string; parent: string; data: Record<string, any>; deleted_at: string | null; deleted_by: string | null }
interface Catalog { continents: { code: string; fr: string; en: string; ar: string }[]; countries: Omit<GeoCountry, 'd'>[] }
interface EffRegion { key: string; id: number; name: string; type: string; base?: GeoRegion; custom: boolean }

export const DEFAULT_DIGITS: [number, number] = [6, 12];
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** World geography (continents, countries, provinces, cities): the bundled dataset (apps/api/geo-data, built by tools/build-geo.py) plus what the root super-admin
 *  added, renamed or trashed (table geo_entries, loaded by GeoAdminService). Nothing national is coded: it is reference data. */
@Injectable()
export class GeoService {
  private catalog?: Catalog;
  private cache = new Map<string, GeoRegion[]>();
  private rows: OverlayRow[] = [];
  private loadedAt = 0;
  private loader?: () => Promise<OverlayRow[]>;

  setLoader(fn: () => Promise<OverlayRow[]>) { this.loader = fn; }
  setOverlay(rows: OverlayRow[]) { this.rows = rows; this.loadedAt = Date.now(); }
  /** Reloads the edits (at most every 5 s unless forced). A failing load keeps the previous edits: the bundled dataset always works. */
  async refresh(force = false): Promise<void> {
    if (!this.loader || (!force && Date.now() - this.loadedAt < 5000)) return;
    try { this.setOverlay(await this.loader()); } catch { this.loadedAt = Date.now(); }
  }
  rowOf(kind: OverlayRow['kind'], code: string, parent = ''): OverlayRow | undefined { return this.rows.find((r) => r.kind === kind && r.code === code && r.parent === parent); }
  rowById(id: number): OverlayRow | undefined { return this.rows.find((r) => r.id === id); }
  trashedRows(): OverlayRow[] { return this.rows.filter((r) => r.deleted_at && !r.data.purged); }
  private ov(kind: OverlayRow['kind']) { return this.rows.filter((r) => r.kind === kind); }

  private dir(): string {
    if (process.env.GEO_DIR) return process.env.GEO_DIR;
    let d = __dirname;
    for (let i = 0; i < 6; i++) { if (existsSync(join(d, 'geo-data', 'countries.json'))) return join(d, 'geo-data'); d = dirname(d); }
    throw new Error('geo-data not found (set GEO_DIR)');
  }
  private cat(): Catalog { return (this.catalog ??= JSON.parse(readFileSync(join(this.dir(), 'countries.json'), 'utf8')) as Catalog); }

  continents() {
    const n: Record<string, number> = {};
    for (const c of this.countries()) n[c.k] = (n[c.k] ?? 0) + 1;
    const rows = this.ov('continent');
    const dead = new Set(rows.filter((r) => r.deleted_at).map((r) => r.code));
    const live = new Map(rows.filter((r) => !r.deleted_at).map((r) => [r.code, r.data]));
    const names = (d?: Record<string, any>) => ({ ...(d?.fr ? { fr: d.fr } : {}), ...(d?.en ? { en: d.en } : {}), ...(d?.ar ? { ar: d.ar } : {}) });
    const bundled = this.cat().continents;
    const base = bundled.filter((k) => !dead.has(k.code)).map((k) => ({ ...k, ...names(live.get(k.code)), custom: false }));
    const added = rows.filter((r) => !r.deleted_at && !bundled.some((k) => k.code === r.code)).map((r) => ({ code: r.code, fr: r.data.fr ?? r.data.en, en: r.data.en ?? r.data.fr, ar: r.data.ar ?? r.data.en ?? r.data.fr, custom: true }));
    return [...base, ...added].map((k) => ({ ...k, countries: n[k.code] ?? 0 }));
  }
  countries(continent?: string, q?: string): GeoCountry[] {
    const needle = q ? fold(q) : '';
    const rows = this.ov('country');
    const dead = new Set(rows.filter((r) => r.deleted_at).map((r) => r.code));
    const live = new Map(rows.filter((r) => !r.deleted_at).map((r) => [r.code, r.data]));
    const bundled = this.cat().countries;
    const edit = (d: Record<string, any>) => ({ ...(d.n ? { n: d.n } : {}), ...(d.fr ? { fr: d.fr } : {}), ...(d.k ? { k: d.k } : {}), ...(d.ph ? { ph: d.ph } : {}), ...(d.cur ? { cur: d.cur } : {}), ...(d.tz ? { tz: d.tz } : {}), ...(d.cap !== undefined ? { cap: d.cap } : {}), ...(d.d ? { d: d.d } : {}) });
    const base: GeoCountry[] = bundled.filter((c) => !dead.has(c.c)).map((c) => ({ d: DEFAULT_DIGITS, ...c, ...edit(live.get(c.c) ?? {}) }));
    const added: GeoCountry[] = rows.filter((r) => !r.deleted_at && !bundled.some((c) => c.c === r.code)).map((r) => ({
      c: r.code, i3: r.data.i3 ?? r.code, n: r.data.n, fr: r.data.fr ?? r.data.n, nat: '', k: r.data.k, sr: '', cap: r.data.cap ?? '', cur: r.data.cur ?? '', ph: r.data.ph ?? '', tz: r.data.tz ?? null, em: '', la: null, lo: null, d: r.data.d ?? DEFAULT_DIGITS, custom: true,
    }));
    return [...base, ...added].filter((c) => (!continent || c.k === continent) && (!needle || fold(c.n).includes(needle) || fold(c.fr).includes(needle) || fold(c.nat).includes(needle) || c.c.toLowerCase() === needle));
  }
  country(iso: string): GeoCountry {
    const code = iso.toUpperCase();
    const c = this.countries().find((x) => x.c === code);
    if (!c) throw new NotFoundException('unknown country');
    return c;
  }
  private load(code: string): GeoRegion[] {
    const hit = this.cache.get(code); if (hit) return hit;
    const file = join(this.dir(), 'regions', `${code}.json.gz`);
    if (!existsSync(file)) return [];          // a country added by hand has no bundled provinces
    const regs = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8')) as GeoRegion[];
    if (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(code, regs); return regs;
  }
  /** Provinces after the edits: bundled ones (key = dataset id) minus the trashed, renamed ones, plus the ones added by hand (key = `c:<name>`, negative id). */
  effRegions(iso: string): EffRegion[] { return this.regionsOf(this.country(iso).c); }
  private regionsOf(code: string): EffRegion[] {
    const rows = this.ov('region').filter((r) => r.parent === code);
    const dead = new Set(rows.filter((r) => r.deleted_at).map((r) => r.code));
    const edit = new Map(rows.filter((r) => !r.deleted_at).map((r) => [r.code, r.data]));
    const out: EffRegion[] = [];
    for (const b of this.load(code)) { const key = String(b.id); if (!dead.has(key)) out.push({ key, id: b.id, name: (edit.get(key)?.n as string | undefined) ?? b.n, type: b.t, base: b, custom: false }); }
    for (const r of rows) if (!r.deleted_at && r.code.startsWith('c:')) out.push({ key: r.code, id: -Number(r.id), name: r.data.n, type: r.data.t ?? 'region', custom: true });
    return out;
  }
  regions(iso: string) {
    const code = this.country(iso).c;
    const rows = this.ov('city').filter((r) => r.parent === code);
    const dead = new Set(rows.filter((r) => r.deleted_at).map((r) => r.code));
    return this.regionsOf(code).map((r) => ({
      id: r.id, code: r.base?.c ?? '', name: r.name, type: r.type, custom: r.custom,
      cities: (r.base?.ci ?? []).filter(([n]) => !dead.has(`${r.key}|${fold(n)}`)).length + rows.filter((x) => !x.deleted_at && x.data.rk === r.key).length,
    }));
  }
  cities(iso: string, regionId?: number, q?: string, limit = 50) {
    const code = this.country(iso).c;
    const needle = q ? fold(q) : '';
    const rows = this.ov('city').filter((r) => r.parent === code);
    const dead = new Set(rows.filter((r) => r.deleted_at).map((r) => r.code));
    const out: { name: string; region: string; lat: string | null; lng: string | null; custom?: boolean }[] = [];
    for (const reg of this.regionsOf(code)) {
      if (regionId !== undefined && reg.id !== regionId) continue;
      for (const [name, lat, lng] of reg.base?.ci ?? []) {
        if (dead.has(`${reg.key}|${fold(name)}`)) continue;
        if (!needle || fold(name).includes(needle)) { out.push({ name, region: reg.name, lat, lng }); if (out.length >= limit) return out; }
      }
      for (const r of rows) {
        if (r.deleted_at || r.data.rk !== reg.key) continue;
        if (!needle || fold(r.data.name).includes(needle)) { out.push({ name: r.data.name, region: reg.name, lat: null, lng: null, custom: true }); if (out.length >= limit) return out; }
      }
    }
    return out;
  }
  hasRegion(iso: string, name: string): boolean { return this.effRegions(iso).some((r) => r.name === name); }
  stats() { return { continents: this.continents().length, countries: this.countries().length }; }
}
