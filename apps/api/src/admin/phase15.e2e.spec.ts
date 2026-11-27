import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SignJWT } from 'jose';
import { join } from 'node:path';
import { Pool } from 'pg';

process.env.RATE_LIMIT_PER_MIN = '5000'; process.env.RATE_LIMIT_AUTH_PER_MIN = '1000';
const SECRET = 'z'.repeat(40);
process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = SECRET;
process.env.MODULES_DIR = join(__dirname, '../../../../packages/modules');

// 1x1 transparent PNG
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Phase 15 e2e: personal space, editable geography, role permissions, trash', () => {
  jest.setTimeout(90000);
  let app: INestApplication; let server: any; let admin: Pool; let rootT: string;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const tok = async (role: string, tenant: string, n: number) => (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    const { AppModule } = await import('../app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true, bodyParser: false }); (await import('../core/security')).applySecurity(app); await app.init(); server = app.getHttpServer();
    rootT = await new SignJWT({ roles: ['root_super_admin'] }).setSubject(U(9200)).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    await admin.query("DELETE FROM geo_entries WHERE code IN ('XA','ZZ') OR code LIKE 'c:%' OR code LIKE '%|%'");
    await admin.query("DELETE FROM role_permission_overrides");
    await admin.query("DROP SCHEMA IF EXISTS tenant_e2e_p15 CASCADE"); await admin.query("DELETE FROM tenants WHERE slug IN ('e2e_p15','e2e_trash')");
    await call('post', '/tenants', rootT).send({ slug: 'e2e_p15', name: 'École P15', school_type: 'lycee', country_code: 'GA' }).expect(201);
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('lets every account edit its own profile, validates the phone against the country and checks the photo', async () => {
    const t = await tok('teacher', 'lycee_a', 21);
    expect((await call('get', '/me/profile', t).expect(200)).body).toMatchObject({ full_name: null, avatar: null });
    await call('put', '/me/profile', t).send({ full_name: ' Awa Ndong ', language: 'en', phone_country: 'GA', phone_number: '07 12 34 56', preferences: { mode: 'dark', accent: '#0F766E', fontScale: 110 } }).expect(200);
    expect((await call('get', '/me/profile', t).expect(200)).body).toMatchObject({ full_name: 'Awa Ndong', language: 'en', phone_country: 'GA', phone_number: '07123456', preferences: { mode: 'dark', accent: '#0f766e', fontScale: 110 } });
    await call('put', '/me/profile', t).send({ phone_country: 'GA', phone_number: '12' }).expect(400);          // too short for the country
    await call('put', '/me/profile', t).send({ phone_country: 'ZZ', phone_number: '0712345678' }).expect(400);  // unknown country
    await call('put', '/me/profile', t).send({ preferences: { accent: 'red' } }).expect(400);
    await call('put', '/me/avatar', t).send({ data_url: PNG }).expect(200);
    await call('put', '/me/avatar', t).send({ data_url: 'data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAA' }).expect(400);   // content is not a PNG
    await call('put', '/me/avatar', t).send({ data_url: 'data:text/html;base64,PGI+' }).expect(400);
    expect((await call('get', '/me/profile', t).expect(200)).body.avatar).toBe(PNG);
    await call('delete', '/me/avatar', t).expect(200);
    // another account never sees it
    const other = await tok('teacher', 'lycee_a', 22);
    expect((await call('get', '/me/profile', other).expect(200)).body.full_name).toBeNull();
    expect((await call('get', '/geo/dial-codes', t).expect(200)).body.find((c: any) => c.c === 'GA')).toMatchObject({ ph: '241' });
  });

  it('adds continents, countries, provinces and cities, and says so when one already exists', async () => {
    const adm = await tok('admin', 'lycee_a', 1);
    await call('post', '/geo/continents', adm).send({ code: 'ZZ', fr: 'Zed', en: 'Zed' }).expect(403);
    await call('post', '/geo/continents', rootT).send({ code: 'AF', fr: 'Autre', en: 'Other' }).expect(409);            // code taken
    await call('post', '/geo/continents', rootT).send({ code: 'ZZ', fr: 'afrique', en: 'Other' }).expect(409);          // name taken, ignoring case
    await call('post', '/geo/continents', rootT).send({ code: 'ZZ', fr: 'Zédland', en: 'Zedland' }).expect(201);
    await call('post', '/geo/continents', rootT).send({ code: 'ZZ', fr: 'Zédland', en: 'Zedland' }).expect(409);
    expect((await call('get', '/geo/continents', rootT).expect(200)).body.map((k: any) => k.code)).toContain('ZZ');

    await call('post', '/geo/countries', rootT).send({ code: 'GA', n: 'Gabonia', fr: 'Gabonia', k: 'AF', ph: '999' }).expect(409);
    await call('post', '/geo/countries', rootT).send({ code: 'XA', n: 'Gabon', fr: 'Autre', k: 'AF', ph: '999' }).expect(409);   // name of an existing country
    const c = (await call('post', '/geo/countries', rootT).send({ code: 'XA', n: 'Xanadu', fr: 'Xanadu', k: 'ZZ', ph: '+999', cur: 'xaf', d: [7, 9] }).expect(201)).body;
    expect(c).toMatchObject({ c: 'XA', k: 'ZZ', ph: '999', cur: 'XAF', d: [7, 9], custom: true });
    await call('delete', '/geo/continents/ZZ', rootT).expect(409);                                                       // still holds a country

    await call('post', '/geo/countries/XA/regions', rootT).send({ name: 'Nord' }).expect(201);
    await call('post', '/geo/countries/XA/regions', rootT).send({ name: 'nord' }).expect(409);
    const nord = (await call('get', '/geo/countries/XA/regions', rootT).expect(200)).body.find((r: any) => r.name === 'Nord');
    expect(nord.id).toBeLessThan(0);
    await call('post', '/geo/countries/XA/cities', rootT).send({ region_id: nord.id, name: 'Port-Zed' }).expect(201);
    await call('post', '/geo/countries/XA/cities', rootT).send({ region_id: nord.id, name: 'port-zed' }).expect(409);
    expect((await call('get', `/geo/countries/XA/cities?region=${nord.id}`, rootT).expect(200)).body.map((x: any) => x.name)).toEqual(['Port-Zed']);

    // a bundled province and city can be added to, renamed and hidden too
    const est = (await call('get', '/geo/countries/GA/regions', rootT).expect(200)).body.find((r: any) => r.name === 'Estuaire');
    await call('post', '/geo/countries/GA/cities', rootT).send({ region_id: est.id, name: 'Libreville' }).expect(409);
    await call('post', '/geo/countries/GA/cities', rootT).send({ region_id: est.id, name: 'Ville-Test' }).expect(201);
    await call('delete', `/geo/countries/GA/cities?region_id=${est.id}&name=Libreville`, rootT).expect(200);
    expect((await call('get', `/geo/countries/GA/cities?region=${est.id}&q=libreville`, rootT).expect(200)).body).toHaveLength(0);
  });

  it('trashes and restores geography, and deleting for good removes what was added by hand', async () => {
    const items = (await call('get', '/trash?kind=geo', rootT).expect(200)).body as any[];
    const lib = items.find((i) => i.label === 'Libreville');
    expect(lib).toBeTruthy(); expect(lib.overdue).toBe(false);
    await call('post', `/trash/geo/${lib.id}/restore`, rootT).expect(201);
    const est = (await call('get', '/geo/countries/GA/regions', rootT)).body.find((r: any) => r.name === 'Estuaire');
    expect((await call('get', `/geo/countries/GA/cities?region=${est.id}&q=libreville`, rootT).expect(200)).body.length).toBeGreaterThan(0);

    await call('delete', '/geo/countries/XA', rootT).expect(200);
    expect((await call('get', '/geo/countries?q=xanadu', rootT).expect(200)).body).toHaveLength(0);
    await call('post', '/geo/countries', rootT).send({ code: 'XA', n: 'Xanadu', fr: 'Xanadu', k: 'ZZ', ph: '999' }).expect(409);   // in the trash: restore it instead
    const xa = ((await call('get', '/trash?kind=geo', rootT)).body as any[]).find((i) => i.label === 'Xanadu');
    await call('post', `/trash/geo/${xa.id}/restore`, rootT).expect(201);
    expect((await call('get', '/geo/countries?q=xanadu', rootT).expect(200)).body).toHaveLength(1);
    await call('delete', '/geo/countries/XA', rootT).expect(200);
    await call('delete', `/trash/geo/${xa.id}`, rootT).expect(200);
    const left = await admin.query("SELECT 1 FROM geo_entries WHERE kind = 'country' AND code = 'XA'");
    expect(left.rowCount).toBe(0);
  });

  it('keeps countries that hold schools', async () => {
    await call('delete', '/geo/countries/GA', rootT).expect(409);      // the school created for these tests lives there
  });

  it('lets the root change what a role may do, at once, and reset it', async () => {
    const adm = await tok('admin', 'e2e_p15', 1); const teacher = await tok('teacher', 'e2e_p15', 23);
    await call('get', '/roles/matrix', adm).expect(403);
    const m = (await call('get', '/roles/matrix', rootT).expect(200)).body;
    const t0 = m.roles.find((r: any) => r.code === 'teacher');
    expect(t0.permissions).not.toContain('staff:read'); expect(m.roles.find((r: any) => r.code === 'root_super_admin').editable).toBe(false);
    expect(m.permissions.map((p: any) => p.code)).not.toContain('tenants:manage');
    await call('get', '/staff/contracts', teacher).expect(403);
    await call('put', '/roles/teacher/permissions', rootT).send({ permissions: [...t0.permissions, 'staff:read'] }).expect(200);
    expect(((await call('get', '/roles/matrix', rootT)).body.roles.find((r: any) => r.code === 'teacher')).changed).toBe(true);
    expect([403, 404]).not.toContain((await call('get', '/staff/contracts', teacher)).status);   // allowed now (whatever the list returns)
    await call('put', '/roles/teacher/permissions', rootT).send({ permissions: ['tenants:manage'] }).expect(400);
    await call('put', '/roles/root_super_admin/permissions', rootT).send({ permissions: [] }).expect(400);
    await call('post', '/roles/teacher/reset', rootT).expect(201);
    await call('get', '/staff/contracts', teacher).expect(403);
  });

  it('puts a school in the trash, restores it, and purges it only with its code', async () => {
    await call('post', '/tenants', rootT).send({ slug: 'e2e_trash', name: 'École Corbeille', school_type: 'lycee', country_code: 'GA' }).expect(201);
    await call('delete', '/tenants/e2e_trash', rootT).expect(200);
    expect(((await call('get', '/tenants', rootT).expect(200)).body as any[]).some((t) => t.slug === 'e2e_trash')).toBe(false);
    const it = ((await call('get', '/trash?kind=school', rootT).expect(200)).body as any[]).find((i) => i.id === 'e2e_trash');
    expect(it).toMatchObject({ label: 'École Corbeille', overdue: false });
    await call('post', '/trash/school/e2e_trash/restore', rootT).expect(201);
    expect(((await call('get', '/tenants', rootT)).body as any[]).find((t) => t.slug === 'e2e_trash').active).toBe(true);
    await call('delete', '/tenants/e2e_trash', rootT).expect(200);
    await call('delete', '/trash/school/e2e_trash?confirm=wrong', rootT).expect(400);
    await call('delete', '/trash/school/e2e_trash?confirm=e2e_trash', rootT).expect(200);
    expect((await admin.query("SELECT 1 FROM information_schema.schemata WHERE schema_name = 'tenant_e2e_trash'")).rowCount).toBe(0);
    expect((await admin.query("SELECT 1 FROM tenants WHERE slug = 'e2e_trash'")).rowCount).toBe(0);
    await call('delete', '/trash/school/e2e_p15?confirm=e2e_p15', rootT).expect(404);   // a live school cannot be purged
  });
});
