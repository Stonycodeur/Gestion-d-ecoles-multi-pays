import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { SignJWT } from 'jose';

const SECRET = 'r'.repeat(40);
process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = SECRET;
process.env.MODULES_DIR = join(__dirname, '../../../packages/modules');
process.env.MESSAGE_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.WEBHOOK_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.PUSH_MODE = 'sandbox';
process.env.MINISTRY_SANDBOX_FAIL_FIRST = '0';

import { runSandboxed } from './modules/sandbox';

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Phase 6b e2e (public API, webhooks, marketplace, ministry, inspectors)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let server: any; let admin: Pool; let recv: Server; let recvPort = 0;
  const received: { headers: Record<string, any>; body: string }[] = []; let recvStatus = 200;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n + 2000).padStart(12, '0')}`;
  const ids: Record<string, string> = {};
  let adminT: string, headT: string, teacherT: string, rootT: string;
  const tok = async (role: string, n: number, extra: object = {}) => (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant: 'e2e_j', ...extra })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'delete', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,'e2e_j','Collège J','college','GA','tenant_e2e_j') ON CONFLICT DO NOTHING", [U(9100)]);
    await admin.query("SELECT provision_tenant_schema('e2e_j')");
    recv = createServer((req, res) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { received.push({ headers: req.headers, body: b }); res.statusCode = recvStatus; res.end('ok'); }); });
    await new Promise<void>((r) => recv.listen(0, '127.0.0.1', () => r())); recvPort = (recv.address() as any).port;
    const { AppModule } = await import('./app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true }); await app.init(); server = app.getHttpServer();
    adminT = await tok('admin', 1); headT = await tok('head', 2);
    rootT = await new SignJWT({ roles: ['root_super_admin'] }).setSubject(U(9000)).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
    ids.cls = (await call('post', '/classes', adminT).send({ name: '3e A', level_code: '3e', school_year: '2026-2027' }).expect(201)).body.id;
    ids.s1 = (await call('post', '/students', adminT).send({ first_name: 'Ada', last_name: 'Obiang', class_id: ids.cls }).expect(201)).body.student.id;
    teacherT = await tok('teacher', 3, { class_ids: [ids.cls] });
  });
  afterAll(async () => { await app.close(); recv.close(); await admin.end(); });

  describe('public API', () => {
    let cid: string, csec: string;
    const token = (b: object) => request(server).post('/oauth/token').send({ grant_type: 'client_credentials', school: 'e2e_j', ...b });
    it('only API managers create clients; the secret is shown once and stored hashed', async () => {
      await call('post', '/api-admin/clients', teacherT).send({ name: 'x', scopes: ['students:read'] }).expect(403);
      await call('post', '/api-admin/clients', adminT).send({ name: 'x', scopes: ['payments:read'] }).expect(400);
      const r = await call('post', '/api-admin/clients', adminT).send({ name: 'Intégration', scopes: ['students:read', 'classes:read'], quota_per_hour: 1000 }).expect(201);
      cid = r.body.client_id; csec = r.body.client_secret; expect(csec.length).toBeGreaterThan(20);
      const list = await call('get', '/api-admin/clients', adminT).expect(200);
      expect(JSON.stringify(list.body)).not.toContain(csec); expect(JSON.stringify(list.body)).not.toContain('secret_hash');
      const row = (await admin.query("SELECT secret_hash FROM tenant_e2e_j.api_clients WHERE client_id = $1", [cid])).rows[0];
      expect(row.secret_hash).not.toContain(csec);
    });
    it('client credentials: bad secret refused, good secret gives a scoped bearer token', async () => {
      await token({ client_id: cid, client_secret: 'nope' }).expect(401);
      await request(server).post('/oauth/token').send({ grant_type: 'password', school: 'e2e_j' }).expect(400);
      await token({ client_id: cid, client_secret: csec, scope: 'grades:read' }).expect(400);
      const t = await token({ client_id: cid, client_secret: csec }).expect(201);
      expect(t.body.token_type).toBe('Bearer'); ids.api = t.body.access_token;
    });
    it('REST is scope-limited, minimised and read-only', async () => {
      await request(server).get('/v1/students').expect(401);
      await request(server).get('/v1/students').set('Authorization', 'Bearer garbage').expect(401);
      const s = await request(server).get('/v1/students').set('Authorization', `Bearer ${ids.api}`).expect(200);
      expect(s.body.length).toBe(1); expect(Object.keys(s.body[0]).sort()).toEqual(['class_id', 'first_name', 'id', 'last_name', 'status']);
      expect(s.headers['x-ratelimit-remaining']).toBeDefined();
      await request(server).get('/v1/classes').set('Authorization', `Bearer ${ids.api}`).expect(200);
      await request(server).get('/v1/news').set('Authorization', `Bearer ${ids.api}`).expect(403);
      await request(server).get('/v1/grades').set('Authorization', `Bearer ${ids.api}`).query({ student_id: ids.s1 }).expect(403);
      await request(server).post('/v1/students').set('Authorization', `Bearer ${ids.api}`).send({}).expect(404);
    });
    it('GraphQL answers within the same scopes', async () => {
      const ok = await request(server).post('/v1/graphql').set('Authorization', `Bearer ${ids.api}`).send({ query: '{ me { name scopes } students(limit: 5) { first_name } }' }).expect(201);
      expect(ok.body.data.students[0].first_name).toBe('Ada'); expect(ok.body.data.me.scopes).toContain('students:read');
      const no = await request(server).post('/v1/graphql').set('Authorization', `Bearer ${ids.api}`).send({ query: '{ news { title } }' }).expect(201);
      expect(no.body.errors[0].message).toMatch(/scope news:read/);
      const bad = await request(server).post('/v1/graphql').set('Authorization', `Bearer ${ids.api}`).send({ query: '{ password }' }).expect(201);
      expect(bad.body.errors.length).toBe(1);
    });
    it('quota: the client is cut off with 429 + Retry-After', async () => {
      const c = (await call('post', '/api-admin/clients', adminT).send({ name: 'petit', scopes: ['classes:read'], quota_per_hour: 2 }).expect(201)).body;
      const t = (await token({ client_id: c.client_id, client_secret: c.client_secret }).expect(201)).body.access_token;
      await request(server).get('/v1/classes').set('Authorization', `Bearer ${t}`).expect(200);
      await request(server).get('/v1/classes').set('Authorization', `Bearer ${t}`).expect(200);
      const r = await request(server).get('/v1/classes').set('Authorization', `Bearer ${t}`).expect(429);
      expect(r.headers['retry-after']).toBeDefined();
    });
    it('revocation applies immediately to tokens already issued', async () => {
      const id = (await call('get', '/api-admin/clients', adminT).expect(200)).body.find((c: any) => c.client_id === cid).id;
      await call('post', `/api-admin/clients/${id}/revoke`, adminT).expect(201);
      await request(server).get('/v1/classes').set('Authorization', `Bearer ${ids.api}`).expect(401);
      await token({ client_id: cid, client_secret: csec }).expect(401);
    });
    it('the developer portal is public', async () => { const d = await request(server).get('/public-api/docs').expect(200); expect(d.body.scopes).toContain('students:read'); });
  });

  describe('signed webhooks', () => {
    let hook: { id: string; secret: string };
    it('refuses unsafe targets, then creates a hook whose secret is shown once', async () => {
      await call('post', '/api-admin/webhooks', adminT).send({ url: 'http://127.0.0.1:9/x', events: ['student.created'] }).expect(400);
      await call('post', '/api-admin/webhooks', adminT).send({ url: 'https://169.254.169.254/x', events: ['student.created'] }).expect(400);
      process.env.WEBHOOK_ALLOW_PRIVATE = 'true';   // tests only: the receiver listens on loopback
      await call('post', '/api-admin/webhooks', adminT).send({ url: `http://127.0.0.1:${recvPort}/h`, events: ['student.deleted'] }).expect(400);
      hook = (await call('post', '/api-admin/webhooks', adminT).send({ url: `http://127.0.0.1:${recvPort}/h`, events: ['student.created'] }).expect(201)).body;
      expect(hook.secret).toBeDefined();
      expect(JSON.stringify((await call('get', '/api-admin/webhooks', adminT).expect(200)).body)).not.toContain(hook.secret);
    });
    it('a business event sends a signed, minimised delivery', async () => {
      received.length = 0;
      await call('post', '/students', adminT).send({ first_name: 'Ben', last_name: 'Ndong', class_id: ids.cls }).expect(201);
      for (let i = 0; i < 30 && !received.length; i++) await sleep(100);
      expect(received.length).toBe(1);
      const r = received[0]!; const ts = String(r.headers['x-em-timestamp']);
      expect(r.headers['x-em-signature']).toBe(createHmac('sha256', hook.secret).update(`${ts}.${r.body}`).digest('hex'));
      const body = JSON.parse(r.body); expect(body.event).toBe('student.created'); expect(Object.keys(body.data).sort()).toEqual(['class_id', 'id']);
    });
    it('a failing receiver leaves a failed delivery that can be retried', async () => {
      received.length = 0; recvStatus = 500;
      await call('post', '/students', adminT).send({ first_name: 'Cy', last_name: 'Mba', class_id: ids.cls }).expect(201);
      for (let i = 0; i < 30 && !received.length; i++) await sleep(100);
      await sleep(300);
      const failed = (await call('get', '/api-admin/deliveries?status=failed', adminT).expect(200)).body; expect(failed.length).toBe(1);
      recvStatus = 200;
      const r = await call('post', '/api-admin/deliveries/retry', adminT).expect(201); expect(r.body).toEqual({ retried: 1, delivered: 1 });
      expect((await call('get', '/api-admin/deliveries?status=failed', adminT).expect(200)).body.length).toBe(0);
    });
    it('test ping works and deletion stops deliveries', async () => {
      const t = await call('post', `/api-admin/webhooks/${hook.id}/test`, adminT).expect(201); expect(t.body.status).toBe('delivered');
      await call('delete', `/api-admin/webhooks/${hook.id}`, adminT).expect(200);
      received.length = 0;
      await call('post', '/students', adminT).send({ first_name: 'Di', last_name: 'Eyi', class_id: ids.cls }).expect(201);
      await sleep(500); expect(received.length).toBe(0);
    });
  });

  describe('marketplace', () => {
    const manifest = (over: object = {}) => ({ name: 'module-demo-stats', version: '1.0.0', core_version: '>=0.1.0', description: 'Démo', permissions: ['demo:read'], hooks: { onGradeSubmitted: 'h' }, ...over });
    let subId: string;
    it('submission is reviewed automatically: forbidden constructs and reserved names are rejected', async () => {
      await call('post', '/marketplace/submissions', teacherT).send({ manifest: manifest(), handlers_source: { h: 'return 1;' } }).expect(403);
      await call('post', '/marketplace/submissions', adminT).send({ manifest: manifest(), handlers_source: { h: 'return process.env;' } }).expect(400);
      await call('post', '/marketplace/submissions', adminT).send({ manifest: manifest({ name: 'module-oaa' }), handlers_source: { h: 'return 1;' } }).expect(400);
      await call('post', '/marketplace/submissions', adminT).send({ manifest: manifest({ core_version: '>=99.0.0' }), handlers_source: { h: 'return 1;' } }).expect(400);
      const r = await call('post', '/marketplace/submissions', adminT).send({ manifest: manifest(), handlers_source: { h: 'return { seen: payload };' } }).expect(201);
      subId = r.body.id; expect(r.body.status).toBe('submitted');
      await call('post', '/marketplace/submissions', adminT).send({ manifest: manifest(), handlers_source: { h: 'return 1;' } }).expect(400);   // same version again
    });
    it('only the root super-admin publishes; nothing is installable before', async () => {
      await call('get', '/marketplace/submissions', adminT).expect(403);
      await call('post', `/marketplace/submissions/${subId}/decision`, adminT).send({ approve: true }).expect(403);
      await call('post', '/marketplace/modules/module-demo-stats/install', adminT).send({ accept_permissions: ['demo:read'] }).expect(404);
      await call('post', `/marketplace/submissions/${subId}/decision`, rootT).send({ approve: true }).expect(201);
      const cat = (await call('get', '/marketplace/modules', adminT).expect(200)).body; expect(cat.map((m: any) => m.name)).toContain('module-demo-stats');
    });
    it('installation needs explicit acceptance of the permissions, then the module is active for this school only', async () => {
      await call('post', '/marketplace/modules/module-demo-stats/install', adminT).send({ accept_permissions: [] }).expect(400);
      await call('post', '/marketplace/modules/module-demo-stats/install', adminT).send({ accept_permissions: ['demo:read'] }).expect(201);
      expect((await call('get', '/marketplace/installs', adminT).expect(200)).body.length).toBe(1);
      await call('post', '/marketplace/modules/module-demo-stats/reviews', adminT).send({ rating: 5, comment: 'ok' }).expect(201);
      expect((await call('get', '/marketplace/modules/module-demo-stats', adminT).expect(200)).body.summary).toEqual({ count: 1, average: 5 });
      await call('post', '/marketplace/modules/module-demo-stats/uninstall', adminT).expect(201);
      await call('post', '/marketplace/modules/module-demo-stats/reviews', adminT).send({ rating: 4 }).expect(403);   // only installed schools review… after uninstall the install row is gone
    });
    it('an update that adds permissions needs a new acceptance', async () => {
      await call('post', '/marketplace/modules/module-demo-stats/install', adminT).send({ accept_permissions: ['demo:read'] }).expect(201);
      const r = await call('post', '/marketplace/submissions', adminT).send({ manifest: manifest({ version: '1.1.0', permissions: ['demo:read', 'demo:write'] }), handlers_source: { h: 'return 2;' } }).expect(201);
      await call('post', `/marketplace/submissions/${r.body.id}/decision`, rootT).send({ approve: true }).expect(201);
      await call('post', '/marketplace/modules/module-demo-stats/update', adminT).send({ accept_permissions: ['demo:read'] }).expect(400);
      const u = await call('post', '/marketplace/modules/module-demo-stats/update', adminT).send({ accept_permissions: ['demo:write'] }).expect(201);
      expect(u.body.added_permissions).toEqual(['demo:write']);
    });
    it('withdrawal is root-only and removes the module from the catalogue', async () => {
      await call('post', '/marketplace/modules/module-demo-stats/withdraw', adminT).expect(403);
      await call('post', '/marketplace/modules/module-demo-stats/withdraw', rootT).expect(201);
      expect((await call('get', '/marketplace/modules', adminT).expect(200)).body.map((m: any) => m.name)).not.toContain('module-demo-stats');
    });
    it('sandbox: pure computation works; host access, loops and escapes do not', async () => {
      expect(await runSandboxed('return { n: payload.a + config.b };', { a: 2 }, { b: 3 })).toEqual({ n: 5 });
      await expect(runSandboxed('return typeof process + typeof require + typeof fetch;', {}, {})).resolves.toBe('undefinedundefinedundefined');
      await expect(runSandboxed('while(true){}', {}, {}, { timeoutMs: 200 })).rejects.toThrow();
      await expect(runSandboxed('return this.constructor.constructor("return process")();', {}, {})).rejects.toThrow();
    });
  });

  describe('ministry connectors and inspectors', () => {
    let tx: any;
    it('the connectors come from the country reference data', async () => {
      const c = (await call('get', '/ministry/connectors', adminT).expect(200)).body; expect(c.map((x: any) => x.code).sort()).toEqual(['men', 'mesr']);
      await call('get', '/ministry/connectors', teacherT).expect(403);
    });
    it('preparation is minimised and checksummed; unknown datasets and formats are refused', async () => {
      await call('post', '/ministry/transmissions', adminT).send({ connector: 'men', dataset: 'notes', format: 'csv', school_year: '2026-2027' }).expect(400);
      await call('post', '/ministry/transmissions', adminT).send({ connector: 'men', dataset: 'effectifs', format: 'xml', school_year: '2026-2027' }).expect(400);
      tx = (await call('post', '/ministry/transmissions', adminT).send({ connector: 'men', dataset: 'effectifs', format: 'csv', school_year: '2026-2027' }).expect(201)).body;
      expect(tx.status).toBe('prepared'); expect(tx.checksum).toMatch(/^[0-9a-f]{64}$/);
      const file = await call('get', `/ministry/transmissions/${tx.id}/file`, adminT).expect(200);
      expect(file.text).not.toMatch(/Obiang|birth/i);
    });
    it('the direction validates against the checksum, then sends (sandbox) with a full exchange log', async () => {
      await call('post', `/ministry/transmissions/${tx.id}/send`, headT).expect(400);   // not validated yet
      await call('post', `/ministry/transmissions/${tx.id}/validate`, adminT).send({ approve: true, checksum: tx.checksum }).expect(403);
      await call('post', `/ministry/transmissions/${tx.id}/validate`, headT).send({ approve: true, checksum: 'f'.repeat(64) }).expect(400);
      await call('post', `/ministry/transmissions/${tx.id}/validate`, headT).send({ approve: true, checksum: tx.checksum }).expect(201);
      const s = await call('post', `/ministry/transmissions/${tx.id}/send`, headT).expect(201); expect(s.body.status).toBe('sent');
      const d = (await call('get', `/ministry/transmissions/${tx.id}`, adminT).expect(200)).body;
      expect(d.logs.map((l: any) => l.event)).toEqual(expect.arrayContaining(['prepared', 'validated', 'sent']));
      await call('post', `/ministry/transmissions/${tx.id}/cancel`, headT).expect(400);   // sent is final
    });
    it('inspector accounts are time-limited, read-limited and revocable at once', async () => {
      const soon = new Date(Date.now() + 7 * 86400000).toISOString();
      await call('post', '/ministry/inspectors', adminT).send({ user_id: U(50), display_name: 'Inspecteur', expires_at: new Date(Date.now() + 200 * 86400000).toISOString() }).expect(400);
      await call('post', '/ministry/inspectors', adminT).send({ user_id: U(50), display_name: 'Inspecteur', expires_at: new Date(Date.now() - 1000).toISOString() }).expect(400);
      const a = (await call('post', '/ministry/inspectors', adminT).send({ user_id: U(50), display_name: 'Inspecteur', expires_at: soon }).expect(201)).body;
      const it = await tok('inspector', 50);
      const ok = await call('get', '/lessons', it); expect([401, 403]).not.toContain(ok.status);
      await call('get', '/students', it).expect(403);
      await call('post', `/ministry/inspectors/${a.id}/revoke`, adminT).expect(201);
      await call('get', '/lessons', it).expect(403);
    });
  });
});
