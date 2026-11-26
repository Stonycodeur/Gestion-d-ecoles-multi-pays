import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { poolConfig } from '../core/db-config';
import { Pool } from 'pg';
import { AuditService } from '../core/audit.service';
import { GeoService } from '../geo/geo.service';

const TYPES = ['primary', 'college', 'lycee', 'university'];

/** School management for the root super-admin (spec 6.2). Creation runs through SECURITY DEFINER functions (see 080_tenants_admin.sql). */
@Injectable()
export class TenantsService {
  private pool?: Pool;
  constructor(private readonly audit: AuditService, private readonly geo: GeoService) {}
  private get db(): Pool {
    if (!this.pool) {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
      this.pool = new Pool(poolConfig());
    }
    return this.pool;
  }
  private async root<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.root_bypass', 'on', true)");
      const out = await fn(async (sql, params) => (await c.query(sql, params as unknown[])).rows);
      await c.query('COMMIT');
      return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }

  list() { return this.root((q) => q('SELECT id, slug, name, school_type, country_code, continent_code, region, city, active, created_at FROM public.tenants ORDER BY name')); }
  /** Countries of the referential (the ones a school can be created in), with their currency and grading scales. */
  activated() { return this.root((q) => q('SELECT c.code, c.name_fr, c.name_en, c.currency, c.is_sample, (SELECT count(*)::int FROM public.tenants t WHERE t.country_code = c.code) AS schools FROM public.countries c ORDER BY c.name_en')); }

  /** Activates any country of the world: its reference rows (education system, scales, calendar) are cloned from a grading model. Idempotent. */
  async activateCountry(actor: string, iso: string, b: any) {
    const c = this.geo.country(iso);
    const model = ['numeric', 'letters', 'percent'].includes(b?.model) ? b.model : 'numeric';
    const locale = ['fr', 'en', 'ar'].includes(b?.locale) ? b.locale : 'fr';
    const languages = locale === 'fr' ? ['fr', 'en'] : locale === 'en' ? ['en', 'fr'] : ['ar', 'fr', 'en'];
    const created = await this.root(async (q) => (await q('SELECT admin_ensure_country($1,$2,$3,$4,$5,$6,$7,$8) AS created', [c.c, c.fr, c.n, c.cur, c.tz, languages, locale, model]))[0].created as boolean);
    if (created) await this.audit.log({ actorId: actor, action: 'country.activate', entity: 'country', entityId: c.c, details: { model, locale } });
    return { code: c.c, created, model };
  }
  async get(slug: string) {
    const r = await this.root((q) => q('SELECT id, slug, name, school_type, country_code, continent_code, region, city, config, active, created_at FROM public.tenants WHERE slug = $1', [slug]));
    if (!r.length) throw new NotFoundException('unknown tenant');
    return r[0];
  }

  /** Creation assistant: the scales the country offers for this type of school, with the country default pre-selected. */
  proposals(country: string, schoolType: string) {
    if (!/^[A-Z]{2}$/.test(country) || !TYPES.includes(schoolType)) throw new BadRequestException('country (ISO code) and school_type are required');
    return this.root(async (q) => {
      const es = (await q('SELECT cycle, label_fr, label_en, levels, national_exam, grading_scale_code, period_type FROM public.education_systems WHERE country_code = $1 AND school_type = $2', [country, schoolType]))[0];
      if (!es) throw new NotFoundException('this country has no education system for this school type');
      const scales = await q('SELECT code, type, min_value, max_value, step, decimals, pass_mark, display_format FROM public.grading_scales WHERE country_code = $1 ORDER BY code', [country]);
      return { education_system: es, default_scale: es.grading_scale_code, scales };
    });
  }

  async create(actor: string, b: any) {
    const slug = typeof b?.slug === 'string' ? b.slug : '';
    if (!/^[a-z0-9_]{2,40}$/.test(slug)) throw new BadRequestException('slug: 2-40 chars, a-z 0-9 _');
    if (typeof b?.name !== 'string' || !b.name.trim() || b.name.length > 200) throw new BadRequestException('name is required');
    if (!TYPES.includes(b?.school_type)) throw new BadRequestException(`school_type must be one of ${TYPES.join(', ')}`);
    const country = typeof b?.country_code === 'string' ? b.country_code.toUpperCase() : '';
    const config = b?.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : {};
    if (JSON.stringify(config).length > 20000) throw new BadRequestException('config too large');
    const text = (v: unknown, what: string) => { if (v === undefined || v === null || v === '') return ''; if (typeof v !== 'string' || v.length > 120) throw new BadRequestException(`${what} is invalid`); return v.trim(); };
    const region = text(b?.region, 'region'); const city = text(b?.city, 'city');
    let continent = '';
    try { continent = this.geo.country(country).k; } catch { /* a country outside the dataset (e.g. the sample country XL) has no continent */ }
    const id = await this.root(async (q) => {
      if (!(await q('SELECT 1 FROM public.countries WHERE code = $1', [country])).length) throw new BadRequestException('unknown country_code: activate the country first (POST /geo/countries/:iso/activate)');
      if (b.grading_scale_code) {
        const es = (await q('SELECT cycle FROM public.education_systems WHERE country_code = $1 AND school_type = $2', [country, b.school_type]))[0];
        if (!es) throw new BadRequestException('this country has no education system for this school type');
        if (!(await q('SELECT 1 FROM public.grading_scales WHERE country_code = $1 AND code = $2', [country, b.grading_scale_code])).length) throw new BadRequestException('scale not allowed for this country');
      }
      try {
        const newId = (await q('SELECT admin_create_tenant($1,$2,$3,$4,$5) AS id', [slug, b.name.trim(), b.school_type, country, JSON.stringify(config)]))[0].id as string;
        await q("SELECT set_config('app.root_bypass', 'on', true)");   // re-asserted: observed to be cleared once a SECURITY DEFINER function with its own SET clause has run
        await q('SELECT admin_set_tenant_location($1,$2,$3,$4)', [slug, continent, region, city]);
        if (b.grading_scale_code) {
          const es = (await q('SELECT cycle FROM public.education_systems WHERE country_code = $1 AND school_type = $2', [country, b.school_type]))[0];
          await q('INSERT INTO public.tenant_settings(tenant_id, cycle, grading_scale_code, effective_from) VALUES ($1,$2,$3,CURRENT_DATE)', [newId, es.cycle, b.grading_scale_code]);
        }
        return newId;
      } catch (e) { if ((e as { code?: string }).code === '23505') throw new ConflictException('a school with this slug already exists'); throw e; }
    });
    await this.audit.log({ actorId: actor, action: 'tenant.create', entity: 'tenant', entityId: id, details: { slug, country, region, city, school_type: b.school_type } });
    return this.get(slug);
  }

  /** Overview for the root console: counters and the latest audited actions. */
  async overview() {
    return this.root(async (q) => {
      const c = (await q(`SELECT (SELECT count(*)::int FROM public.tenants) AS schools, (SELECT count(*)::int FROM public.tenants WHERE active) AS active_schools,
        (SELECT count(*)::int FROM public.countries) AS countries, (SELECT count(*)::int FROM public.users) AS accounts`))[0];
      const audit = await q('SELECT * FROM admin_recent_audit(25)');
      return { ...c, world: this.geo.stats(), audit };
    });
  }

  async update(actor: string, slug: string, b: any) {
    const name = b?.name === undefined ? null : typeof b.name === 'string' && b.name.trim() && b.name.length <= 200 ? b.name.trim() : (() => { throw new BadRequestException('invalid name'); })();
    const config = b?.config === undefined ? null : b.config && typeof b.config === 'object' && !Array.isArray(b.config) ? b.config : (() => { throw new BadRequestException('config must be an object'); })();
    const active = b?.active === undefined ? null : typeof b.active === 'boolean' ? b.active : (() => { throw new BadRequestException('active must be boolean'); })();
    try { await this.root((q) => q('SELECT admin_update_tenant($1,$2,$3,$4)', [slug, name, config ? JSON.stringify(config) : null, active])); }
    catch (e) { if (/unknown tenant/.test(String((e as Error).message))) throw new NotFoundException('unknown tenant'); throw e; }
    await this.audit.log({ actorId: actor, action: active === false ? 'tenant.deactivate' : 'tenant.update', entity: 'tenant', details: { slug } });
    return this.get(slug);
  }
}
