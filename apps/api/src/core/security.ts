import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { json, urlencoded } from 'express';
import { QuotaCounter } from '@ecolemanager/shared';
import { metricsMiddleware } from './metrics';

/** HTTP hardening applied in main.ts: security headers, body size limits (raw body kept for webhook signatures), global and sensitive-route rate limits, strict CORS. */
export function applySecurity(app: INestApplication, env: NodeJS.ProcessEnv = process.env): void {
  const x = app.getHttpAdapter().getInstance();
  x.disable('x-powered-by');
  if (env.TRUST_PROXY) x.set('trust proxy', env.TRUST_PROXY === 'true' ? 1 : env.TRUST_PROXY);
  const prod = (env.NODE_ENV ?? 'development') === 'production';
  x.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()'); res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    if (prod) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (!req.path.startsWith('/docs')) res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");   // the API serves data only; Swagger UI needs its own scripts
    next();
  });
  x.use(metricsMiddleware(env));   // before the limiter: scraping must not consume or be blocked by the client quota
  const limiter = new QuotaCounter(); const general = Number(env.RATE_LIMIT_PER_MIN ?? 600); const sensitive = Number(env.RATE_LIMIT_AUTH_PER_MIN ?? 30);
  x.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/health' || req.method === 'OPTIONS') return next();
    const ip = req.ip ?? 'unknown'; const isSensitive = /^\/(auth|oauth)\//.test(req.path);
    const r = limiter.hit(`${isSensitive ? 's' : 'g'}|${ip}`, isSensitive ? sensitive : general, 60_000);
    res.setHeader('RateLimit-Remaining', String(r.remaining));
    if (!r.allowed) { res.setHeader('Retry-After', String(Math.max(1, Math.ceil((r.resetAt - Date.now()) / 1000)))); res.status(429).json({ statusCode: 429, message: 'too many requests' }); return; }
    next();
  });
  const origins = (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);   // strict: an empty list allows no browser origin, never '*'
  app.enableCors({ origin: origins, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], maxAge: 600 });
  const limit = env.BODY_LIMIT ?? '1mb';
  // Lesson attachments: up to 5 MB of file, i.e. about 6.7 MB once base64-encoded. Mounted first so only this route gets the larger limit.
  x.use(/^\/lessons\/[^/]+\/attachments$/, json({ limit: env.ATTACHMENT_BODY_LIMIT ?? '8mb', verify: (req: any, _res: unknown, buf: Buffer) => { req.rawBody = buf; } }));
  x.use(json({ limit, verify: (req: any, _res: unknown, buf: Buffer) => { req.rawBody = buf; } })); x.use(urlencoded({ extended: false, limit }));
}
