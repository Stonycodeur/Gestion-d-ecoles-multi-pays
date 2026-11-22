import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';
import { Pool } from 'pg';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 'q'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../packages/modules');
process.env.MESSAGE_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.WEBHOOK_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.PUSH_MODE = 'sandbox';
process.env.LLM_MODE = 'sandbox';

import type { LlmAdapter, LlmRequest } from './genai/llm.adapter';

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Phase 6c e2e (generative assistant, XR)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let server: any; let admin: Pool;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n + 3000).padStart(12, '0')}`;
  const ids: Record<string, string> = {};
  let adminT: string, teacherT: string, childT: string, olderT: string, guardianT: string;
  const seen: LlmRequest[] = [];
  const spy: LlmAdapter = { name: 'spy', async run(r) { seen.push(r); return { simulated: true, output: r.kind === 'tutor' ? { reply: 'Que sais-tu déjà ?' } : r.kind === 'summarize' ? { summary: `Résumé pour [NOM1] : ${r.text.slice(0, 20)}` } : { questions: [{ prompt: 'q', choices: ['a', 'b'], correct: 0 }, { prompt: 'bad', choices: ['x'], correct: 0 }] } }; } };
  const tok = async (role: string, n: number, extra: object = {}) => (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant: 'e2e_k', ...extra })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'delete', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);
  const assist = (t: string, body: object) => call('post', '/ai/assist', t).send(body);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,'e2e_k','Collège K','college','GA','tenant_e2e_k') ON CONFLICT DO NOTHING", [U(9100)]);
    await admin.query("SELECT provision_tenant_schema('e2e_k')");
    const { AppModule } = await import('./app.module');
    const { GenAiService } = await import('./genai/genai.service');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true }); await app.init(); server = app.getHttpServer();
    app.get(GenAiService).setAdapter(spy);
    adminT = await tok('admin', 1);
    ids.cls = (await call('post', '/classes', adminT).send({ name: '6e A', level_code: '6e', school_year: '2026-2027' }).expect(201)).body.id;
    ids.child = (await call('post', '/students', adminT).send({ first_name: 'Ada', last_name: 'Obiang', birth_date: '2017-03-02', class_id: ids.cls }).expect(201)).body.student.id;
    ids.older = (await call('post', '/students', adminT).send({ first_name: 'Luc', last_name: 'Ndong', birth_date: '2008-03-02', class_id: ids.cls }).expect(201)).body.student.id;
    teacherT = await tok('teacher', 3, { class_ids: [ids.cls] });
    childT = await tok('student', 4, { student_id: ids.child }); olderT = await tok('student', 5, { student_id: ids.older }); guardianT = await tok('guardian', 6, { child_ids: [ids.child] });
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  describe('generative assistant', () => {
    it('is off until the school enables it, and can be switched off again', async () => {
      await assist(teacherT, { kind: 'summarize', text: 'Un cours.' }).expect(403);
      await call('post', '/modules/module-ai-assistant/enable', adminT).expect(201);
      await call('post', '/modules/module-gamification/enable', adminT).expect(201);
      const st = (await call('get', '/ai/status', teacherT).expect(200)).body; expect(st.enabled).toBe(true);
      await call('post', '/modules/module-ai-assistant/disable', adminT).expect(201);
      await assist(teacherT, { kind: 'summarize', text: 'Un cours.' }).expect(403);
      await call('post', '/modules/module-ai-assistant/enable', adminT).expect(201);
    });
    it('personal data never reaches the model, and comes back in the answer', async () => {
      seen.length = 0;
      const r = await assist(teacherT, { kind: 'summarize', student_id: ids.child, text: 'Ada Obiang (ada@mail.ga, 06 12 34 56 78) a présenté le volcanisme.' }).expect(201);
      const sent = seen[0]!.text; expect(sent).not.toMatch(/Ada|Obiang|ada@|06 12/); expect(sent).toMatch(/\[NOM\d\]/);
      expect(r.body.output.summary).toContain('Ada');   // [NOM1] restored for the teacher
      const log = (await admin.query('SELECT * FROM tenant_e2e_k.ai_usage_log')).rows; expect(log.length).toBeGreaterThan(0);
      expect(JSON.stringify(log)).not.toMatch(/Obiang|volcanisme/); expect(log[log.length - 1].redactions).toBeGreaterThan(2);
    });
    it('role rules: tutor only for students, staff tools not for students or guardians', async () => {
      await assist(teacherT, { kind: 'tutor', text: 'aide' }).expect(403);
      await assist(guardianT, { kind: 'summarize', text: 'x' }).expect(403);
      await assist(childT, { kind: 'summarize', text: 'x' }).expect(403);
      await assist(teacherT, { kind: 'nope', text: 'x' }).expect(400);
      await assist(teacherT, { kind: 'summarize', text: 'x'.repeat(9000) }).expect(400);
    });
    it('QCM: invalid model items are dropped; the teacher saves them as a DRAFT quiz', async () => {
      const r = await assist(teacherT, { kind: 'qcm', text: 'La Terre tourne autour du Soleil.', count: 2 }).expect(201);
      expect(r.body.output.questions.length).toBe(1); expect(r.body.output.rejected).toBe(1);
      const q = await call('post', '/ai/qcm/save', teacherT).send({ class_id: ids.cls, title: 'Astronomie', questions: r.body.output.questions }).expect(201);
      expect(q.body.published).toBe(false);
      await call('post', '/ai/qcm/save', teacherT).send({ class_id: ids.cls, title: 'Vide', questions: [{ prompt: 'x', choices: ['a'], correct: 0 }] }).expect(400);
    });
    it('correction help is only a proposal: deciding it never records a grade', async () => {
      const before = Number((await admin.query('SELECT COUNT(*) FROM tenant_e2e_k.grades')).rows[0].count);
      const r = await assist(teacherT, { kind: 'correction_help', student_id: ids.child, text: 'Sujet', reference: 'Le volcan émet de la lave.', answer: 'Ada pense que le volcan émet de la lave.', max_points: 10 }).expect(201);
      expect(r.body.proposal_id).toBeDefined(); expect(seen[seen.length - 1]!.answer).not.toMatch(/Ada/);
      await call('post', `/ai/proposals/${r.body.proposal_id}/decision`, guardianT).send({ accept: true }).expect(403);
      const d = await call('post', `/ai/proposals/${r.body.proposal_id}/decision`, teacherT).send({ accept: true, note: 'ok' }).expect(201);
      expect(d.body).toMatchObject({ status: 'accepted', grade_recorded: false });
      await call('post', `/ai/proposals/${r.body.proposal_id}/decision`, teacherT).send({ accept: false }).expect(404);   // already decided
      expect(Number((await admin.query('SELECT COUNT(*) FROM tenant_e2e_k.grades')).rows[0].count)).toBe(before);
    });
    it('the tutor is age-filtered: a 9-year-old is refused a topic that a 17-year-old may discuss', async () => {
      seen.length = 0;
      const blocked = (await assist(childT, { kind: 'tutor', text: 'Parle-moi de la drogue' }).expect(201)).body.output; expect(blocked.blocked).toBe(true); expect(seen.length).toBe(0);
      const ok = (await assist(olderT, { kind: 'tutor', text: 'Parle-moi de la drogue en biologie' }).expect(201)).body.output; expect(ok.blocked).toBe(false); expect(seen.length).toBe(1);
      const own = (await assist(childT, { kind: 'tutor', text: 'Comment calculer une fraction ?' }).expect(201)).body.output; expect(own.reply).toBeDefined();
      expect(seen[1]!.level).toBe('6e');
    });
    it('usage statistics are for administrators only and carry no content', async () => {
      await call('get', '/ai/usage', teacherT).expect(403);
      const u = (await call('get', '/ai/usage', adminT).expect(200)).body; expect(u.length).toBeGreaterThan(0); expect(Object.keys(u[0]).sort()).toEqual(['adapter', 'blocked', 'calls', 'chars_in', 'kind', 'redactions', 'role']);
    });
  });

  describe('XR assets', () => {
    const asset = (o: object = {}) => ({ title: 'Volcan', kind: 'model_3d', format: 'glb', url: 'https://cdn.ecole.ga/volcan.glb', ios_url: 'https://cdn.ecole.ga/volcan.usdz', size_bytes: 2_000_000, alt_text: 'Modèle 3D d’un volcan en coupe', ...o });
    it('is off until enabled', async () => { await call('post', '/xr/assets', teacherT).send(asset()).expect(403); await call('post', '/modules/module-xr/enable', adminT).expect(201); });
    it('teachers attach a 3D model to a lesson of their class; students and guardians only read', async () => {
      const math = (await call('post', '/subjects', adminT).send({ code: 'SVT', name: 'SVT', coefficient: 2 }).expect(201)).body.id;
      const lesson = (await call('post', '/lessons', teacherT).send({ class_id: ids.cls, subject_id: math, on_date: '2026-11-20', title: 'Le volcanisme', content: 'x' }).expect(201)).body.id;
      const a = (await call('post', '/xr/assets', teacherT).send(asset({ lesson_id: lesson })).expect(201)).body; expect(a.lesson_id).toBe(lesson);
      await call('post', '/xr/assets', childT).send(asset()).expect(403);
      const list = (await call('get', `/xr/assets?lesson_id=${lesson}`, childT).expect(200)).body; expect(list.map((x: any) => x.id)).toEqual([a.id]);
      await call('get', '/xr/assets', guardianT).expect(200);
      const other = (await call('post', '/classes', adminT).send({ name: '6e B', level_code: '6e', school_year: '2026-2027' }).expect(201)).body.id;
      const lesson2 = (await admin.query("INSERT INTO tenant_e2e_k.lessons(tenant_id, class_id, subject_id, on_date, title, content, status) VALUES ((SELECT id FROM tenants WHERE slug = 'e2e_k'), $1, $2, '2026-11-20', 'Autre', 'x', 'published') RETURNING id", [other, math])).rows[0].id;   // admins cannot author lessons
      await call('post', '/xr/assets', teacherT).send(asset({ lesson_id: lesson2 })).expect(403);   // not their class
      await call('delete', `/xr/assets/${a.id}`, childT).expect(403);
      await call('delete', `/xr/assets/${a.id}`, teacherT).expect(200);
    });
    it('invalid assets are refused with the reasons (format, weight, alt text, insecure address)', async () => {
      for (const bad of [{ alt_text: '' }, { format: 'exe', url: 'https://x.ga/a.exe' }, { size_bytes: 999_999_999 }, { url: 'http://insecure.ga/volcan.glb' }]) await call('post', '/xr/assets', teacherT).send(asset(bad)).expect(400);
    });
    it('the public 360° tour shows only public panoramas, published by the administration', async () => {
      const pano = (o: object = {}) => ({ title: 'Cour', kind: 'panorama_360', format: 'jpg', url: 'https://cdn.ecole.ga/cour.jpg', size_bytes: 3_000_000, alt_text: 'Vue à 360° de la cour de récréation', ...o });
      await call('post', '/xr/assets', teacherT).send(pano({ is_public: true })).expect(403);   // site:write needed
      await call('post', '/xr/assets', adminT).send(asset({ is_public: true })).expect(400);    // only panoramas are public
      await call('post', '/xr/assets', adminT).send(pano({ is_public: true })).expect(201);
      await call('post', '/xr/assets', adminT).send(pano({ title: 'Privé', url: 'https://cdn.ecole.ga/prive.jpg' })).expect(201);
      const t = (await request(server).get('/public/e2e_k/tour').expect(200)).body; expect(t.map((x: any) => x.title)).toEqual(['Cour']); expect(t[0].alt_text).toBeDefined();
    });
  });
});
