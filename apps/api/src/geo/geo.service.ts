import { Injectable, NotFoundException } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

export interface GeoCountry { c: string; i3: string; n: string; fr: string; nat: string; k: string; sr: string; cap: string; cur: string; ph: string; tz: string | null; em: string; la: string | null; lo: string | null }
export interface GeoRegion { id: number; c: string; n: string; t: string; la: string | null; lo: string | null; ci: [string, string | null, string | null][] }
interface Catalog { continents: { code: string; fr: string; en: string; ar: string }[]; countries: GeoCountry[] }

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** World geography (continents, countries, provinces, cities) read from the bundled dataset (apps/api/geo-data, built by tools/build-geo.py). Nothing national is coded: it is reference data. */
@Injectable()
export class GeoService {
  private catalog?: Catalog;
  private cache = new Map<string, GeoRegion[]>();

  private dir(): string {
    if (process.env.GEO_DIR) return process.env.GEO_DIR;
    let d = __dirname;
    for (let i = 0; i < 6; i++) { if (existsSync(join(d, 'geo-data', 'countries.json'))) return join(d, 'geo-data'); d = dirname(d); }
    throw new Error('geo-data not found (set GEO_DIR)');
  }
  private cat(): Catalog { return (this.catalog ??= JSON.parse(readFileSync(join(this.dir(), 'countries.json'), 'utf8')) as Catalog); }

  continents() {
    const n: Record<string, number> = {};
    for (const c of this.cat().countries) n[c.k] = (n[c.k] ?? 0) + 1;
    return this.cat().continents.map((k) => ({ ...k, countries: n[k.code] ?? 0 }));
  }
  countries(continent?: string, q?: string): GeoCountry[] {
    const needle = q ? fold(q.trim()) : '';
    return this.cat().countries.filter((c) => (!continent || c.k === continent) && (!needle || fold(c.n).includes(needle) || fold(c.fr).includes(needle) || fold(c.nat).includes(needle) || c.c.toLowerCase() === needle));
  }
  country(iso: string): GeoCountry {
    const c = this.cat().countries.find((x) => x.c === iso.toUpperCase());
    if (!c) throw new NotFoundException('unknown country');
    return c;
  }
  private load(iso: string): GeoRegion[] {
    const code = this.country(iso).c;
    const hit = this.cache.get(code); if (hit) return hit;
    const regs = JSON.parse(gunzipSync(readFileSync(join(this.dir(), 'regions', `${code}.json.gz`))).toString('utf8')) as GeoRegion[];
    if (this.cache.size >= 8) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(code, regs); return regs;
  }
  regions(iso: string) { return this.load(iso).map((r) => ({ id: r.id, code: r.c, name: r.n, type: r.t, cities: r.ci.length })); }
  cities(iso: string, regionId?: number, q?: string, limit = 50) {
    const needle = q ? fold(q.trim()) : '';
    const out: { name: string; region: string; lat: string | null; lng: string | null }[] = [];
    for (const r of this.load(iso)) {
      if (regionId !== undefined && r.id !== regionId) continue;
      for (const [name, lat, lng] of r.ci) {
        if (!needle || fold(name).includes(needle)) { out.push({ name, region: r.n, lat, lng }); if (out.length >= limit) return out; }
      }
    }
    return out;
  }
  hasRegion(iso: string, name: string): boolean { return this.load(iso).some((r) => r.n === name); }
  stats() { const c = this.cat().countries; return { continents: this.cat().continents.length, countries: c.length }; }
}
