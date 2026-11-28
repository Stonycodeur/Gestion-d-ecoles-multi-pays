import { BadRequestException, ConflictException, Injectable, NotFoundException, NotImplementedException } from '@nestjs/common';
import { Pool } from 'pg';
import { poolConfig } from '../core/db-config';
import { AuditService } from '../core/audit.service';
import { generatePassword, strongEnough } from './password';

/** Roles the root super-admin can create in a school. The root itself is unique and immutable; the visitor role needs no account. */
export const CREATABLE_ROLES = ['tenant_super_admin', 'admin', 'head', 'teacher', 'education_assistant', 'accountant', 'student', 'guardian', 'inspector'];
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Account administration for the root super-admin. Runs through SECURITY DEFINER functions (101_supabase_accounts.sql): the API never holds a service-role key. */
@Injectable()
export class AccountsAdminService {
  private pool?: Pool;
  constructor(private readonly audit: AuditService) {}
  private get db(): Pool {
    if (!this.pool) { if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set'); this.pool = new Pool(poolConfig()); }
    return this.pool;
  }
  private async root<T>(fn: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<T>): Promise<T> {
    const c = await this.db.connect();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.root_bypass', 'on', true)");
      const out = await fn(async (sql, params) => (await c.query(sql, params as unknown[])).rows);
      await c.query('COMMIT'); return out;
    } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e; } finally { c.release(); }
  }
  /** Maps database refusals to HTTP errors; a missing function means the identity provider is not Supabase (accounts are then managed there). */
  private fail(e: unknown): never {
    const err = e as { code?: string; message?: string };
    if (err.code === '42883') throw new NotImplementedException('account administration needs the Supabase account functions (infra/sql/101_supabase_accounts.sql); with another identity provider, create the user there');
    const m = String(err.message ?? '');
    if (/unknown (school|account|role)|invalid email|password too short|only school roles|unique and immutable|root super-admin|cannot be deleted/.test(m)) throw new BadRequestException(m);
    if (/not in the trash/.test(m)) throw new NotFoundException(m);
    throw e;
  }

  async list(school?: string) {
    if (school !== undefined && !/^[a-z0-9_]{2,40}$/.test(school)) throw new BadRequestException('invalid school');
    try { return await this.root((q) => q('SELECT * FROM admin_list_accounts($1)', [school ?? null])); } catch (e) { return this.fail(e); }
  }

  async create(actor: string, b: any) {
    const email = typeof b?.email === 'string' ? b.email.trim().toLowerCase() : '';
    if (!EMAIL.test(email)) throw new BadRequestException('a valid email is required');
    if (!CREATABLE_ROLES.includes(b?.role)) throw new BadRequestException(`role must be one of ${CREATABLE_ROLES.join(', ')}`);
    if (typeof b?.school_slug !== 'string' || !/^[a-z0-9_]{2,40}$/.test(b.school_slug)) throw new BadRequestException('school_slug is required');
    if (b.password !== undefined && b.password !== '' && !strongEnough(b.password)) throw new BadRequestException('password: 10+ characters with lower case, upper case and a digit');
    const generated = !b.password;
    const password = generated ? generatePassword() : (b.password as string);
    let id: string;
    try {
      id = await this.root(async (q) => {
        const exists = (await q('SELECT 1 FROM public.users WHERE lower(email) = $1', [email])).length > 0;
        if (exists) throw new ConflictException('an account with this email already exists');
        return (await q('SELECT admin_create_account($1,$2,$3,$4) AS id', [email, password, b.role, b.school_slug]))[0].id as string;
      });
    } catch (e) { return this.fail(e); }
    await this.audit.log({ actorId: actor, action: 'account.create', entity: 'user', entityId: id, details: { email, role: b.role, school: b.school_slug } });
    return { id, email, role: b.role, school_slug: b.school_slug, ...(generated ? { temporary_password: password } : {}), must_change_password: generated };
  }

  async resetPassword(actor: string, id: string, b: any) {
    if (!UUID.test(id)) throw new NotFoundException('unknown account');
    if (b?.password !== undefined && b.password !== '' && !strongEnough(b.password)) throw new BadRequestException('password: 10+ characters with lower case, upper case and a digit');
    const generated = !b?.password; const password = generated ? generatePassword() : (b.password as string);
    try { await this.root((q) => q('SELECT admin_reset_password($1,$2)', [id, password])); } catch (e) { return this.fail(e); }
    await this.audit.log({ actorId: actor, action: 'account.reset_password', entity: 'user', entityId: id });
    return { id, ...(generated ? { temporary_password: password } : {}) };
  }

  async setActive(actor: string, id: string, active: unknown) {
    if (!UUID.test(id)) throw new NotFoundException('unknown account');
    if (typeof active !== 'boolean') throw new BadRequestException('active must be boolean');
    try { await this.root((q) => q('SELECT admin_set_account_active($1,$2)', [id, active])); } catch (e) { return this.fail(e); }
    await this.audit.log({ actorId: actor, action: active ? 'account.enable' : 'account.disable', entity: 'user', entityId: id });
    return { id, active };
  }

  /** Sign-in details of one account (needs 112_school_spaces.sql): 2FA, open sessions, last sign-in, phone. */
  async detail(id: string) {
    if (!UUID.test(id)) throw new NotFoundException('unknown account');
    try { return (await this.root((q) => q('SELECT * FROM admin_account_detail($1)', [id])))[0] ?? null; } catch (e) { if ((e as { code?: string }).code === '42883') return null; return this.fail(e); }
  }
  /** Sign-in history of one account (needs 114_supabase_login_history.sql); empty with another identity provider. */
  async loginHistory(id: string): Promise<{ at: string; ip: string | null; action: string; provider: string | null }[]> {
    if (!UUID.test(id)) throw new NotFoundException('unknown account');
    try { return await this.root((q) => q('SELECT at, ip, action, provider FROM admin_login_history($1, 30)', [id])); } catch (e) { if ((e as { code?: string }).code === '42883') return []; return this.fail(e); }
  }
  /** When the identity provider last changed this account (a new password included); null when unknown. */
  async authUpdatedAt(id: string): Promise<Date | null> {
    if (!UUID.test(id)) return null;
    try { const r = await this.root((q) => q('SELECT admin_auth_updated_at($1) AS at', [id])); return r[0]?.at ? new Date(r[0].at) : null; } catch (e) { if ((e as { code?: string }).code === '42883') return null; return this.fail(e); }
  }
  async closeSessions(actor: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('unknown account');
    try { await this.root((q) => q('SELECT admin_close_sessions($1)', [id])); } catch (e) { return this.fail(e); }
    await this.audit.log({ actorId: actor, action: 'account.close_sessions', entity: 'user', entityId: id });
    return { closed: true };
  }

  // ----- trash (needs 111_supabase_trash.sql): a trashed account is disabled and hidden until restored or purged
  async listTrashed() { try { return await this.root((q) => q('SELECT * FROM admin_list_trashed_accounts()')); } catch (e) { if ((e as { code?: string }).code === '42883') return []; return this.fail(e); } }
  async trash(actor: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('unknown account');
    try { await this.root((q) => q('SELECT admin_trash_account($1,$2)', [id, actor])); } catch (e) { return this.fail(e); }
    await this.audit.log({ actorId: actor, action: 'account.trash', entity: 'user', entityId: id });
    return { trashed: true };
  }
  async restore(actor: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('unknown account');
    try { await this.root((q) => q('SELECT admin_restore_account($1)', [id])); } catch (e) { return this.fail(e); }
    await this.audit.log({ actorId: actor, action: 'account.restore', entity: 'user', entityId: id });
    return { restored: true };
  }
  async purge(actor: string, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('unknown account');
    try { await this.root((q) => q('SELECT admin_purge_account($1)', [id])); } catch (e) { return this.fail(e); }
    await this.audit.log({ actorId: actor, action: 'account.purge', entity: 'user', entityId: id });
    return { purged: true };
  }
}
