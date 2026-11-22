import { randomUUID } from 'node:crypto';
import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/** Dependency-free Sentry reporter (store API). Only server errors (5xx / unexpected) are sent: message, stack, method and matched route. Never bodies, headers, tokens or query strings. */
export function parseDsn(dsn: string): { url: string; auth: string } | undefined {
  try {
    const u = new URL(dsn); const project = u.pathname.replace(/^\//, '');
    if (!u.username || !project) return undefined;
    return { url: `${u.protocol}//${u.host}/api/${project}/store/`, auth: `Sentry sentry_version=7, sentry_client=ecolemanager/1.0, sentry_key=${u.username}` };
  } catch { return undefined; }
}
export function buildEvent(err: unknown, ctx: { method?: string; route?: string }, env = process.env.NODE_ENV ?? 'development') {
  const e = err instanceof Error ? err : new Error(String(err));
  return { event_id: randomUUID().replace(/-/g, ''), timestamp: new Date().toISOString(), platform: 'node', level: 'error', environment: env,
    message: e.message.slice(0, 500), exception: { values: [{ type: e.name, value: e.message.slice(0, 500), stacktrace: { frames: (e.stack ?? '').split('\n').slice(1, 20).map((l) => ({ function: l.trim().slice(0, 200) })) } }] },
    request: { method: ctx.method, url: ctx.route }, tags: { route: ctx.route ?? 'unmatched' } };
}
export async function reportError(err: unknown, ctx: { method?: string; route?: string }, dsn = process.env.SENTRY_DSN, fetchFn: typeof fetch = fetch): Promise<boolean> {
  const t = dsn ? parseDsn(dsn) : undefined; if (!t) return false;
  try { const r = await fetchFn(t.url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Sentry-Auth': t.auth }, body: JSON.stringify(buildEvent(err, ctx)), signal: AbortSignal.timeout(3000) }); return r.ok; } catch { return false; }
}

@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    if (status >= 500) { const req = host.switchToHttp().getRequest(); void reportError(exception, { method: req?.method, route: req?.route?.path }); }
    super.catch(exception, host);
  }
}
