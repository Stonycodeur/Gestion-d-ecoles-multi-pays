import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SignJWT } from 'jose';
import { join } from 'node:path';
import { Pool } from 'pg';

const SECRET = 'z'.repeat(40);
process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = SECRET;
process.env.MODULES_DIR = join(__dirname, '../../../../packages/modules');

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Academic e2e: schools, competencies, ECTS transcript, lesson log, timetable exports', () => {
  jest.setTimeout(90000);
  let app: INestApplication; let server: any; let admin: Pool; let rootT: string;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const ids: Record<string, string> = {};
  const tok = async (role: string, tenant: string, n: number, extra: object = {}) =>
    (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant, ...extra })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'put' | 'patch', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    const { AppModule } = await import('../app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication(); await app.init(); server = app.getHttpServer();
    rootT = await new SignJWT({ roles: ['root_super_admin'] }).setSubject(U(9000)).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('lets only the root super-admin create and manage schools, with the country scales proposed', async () => {
    const adminAny = await tok('admin', 'lycee_a', 1);
    await call('post', '/tenants', adminAny).send({ slug: 'e2e_s', name: 'x', school_type: 'lycee', country_code: 'GA' }).expect(403);
    await call('get', '/tenants', adminAny).expect(403);
    const prop = (await call('get', '/tenants/proposals?country_code=GA&school_type=lycee', rootT).expect(200)).body;
    expect(prop.default_scale).toBe('num20'); expect(prop.scales.map((s: any) => s.code)).toEqual(expect.arrayContaining(['num10', 'num20']));
    await call('get', '/tenants/proposals?country_code=GA&school_type=nope', rootT).expect(400);
    await call('post', '/tenants', rootT).send({ slug: 'Bad Slug', name: 'x', school_type: 'lycee', country_code: 'GA' }).expect(400);
    await call('post', '/tenants', rootT).send({ slug: 'e2e_s', name: 'x', school_type: 'lycee', country_code: 'ZZ' }).expect(400);
    await call('post', '/tenants', rootT).send({ slug: 'e2e_s', name: 'x', school_type: 'lycee', country_code: 'GA', grading_scale_code: 'letters' }).expect(400);
    const made = (await call('post', '/tenants', rootT).send({ slug: 'e2e_s', name: 'Lycée Test S', school_type: 'lycee', country_code: 'GA', grading_scale_code: 'num10' }).expect(201)).body;
    expect(made).toMatchObject({ slug: 'e2e_s', country_code: 'GA', active: true });
    await call('post', '/tenants', rootT).send({ slug: 'e2e_s', name: 'again', school_type: 'lycee', country_code: 'GA' }).expect(409);
    await call('post', '/tenants', rootT).send({ slug: 'e2e_t', name: 'Université Test T', school_type: 'university', country_code: 'GA' }).expect(201);
    const adminS = await tok('admin', 'e2e_s', 11);
    expect((await call('get', '/settings/grading', adminS).expect(200)).body.active.code).toBe('num10');     // chosen at creation
    expect((await call('patch', '/tenants/e2e_s', rootT).send({ name: 'Lycée Test S2' }).expect(200)).body.name).toBe('Lycée Test S2');
    await call('patch', '/tenants/e2e_s', rootT).send({ active: false }).expect(200);
    await call('get', '/settings/grading', adminS).expect(404);                                             // a deactivated school is closed
    await call('patch', '/tenants/e2e_s', rootT).send({ active: true }).expect(200);
    await call('patch', '/tenants/unknown_x', rootT).send({ name: 'n' }).expect(404);
    const audit = await admin.query("SELECT count(*)::int AS c FROM audit_logs WHERE action = 'tenant.create'");
    expect(audit.rows[0].c).toBeGreaterThanOrEqual(2);
  });

  it('records competency levels, shows them on the report, and protects other classes', async () => {
    const adminS = await tok('admin', 'e2e_s', 11); const headS = await tok('head', 'e2e_s', 12);
    ids.cls = (await call('post', '/classes', adminS).send({ name: '2nde A', level_code: '2nde', school_year: '2026-2027' }).expect(201)).body.id;
    ids.cls2 = (await call('post', '/classes', adminS).send({ name: '2nde B', level_code: '2nde', school_year: '2026-2027' }).expect(201)).body.id;
    ids.math = (await call('post', '/subjects', adminS).send({ code: 'MATH', name: 'Mathématiques', coefficient: 4 }).expect(201)).body.id;
    ids.s1 = (await call('post', '/students', adminS).send({ first_name: 'Ada', last_name: 'Obiang', class_id: ids.cls }).expect(201)).body.student.id;
    ids.s2 = (await call('post', '/students', adminS).send({ first_name: 'Eli', last_name: 'Nze', class_id: ids.cls2 }).expect(201)).body.student.id;
    const comp = (await call('post', '/competencies', adminS).send({ subject_id: ids.math, code: 'C1', label: 'Résoudre une équation' }).expect(201)).body;
    const teacherOther = await tok('teacher', 'e2e_s', 13, { class_ids: [ids.cls2] });
    await call('post', '/competencies', teacherOther).send({ subject_id: ids.math, code: 'C2', label: 'x' }).expect(403);
    await call('put', '/competency-assessments', teacherOther).send({ period_code: 'T1', entries: [{ student_id: ids.s1, competency_id: comp.id, level: 'acquired' }] }).expect(403);
    await call('put', '/competency-assessments', headS).send({ period_code: 'T1', entries: [{ student_id: ids.s1, competency_id: comp.id, level: 'expert' }] }).expect(400);
    await call('put', '/competency-assessments', headS).send({ period_code: 'T1', entries: [{ student_id: ids.s1, competency_id: comp.id, level: 'in_progress' }] }).expect(200);
    await call('put', '/competency-assessments', headS).send({ period_code: 'T1', entries: [{ student_id: ids.s1, competency_id: comp.id, level: 'mastered', comment: 'Très bien' }] }).expect(200);
    const fam = await tok('guardian', 'e2e_s', 21, { child_ids: [ids.s1] });
    const got = (await call('get', `/students/${ids.s1}/competencies?period=T1`, fam).expect(200)).body;
    expect(got).toHaveLength(1); expect(got[0]).toMatchObject({ code: 'C1', level: 'mastered', comment: 'Très bien' });
    expect((await call('get', `/students/${ids.s1}/report?period=T1`, fam).expect(200)).body.competencies).toHaveLength(1);
    await call('get', `/students/${ids.s2}/competencies?period=T1`, fam).expect(403);
  });

  it('keeps the lesson log inside the class of the student or the children, with attachments and a linked quiz', async () => {
    const adminS = await tok('admin', 'e2e_s', 11); const headS = await tok('head', 'e2e_s', 12); const tchS = await tok('teacher', 'e2e_s', 14, { class_ids: [ids.cls, ids.cls2] });
    await call('post', '/modules/module-gamification/enable', adminS).send({}).expect((r: any) => expect([200, 201]).toContain(r.status));
    const lesson = (await call('post', '/lessons', tchS).send({ class_id: ids.cls, subject_id: ids.math, on_date: '2026-10-05', title: 'Équations', content: 'Cours', homework: 'Ex 1' }).expect(201)).body;
    await call('post', '/lessons', tchS).send({ class_id: ids.cls, subject_id: ids.math, on_date: '2026-10-06', title: 'Bad', quiz_id: U(777) }).expect(400);
    const quiz = (await call('post', '/quizzes', tchS).send({ class_id: ids.cls, subject_id: ids.math, title: 'QCM 1', questions: [{ prompt: '1+1 ?', choices: ['1', '2'], correct: 1 }] }).expect(201)).body;
    const linked = (await call('post', '/lessons', tchS).send({ class_id: ids.cls, subject_id: ids.math, on_date: '2026-10-07', title: 'Avec QCM', quiz_id: quiz.id }).expect(201)).body;
    expect(linked.quiz_id).toBe(quiz.id);
    await call('post', '/lessons', tchS).send({ class_id: ids.cls2, subject_id: ids.math, on_date: '2026-10-07', title: 'Autre classe', quiz_id: quiz.id }).expect(400);   // quiz of another class
    await call('post', '/lessons', tchS).send({ class_id: ids.cls2, subject_id: ids.math, on_date: '2026-10-08', title: 'Cours B' }).expect(201);

    const content = Buffer.from('polycopié').toString('base64');
    const att = (await call('post', `/lessons/${lesson.id}/attachments`, tchS).send({ filename: 'poly.txt', content_type: 'text/plain', content_base64: content }).expect(201)).body;
    await call('post', `/lessons/${lesson.id}/attachments`, tchS).send({ filename: 'empty.txt', content_base64: '' }).expect(400);
    const fam = await tok('guardian', 'e2e_s', 21, { child_ids: [ids.s1] });
    const list = (await call('get', '/lessons', fam).expect(200)).body;
    expect(list.every((l: any) => l.class_id === ids.cls)).toBe(true);                                       // only the child's class
    expect(list.find((l: any) => l.id === lesson.id).attachments[0]).toMatchObject({ id: att.id, filename: 'poly.txt' });
    await call('get', `/lessons?class_id=${ids.cls2}`, fam).expect(403);
    const dl = await call('get', `/lessons/${lesson.id}/attachments/${att.id}`, fam).expect(200);
    expect(dl.text).toBe('polycopié');
    const other = await tok('guardian', 'e2e_s', 22, { child_ids: [ids.s2] });
    await call('get', `/lessons/${lesson.id}/attachments/${att.id}`, other).expect(403);
    const stu = await tok('student', 'e2e_s', 23, { student_id: ids.s2 });
    expect((await call('get', '/lessons', stu).expect(200)).body.every((l: any) => l.class_id === ids.cls2)).toBe(true);
    expect((await call('get', '/lessons', headS).expect(200)).body.length).toBeGreaterThanOrEqual(4);       // staff see everything
  });

  it('exports the timetable as a month view and a PDF', async () => {
    const adminS = await tok('admin', 'e2e_s', 11);
    const t1 = (await call('post', '/teachers', adminS).send({ first_name: 'Jean', last_name: 'Mba' }).expect(201)).body.id;
    const sch = (await admin.query("INSERT INTO tenant_e2e_s.schedules(tenant_id, school_year, status) SELECT id, '2026-2027', 'published' FROM public.tenants WHERE slug = 'e2e_s' RETURNING id")).rows[0].id;
    await call('post', `/schedules/${sch}/slots`, adminS).send({ class_id: ids.cls, subject_id: ids.math, teacher_id: t1, weekday: 2, period_index: 1 }).expect(201);
    const fam = await tok('guardian', 'e2e_s', 21, { child_ids: [ids.s1] });
    const m = (await call('get', '/timetable/month?month=2026-10', fam).expect(200)).body;
    expect(m.days.length).toBe(4);                                                                           // four Tuesdays in October 2026
    expect(m.days.every((d: any) => new Date(`${d.date}T00:00:00Z`).getUTCDay() === 2)).toBe(true);
    expect(m.days[0].slots[0]).toMatchObject({ subject_name: 'Mathématiques', substitute_name: null });
    await call('get', '/timetable/month?month=2026-13', fam).expect(400);
    const pdf = await call('get', '/timetable.pdf', fam).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf'); expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('builds a university transcript from course units with ECTS, in the scale they were graded in', async () => {
    const adminT = await tok('admin', 'e2e_t', 31); const headT = await tok('head', 'e2e_t', 32);
    ids.cu = (await call('post', '/classes', adminT).send({ name: 'L1 Info', level_code: 'L1', school_year: '2026-2027' }).expect(201)).body.id;
    ids.st = (await call('post', '/students', adminT).send({ first_name: 'Léa', last_name: 'Ndong', class_id: ids.cu }).expect(201)).body.student.id;
    const u1 = (await call('post', '/course-units', adminT).send({ code: 'INF101', title: 'Algorithmique', credits: 6, semester: 'S1' }).expect(201)).body;
    const u2 = (await call('post', '/course-units', adminT).send({ code: 'MAT101', title: 'Analyse', credits: 4, semester: 'S1' }).expect(201)).body;
    await call('post', '/course-units', adminT).send({ code: 'BAD', title: 'x', credits: 0, semester: 'S1' }).expect(400);
    await call('put', '/unit-results', headT).send({ school_year: '2026-2027', entries: [{ student_id: ids.st, unit_id: u1.id, value: 25 }] }).expect(400);
    await call('put', '/unit-results', headT).send({ school_year: '2026-2027', entries: [{ student_id: ids.st, unit_id: u1.id, value: 14 }, { student_id: ids.st, unit_id: u2.id, value: 8 }] }).expect(200);
    const fam = await tok('student', 'e2e_t', 33, { student_id: ids.st });
    const tr = (await call('get', `/students/${ids.st}/transcript?school_year=2026-2027`, fam).expect(200)).body;
    expect(tr.credits_total).toBe(10); expect(tr.credits_acquired).toBe(6);
    expect(tr.lines.find((l: any) => l.code === 'INF101')).toMatchObject({ validated: true, credits: 6 });
    expect(tr.lines.find((l: any) => l.code === 'MAT101').validated).toBe(false);
    expect(tr.general.text).toMatch(/11[.,]6/);                                                              // (70*6 + 40*4) / 10 = 58 % of 20
    await call('get', `/students/${ids.st}/transcript?school_year=2026-2027`, await tok('student', 'e2e_t', 34, { student_id: U(888) })).expect(403);
    const pdf = await call('get', `/students/${ids.st}/transcript.pdf?school_year=2026-2027`, fam).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe('%PDF');
  });
});
