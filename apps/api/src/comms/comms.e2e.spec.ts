import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';
import { Pool } from 'pg';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 'z'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../../packages/modules');
process.env.MESSAGE_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.STORAGE_MODE = 'sandbox';
process.env.PUSH_MODE = 'sandbox';

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Communication e2e (messaging rules, encryption, news, notifications, locker)', () => {
  jest.setTimeout(60000);
  let app: INestApplication; let server: any; let admin: Pool;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n + 500).padStart(12, '0')}`;
  const ids: Record<string, string> = {};
  let adminT: string, headT: string, teacherT: string, guardianT: string, otherGuardianT: string, studentT: string, accountantT: string, adminB: string;
  const tok = async (role: string, tenant: string, n: number, extra: object = {}) =>
    (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant, ...extra })).body.access_token as string;
  const call = (m: 'get' | 'post', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);

  const bin = (path: string, t: string) => call('get', path, t).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    for (const [slug, id] of [['e2e_c', U(9001)], ['e2e_d', U(9002)]]) {
      await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,$2,$3,'lycee','GA',$4) ON CONFLICT DO NOTHING", [id, slug, `Lycée ${slug}`, `tenant_${slug}`]);
      await admin.query('SELECT provision_tenant_schema($1)', [slug]);
    }
    const { AppModule } = await import('../app.module');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); await app.init(); server = app.getHttpServer();
    adminT = await tok('admin', 'e2e_c', 1); headT = await tok('head', 'e2e_c', 2); accountantT = await tok('accountant', 'e2e_c', 4); adminB = await tok('admin', 'e2e_d', 3);
    ids.cls = (await call('post', '/classes', adminT).send({ name: '2nde A', level_code: '2nde', school_year: '2026-2027' }).expect(201)).body.id;
    ids.cls2 = (await call('post', '/classes', adminT).send({ name: '2nde B', level_code: '2nde', school_year: '2026-2027' }).expect(201)).body.id;
    ids.s1 = (await call('post', '/students', adminT).send({ first_name: 'Ada', last_name: 'Obiang', class_id: ids.cls }).expect(201)).body.student.id;
    ids.s2 = (await call('post', '/students', adminT).send({ first_name: 'Ben', last_name: 'Ndong', class_id: ids.cls2 }).expect(201)).body.student.id;
    teacherT = await tok('teacher', 'e2e_c', 5, { class_ids: [ids.cls] });
    guardianT = await tok('guardian', 'e2e_c', 6, { child_ids: [ids.s1] });
    otherGuardianT = await tok('guardian', 'e2e_c', 7, { child_ids: [ids.s2] });
    studentT = await tok('student', 'e2e_c', 8, { student_id: ids.s1 });
    const dir = (b: object) => call('post', '/directory', adminT).send(b).expect(201);
    await dir({ user_id: U(2), role: 'head', display_name: 'Directeur' });
    await dir({ user_id: U(4), role: 'accountant', display_name: 'Comptable' });
    await dir({ user_id: U(5), role: 'teacher', display_name: 'Prof Mba', class_ids: [ids.cls], locale: 'en' });
    await dir({ user_id: U(6), role: 'guardian', display_name: 'Parent Obiang', child_ids: [ids.s1], email: 'p@example.org' });
    await dir({ user_id: U(7), role: 'guardian', display_name: 'Parent Ndong', child_ids: [ids.s2] });
    await dir({ user_id: U(8), role: 'student', display_name: 'Ada', student_id: ids.s1 });
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('messaging follows the "who can write to whom" rules', async () => {
    const ok = await call('post', '/threads', guardianT).send({ subject: 'Devoirs', member_ids: [U(5)], body: 'Bonjour' }).expect(201);
    ids.thread = ok.body.id;
    await call('post', '/threads', otherGuardianT).send({ subject: 'x', member_ids: [U(5)], body: 'hi' }).expect(403);   // not a teacher of their child
    await call('post', '/threads', guardianT).send({ subject: 'x', member_ids: [U(7)], body: 'hi' }).expect(403);        // guardian -> guardian
    await call('post', '/threads', studentT).send({ subject: 'x', member_ids: [U(8 - 1)], body: 'hi' }).expect(403);      // student -> guardian
    await call('post', '/threads', accountantT).send({ subject: 'Frais', member_ids: [U(6)], body: 'Rappel' }).expect(201);
    await call('post', '/threads', accountantT).send({ subject: 'x', member_ids: [U(5)], body: 'hi' }).expect(403);       // accountant -> teacher
    await call('post', '/threads', headT).send({ subject: 'Réunion', member_ids: [U(5), U(6), U(7)], body: 'Convocation' }).expect(201);
  });

  it('messages are encrypted at rest and readable by members only; attachments round-trip', async () => {
    const m = await call('post', `/threads/${ids.thread}/messages`, teacherT).send({ body: 'Secret 123', attachment: { filename: 'a.txt', content_type: 'text/plain', content_base64: Buffer.from('hello').toString('base64') } }).expect(201);
    const raw = await admin.query('SELECT body_enc FROM tenant_e2e_c.messages WHERE id = $1', [m.body.id]);
    expect(raw.rows[0].body_enc).not.toContain('Secret');
    const list = (await call('get', `/threads/${ids.thread}`, guardianT).expect(200)).body;
    expect(list.map((x: any) => x.body)).toEqual(['Bonjour', 'Secret 123']);
    const att = list[1].attachment;
    expect((await bin(`/attachments/${att.id}`, guardianT).expect(200)).body.toString()).toBe('hello');
    await call('get', `/threads/${ids.thread}`, otherGuardianT).expect(404);
    await call('get', `/attachments/${att.id}`, otherGuardianT).expect(404);
    expect((await call('get', '/threads', teacherT).expect(200)).body.length).toBeGreaterThan(0);
  });

  it('push (sandbox) and in-app notifications are localized and sent to the family on absence and grade', async () => {
    await call('post', '/devices', guardianT).send({ platform: 'android', token: 'tok-1' }).expect(201);
    await call('post', '/absences', teacherT).send({ student_id: ids.s1, on_date: '2026-11-10', kind: 'absence' }).expect(201);
    const n = (await call('get', '/notifications', guardianT).expect(200)).body;
    expect(n.some((x: any) => x.type === 'absence.recorded' && x.title === 'Absence signalée')).toBe(true);
    const out = (await call('get', '/push-outbox', guardianT).expect(200)).body;
    expect(out.some((x: any) => x.title === 'Absence signalée' && x.platform === 'android')).toBe(true);
    const other = (await call('get', '/notifications', otherGuardianT).expect(200)).body;
    expect(other.some((x: any) => x.type === 'absence.recorded')).toBe(false);
  });

  it('news audience filtering, surveys (one vote each) and events', async () => {
    await call('post', '/news', teacherT).send({ title: 't', body: 'b' }).expect(403);
    await call('post', '/news', headT).send({ title: 'Rentrée', body: 'Le 1er', audience: 'all' }).expect(201);
    await call('post', '/news', headT).send({ title: 'Salle des profs', body: 'x', audience: 'staff' }).expect(201);
    expect((await call('get', '/news', guardianT).expect(200)).body.map((x: any) => x.title)).toEqual(['Rentrée']);
    expect((await call('get', '/news', teacherT).expect(200)).body.length).toBe(2);
    const s = (await call('post', '/surveys', headT).send({ question: 'Cantine ?', options: ['Oui', 'Non'] }).expect(201)).body;
    await call('post', `/surveys/${s.id}/vote`, guardianT).send({ option_index: 0 }).expect(201);
    await call('post', `/surveys/${s.id}/vote`, guardianT).send({ option_index: 1 }).expect(409);
    await call('post', `/surveys/${s.id}/vote`, otherGuardianT).send({ option_index: 0 }).expect(201);
    expect((await call('get', `/surveys/${s.id}/results`, headT).expect(200)).body.options[0].votes).toBe(2);
    await call('post', '/events', headT).send({ title: 'Fête', starts_at: '2026-12-20T10:00:00Z' }).expect(201);
    expect((await call('get', '/events', guardianT).expect(200)).body.length).toBe(1);
  });

  it('digital locker: ABAC on read, retention purge, tenant isolation', async () => {
    const d = (await call('post', '/locker', headT).send({ student_id: ids.s1, kind: 'certificat', title: 'Certificat', retention_days: 30, content_base64: Buffer.from('%PDF-1').toString('base64') }).expect(201)).body;
    await call('post', '/locker', guardianT).send({ student_id: ids.s1, kind: 'x', title: 'x', content_base64: 'YQ==' }).expect(403);
    expect((await call('get', `/students/${ids.s1}/locker`, guardianT).expect(200)).body.length).toBe(1);
    await call('get', `/students/${ids.s1}/locker`, otherGuardianT).expect(403);
    expect((await bin(`/locker/${d.id}/download`, studentT).expect(200)).body.toString()).toBe('%PDF-1');
    await call('get', `/locker/${d.id}/download`, otherGuardianT).expect(403);
    await admin.query("UPDATE tenant_e2e_c.locker_documents SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1", [d.id]);
    expect((await call('get', `/students/${ids.s1}/locker`, guardianT).expect(200)).body.length).toBe(0);   // expired = invisible
    expect((await call('post', '/locker/purge', headT).expect(201)).body.purged).toBe(1);
    expect((await call('get', '/news', adminB).expect(200)).body).toEqual([]);
  });
});
