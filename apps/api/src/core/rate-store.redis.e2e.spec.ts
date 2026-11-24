import { randomUUID } from 'node:crypto';
import { RedisRateStore } from './rate-store';

/** Against a real Redis (CI service). Skipped when REDIS_URL_TEST is not set. */
(process.env.REDIS_URL_TEST ? describe : describe.skip)('RedisRateStore against a real Redis', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const IORedis = require('ioredis');
  const a = new IORedis(process.env.REDIS_URL_TEST), b = new IORedis(process.env.REDIS_URL_TEST);
  afterAll(async () => { a.disconnect(); b.disconnect(); });

  it('two clients (two replicas) share one window and the window expires', async () => {
    const key = `t-${randomUUID()}`;
    const s1 = new RedisRateStore(a, 'em:test:'), s2 = new RedisRateStore(b, 'em:test:');
    expect((await s1.hit(key, 2, 1200)).allowed).toBe(true);
    expect((await s2.hit(key, 2, 1200)).allowed).toBe(true);
    const third = await s1.hit(key, 2, 1200);
    expect(third.allowed).toBe(false);
    expect(third.resetAt - Date.now()).toBeLessThanOrEqual(1200);
    await new Promise((r) => setTimeout(r, 1400));
    expect((await s2.hit(key, 2, 1200)).allowed).toBe(true);
  });

  it('an unreachable Redis does not break requests', async () => {
    const dead = new IORedis('redis://127.0.0.1:1', { maxRetriesPerRequest: 0, enableOfflineQueue: false, lazyConnect: true });
    dead.on('error', () => undefined);
    const s = new RedisRateStore(dead);
    expect((await s.hit('x', 1, 60_000)).allowed).toBe(true);
    expect((await s.hit('x', 1, 60_000)).allowed).toBe(false);
    dead.disconnect();
  });
});
