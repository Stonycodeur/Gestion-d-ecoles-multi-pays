import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';
import { Pool } from 'pg';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 'y'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../../packages/modules');

// Needs PostgreSQL: DATABASE_ADMIN_URL (superuser, sets up tenants) and DATABASE_URL (non-superuser app_runtime, so RLS applies).
const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Pedagogy e2e (real PostgreSQL, RLS)', () => {
  jest.setTimeout(60000);
  let app: INestApplication; let server: any; let admin: Pool;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  let adminT: string, headT: string, teacherT: string, guardianT: string, otherGuardianT: string, studentT: string, adminB: string, accountantT: string;
  const ids: Record<string, string> = {};

  const tok = async (role: string, tenant: string, n: number, extra: object = {}) =>
    (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant, ...extra })).body.access_token as string;
  const call = (m: 'get' | 'post', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    for (const [slug, id] of [['e2e_a', U(9001)], ['e2e_b', U(9002)]]) {
      await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,$2,$3,'lycee','GA',$4) ON CONFLICT DO NOTHING", [id, slug, `Lycée ${slug}`, `tenant_${slug}`]);
      await admin.query('SELECT provision_tenant_schema($1)', [slug]);
    }
    const { AppModule } = await import('../app.module');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); await app.init(); server = app.getHttpServer();
    adminT = await tok('admin', 'e2e_a', 1); headT = await tok('head', 'e2e_a', 2); adminB = await tok('admin', 'e2e_b', 3);
    accountantT = await tok('accountant', 'e2e_a', 4);
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('sets up the school (classes, subjects, teacher, room, students) and fires onStudentCreated for enabled modules', async () => {
    await call('post', '/modules/module-oaa/enable', adminT).send({}).expect(201);
    ids.cls = (await call('post', '/classes', adminT).send({ name: '2nde A', level_code: '2nde', school_year: '2026-2027' }).expect(201)).body.id;
    ids.math = (await call('post', '/subjects', adminT).send({ code: 'MATH', name: 'Mathématiques', coefficient: 4 }).expect(201)).body.id;
    ids.fr = (await call('post', '/subjects', adminT).send({ code: 'FR', name: 'Français', coefficient: 3 }).expect(201)).body.id;
    ids.t1 = (await call('post', '/teachers', adminT).send({ first_name: 'Jean', last_name: 'Mba' }).expect(201)).body.id;
    ids.t2 = (await call('post', '/teachers', adminT).send({ first_name: 'Awa', last_name: 'Nze' }).expect(201)).body.id;
    await call('post', '/rooms', adminT).send({ name: 'S1' }).expect(201);
    await call('post', '/rooms', adminT).send({ name: 'S2' }).expect(201);
    await call('post', '/class-subjects', adminT).send({ class_id: ids.cls, subject_id: ids.math, teacher_id: ids.t1, weekly_hours: 4 }).expect(201);
    await call('post', '/class-subjects', adminT).send({ class_id: ids.cls, subject_id: ids.fr, teacher_id: ids.t2, weekly_hours: 3 }).expect(201);
    const s1 = await call('post', '/students', adminT).send({ first_name: 'Ada', last_name: 'Obiang', class_id: ids.cls, guardians: [{ full_name: 'Mme Obiang' }] }).expect(201);
    ids.s1 = s1.body.student.id;
    expect(s1.body.hooks[0]).toMatchObject({ module: 'module-oaa', ok: true });
    expect(s1.body.hooks[0].value.score100).toBe(50);
    ids.s2 = (await call('post', '/students', adminT).send({ first_name: 'Ben', last_name: 'Ndong', class_id: ids.cls }).expect(201)).body.student.id;
    await call('post', '/students', accountantT).send({ first_name: 'x', last_name: 'y' }).expect(403);
    teacherT = await tok('teacher', 'e2e_a', 5, { class_ids: [ids.cls] });
    guardianT = await tok('guardian', 'e2e_a', 6, { child_ids: [ids.s1] });
    otherGuardianT = await tok('guardian', 'e2e_a', 7, { child_ids: [ids.s2] });
    studentT = await tok('student', 'e2e_a', 8, { student_id: ids.s1 });
  });

  it('tenant isolation: school B sees nothing of school A', async () => {
    expect((await call('get', '/classes', adminB).expect(200)).body).toEqual([]);
    expect((await call('get', '/students', adminB).expect(200)).body).toEqual([]);
  });

  it('timetable: generate, conflict-free, head validates before publication, students only see published', async () => {
    const g = (await call('post', '/schedules/generate', adminT).send({ school_year: '2026-2027', periods_per_day: 6 }).expect(201)).body;
    expect(g.complete).toBe(true); expect(g.slots).toBe(7);
    const sid = g.scheduleId;
    await call('post', `/schedules/${sid}/publish`, headT).expect(409);          // not validated yet
    await call('get', `/schedules/${sid}`, studentT).expect(403);                // draft hidden from students
    const view = (await call('get', `/schedules/${sid}`, adminT).expect(200)).body;
    expect(view.conflicts).toEqual([]);
    const taken = view.slots[0];
    await call('post', `/schedules/${sid}/slots`, adminT).send({ class_id: ids.cls, subject_id: ids.fr, teacher_id: ids.t2, weekday: taken.day, period_index: taken.period }).expect(409);
    // drag and drop: moving onto an occupied cell is refused, onto a free cell accepted (drafts only)
    const other = view.slots.find((x: any) => x.teacherId !== taken.teacherId && x.id !== taken.id);
    await (request(server) as any).patch(`/schedules/${sid}/slots/${taken.id}`).set('Authorization', `Bearer ${adminT}`).send({ weekday: other.day, period_index: other.period }).expect(409);
    await (request(server) as any).patch(`/schedules/${sid}/slots/${taken.id}`).set('Authorization', `Bearer ${adminT}`).send({ weekday: 6, period_index: 9 }).expect(200);
    await call('post', `/schedules/${sid}/validate`, adminT).expect(403);        // admin cannot validate: only the head
    await call('post', `/schedules/${sid}/validate`, headT).expect(201);
    await call('post', `/schedules/${sid}/publish`, headT).expect(201);
    await call('get', `/schedules/${sid}`, studentT).expect(200);
    const ics = await call('get', `/schedules/${sid}/ical?first_monday=2026-10-05&until=2027-06-30&timezone=Africa/Libreville`, studentT).expect(200);
    expect(ics.text).toContain('BEGIN:VCALENDAR');
  });

  it('grades: scale from the country referential, step enforced, own class only, report card in the active scale, mid-year scale change keeps old grades', async () => {
    const outsider = await tok('teacher', 'e2e_a', 10, { class_ids: [] });
    await call('post', '/evaluations', outsider).send({ class_id: ids.cls, subject_id: ids.math, period_code: 'T1', title: 'DS1' }).expect(403);
    const ev = (await call('post', '/evaluations', teacherT).send({ class_id: ids.cls, subject_id: ids.math, period_code: 'T1', title: 'DS1', coefficient: 1 }).expect(201)).body;
    expect(ev.scale_snapshot.code).toBe('num20');
    await call('post', `/evaluations/${ev.id}/grades`, teacherT).send({ entries: [{ student_id: ids.s1, value: 14.6 }] }).expect(400);   // step 0.25
    await call('post', `/evaluations/${ev.id}/grades`, teacherT).send({ entries: [{ student_id: ids.s1, value: 21 }] }).expect(400);
    const ok = await call('post', `/evaluations/${ev.id}/grades`, teacherT).send({ entries: [{ student_id: ids.s1, value: 14.5 }, { student_id: ids.s2, value: 10 }] }).expect(201);
    expect(ok.body.saved).toBe(2);
    const rep = (await call('get', `/students/${ids.s1}/report?period=T1`, guardianT).expect(200)).body;
    expect(rep.general.text).toBe('14,5/20'); expect(rep.rank).toBe(1); expect(rep.classSize).toBe(2);
    await call('get', `/students/${ids.s1}/report?period=T1`, otherGuardianT).expect(403);
    const pdf = await call('get', `/students/${ids.s1}/report.pdf?period=T1`, studentT).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    // the school switches to /10 in mid-year: only new evaluations use it
    await admin.query("INSERT INTO tenant_settings(tenant_id, cycle, grading_scale_code) VALUES ($1,'upper_secondary','num10')", [U(9001)]);
    const ev2 = (await call('post', '/evaluations', teacherT).send({ class_id: ids.cls, subject_id: ids.math, period_code: 'T1', title: 'DS2' }).expect(201)).body;
    expect(ev2.scale_snapshot.code).toBe('num10');
    const old = await admin.query('SELECT scale_snapshot->>\'code\' AS code FROM tenant_e2e_a.evaluations WHERE id = $1', [ev.id]);
    expect(old.rows[0].code).toBe('num20');
    await call('post', `/evaluations/${ev2.id}/grades`, teacherT).send({ entries: [{ student_id: ids.s1, value: 8 }] }).expect(201);   // 8/10 = 80
    const rep2 = (await call('get', `/students/${ids.s1}/report?period=T1`, studentT).expect(200)).body;
    expect(rep2.general.text.endsWith('/10')).toBe(true);
    expect(Math.round(rep2.general.value * 10)).toBe(Math.round(((72.5 + 80) / 2) / 100 * 10 * 10));   // both grades comparable on the 0-100 base
    await admin.query("DELETE FROM tenant_settings WHERE tenant_id = $1", [U(9001)]);
  });

  it('absences: teacher records, guardian justifies, head decides, attendance stats; student cannot record', async () => {
    const ab = (await call('post', '/absences', teacherT).send({ student_id: ids.s1, on_date: '2026-11-03', period_index: 1, kind: 'absence' }).expect(201)).body;
    await call('post', '/absences', studentT).send({ student_id: ids.s1, on_date: '2026-11-04', kind: 'absence' }).expect(403);
    await call('post', `/absences/${ab.id}/justify`, otherGuardianT).send({ reason: 'x' }).expect(403);
    const j = (await call('post', `/absences/${ab.id}/justify`, guardianT).send({ reason: 'Maladie' }).expect(201)).body;
    await call('post', `/justifications/${j.id}/decide`, guardianT).send({ decision: 'accepted' }).expect(403);
    await call('post', `/justifications/${j.id}/decide`, headT).send({ decision: 'accepted' }).expect(201);
    const att = (await call('get', `/students/${ids.s1}/attendance`, guardianT).expect(200)).body;
    expect(att.stats).toMatchObject({ absences: 1, justified: 1, unjustified: 0 }); expect(att.alert).toBe('ok');
    await call('get', `/students/${ids.s1}/attendance`, otherGuardianT).expect(403);
  });

  it('lessons: full-text search, visa by the head only', async () => {
    const l = (await call('post', '/lessons', teacherT).send({ class_id: ids.cls, subject_id: ids.math, on_date: '2026-11-05', title: 'Équations', homework: 'Résoudre exercice 5', homework_due: '2026-11-09' }).expect(201)).body;
    expect((await call('get', '/lessons?q=exercice', studentT).expect(200)).body).toHaveLength(1);
    expect((await call('get', '/lessons?q=inexistant', studentT).expect(200)).body).toHaveLength(0);
    await call('post', `/lessons/${l.id}/visa`, teacherT).expect(403);
    await call('post', `/lessons/${l.id}/visa`, headT).expect(201);
  });

  it('row level security works even if a query forgets the tenant filter', async () => {
    const rows = await admin.query('SELECT count(*)::int AS n FROM tenant_e2e_a.students');       // superuser sees all
    expect(rows.rows[0].n).toBe(2);
    const rt = new Pool({ connectionString: process.env.DATABASE_URL });
    const c = await rt.connect();
    try {
      await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id', $1, true)", [U(9002)]);
      expect((await c.query('SELECT count(*)::int AS n FROM tenant_e2e_a.students')).rows[0].n).toBe(0);   // tenant B context, A's table
      await c.query('ROLLBACK');
    } finally { c.release(); await rt.end(); }
  });
});
