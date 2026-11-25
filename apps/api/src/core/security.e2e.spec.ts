import { Controller, Post, Body } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { gzipSync } from 'node:zlib';
import { applySecurity } from './security';

process.env.RATE_LIMIT_PER_MIN = '5000'; process.env.RATE_LIMIT_AUTH_PER_MIN = '5000';
@Controller() class Echo { @Post('echo') echo(@Body() b: unknown) { return { b }; } }

describe('HTTP hardening', () => {
  let server: any; let app: any;
  beforeAll(async () => {
    const mod = await Test.createTestingModule({ controllers: [Echo] }).compile();
    app = mod.createNestApplication({ bodyParser: false }); applySecurity(app); await app.init(); server = app.getHttpServer();
  });
  afterAll(async () => { await app.close(); });
  it('accepts plain JSON', async () => { expect((await request(server).post('/echo').send({ a: 1 })).body).toEqual({ b: { a: 1 } }); });
  it('refuses compressed request bodies (decompression bombs)', async () => {
    const r = await request(server).post('/echo').set('content-encoding', 'gzip').set('content-type', 'application/json').send(gzipSync(Buffer.from('{"a":1}')));
    expect(r.status).toBe(415);
  });
  it('refuses oversized bodies and sets the security headers', async () => {
    const r = await request(server).post('/echo').send({ x: 'a'.repeat(2 * 1024 * 1024) });
    expect(r.status).toBe(413);
    const h = await request(server).post('/echo').send({});
    expect(h.headers['x-content-type-options']).toBe('nosniff'); expect(h.headers['x-frame-options']).toBe('DENY'); expect(h.headers['x-powered-by']).toBeUndefined();
  });
});
