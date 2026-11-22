import { createHash } from 'node:crypto';
import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap } from 'rxjs/operators';
import { ModulesService } from '../modules/modules.service';
import type { CoreRequest } from './request-context';

const KEY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_BODY = 64 * 1024;

/**
 * Replay protection for writes (spec 12.4: offline queues resend after a lost response, which must never double-post a grade, a payment or a message).
 * A request with `Idempotency-Key` is executed once per (principal, tenant, key): the same request replays the stored answer,
 * the same key with a different request is refused (422), a concurrent duplicate gets 409. Failed requests release the key so the client can retry.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly modules: ModulesService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();
    const http = ctx.switchToHttp(); const req = http.getRequest<CoreRequest>(); const res = http.getResponse();
    const key = req.headers['idempotency-key'];
    const pool = this.modules.pool;
    if (!pool || typeof key !== 'string' || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) || !req.principal) return next.handle();
    if (!KEY_RE.test(key)) throw new HttpException('invalid Idempotency-Key', 400);
    const scope = `${req.principal.id}|${req.tenantSlug ?? '-'}`;
    const fingerprint = createHash('sha256').update(`${req.method} ${req.path}\n${JSON.stringify(req.body ?? null)}`).digest('hex');

    return from((async () => {
      if (Math.random() < 0.01) await pool.query(`DELETE FROM idempotency_keys WHERE created_at < NOW() - INTERVAL '24 hours'`).catch(() => undefined);
      const ins = await pool.query('INSERT INTO idempotency_keys(scope, key, fingerprint) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [scope, key, fingerprint]);
      if (ins.rowCount) return { fresh: true as const };
      const row = (await pool.query('SELECT fingerprint, status, response FROM idempotency_keys WHERE scope=$1 AND key=$2', [scope, key])).rows[0];
      if (!row) return { fresh: true as const };   // purged between the two statements: treat as new
      if (row.fingerprint !== fingerprint) throw new HttpException('Idempotency-Key was already used with a different request', 422);
      if (row.status === null) throw new HttpException('a request with this Idempotency-Key is still in progress', 409);
      return { fresh: false as const, status: row.status as number, response: row.response as unknown };
    })()).pipe(mergeMap((st) => {
      if (!st.fresh) { res.status(st.status); res.setHeader('Idempotent-Replay', 'true'); return of(st.response ?? { replayed: true }); }
      return next.handle().pipe(
        mergeMap((body) => {
          const json = body === undefined ? null : JSON.stringify(body);
          const store = json !== null && json.length > MAX_BODY ? null : json;
          return from(pool.query('UPDATE idempotency_keys SET status=$3, response=$4 WHERE scope=$1 AND key=$2', [scope, key, res.statusCode || 200, store])).pipe(mergeMap(() => of(body)));
        }),
        catchError((e) => from(pool.query('DELETE FROM idempotency_keys WHERE scope=$1 AND key=$2', [scope, key]).catch(() => undefined)).pipe(mergeMap(() => throwError(() => e)))),
      );
    }));
  }
}
