import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService } from '../core/audit.service';

const TYPES = ['primary', 'college', 'lycee', 'university'];

/** School management for the root super-admin (spec 6.2). Creation runs through SECURITY DEFINER functions (see 080_tenants_admin.sql). */
@Injectable()
export class TenantsService {
  private pool?: Pool;
  constructor(private readonly audit: AuditService) {}
  private get db(): Pool {
    if (!this.pool) {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
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

  list() { return this.root((q) => q('SELECT id, slug, name, school_type, country_code, active, created_at FROM public.tenants ORDER BY name')); }
  async get(slug: string) {
    const r = await this.root((q) => q('SELECT id, slug, name, school_type, country_code, config, active, created_at FROM public.tenants WHERE slug = $1', [slug]));
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
    const id = await this.root(async (q) => {
      if (!(await q('SELECT 1 FROM public.countries WHERE code = $1', [country])).length) throw new BadRequestException('unknown country_code');
      if (b.grading_scale_code) {
        const es = (await q('SELECT cycle FROM public.education_systems WHERE country_code = $1 AND school_type = $2', [country, b.school_type]))[0];
        if (!es) throw new BadRequestException('this country has no education system for this school type');
        if (!(await q('SELECT 1 FROM public.grading_scales WHERE country_code = $1 AND code = $2', [country, b.grading_scale_code])).length) throw new BadRequestException('scale not allowed for this country');
      }
      try {
        const newId = (await q('SELECT admin_create_tenant($1,$2,$3,$4,$5) AS id', [slug, b.name.trim(), b.school_type, country, JSON.stringify(config)]))[0].id as string;
        if (b.grading_scale_code) {
          const es = (await q('SELECT cycle FROM public.education_systems WHERE country_code = $1 AND school_type = $2', [country, b.school_type]))[0];
          await q('INSERT INTO public.tenant_settings(tenant_id, cycle, grading_scale_code, effective_from) VALUES ($1,$2,$3,CURRENT_DATE)', [newId, es.cycle, b.grading_scale_code]);
        }
        return newId;
      } catch (e) { if ((e as { code?: string }).code === '23505') throw new ConflictException('a school with this slug already exists'); throw e; }
    });
    await this.audit.log({ actorId: actor, action: 'tenant.create', entity: 'tenant', entityId: id, details: { slug, country, school_type: b.school_type } });
    return this.get(slug);
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
