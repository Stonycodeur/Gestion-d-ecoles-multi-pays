import { Injectable, NotFoundException } from '@nestjs/common';
import { poolConfig } from '../core/db-config';
import { Pool, type PoolClient } from 'pg';

export type Q = <R = any>(sql: string, params?: unknown[]) => Promise<R[]>;

/** Runs a unit of work inside one transaction scoped to a tenant: search_path = tenant schema, app.tenant_id set for RLS. */
@Injectable()
export class TenantDb {
  private pool?: Pool;
  get enabled(): boolean { return !!process.env.DATABASE_URL; }
  private getPool(): Pool {
    if (!this.pool) {
      if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
      this.pool = new Pool(poolConfig());
    }
    return this.pool;
  }

  async run<T>(slug: string, fn: (q: Q, tenant: { id: string; slug: string; country: string; schoolType: string }) => Promise<T>): Promise<T> {
    if (!/^[a-z0-9_]{2,40}$/.test(slug)) throw new NotFoundException('unknown tenant');
    const c: PoolClient = await this.getPool().connect();
    try {
      await c.query('BEGIN');
      const t = await c.query('SELECT id, schema_name, country_code, school_type FROM public.tenants WHERE slug = $1 AND active', [slug]);
      if (!t.rowCount) throw new NotFoundException('unknown tenant');
      const row = t.rows[0] as { id: string; schema_name: string; country_code: string; school_type: string };
      await c.query("SELECT set_config('app.tenant_id', $1, true)", [row.id]);
      await c.query(`SET LOCAL search_path TO "${row.schema_name.replace(/[^a-z0-9_]/g, '')}", public`);
      const q: Q = async (sql, params) => (await c.query(sql, params as unknown[])).rows;
      const out = await fn(q, { id: row.id, slug, country: row.country_code, schoolType: row.school_type });
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally { c.release(); }
  }
}
