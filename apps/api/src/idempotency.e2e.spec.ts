import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';
import { Pool } from 'pg';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 'i'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../packages/modules');
process.env.MESSAGE_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.WEBHOOK_KEY = Buffer.alloc(32, 9).toString('base64');

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Idempotency-Key (offline replays)', () => {
  jest.setTimeout(60000);
  let app: INestApplication; let server: any; let admin: Pool; let adminT: string;
  const post = (path: string, key?: string) => { const r = request(server).post(path).set('Authorization', `Bearer ${adminT}`); return key ? r.set('Idempotency-Key', key) : r; };
  const classCount = async (name: string) => Number((await admin.query('SELECT COUNT(*) n FROM tenant_e2e_n.classes WHERE name = $1', [name])).rows[0].n);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ('00000000-0000-4000-8000-000000009200','e2e_n','E2E N','college','GA','tenant_e2e_n') ON CONFLICT DO NOTHING");
    await admin.query("SELECT provision_tenant_schema('e2e_n')");
    const { AppModule } = await import('./app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true }); await app.init(); server = app.getHttpServer();
    adminT = (await request(server).post('/auth/sandbox/token').send({ sub: '00000000-0000-4000-8000-000000005001', role: 'admin', tenant: 'e2e_n' })).body.access_token;
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('the same request with the same key runs once and replays the first answer', async () => {
    const body = { name: 'Idem A', level_code: '6e', school_year: '2026-2027' };
    const a = await post('/classes', 'key-aaaa-0001').send(body).expect(201);
    const b = await post('/classes', 'key-aaaa-0001').send(body).expect(201);
    expect(b.body.id).toBe(a.body.id); expect(b.headers['idempotent-replay']).toBe('true'); expect(a.headers['idempotent-replay']).toBeUndefined();
    expect(await classCount('Idem A')).toBe(1);
  });
  it('without a key nothing is deduplicated (second create is a business conflict, not a replay)', async () => {
    const body = { name: 'Idem B', level_code: '6e', school_year: '2026-2027' };
    await post('/classes').send(body).expect(201);
    const r = await post('/classes').send(body); expect(r.status).toBeGreaterThanOrEqual(400); expect(r.headers['idempotent-replay']).toBeUndefined();
  });
  it('a key reused for a different request is refused, an invalid key is rejected', async () => {
    await post('/classes', 'key-cccc-0003').send({ name: 'Idem C', level_code: '6e', school_year: '2026-2027' }).expect(201);
    await post('/classes', 'key-cccc-0003').send({ name: 'Idem C2', level_code: '6e', school_year: '2026-2027' }).expect(422);
    expect(await classCount('Idem C2')).toBe(0);
    await post('/classes', 'bad key!').send({ name: 'x', level_code: '6e', school_year: '2026-2027' }).expect(400);
  });
  it('a failed request releases the key so the client can retry with the same key', async () => {
    await post('/classes', 'key-dddd-0004').send({ level_code: '6e' }).expect(400);                  // invalid body
    await post('/classes', 'key-dddd-0004').send({ name: 'Idem D', level_code: '6e', school_year: '2026-2027' }).expect(201);
  });
  it('keys are scoped per principal', async () => {
    const other = (await request(server).post('/auth/sandbox/token').send({ sub: '00000000-0000-4000-8000-000000005002', role: 'admin', tenant: 'e2e_n' })).body.access_token;
    const body = { name: 'Idem E', level_code: '6e', school_year: '2026-2027' };
    await post('/classes', 'key-eeee-0005').send(body).expect(201);
    const r = await request(server).post('/classes').set('Authorization', `Bearer ${other}`).set('Idempotency-Key', 'key-eeee-0005').send(body);
    expect(r.headers['idempotent-replay']).toBeUndefined();   // not served from the first admin's answer
  });
});
