import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 's'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../packages/modules');
process.env.MESSAGE_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.WEBHOOK_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.CORS_ORIGINS = 'https://app.ecole.ga';
process.env.RATE_LIMIT_PER_MIN = '40';
process.env.RATE_LIMIT_AUTH_PER_MIN = '5';
process.env.NODE_ENV = 'production';

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('HTTP hardening', () => {
  jest.setTimeout(60000);
  let app: INestApplication; let server: any;
  beforeAll(async () => {
    const { AppModule } = await import('./app.module'); const { applySecurity } = await import('./core/security');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true, bodyParser: false }); applySecurity(app); await app.init(); server = app.getHttpServer();
  });
  afterAll(async () => { await app.close(); });

  it('sends security headers and hides the framework', async () => {
    const r = await request(server).get('/health').expect(200);
    expect(r.headers['x-content-type-options']).toBe('nosniff'); expect(r.headers['x-frame-options']).toBe('DENY'); expect(r.headers['strict-transport-security']).toMatch(/max-age/);
    expect(r.headers['content-security-policy']).toContain("default-src 'none'"); expect(r.headers['x-powered-by']).toBeUndefined(); expect(r.headers['referrer-policy']).toBe('no-referrer');
  });
  it('CORS is strict: only configured origins, never a wildcard', async () => {
    const ok = await request(server).get('/health').set('Origin', 'https://app.ecole.ga'); expect(ok.headers['access-control-allow-origin']).toBe('https://app.ecole.ga');
    const bad = await request(server).get('/health').set('Origin', 'https://evil.example'); expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('bodies are size-limited but JSON parsing still works', async () => {
    await request(server).post('/oauth/token').send({ grant_type: 'password', school: 'x' }).expect(400);
    await request(server).post('/oauth/token').send({ grant_type: 'client_credentials', school: 'x'.repeat(2_000_000) }).expect(413);
  });
  it('sensitive routes have a tighter rate limit, and the general limit also applies', async () => {
    let last = 0; for (let i = 0; i < 8; i++) last = (await request(server).post('/auth/sandbox/token').send({ sub: '00000000-0000-4000-8000-000000000001', role: 'admin', tenant: 'nope' })).status;
    expect(last).toBe(429);
    let seen429 = false; for (let i = 0; i < 60 && !seen429; i++) { const r = await request(server).get('/modules').set('x-forwarded-for', '9.9.9.9'); seen429 = r.status === 429; }
    expect(seen429).toBe(true);
    const r = await request(server).get('/modules'); if (r.status === 429) expect(r.headers['retry-after']).toBeDefined();
    await request(server).get('/health').expect(200);   // health checks are never throttled
  });
});
