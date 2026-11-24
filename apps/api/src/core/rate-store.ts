import { Logger } from '@nestjs/common';
import { QuotaCounter } from '@ecolemanager/shared';

export interface RateResult { allowed: boolean; remaining: number; resetAt: number }
export interface RateStore { readonly kind: 'memory' | 'redis'; hit(key: string, limit: number, windowMs: number): Promise<RateResult> }

/** Per-process counters: fine for one replica, but each replica would count on its own. */
export class MemoryRateStore implements RateStore {
  readonly kind = 'memory' as const;
  private readonly c = new QuotaCounter();
  async hit(key: string, limit: number, windowMs: number) { return this.c.hit(key, limit, windowMs); }
}

/** The part of a Redis client (ioredis) that is used, so tests can pass a fake. */
export interface RedisLike { eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown> }

// Atomic fixed window: the first hit sets the expiry, so every replica sees the same count and the same reset time.
const SCRIPT = "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end; local t = redis.call('PTTL', KEYS[1]); return {n, t}";

/**
 * Counters shared by all API replicas (REDIS_URL). If Redis is unreachable the request is counted locally instead of failing:
 * availability wins over exact counting, and the fallback is logged once per outage.
 */
export class RedisRateStore implements RateStore {
  readonly kind = 'redis' as const;
  private readonly log = new Logger('RateStore');
  private readonly fallback = new MemoryRateStore();
  private down = false;
  constructor(private readonly redis: RedisLike, private readonly prefix = 'em:rl:') {}
  async hit(key: string, limit: number, windowMs: number, now: number = Date.now()): Promise<RateResult> {
    try {
      const [n, ttl] = (await this.redis.eval(SCRIPT, 1, `${this.prefix}${key}`, windowMs)) as [number, number];
      if (this.down) { this.down = false; this.log.log('Redis is back: shared counters in use again'); }
      const left = ttl > 0 ? ttl : windowMs;
      return { allowed: n <= limit, remaining: Math.max(0, limit - n), resetAt: now + left };
    } catch (e) {
      if (!this.down) { this.down = true; this.log.warn(`Redis unavailable (${(e as Error).message}); counting locally until it returns`); }
      return this.fallback.hit(key, limit, windowMs);
    }
  }
}

let shared: RateStore | undefined;
/** The process-wide store: Redis when REDIS_URL is set, otherwise memory. */
export function rateStore(env: NodeJS.ProcessEnv = process.env): RateStore {
  if (shared) return shared;
  if (env.REDIS_URL) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const IORedis = require('ioredis');
    const client = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, lazyConnect: false, connectTimeout: 2000 });
    client.on('error', () => undefined);   // outages are handled (and logged once) by RedisRateStore
    shared = new RedisRateStore(client);
  } else shared = new MemoryRateStore();
  return shared;
}
/** Tests only. */
export function resetRateStore(s?: RateStore) { shared = s; }
