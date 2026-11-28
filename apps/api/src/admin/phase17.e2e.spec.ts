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
(enabled ? describe : describe.skip)('Phase 17 e2e: personal rights, lock, forced password change, platform ads', () => {
  jest.setTimeout(90000);
  let app: INestApplication; let server: any; let admin: Pool; let rootT: string; let perms: any;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const tok = async (role: string, tenant: string, n: number) => (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    const { AppModule } = await import('../app.module');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication({ rawBody: true, bodyParser: false }); (await import('../core/security')).applySecurity(app); await app.init(); server = app.getHttpServer();
    perms = app.get((await import('../core/permissions.service')).PermissionsService);
    rootT = await new SignJWT({ roles: ['root_super_admin'] }).setSubject(U(9400)).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    await admin.query('DELETE FROM role_permission_overrides'); await admin.query("DELETE FROM user_permission_overrides WHERE tenant_slug = 'e2e_p17'"); await admin.query("DELETE FROM user_flags WHERE tenant_slug = 'e2e_p17'");
    await admin.query('DELETE FROM platform_ads');
    await admin.query("DROP SCHEMA IF EXISTS tenant_e2e_p17 CASCADE"); await admin.query("DELETE FROM tenants WHERE slug = 'e2e_p17'");
    await call('post', '/tenants', rootT).send({ slug: 'e2e_p17', name: 'Lycée P17', school_type: 'lycee', country_code: 'GA' }).expect(201);
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('gives and withdraws a right for one person only, inside their school, and shows it in their menu', async () => {
    const stu = await tok('student', 'e2e_p17', 41); const stu2 = await tok('student', 'e2e_p17', 42); const tea = await tok('teacher', 'e2e_p17', 43);
    await call('get', '/teachers', stu).expect(403);
    await admin.query("INSERT INTO user_permission_overrides(user_id, tenant_slug, permission, granted) VALUES ($1,'e2e_p17','staff:read',TRUE)", [U(41)]);
    await admin.query("INSERT INTO user_permission_overrides(user_id, tenant_slug, permission, granted) VALUES ($1,'e2e_p17','students:read',FALSE)", [U(43)]);
    await perms.refresh(true);
    await call('get', '/teachers', stu).expect(200);        // granted to this student
    await call('get', '/teachers', stu2).expect(403);       // another student: unchanged
    await call('get', '/classes', tea).expect(403);         // withdrawn although the role has it
    const items = (await call('get', '/me/navigation', stu).expect(200)).body.groups.flatMap((g: any) => g.items.map((i: any) => i.href));
    expect(items).toContain('/school/staff');
    const other = await tok('student', 'ga_lycee', 41);     // same person id in another school: the grant does not follow
    await call('get', '/teachers', other).expect(403);
  });

  it('refuses a locked account at once and keeps a forced password change to the pages that let the person change it', async () => {
    const tea = await tok('teacher', 'e2e_p17', 51); await call('get', '/classes', tea).expect(200);
    await admin.query("INSERT INTO user_flags(user_id, tenant_slug, must_change_password) VALUES ($1,'e2e_p17',TRUE)", [U(51)]); await perms.refresh(true);
    const r = await call('get', '/classes', tea).expect(403); expect(JSON.stringify(r.body)).toContain('password_change_required');
    await call('get', '/me/navigation', tea).expect(200);
    await admin.query("UPDATE user_flags SET must_change_password = FALSE, locked = TRUE, locked_reason = 'test' WHERE user_id = $1", [U(51)]); await perms.refresh(true);
    expect(JSON.stringify((await call('get', '/classes', tea).expect(403)).body)).toContain('account locked');
    await call('get', '/me/navigation', tea).expect(403);
    await admin.query('DELETE FROM user_flags WHERE user_id = $1', [U(51)]); await perms.refresh(true);
    await call('get', '/classes', tea).expect(200);
  });

  it('manages the platform ads from the root console and publishes only the live ones', async () => {
    const stu = await tok('student', 'e2e_p17', 41);
    await call('post', '/platform/ads', stu).send({ title_fr: 'x', title_en: 'x' }).expect(403);
    const a = (await call('post', '/platform/ads', rootT).send({ title_fr: 'Rentrée 2026', title_en: 'Back to school 2026', text_fr: 'Inscrivez-vous', text_en: 'Enrol now', link_url: '/pays/GA', theme: 'violet', position: 1 }).expect(201)).body;
    await call('post', '/platform/ads', rootT).send({ title_fr: 'Cachée', title_en: 'Hidden', active: false }).expect(201);
    await call('post', '/platform/ads', rootT).send({ title_fr: 'Lien', title_en: 'Link', link_url: 'javascript:alert(1)' }).expect(400);
    const pub = (await request(server).get('/directory/ads').expect(200)).body;
    expect(pub.map((x: any) => x.title_fr)).toEqual(['Rentrée 2026']); expect(Object.keys(pub[0]).sort()).toEqual(expect.not.arrayContaining(['created_by', 'active']));
    await call('patch', `/platform/ads/${a.id}`, rootT).send({ active: false }).expect(200);
    expect((await request(server).get('/directory/ads').expect(200)).body).toEqual([]);
    expect((await call('get', '/platform/ads', rootT).expect(200)).body).toHaveLength(2);
    await call('delete', `/platform/ads/${a.id}`, rootT).expect(200);
    expect((await call('get', '/platform/ads', rootT).expect(200)).body).toHaveLength(1);
  });
});
