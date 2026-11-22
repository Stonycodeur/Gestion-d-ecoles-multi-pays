import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';
import { Pool } from 'pg';
import { SignJWT } from 'jose';

const SECRET = 'p'.repeat(40);
process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = SECRET;
process.env.MODULES_DIR = join(__dirname, '../../../packages/modules');
process.env.MESSAGE_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.WEBHOOK_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.PUSH_MODE = 'sandbox';

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Phase 7 e2e (account deletion, isolation)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let server: any; let admin: Pool;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n + 4000).padStart(12, '0')}`;
  const ids: Record<string, string> = {};
  const tok = async (role: string, n: number, tenant: string, extra: object = {}) => (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant, ...extra })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'delete', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);
  let adminT: string, guardianT: string, studentT: string, teacherT: string;

  const mkTenant = async (slug: string, id: number) => { await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,$2,$3,'college','GA',$4) ON CONFLICT DO NOTHING", [U(id), slug, `École ${slug}`, `tenant_${slug}`]); await admin.query('SELECT provision_tenant_schema($1)', [slug]); };
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await mkTenant('e2e_l', 9100); await mkTenant('e2e_m', 9101);
    const { AppModule } = await import('./app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true }); await app.init(); server = app.getHttpServer();
    adminT = await tok('admin', 1, 'e2e_l');
    ids.cls = (await call('post', '/classes', adminT).send({ name: '4e A', level_code: '4e', school_year: '2026-2027' }).expect(201)).body.id;
    ids.stu = (await call('post', '/students', adminT).send({ first_name: 'Ada', last_name: 'Obiang', birth_date: '2012-04-05', class_id: ids.cls }).expect(201)).body.student.id;
    guardianT = await tok('guardian', 2, 'e2e_l', { child_ids: [ids.stu] }); studentT = await tok('student', 3, 'e2e_l', { student_id: ids.stu }); teacherT = await tok('teacher', 4, 'e2e_l', { class_ids: [ids.cls] });
    await admin.query("UPDATE tenant_e2e_l.students SET user_id = $1 WHERE id = $2", [U(3), ids.stu]);
    await admin.query("INSERT INTO tenant_e2e_l.guardians(tenant_id, student_id, full_name, phone, email, user_id) VALUES ((SELECT id FROM tenants WHERE slug='e2e_l'), $1, 'Marie Obiang', '+24106000000', 'marie@mail.ga', $2)", [ids.stu, U(2)]);
    for (const [uid, role, name] of [[U(2), 'guardian', 'Marie Obiang'], [U(3), 'student', 'Ada Obiang'], [U(4), 'teacher', 'Paul Mba']]) await admin.query("INSERT INTO tenant_e2e_l.directory(tenant_id, user_id, role, display_name, email, phone, child_ids, student_id) VALUES ((SELECT id FROM tenants WHERE slug='e2e_l'), $1, $2, $3, 'x@mail.ga', '0600', $4, $5) ON CONFLICT (user_id) DO NOTHING", [uid, role, name, role === 'guardian' ? [ids.stu] : [], role === 'student' ? ids.stu : null]);
    await admin.query("INSERT INTO tenant_e2e_l.device_tokens(tenant_id, user_id, platform, token) VALUES ((SELECT id FROM tenants WHERE slug='e2e_l'), $1, 'android', 'tok-g'), ((SELECT id FROM tenants WHERE slug='e2e_l'), $2, 'android', 'tok-s')", [U(2), U(3)]);
  });
  afterAll(async () => { await app.close(); await admin.end(); });
  const count = async (sql: string, p: unknown[] = []) => Number((await admin.query(sql, p)).rows[0].n);

  it('self-deletion needs confirmation and is refused for students and for the root account', async () => {
    await call('delete', '/account', guardianT).send({}).expect(400);
    await call('delete', '/account', studentT).send({ confirm: 'DELETE' }).expect(403);
    const root = await new SignJWT({ roles: ['root_super_admin'] }).setSubject(U(9000)).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    await request(server).delete('/account').set('Authorization', `Bearer ${root}`).set('x-tenant', 'e2e_l').send({ confirm: 'DELETE' }).expect((r: any) => expect([400, 403]).toContain(r.status));
  });
  it('a guardian deletes the account: contact data and devices are gone, the child is untouched', async () => {
    await call('delete', '/account', guardianT).send({ confirm: 'DELETE' }).expect(200);
    expect(await count("SELECT COUNT(*) n FROM tenant_e2e_l.device_tokens WHERE user_id = $1", [U(2)])).toBe(0);
    const d = (await admin.query("SELECT role, display_name, email, phone, child_ids FROM tenant_e2e_l.directory WHERE user_id = $1", [U(2)])).rows[0];
    expect(d).toMatchObject({ role: 'deleted', display_name: 'Compte supprimé', email: null, phone: null, child_ids: [] });
    const g = (await admin.query("SELECT full_name, phone, email, user_id FROM tenant_e2e_l.guardians WHERE student_id = $1", [ids.stu])).rows[0];
    expect(g).toMatchObject({ full_name: 'Compte supprimé', phone: null, email: null, user_id: null });
    expect((await admin.query("SELECT first_name FROM tenant_e2e_l.students WHERE id = $1", [ids.stu])).rows[0].first_name).toBe('Ada');
  });
  it('erasure of a child: guardian requests, only the administration executes, identity disappears but results stay', async () => {
    const g2 = await tok('guardian', 5, 'e2e_l', { child_ids: [ids.stu] });
    await call('post', `/account/erasure-request/${ids.stu}`, teacherT).expect(403);
    await call('post', `/account/erasure-request/${ids.stu}`, g2).expect(201);
    await call('post', `/account/erase-student/${ids.stu}`, g2).expect(403);
    await call('post', `/account/erase-student/${ids.stu}`, teacherT).expect(403);
    await admin.query("INSERT INTO tenant_e2e_l.gps_consents(tenant_id, student_id, guardian_user_id, granted, consent_window, granted_at) VALUES ((SELECT id FROM tenants WHERE slug='e2e_l'), $1, $2, true, '{}', NOW())", [ids.stu, U(5)]);
    await call('post', `/account/erase-student/${ids.stu}`, adminT).expect(201);
    const s = (await admin.query("SELECT first_name, last_name, birth_date, user_id, class_id FROM tenant_e2e_l.students WHERE id = $1", [ids.stu])).rows[0];
    expect(s).toMatchObject({ first_name: 'Élève', last_name: 'supprimé', birth_date: null, user_id: null }); expect(s.class_id).toBe(ids.cls);
    expect(await count("SELECT COUNT(*) n FROM tenant_e2e_l.gps_consents WHERE student_id = $1", [ids.stu])).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM tenant_e2e_l.device_tokens WHERE user_id = $1", [U(3)])).toBe(0);
    expect((await admin.query("SELECT role, display_name FROM tenant_e2e_l.directory WHERE user_id = $1", [U(3)])).rows[0]).toMatchObject({ role: 'deleted', display_name: 'Compte supprimé' });
    expect(await count("SELECT COUNT(*) n FROM audit_logs WHERE action IN ('student.erased','account.delete','account.erasure_requested') AND details->>'tenant' = 'e2e_l'")).toBe(3);
  });
  it('tenant isolation: a token of another school cannot read or erase this school’s data', async () => {
    const other = await tok('admin', 1, 'e2e_m');
    expect((await call('get', '/students', other).expect(200)).body).toEqual([]);
    await call('post', `/account/erase-student/${ids.stu}`, other).expect(404);
    expect((await admin.query("SELECT first_name FROM tenant_e2e_l.students WHERE id = $1", [ids.stu])).rows[0].first_name).toBe('Élève');
    const forged = await tok('admin', 1, 'e2e_l'); await request(server).get('/students').set('Authorization', `Bearer ${forged}`).set('x-tenant', 'e2e_m').expect((r: any) => expect([200, 403]).toContain(r.status));
  });
});
