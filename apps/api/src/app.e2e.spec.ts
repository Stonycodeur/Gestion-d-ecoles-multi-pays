import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 'x'.repeat(40);
process.env.ALLOW_TENANT_HEADER = 'false';
process.env.MODULES_DIR = join(__dirname, '../../../packages/modules');

describe('Core e2e (sandbox auth, in-memory audit)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;
  beforeAll(async () => {
    const { AppModule } = await import('./app.module');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); await app.init(); server = app.getHttpServer();
  });
  afterAll(async () => { await app.close(); });

  const token = async (role: string, tenant: string, extra: object = {}) =>
    (await request(server).post('/auth/sandbox/token').send({ sub: `${role}-${tenant}`, role, tenant, ...extra })).body.access_token as string;

  it('health is public; protected routes need a token', async () => {
    await request(server).get('/health').expect(200);
    await request(server).get('/modules/active').expect(401);
    await request(server).get('/modules/active').set('Authorization', 'Bearer garbage').expect(401);
  });

  it('sandbox never mints a root token', async () => {
    await request(server).post('/auth/sandbox/token').send({ sub: 'r', role: 'root_super_admin', tenant: 'lycee_a' }).expect(401);
  });

  it('module-oaa is discovered from packages/modules and enabled per tenant only by an admin', async () => {
    const teacher = await token('teacher', 'lycee_a');
    const admin = await token('admin', 'lycee_a');
    const other = await token('admin', 'lycee_b');
    await request(server).post('/modules/module-oaa/enable').set('Authorization', `Bearer ${teacher}`).send({}).expect(403);
    await request(server).post('/modules/module-oaa/enable').set('Authorization', `Bearer ${admin}`).send({}).expect(201);
    const a = await request(server).get('/modules/active').set('Authorization', `Bearer ${teacher}`).expect(200);
    expect(a.body.map((m: { name: string }) => m.name)).toEqual(['module-oaa']);
    expect(a.body[0].mobile_screens).toContain('oaa_dashboard');
    const b = await request(server).get('/modules/active').set('Authorization', `Bearer ${other}`).expect(200);
    expect(b.body).toEqual([]);                       // tenant isolation
    await request(server).post('/modules/module-oaa/disable').set('Authorization', `Bearer ${admin}`).expect(201);
    const c = await request(server).get('/modules/active').set('Authorization', `Bearer ${teacher}`).expect(200);
    expect(c.body).toEqual([]);
  });

  it('token tenant must match the subdomain', async () => {
    process.env.BASE_DOMAIN = 'ecolemanager.app';
    const t = await token('admin', 'lycee_a');
    await request(server).get('/modules/active').set('Host', 'lycee_b.ecolemanager.app').set('Authorization', `Bearer ${t}`).expect(403);
    await request(server).get('/modules/active').set('Host', 'lycee-a.ecolemanager.app').set('Authorization', `Bearer ${t}`).expect(200);
    delete process.env.BASE_DOMAIN;
  });

  it('unknown module is rejected', async () => {
    const admin = await token('admin', 'lycee_a');
    await request(server).post('/modules/module-nope/enable').set('Authorization', `Bearer ${admin}`).send({}).expect(400);
  });
});
