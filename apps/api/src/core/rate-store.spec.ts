import { MemoryRateStore, RedisRateStore, type RedisLike } from './rate-store';

/** A fake that behaves like the Lua script: INCR, expiry set on the first hit, PTTL. */
class FakeRedis implements RedisLike {
  data = new Map<string, { n: number; exp: number }>(); now = 1_000_000; fail = false; calls = 0;
  async eval(_s: string, _k: number, key: string | number, ttl: string | number) {
    this.calls++;
    if (this.fail) throw new Error('ECONNREFUSED');
    let e = this.data.get(String(key));
    if (!e || e.exp <= this.now) e = { n: 0, exp: this.now + Number(ttl) };
    e.n++; this.data.set(String(key), e);
    return [e.n, e.exp - this.now];
  }
}

describe('RateStore', () => {
  it('memory store blocks after the limit', async () => {
    const s = new MemoryRateStore();
    expect((await s.hit('a', 2, 60_000)).allowed).toBe(true);
    expect((await s.hit('a', 2, 60_000)).remaining).toBe(0);
    expect((await s.hit('a', 2, 60_000)).allowed).toBe(false);
  });

  it('redis store counts in one shared place, so two replicas share the limit', async () => {
    const shared = new FakeRedis();
    const r1 = new RedisRateStore(shared), r2 = new RedisRateStore(shared);
    expect((await r1.hit('ip', 3, 60_000)).allowed).toBe(true);
    expect((await r2.hit('ip', 3, 60_000)).allowed).toBe(true);
    expect((await r1.hit('ip', 3, 60_000)).remaining).toBe(0);
    const blocked = await r2.hit('ip', 3, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.resetAt).toBeGreaterThan(Date.now());
    expect((await r1.hit('other', 3, 60_000)).allowed).toBe(true);   // other keys are independent
  });

  it('falls back to local counting while Redis is down, then uses Redis again', async () => {
    const f = new FakeRedis(); const r = new RedisRateStore(f);
    f.fail = true;
    expect((await r.hit('k', 1, 60_000)).allowed).toBe(true);        // not an outage for the user
    expect((await r.hit('k', 1, 60_000)).allowed).toBe(false);       // still limited, locally
    f.fail = false;
    expect((await r.hit('k', 1, 60_000)).allowed).toBe(true);        // shared counter starts fresh
  });
});
