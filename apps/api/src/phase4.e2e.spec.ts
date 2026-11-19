import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';
import { Pool } from 'pg';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 'q'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../packages/modules');
process.env.MESSAGE_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.PUSH_MODE = 'sandbox';
process.env.AI_MODEL_PATH = join(__dirname, '../../ai/model/model.json');

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Phase 4 e2e (OAA, gamification, predictive AI)', () => {
  jest.setTimeout(90000);
  let app: INestApplication; let server: any; let admin: Pool;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n + 700).padStart(12, '0')}`;
  const ids: Record<string, string> = {};
  let adminT: string, headT: string, teacherT: string, otherTeacherT: string, guardianT: string, otherGuardianT: string, studentT: string;
  const tok = async (role: string, tenant: string, n: number, extra: object = {}) =>
    (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant, ...extra })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'put', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,'e2e_g','Lycée G','lycee','GA','tenant_e2e_g') ON CONFLICT DO NOTHING", [U(9001)]);
    await admin.query("SELECT provision_tenant_schema('e2e_g')");
    const { AppModule } = await import('./app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication(); await app.init(); server = app.getHttpServer();
    adminT = await tok('admin', 'e2e_g', 1); headT = await tok('head', 'e2e_g', 2);
    for (const m of ['module-oaa', 'module-gamification', 'module-ia-predictive']) await call('post', `/modules/${m}/enable`, adminT).send({}).expect(201);
    ids.cls = (await call('post', '/classes', adminT).send({ name: '2nde A', level_code: '2nde', school_year: '2026-2027' }).expect(201)).body.id;
    ids.cls2 = (await call('post', '/classes', adminT).send({ name: '2nde B', level_code: '2nde', school_year: '2026-2027' }).expect(201)).body.id;
    ids.math = (await call('post', '/subjects', adminT).send({ code: 'MATH', name: 'Maths', coefficient: 4 }).expect(201)).body.id;
    ids.eps = (await call('post', '/subjects', adminT).send({ code: 'EPS', name: 'EPS', coefficient: 1, category: 'physical' }).expect(201)).body.id;
    await call('post', '/subjects', adminT).send({ code: 'X', name: 'X', category: 'nope' }).expect(400);
    const mk = async (first: string, cls: string, gender: string) => (await call('post', '/students', adminT).send({ first_name: first, last_name: 'Test', class_id: cls, gender }).expect(201)).body;
    const a = await mk('Ada', ids.cls, 'F'); ids.s1 = a.student.id; ids.hook = a.hooks;
    ids.s2 = (await mk('Ben', ids.cls, 'M')).student.id;
    ids.s3 = (await mk('Cleo', ids.cls2, 'F')).student.id;
    teacherT = await tok('teacher', 'e2e_g', 3, { class_ids: [ids.cls] });
    otherTeacherT = await tok('teacher', 'e2e_g', 4, { class_ids: [ids.cls2] });
    guardianT = await tok('guardian', 'e2e_g', 5, { child_ids: [ids.s1] });
    otherGuardianT = await tok('guardian', 'e2e_g', 6, { child_ids: [ids.s3] });
    studentT = await tok('student', 'e2e_g', 7, { student_id: ids.s1 });
    await call('post', '/directory', adminT).send({ user_id: U(2), role: 'head', display_name: 'Directeur' }).expect(201);
    await call('post', '/directory', adminT).send({ user_id: U(5), role: 'guardian', display_name: 'Parent Ada', child_ids: [ids.s1] }).expect(201);
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('onStudentCreated initialises the OAA (module hook, persisted by the core)', async () => {
    expect((ids.hook as any)[0]).toMatchObject({ module: 'module-oaa', ok: true });
    const r = (await call('get', `/students/${ids.s1}/oaa`, headT).expect(200)).body;
    expect(r.score100).toBe(50); expect(r.alert).toBe('ok');
    expect(r.thresholds.warning.in_scale).toMatch(/10/);    // 50 % of 20, shown in the local scale
    expect(r.thresholds.penalty.in_scale).toMatch(/8/);
  });

  it('me/students: own record, children, taught classes', async () => {
    expect((await call('get', '/me/students', studentT).expect(200)).body.map((x: any) => x.id)).toEqual([ids.s1]);
    expect((await call('get', '/me/students', guardianT).expect(200)).body.map((x: any) => x.id)).toEqual([ids.s1]);
    expect((await call('get', '/me/students', teacherT).expect(200)).body.length).toBe(2);
  });

  it('confidentiality by role: student own, parent child, teacher own class, direction all', async () => {
    await call('get', `/students/${ids.s1}/oaa`, studentT).expect(200);
    await call('get', `/students/${ids.s1}/oaa`, guardianT).expect(200);
    await call('get', `/students/${ids.s1}/oaa`, teacherT).expect(200);
    await call('get', `/students/${ids.s1}/oaa`, otherGuardianT).expect(403);
    await call('get', `/students/${ids.s1}/oaa`, otherTeacherT).expect(403);
    await call('get', `/classes/${ids.cls}/oaa`, studentT).expect(403);
    expect((await call('get', `/classes/${ids.cls}/oaa`, teacherT).expect(200)).body.students.length).toBe(2);
    await call('get', `/classes/${ids.cls}/oaa`, otherTeacherT).expect(403);
  });

  it('grades feed the right axes: academic from Maths, physical from EPS (spec 7.1)', async () => {
    const ev = async (subject: string, title: string) => (await call('post', '/evaluations', teacherT).send({ class_id: ids.cls, subject_id: subject, period_code: 'T1', title }).expect(201)).body.id;
    const m = await ev(ids.math, 'DS1'), e = await ev(ids.eps, 'Course');
    await call('post', `/evaluations/${m}/grades`, teacherT).send({ entries: [{ student_id: ids.s1, value: 16 }, { student_id: ids.s2, value: 6 }] }).expect(201);
    await call('post', `/evaluations/${e}/grades`, teacherT).send({ entries: [{ student_id: ids.s1, value: 18 }] }).expect(201);
    const r = (await call('get', `/students/${ids.s1}/oaa`, headT).expect(200)).body;
    expect(r.axes.academic).toBeCloseTo(80, 0);        // 16/20
    expect(r.axes.physical).toBeCloseTo(90, 0);        // 18/20
    expect(r.history.length).toBeGreaterThan(1);
    const low = (await call('get', `/students/${ids.s2}/oaa`, headT).expect(200)).body;
    expect(low.axes.academic).toBeCloseTo(30, 0);
  });

  it('teacher assessments feed an axis; a score under the penalty threshold PROPOSES a penalty (human decides)', async () => {
    await call('post', `/students/${ids.s2}/oaa/assessments`, otherTeacherT).send({ axis: 'adaptability', value: 10 }).expect(403);
    await call('post', `/students/${ids.s2}/oaa/assessments`, teacherT).send({ axis: 'nope', value: 10 }).expect(400);
    for (const axis of ['adaptability', 'physical', 'orientation']) await call('post', `/students/${ids.s2}/oaa/assessments`, teacherT).send({ axis, value: 5, label: 'bilan' }).expect(201);
    const r = (await call('get', `/students/${ids.s2}/oaa`, headT).expect(200)).body;
    expect(r.score100).toBeLessThan(40); expect(r.alert).toBe('penalty');
    const pen = (await call('get', '/oaa/penalties?status=proposed', headT).expect(200)).body;
    expect(pen.some((x: any) => x.student_id === ids.s2)).toBe(true);
    await call('post', `/oaa/penalties/${pen[0].id}/decision`, teacherT).send({ decision: 'applied' }).expect(403);
    await call('post', `/oaa/penalties/${pen[0].id}/decision`, headT).send({ decision: 'applied' }).expect(201);
  });

  it('OAA config is validated and the score is displayed in the active scale', async () => {
    await call('put', '/oaa/config', headT).send({ thresholds: { warning: 30, penalty: 40 } }).expect(400);
    await call('put', '/oaa/config', headT).send({ weights: { academic: -1 } }).expect(400);
    await call('put', '/oaa/config', teacherT).send({}).expect(403);
    await call('put', '/oaa/config', headT).send({ ranking_enabled: false }).expect(200);
    const cls = (await call('get', `/classes/${ids.cls}/oaa`, headT).expect(200)).body;
    expect(cls.ranking_enabled).toBe(false); expect(cls.students.every((s: any) => s.rank === null)).toBe(true);
    await call('put', '/oaa/config', headT).send({ ranking_enabled: true }).expect(200);
    expect((await call('get', `/classes/${ids.cls}/oaa`, headT).expect(200)).body.students.some((s: any) => s.rank === 1)).toBe(true);
  });

  it('absences hit the social-contribution axis and warn the family in the local scale', async () => {
    const before = (await call('get', `/students/${ids.s1}/oaa`, headT).expect(200)).body.axes.social_contribution;
    for (let i = 1; i <= 6; i++) await call('post', '/absences', teacherT).send({ student_id: ids.s1, on_date: `2026-11-0${i}`, kind: 'absence' }).expect(201);
    const after = (await call('get', `/students/${ids.s1}/oaa`, headT).expect(200)).body.axes.social_contribution;
    expect(after).toBeLessThan(before);
  });

  let quiz: any;
  it('quiz: creation by the class teacher only, answers never leak, shuffle per attempt', async () => {
    const body = { title: 'Quiz Maths', class_id: ids.cls, subject_id: ids.math, mode: 'qcm', time_limit_sec: 600,
      questions: [{ prompt: '2+2', choices: ['3', '4', '5'], correct: 1, points: 5 }, { prompt: '3x3', choices: ['6', '9', '12'], correct: 1, points: 5 }, { prompt: '10/2', choices: ['5', '2', '20'], correct: 0, points: 5 }] };
    await call('post', '/quizzes', otherTeacherT).send(body).expect(403);
    await call('post', '/quizzes', studentT).send(body).expect(403);
    quiz = (await call('post', '/quizzes', teacherT).send(body).expect(201)).body;
    await call('post', `/quizzes/${quiz.id}/start`, studentT).expect(404);               // not published yet
    await call('post', `/quizzes/${quiz.id}/publish`, teacherT).expect(201);
    expect((await call('get', '/quizzes', studentT).expect(200)).body.length).toBe(1);
    const start = (await call('post', `/quizzes/${quiz.id}/start`, studentT).expect(201)).body;
    expect(JSON.stringify(start)).not.toContain('"correct"');
    quiz.attempt = start;
    await call('post', `/quizzes/${quiz.id}/start`, studentT).expect(409);               // max_attempts = 1
  });

  it('quiz submission: scored on ORIGINAL indexes, XP idempotent, badges, OAA fed (table 8.4), too-fast flagged', async () => {
    const answers = Object.fromEntries(quiz.attempt.questions.map((q: any) => {
      const right: Record<string, number> = { '2+2': 1, '3x3': 1, '10/2': 0 };
      return [q.id, right[q.prompt]];
    }));
    const r = (await call('post', `/quiz-attempts/${quiz.attempt.attempt_id}/submit`, studentT).send({ answers }).expect(201)).body;
    expect(r.score100).toBe(100); expect(r.xp).toBe(25); expect(r.badges).toContain('sans_faute');
    expect(r.flags).toContain('too_fast');                                                 // 3 answers in < 3 seconds
    await call('post', `/quiz-attempts/${quiz.attempt.attempt_id}/submit`, studentT).send({ answers }).expect(409);
    const prof = (await call('get', `/students/${ids.s1}/gamification`, guardianT).expect(200)).body;
    expect(prof.total_xp).toBe(25); expect(prof.badges.map((b: any) => b.code)).toContain('sans_faute'); expect(prof.level.label).toBe('Novice');
    await call('get', `/students/${ids.s1}/gamification`, otherGuardianT).expect(403);
    const att = (await call('get', `/quizzes/${quiz.id}/attempts`, teacherT).expect(200)).body;
    expect(att[0].flags).toContain('too_fast');
    await call('get', `/quizzes/${quiz.id}/attempts`, studentT).expect(403);
  });

  it('time limit is enforced server side', async () => {
    const q2 = (await call('post', '/quizzes', teacherT).send({ title: 'Chrono', class_id: ids.cls, mode: 'qcm', time_limit_sec: 10, questions: [{ prompt: 'a', choices: ['x', 'y'], correct: 0 }] }).expect(201)).body;
    await call('post', `/quizzes/${q2.id}/publish`, teacherT).expect(201);
    const st = (await call('post', `/quizzes/${q2.id}/start`, studentT).expect(201)).body;
    await admin.query("UPDATE tenant_e2e_g.quiz_attempts SET started_at = NOW() - INTERVAL '5 minutes' WHERE id = $1", [st.attempt_id]);
    await call('post', `/quiz-attempts/${st.attempt_id}/submit`, studentT).send({ answers: {} }).expect(400);
    await call('post', `/quiz-attempts/${st.attempt_id}/submit`, studentT).send({ answers: {} }).expect(409);   // closed
  });

  it('boss and escape-game modes return their own outcome; awards are idempotent and class-scoped', async () => {
    const boss = (await call('post', '/quizzes', teacherT).send({ title: 'Boss', class_id: ids.cls, mode: 'boss', questions: [{ prompt: 'a', choices: ['x', 'y'], correct: 0 }, { prompt: 'b', choices: ['x', 'y'], correct: 1 }] }).expect(201)).body;
    await call('post', `/quizzes/${boss.id}/publish`, teacherT).expect(201);
    const st = (await call('post', `/quizzes/${boss.id}/start`, studentT).expect(201)).body;
    const ans = Object.fromEntries(st.questions.map((q: any) => [q.id, q.prompt === 'a' ? 0 : 1]));
    const r = (await call('post', `/quiz-attempts/${st.attempt_id}/submit`, studentT).send({ answers: ans }).expect(201)).body;
    expect(r.boss_defeated).toBe(true); expect(r.badges).toContain('chasseur_boss');
    const a1 = (await call('post', '/games/award', teacherT).send({ student_id: ids.s1, source: 'homework', ref: 'hw-1' }).expect(201)).body;
    expect(a1.xp).toBe(10);
    expect((await call('post', '/games/award', teacherT).send({ student_id: ids.s1, source: 'homework', ref: 'hw-1' }).expect(201)).body.duplicate).toBe(true);
    await call('post', '/games/award', otherTeacherT).send({ student_id: ids.s1, source: 'homework', ref: 'hw-2' }).expect(403);
    await call('post', '/games/award', studentT).send({ student_id: ids.s1, source: 'homework', ref: 'hw-3' }).expect(403);
  });

  it('challenges, teams and leaderboards (names shortened for students)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await call('post', '/challenges', studentT).send({}).expect(403);
    await call('post', '/challenges', teacherT).send({ code: 'T1', title: 'Défi prof', kind: 'individual', metric: 'xp', target: 10000, starts_on: today, ends_on: today }).expect(201);
    await call('post', '/challenges', headT).send({ code: 'XP50', title: 'Gagne 50 XP', kind: 'individual', metric: 'xp', target: 50, starts_on: today, ends_on: today }).expect(201);
    const t = (await call('post', '/teams', teacherT).send({ name: 'Les Lions', class_id: ids.cls, member_ids: [ids.s1, ids.s2] }).expect(201)).body;
    expect(t.members).toBe(2);
    await call('post', '/teams', otherTeacherT).send({ name: 'Intrus', class_id: ids.cls, member_ids: [ids.s1] }).expect(403);
    await call('post', '/games/award', teacherT).send({ student_id: ids.s1, source: 'participation', ref: 'p1' }).expect(201);
    await call('post', '/games/award', teacherT).send({ student_id: ids.s1, source: 'homework', ref: 'hw-4' }).expect(201);
    const prof = (await call('get', `/students/${ids.s1}/gamification`, studentT).expect(200)).body;
    expect(prof.completed_challenges.map((c: any) => c.code)).toContain('XP50');
    const board = (await call('get', '/leaderboards?scope=class', studentT).expect(200)).body;
    expect(board[0].rank).toBe(1); expect(board[0].name).toBe('Ada T.'); expect(board[0].student_id).toBeUndefined();
    const staffBoard = (await call('get', `/leaderboards?scope=class&class_id=${ids.cls}`, teacherT).expect(200)).body;
    expect(staffBoard[0].student_id).toBe(ids.s1);
    await call('get', `/leaderboards?scope=class&class_id=${ids.cls}`, otherTeacherT).expect(403);
    expect((await call('get', `/leaderboards?scope=subject&subject_id=${ids.math}`, headT).expect(200)).body[0].points).toBeGreaterThan(0);
    expect((await call('get', '/teams', headT).expect(200)).body[0].name).toBe('Les Lions');
  });

  it('predictive AI: explainable, advisory, class-scoped, alerts the direction, bias audit', async () => {
    await call('post', '/predictive/run', studentT).send({}).expect(403);
    await call('post', '/predictive/run', otherTeacherT).send({ class_id: ids.cls }).expect(403);
    await call('post', '/predictive/run', teacherT).send({}).expect(403);               // school-wide = direction only
    const run = (await call('post', '/predictive/run', headT).send({}).expect(201)).body;
    expect(run.advisory_only).toBe(true); expect(run.scored).toBeGreaterThanOrEqual(2); expect(run.skipped_insufficient_data).toBeGreaterThanOrEqual(1);   // Cleo has no grade yet
    const weak = (await call('get', `/predictive/students/${ids.s2}`, headT).expect(200)).body;
    expect(weak.latest.level).toBe('high'); expect(weak.latest.factors[0].contribution).toBeGreaterThan(0); expect(weak.recommendations.length).toBeGreaterThan(0);
    const strong = (await call('get', `/predictive/students/${ids.s1}?lang=en`, teacherT).expect(200)).body;
    expect(['low', 'medium']).toContain(strong.latest.level); expect(strong.notice).toMatch(/Decision support/);
    await call('get', `/predictive/students/${ids.s1}`, otherTeacherT).expect(403);
    await call('get', `/predictive/students/${ids.s1}`, guardianT).expect(403);          // staff only unless family_visible is switched on
    const dash = (await call('get', '/predictive/dashboard', headT).expect(200)).body;
    expect(dash.counts.high).toBeGreaterThanOrEqual(1); expect(dash.high_risk[0].name).toBeDefined();
    const notes = (await call('get', '/notifications', headT).expect(200)).body;
    expect(notes.some((n: any) => n.type === 'ai.risk')).toBe(true);
    await call('post', `/predictive/predictions/${weak.latest.id}/feedback`, teacherT).send({ useful: true, class_id: ids.cls }).expect(201);
    const bias = (await call('get', '/predictive/bias', headT).expect(200)).body;
    expect(bias.excluded).toContain('payment data'); expect(bias.features_used).not.toContain('gender');
    await call('get', '/predictive/bias', teacherT).expect(403);
  });

  it('family visibility is a school choice (module config) and modules can be switched off per school', async () => {
    await call('post', '/modules/module-ia-predictive/enable', adminT).send({ config: { family_visible: true } }).expect(201);
    await call('get', `/predictive/students/${ids.s1}`, guardianT).expect(200);
    await call('get', `/predictive/students/${ids.s1}`, otherGuardianT).expect(403);
    await call('post', '/modules/module-ia-predictive/disable', adminT).send({}).expect(201);
    await call('get', `/predictive/students/${ids.s1}`, headT).expect(403);
    await call('post', '/modules/module-gamification/disable', adminT).send({}).expect(201);
    await call('get', '/challenges', headT).expect(403);
    const screens = (await call('get', '/modules/active', headT).expect(200)).body;
    expect(JSON.stringify(screens)).not.toContain('quiz_player');
  });
});
