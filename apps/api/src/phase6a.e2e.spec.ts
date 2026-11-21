import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';
import { Pool } from 'pg';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 'r'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../packages/modules');
process.env.MESSAGE_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.PUSH_MODE = 'sandbox';
process.env.PUBLIC_FORM_LIMIT = '6';

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Phase 6a e2e (orientation, internships, exam fiche, visitor space, resources)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let server: any; let admin: Pool;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n + 1000).padStart(12, '0')}`;
  const ids: Record<string, string> = {};
  let adminT: string, headT: string, teacherT: string, studentT: string, guardianT: string, otherGuardianT: string, otherStudentT: string;
  const tok = async (role: string, n: number, extra: object = {}) => (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant: 'e2e_i', ...extra })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'put', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);
  const pub = (m: 'get' | 'post', path: string) => (request(server) as any)[m](path);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,'e2e_i','Collège I','college','GA','tenant_e2e_i') ON CONFLICT DO NOTHING", [U(9100)]);
    await admin.query("SELECT provision_tenant_schema('e2e_i')");
    const { AppModule } = await import('./app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true }); await app.init(); server = app.getHttpServer();
    adminT = await tok('admin', 1); headT = await tok('head', 2);
    ids.cls = (await call('post', '/classes', adminT).send({ name: '3e A', level_code: '3e', school_year: '2026-2027' }).expect(201)).body.id;
    ids.cls2 = (await call('post', '/classes', adminT).send({ name: '3e B', level_code: '3e', school_year: '2026-2027' }).expect(201)).body.id;
    ids.s1 = (await call('post', '/students', adminT).send({ first_name: 'Ada', last_name: 'Obiang', class_id: ids.cls }).expect(201)).body.student.id;
    ids.s2 = (await call('post', '/students', adminT).send({ first_name: 'Ben', last_name: 'Ndong', class_id: ids.cls2 }).expect(201)).body.student.id;
    teacherT = await tok('teacher', 3, { class_ids: [ids.cls] });
    studentT = await tok('student', 4, { student_id: ids.s1 });
    guardianT = await tok('guardian', 5, { child_ids: [ids.s1] });
    otherGuardianT = await tok('guardian', 6, { child_ids: [ids.s2] });
    otherStudentT = await tok('student', 7, { student_id: ids.s2 });
    await call('post', '/directory', adminT).send({ user_id: U(4), role: 'student', display_name: 'Ada', student_id: ids.s1 }).expect(201);
    await call('post', '/directory', adminT).send({ user_id: U(1), role: 'admin', display_name: 'Admin' }).expect(201);
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('modules gate everything: 403 while disabled, public space 404', async () => {
    await call('get', '/orientation/paths', studentT).expect(403);
    await call('get', '/resources', studentT).expect(403);
    await pub('get', '/public/e2e_i/site').expect(404);
    for (const m of ['module-orientation', 'module-visitor', 'module-resources']) await call('post', `/modules/${m}/enable`, adminT).send({}).expect(201);
  });

  it('career paths: staff write, students read', async () => {
    await call('post', '/orientation/paths', studentT).send({ title: 'x', description: 'y' }).expect(403);
    await call('post', '/orientation/paths', adminT).send({ title: 'Collège → Lycée scientifique', from_level: '3e', to_level: '2nde', description: 'Série C/D', steps: ['Dossier', 'Entretien'] }).expect(201);
    await call('post', '/orientation/paths', adminT).send({ title: 'Ingénieur', kind: 'career_sheet', description: 'Métier' }).expect(201);
    expect((await call('get', '/orientation/paths?kind=career_sheet', studentT).expect(200)).body).toHaveLength(1);
    await call('post', '/orientation/paths', adminT).send({ title: 'bad', kind: 'nope', description: 'y' }).expect(400);
  });

  it('internship workflow: request, decision by staff only, report, completion; family scope', async () => {
    const body = { student_id: ids.s1, organisation: 'Hôpital de Libreville', start_on: '2027-03-01', end_on: '2027-03-12' };
    await call('post', '/orientation/internships', otherGuardianT).send(body).expect(403);
    await call('post', '/orientation/internships', studentT).send({ ...body, end_on: '2027-02-01' }).expect(400);
    const it1 = (await call('post', '/orientation/internships', studentT).send(body).expect(201)).body;
    expect(it1.status).toBe('requested');
    await call('post', `/orientation/internships/${it1.id}/transition`, studentT).send({ to: 'approved' }).expect(400);
    await call('post', `/orientation/internships/${it1.id}/transition`, headT).send({ to: 'rejected' }).expect(400);   // note required
    await call('post', `/orientation/internships/${it1.id}/report`, studentT).send({ text: 'too early' }).expect(400);
    await call('post', `/orientation/internships/${it1.id}/transition`, headT).send({ to: 'approved', note: 'ok' }).expect(201);
    expect((await admin.query("SELECT COUNT(*)::int AS n FROM tenant_e2e_i.notifications WHERE type = 'internship.update'")).rows[0].n).toBeGreaterThanOrEqual(0);
    await call('post', `/orientation/internships/${it1.id}/transition`, headT).send({ to: 'completed' }).expect(400);
    await call('post', `/orientation/internships/${it1.id}/transition`, studentT).send({ to: 'in_progress' }).expect(201);
    await call('post', `/orientation/internships/${it1.id}/report`, otherStudentT).send({ text: 'not mine' }).expect(403);
    await call('post', `/orientation/internships/${it1.id}/report`, studentT).send({ text: 'Rapport de stage' }).expect(201);
    expect((await call('post', `/orientation/internships/${it1.id}/transition`, headT).send({ to: 'completed' }).expect(201)).body.status).toBe('completed');
    expect((await call('get', '/orientation/internships', guardianT).expect(200)).body).toHaveLength(1);
    expect((await call('get', '/orientation/internships', otherGuardianT).expect(200)).body).toHaveLength(0);
    expect((await call('get', '/orientation/internships?status=completed', headT).expect(200)).body).toHaveLength(1);
  });

  it('BEPC fiche comes from the country reference and is a projection; outcomes are recorded by humans', async () => {
    ids.math = (await call('post', '/subjects', adminT).send({ code: 'MATH', name: 'Mathématiques', coefficient: 4 }).expect(201)).body.id;
    ids.t1 = (await call('post', '/teachers', adminT).send({ first_name: 'T', last_name: 'One', user_id: U(3) }).expect(201)).body.id;
    const ev = (await call('post', '/evaluations', adminT).send({ class_id: ids.cls, subject_id: ids.math, period_code: 'T1', title: 'DS1', coefficient: 1 }).expect(201)).body;
    await call('post', `/evaluations/${ev.id}/grades`, adminT).send({ entries: [{ student_id: ids.s1, value: 14 }] }).expect(201);
    const f = (await call('get', `/orientation/exam/fiche/${ids.s1}`, guardianT).expect(200)).body;
    expect(f.advisory).toBe(true); expect(f.fiche.exam_code).toBe('BEPC'); expect(f.fiche.continuous_pct).toBe(70); expect(f.fiche.admitted).toBe(true);
    expect(f.fiche.missing_exam).toContain('MATH');
    await call('get', `/orientation/exam/fiche/${ids.s1}`, otherGuardianT).expect(403);
    await call('put', '/orientation/exam/marks', studentT).send({ student_id: ids.s1, school_year: '2026-2027', marks: [{ subject_code: 'MATH', pct: 50 }] }).expect(403);
    await call('put', '/orientation/exam/marks', headT).send({ student_id: ids.s1, school_year: '2026-2027', marks: [{ subject_code: 'XXX', pct: 50 }] }).expect(400);
    await call('put', '/orientation/exam/marks', headT).send({ student_id: ids.s1, school_year: '2026-2027', marks: [{ subject_code: 'MATH', pct: 120 }] }).expect(400);
    await call('put', '/orientation/exam/marks', headT).send({ student_id: ids.s1, school_year: '2026-2027', marks: [{ subject_code: 'MATH', pct: 50 }] }).expect(200);
    const f2 = (await call('get', `/orientation/exam/fiche/${ids.s1}`, headT).expect(200)).body;
    expect(f2.fiche.exam_pct).toBe(50); expect(f2.fiche.subjects.find((s: any) => s.subject_code === 'MATH').combined_pct).toBe(58);   // 70*.4 + 50*.6
    await call('post', '/orientation/exam/outcome', teacherT).send({ student_id: ids.s1, school_year: '2026-2027', passed: true }).expect(403);
    await call('post', '/orientation/exam/outcome', headT).send({ student_id: ids.s1, school_year: '2026-2027', passed: true, mention: 'Passable' }).expect(201);
    expect((await call('get', `/orientation/exam/fiche/${ids.s1}`, studentT).expect(200)).body.outcome.passed).toBe(true);
  });

  it('visitor space: showcase, public news only, online enrolment, honeypot, decision creates the student', async () => {
    await call('put', '/visitor/site/history', studentT).send({ value: { text: 'x' } }).expect(403);
    await call('put', '/visitor/site/history', adminT).send({ value: { text: 'Fondé en 1960' } }).expect(200);
    await call('put', '/visitor/site/nope', adminT).send({ value: 1 }).expect(400);
    await call('put', '/visitor/site/tour360', adminT).send({ value: { scenes: 'bad' } }).expect(400);
    await call('put', '/visitor/site/tour360', adminT).send({ value: { scenes: [{ id: 'hall', title: 'Hall', image_url: '/tour/hall.jpg' }] } }).expect(200);
    const site = (await pub('get', '/public/e2e_i/site').expect(200)).body;
    expect(site.content.history.text).toBe('Fondé en 1960'); expect(site.content.tour360.scenes).toHaveLength(1); expect(site.country.name_fr).toMatch(/Gabon/);
    await call('post', '/news', headT).send({ title: 'Portes ouvertes', body: 'Samedi', is_public: true }).expect(201);
    await call('post', '/news', headT).send({ title: 'Interne', body: 'Réunion', is_public: false }).expect(201);
    expect((await pub('get', '/public/e2e_i/news').expect(200)).body.map((n: any) => n.title)).toEqual(['Portes ouvertes']);
    expect((await pub('get', '/public/e2e_i/levels').expect(200)).body).toContain('3e');

    const good = { first_name: 'Eli', last_name: 'Mba', level_code: '6e', guardian_name: 'M. Mba', guardian_email: 'mba@example.org', consent: true };
    const ok = (await pub('post', '/public/e2e_i/apply').send(good).expect(201)).body; expect(ok.reference).toBeTruthy();
    await pub('post', '/public/e2e_i/apply').send({ ...good, level_code: 'Tle' }).expect(400);
    await pub('post', '/public/e2e_i/apply').send({ ...good, consent: false }).expect(400);
    expect((await pub('post', '/public/e2e_i/apply').send({ ...good, website: 'spam' }).expect(201)).body.reference).toBeUndefined();
    const second = (await pub('post', '/public/e2e_i/apply').send({ ...good, first_name: 'Zoe' }).expect(201)).body;
    await call('get', '/visitor/applications', teacherT).expect(403);
    const apps = (await call('get', '/visitor/applications?status=pending', adminT).expect(200)).body; expect(apps).toHaveLength(2);
    const acc = (await call('post', `/visitor/applications/${ok.reference}/decision`, adminT).send({ accept: true, class_id: ids.cls }).expect(201)).body;
    expect(acc.application.status).toBe('accepted'); expect(acc.student.first_name).toBe('Eli');
    expect((await admin.query('SELECT full_name FROM tenant_e2e_i.guardians WHERE student_id = $1', [acc.student.id])).rows[0].full_name).toBe('M. Mba');
    await call('post', `/visitor/applications/${ok.reference}/decision`, adminT).send({ accept: true }).expect(400);   // already decided
    expect((await call('post', `/visitor/applications/${second.reference}/decision`, headT).send({ accept: false }).expect(201)).body.application.status).toBe('rejected');
    await pub('post', '/public/e2e_i/contact').send({ name: 'Visiteur', email: 'v@example.org', subject: 'Question', body: 'Bonjour' }).expect(201);
    expect((await call('get', '/visitor/contact', adminT).expect(200)).body).toHaveLength(1);
  });

  it('public statistics withhold small cohorts; apply is rate limited', async () => {
    const st = (await pub('get', '/public/e2e_i/stats').expect(200)).body;
    expect(st.min_cohort).toBe(10); expect(st.enrolled).toBeGreaterThanOrEqual(3);
    expect(st.success[0].exam_code).toBe('BEPC'); expect(st.success[0].success_rate_pct).toBeNull(); expect(st.success[0].candidates).toBeNull();
    let limited = false;
    for (let i = 0; i < 8 && !limited; i++) limited = (await pub('post', '/public/e2e_i/apply').send({})).status === 429;
    expect(limited).toBe(true);
  });

  it('resources: full-text search, filters, carry-over; forums scoped to the class', async () => {
    await call('post', '/resources', studentT).send({ title: 'x', kind: 'link', url: 'https://x.org' }).expect(403);
    await call('post', '/resources', teacherT).send({ title: 'Cours d\'algèbre', description: 'Équations du second degré', kind: 'pdf', url: '/files/algebre.pdf', subject_code: 'MATH', level_code: '3e', tags: ['Algebre'], shared: true }).expect(201);
    await call('post', '/resources', teacherT).send({ title: 'Géographie', kind: 'link', url: 'javascript:alert(1)' }).expect(400);
    const r = (await call('post', '/resources', teacherT).send({ title: 'Atlas', kind: 'link', url: 'https://atlas.example.org', subject_code: 'HG', tags: ['carte'], school_year: '2026-2027' }).expect(201)).body;
    expect((await call('get', '/resources?q=algèbre', studentT).expect(200)).body.map((x: any) => x.title)).toEqual(["Cours d'algèbre"]);
    expect((await call('get', '/resources?tag=carte', guardianT).expect(200)).body).toHaveLength(1);
    expect((await call('get', '/resources?subject=MATH&level=3e', studentT).expect(200)).body).toHaveLength(1);
    const copy = (await call('post', `/resources/${r.id}/carry-over`, teacherT).send({ school_year: '2027-2028' }).expect(201)).body;
    expect(copy.school_year).toBe('2027-2028'); expect(copy.id).not.toBe(r.id);
    ids.forum = (await call('post', '/forums', teacherT).send({ title: 'Maths 3e A', class_id: ids.cls }).expect(201)).body.id;
    const post = (await call('post', `/forums/${ids.forum}/posts`, studentT).send({ body: 'Une question' }).expect(201)).body;
    expect(post.author_name).toBe('Ada');
    await call('post', `/forums/${ids.forum}/posts`, teacherT).send({ body: 'Réponse', parent_id: post.id }).expect(201);
    expect((await call('get', `/forums/${ids.forum}/posts`, guardianT).expect(200)).body).toHaveLength(2);
    await call('get', `/forums/${ids.forum}/posts`, otherStudentT).expect(403);
    await call('post', `/forums/${ids.forum}/posts`, otherStudentT).send({ body: 'intrus' }).expect(403);
    expect((await call('get', '/forums', otherStudentT).expect(200)).body).toHaveLength(0);
    expect((await call('get', '/forums', studentT).expect(200)).body).toHaveLength(1);
  });
});
