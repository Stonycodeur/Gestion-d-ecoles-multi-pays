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


const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Phase 16 e2e: public directory, navigation by right and level, school management, school users', () => {
  jest.setTimeout(90000);
  let app: INestApplication; let server: any; let admin: Pool; let rootT: string;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const tok = async (role: string, tenant: string, n: number) => (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    const { AppModule } = await import('../app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true, bodyParser: false }); (await import('../core/security')).applySecurity(app); await app.init(); server = app.getHttpServer();
    rootT = await new SignJWT({ roles: ['root_super_admin'] }).setSubject(U(9300)).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    await admin.query('DELETE FROM role_permission_overrides');
    await admin.query("DROP SCHEMA IF EXISTS tenant_e2e_p16 CASCADE"); await admin.query("DELETE FROM tenants WHERE slug IN ('e2e_p16')");
    await call('post', '/tenants', rootT).send({ slug: 'e2e_p16', name: 'Université P16', school_type: 'university', country_code: 'GA' }).expect(201);
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  const nav = async (t: string) => (await call('get', '/me/navigation', t).expect(200)).body;
  const hrefs = (n: any) => n.groups.flatMap((g: any) => g.items.map((i: any) => i.href)) as string[];

  it('lists countries and schools without signing in, and only what is public', async () => {
    const gabon = (await request(server).get('/directory/countries?q=gabon').expect(200)).body;
    expect(gabon[0]).toMatchObject({ c: 'GA', schools: expect.any(Number) }); expect(gabon[0].schools).toBeGreaterThanOrEqual(1);
    const all = (await request(server).get('/directory/countries').expect(200)).body; expect(all.length).toBeGreaterThan(100); expect(all[0].schools).toBeGreaterThanOrEqual(all[all.length - 1].schools);
    const ga = (await request(server).get('/directory/schools?country=GA').expect(200)).body;
    expect(ga.map((s: any) => s.slug)).toContain('e2e_p16'); expect(Object.keys(ga[0]).sort()).toEqual(['city', 'country', 'name', 'region', 'slug', 'type', 'type_label']);
    expect((await request(server).get('/directory/schools?country=GA&type=university&q=p16').expect(200)).body).toHaveLength(1);
    expect((await request(server).get('/directory/schools?country=JP').expect(200)).body).toEqual([]);   // no school there: the site shows "unavailable"
    const one = (await request(server).get('/directory/schools?slug=e2e_p16').expect(200)).body;
    expect(one).toHaveLength(1); expect(one[0].sections).toEqual(expect.arrayContaining(['presentation', 'programs', 'admissions'])); expect(one[0].sections).not.toContain('enrol'); expect(one[0].vocabulary.student.fr).toBe('Étudiant'); expect(one[0].site_open).toBe(false);
    await request(server).get('/directory/schools?slug=BAD%20CODE').expect(400);
    await request(server).get('/directory/schools?country=GAB').expect(400);
    await request(server).get('/directory/schools?type=nursery').expect(400);
  });

  it('shows each person only the pages their rights, the enabled modules and the school level allow', async () => {
    const adm = await tok('admin', 'e2e_p16', 31); const stu = await tok('student', 'e2e_p16', 32); const tea = await tok('teacher', 'e2e_p16', 33); const acc = await tok('accountant', 'e2e_p16', 34);
    const a = await nav(adm);
    expect(a.school).toMatchObject({ slug: 'e2e_p16', type: 'university' }); expect(a.profile.vocabulary.student.fr).toBe('Étudiant'); expect(a.profile.vocabulary.head.fr).toBe('Doyen');
    expect(hrefs(a)).toEqual(expect.arrayContaining(['/school/users', '/school/settings', '/school/students', '/grades'])); expect(hrefs(a)).not.toContain('/payments');   // module not enabled yet
    expect(a.groups.flatMap((g: any) => g.items).find((i: any) => i.href === '/school/classes').label.fr).toBe('Promotions et groupes');
    await call('post', '/modules/module-payment/enable', adm).send({}).expect(201);
    expect(hrefs(await nav(adm))).toContain('/payments');
    const s = hrefs(await nav(stu)); expect(s).toContain('/grades'); expect(s).toContain('/payments'); for (const h of ['/school/users', '/school/students', '/school/settings', '/administration']) expect(s).not.toContain(h);
    const t = hrefs(await nav(tea)); expect(t).toContain('/school/students'); expect(t).not.toContain('/school/users'); expect(t).not.toContain('/payments');
    const c = hrefs(await nav(acc)); expect(c).toContain('/payments'); expect(c.filter((h) => h.startsWith('/school'))).toEqual([]); expect(c).not.toContain('/grades');
    await call('get', '/school/users', tea).expect(403); await call('get', '/school/users', stu).expect(403);
    await call('get', '/school/profile', tea).expect(403);
  });

  it('lets the school choose its pages and its words, within what the level offers', async () => {
    const adm = await tok('admin', 'e2e_p16', 31);
    await call('put', '/school/profile', adm).send({ hidden: ['/news'], vocabulary: { head: { fr: 'Recteur' }, students: { fr: 'Auditeurs', en: 'Attendees' } } }).expect(200);
    const n = await nav(adm); expect(hrefs(n)).not.toContain('/news'); expect(n.profile.vocabulary.head).toMatchObject({ fr: 'Recteur', en: 'Dean' }); expect(n.profile.vocabulary.students).toEqual({ fr: 'Auditeurs', en: 'Attendees' });
    const p = (await call('get', '/school/profile', adm).expect(200)).body; expect(p.pages.find((x: any) => x.href === '/gps').level_hidden).toBe(true);
    await call('put', '/school/profile', adm).send({ hidden: ['/nope'] }).expect(400); await call('put', '/school/profile', adm).send({ vocabulary: { colour: { fr: 'x' } } }).expect(400);
    await call('put', '/school/profile', adm).send({ hidden: [], shown: ['/gps'] }).expect(200);   // bring back a page the level hides (needs the module too)
    expect((await nav(adm)).shown).toEqual(['/gps']); expect(hrefs(await nav(adm))).toContain('/news');
  });

  it('manages classes, subjects, rooms, teachers and students; refuses what is in use', async () => {
    const adm = await tok('admin', 'e2e_p16', 31); const tea = await tok('teacher', 'e2e_p16', 33);
    const cl = (await call('post', '/classes', adm).send({ name: 'L1 Droit', level_code: 'L1', school_year: '2026-2027' }).expect(201)).body;
    expect((await call('patch', `/classes/${cl.id}`, adm).send({ name: 'L1 Droit A', section: 'A' }).expect(200)).body).toMatchObject({ name: 'L1 Droit A', section: 'A' });
    await call('patch', `/classes/${cl.id}`, adm).send({}).expect(400); await call('patch', `/classes/${cl.id}`, tea).send({ name: 'x' }).expect(403);
    const sub = (await call('post', '/subjects', adm).send({ code: 'DRC', name: 'Droit civil', coefficient: 3 }).expect(201)).body;
    expect(Number((await call('patch', `/subjects/${sub.id}`, adm).send({ coefficient: 4 }).expect(200)).body.coefficient)).toBe(4);
    await call('patch', `/subjects/${sub.id}`, adm).send({ category: 'magic' }).expect(400);
    const te = (await call('post', '/teachers', adm).send({ first_name: 'Awa', last_name: 'Ndong' }).expect(201)).body;
    expect((await call('get', '/teachers', adm).expect(200)).body.map((x: any) => x.id)).toContain(te.id);
    await call('patch', `/teachers/${te.id}`, adm).send({ max_weekly_hours: 18 }).expect(200);
    const rm = (await call('post', '/rooms', adm).send({ name: 'Amphi A', capacity: 300 }).expect(201)).body;
    await call('patch', `/rooms/${rm.id}`, adm).send({ capacity: 320 }).expect(200); expect((await call('get', '/rooms', adm).expect(200)).body[0].capacity).toBe(320);
    const cs = (await call('post', '/class-subjects', adm).send({ class_id: cl.id, subject_id: sub.id, teacher_id: te.id, weekly_hours: 3 }).expect(201)).body;
    expect((await call('get', `/class-subjects?class_id=${cl.id}`, adm).expect(200)).body[0]).toMatchObject({ subject: 'Droit civil', teacher: 'Awa Ndong' });
    await call('delete', `/subjects/${sub.id}`, adm).expect(409); await call('delete', `/teachers/${te.id}`, adm).expect(409);   // still taught
    const st = (await call('post', '/students', adm).send({ first_name: 'Moussa', last_name: 'Obame', class_id: cl.id }).expect(201)).body.student;
    expect((await call('patch', `/students/${st.id}`, adm).send({ status: 'transferred' }).expect(200)).body.status).toBe('transferred'); await call('patch', `/students/${st.id}`, adm).send({ status: 'lost' }).expect(400);
    await call('delete', `/classes/${cl.id}`, adm).expect(409);   // a student is placed there
    await call('delete', `/class-subjects/${cs.id}`, adm).expect(200); await call('delete', `/subjects/${sub.id}`, adm).expect(200); await call('delete', `/teachers/${te.id}`, adm).expect(200);
    await call('delete', `/rooms/${rm.id}`, adm).expect(200); await call('delete', `/rooms/${rm.id}`, adm).expect(404);
  });

  it('keeps school user administration to people with the right, and marks notifications read in one go', async () => {
    const adm = await tok('admin', 'e2e_p16', 31); const stu = await tok('student', 'e2e_p16', 32);
    expect([200, 501]).toContain((await call('get', '/school/users', adm)).status);   // 501 in sandbox mode: accounts live in the identity provider
    await call('post', '/school/users', stu).send({ email: 'x@y.zz', role: 'admin' }).expect(403);
    expect((await call('post', '/notifications/read-all', stu).expect(201)).body).toEqual({ marked: 0 });
  });
});
