import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SignJWT } from 'jose';
import { join } from 'node:path';
import { Pool } from 'pg';

process.env.RATE_LIMIT_PER_MIN = '5000'; process.env.RATE_LIMIT_AUTH_PER_MIN = '1000';
const SECRET = 'y'.repeat(40);
process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = SECRET;
process.env.MODULES_DIR = join(__dirname, '../../../../packages/modules');

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Root console e2e: world geography, country activation, school location, school context, accounts', () => {
  jest.setTimeout(90000);
  let app: INestApplication; let server: any; let admin: Pool; let rootT: string;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const tok = async (role: string, tenant: string, n: number) => (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'put' | 'patch', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    const { AppModule } = await import('../app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true, bodyParser: false }); (await import('../core/security')).applySecurity(app); await app.init(); server = app.getHttpServer();
    rootT = await new SignJWT({ roles: ['root_super_admin'] }).setSubject(U(9100)).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('serves the world geography and keeps platform actions to the root', async () => {
    const adm = await tok('admin', 'lycee_a', 1);
    expect((await call('get', '/geo/continents', adm).expect(200)).body).toHaveLength(7);
    expect((await call('get', '/geo/countries/GA/regions', adm).expect(200)).body.map((r: any) => r.name)).toContain('Estuaire');
    await call('get', '/geo/countries?continent=AF', adm).expect(403);
    await call('post', '/geo/countries/BR/activate', adm).send({ model: 'letters' }).expect(403);
    await call('get', '/admin/overview', adm).expect(403);
    await call('get', '/admin/accounts', adm).expect(403);
    const sa = (await call('get', '/geo/countries?continent=SA', rootT).expect(200)).body;
    expect(sa.map((c: any) => c.c)).toEqual(expect.arrayContaining(['BR', 'AR', 'CO']));
    await call('get', '/geo/countries/ZZ', rootT).expect(404);
    await call('get', '/geo/countries/GA/cities?region=abc', rootT).expect(400);
  });

  it('activates a country by configuration only, then creates a located school in it', async () => {
    await call('post', '/tenants', rootT).send({ slug: 'e2e_rc', name: 'Colégio Teste', school_type: 'lycee', country_code: 'BR' }).expect(400);   // not activated yet
    const act = (await call('post', '/geo/countries/BR/activate', rootT).send({ model: 'letters', locale: 'en' }).expect(201)).body;
    expect(act.code).toBe('BR');
    expect((await call('post', '/geo/countries/BR/activate', rootT).send({ model: 'numeric' }).expect(201)).body.created).toBe(false);   // idempotent, first model kept
    const prop = (await call('get', '/tenants/proposals?country_code=BR&school_type=lycee', rootT).expect(200)).body;
    expect(prop.default_scale).toBe('letters');
    expect(prop.scales.map((s: any) => s.code)).toContain('letters');
    const made = (await call('post', '/tenants', rootT).send({ slug: 'e2e_rc', name: 'Colégio Teste', school_type: 'lycee', country_code: 'BR', region: 'São Paulo', city: 'Campinas' }).expect(201)).body;
    expect(made).toMatchObject({ slug: 'e2e_rc', country_code: 'BR', continent_code: 'SA', region: 'São Paulo', city: 'Campinas' });
    const list = (await call('get', '/tenants', rootT).expect(200)).body.find((t: any) => t.slug === 'e2e_rc');
    expect(list).toMatchObject({ city: 'Campinas', continent_code: 'SA' });
    const tables = await admin.query("SELECT count(*)::int AS c FROM information_schema.tables WHERE table_schema = 'tenant_e2e_rc'");
    expect(tables.rows[0].c).toBeGreaterThan(50);          // the school got its own isolated schema
    await call('post', '/tenants', rootT).send({ slug: 'e2e_jp', name: 'x', school_type: 'lycee', country_code: 'JP' }).expect(400);
  });

  it('lets the root work inside any school through X-Tenant, audited, and nowhere without it', async () => {
    await call('get', '/classes', rootT).expect(400);                                               // no school chosen
    await call('get', '/classes', rootT).set('X-Tenant', 'no_such_school').expect(404);
    expect((await call('get', '/classes', rootT).set('X-Tenant', 'e2e_rc').expect(200)).body).toBeDefined();
    const c = await call('post', '/classes', rootT).set('X-Tenant', 'e2e_rc').send({ name: 'Turma A', level_code: '2nde', school_year: '2026-2027' });
    expect([200, 201]).toContain(c.status);
    const audit = await admin.query("SELECT count(*)::int AS c FROM audit_logs WHERE action = 'root.tenant_context'");
    expect(audit.rows[0].c).toBeGreaterThanOrEqual(1);
    const adm = await tok('admin', 'e2e_rc', 21);
    await call('get', '/classes', adm).set('X-Tenant', 'lycee_a').expect(200);                      // a school member can never switch school with the header
    const ov = (await call('get', '/admin/overview', rootT).expect(200)).body;
    expect(ov.schools).toBeGreaterThanOrEqual(1); expect(ov.world.countries).toBeGreaterThanOrEqual(240); expect(Array.isArray(ov.audit)).toBe(true);
  });

  it('validates account creation before touching the identity provider', async () => {
    const base = { email: 'new.head@example.org', role: 'head', school_slug: 'e2e_rc' };
    await call('post', '/admin/accounts', rootT).send({ ...base, role: 'root_super_admin' }).expect(400);   // the root is unique
    await call('post', '/admin/accounts', rootT).send({ ...base, role: 'visitor' }).expect(400);
    await call('post', '/admin/accounts', rootT).send({ ...base, email: 'nope' }).expect(400);
    await call('post', '/admin/accounts', rootT).send({ ...base, school_slug: undefined }).expect(400);
    await call('post', '/admin/accounts', rootT).send({ ...base, password: 'weak' }).expect(400);
    const r = await call('post', '/admin/accounts', rootT).send(base);
    expect([201, 501]).toContain(r.status);                       // 501 where the Supabase account functions are not installed (plain PostgreSQL)
    await call('post', '/admin/accounts/not-a-uuid/reset-password', rootT).send({}).expect(404);
    await call('patch', `/admin/accounts/${U(1)}`, rootT).send({ active: 'yes' }).expect(400);
  });
});
