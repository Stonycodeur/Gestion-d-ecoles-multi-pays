import type { NextFunction, Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';

/** Minimal Prometheus exposition (no dependency). Labels are low-cardinality: method, matched route pattern, status class. */
const BUCKETS = [0.025, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];   // 0.2 s = the p95 objective of spec 12.1
interface Series { count: number; sum: number; buckets: number[] }
export class HttpMetrics {
  private series = new Map<string, Series>();
  private statuses = new Map<string, number>();
  private readonly started = Date.now();
  observe(method: string, route: string, status: number, seconds: number): void {
    const k = `${method}|${route}`; const s = this.series.get(k) ?? { count: 0, sum: 0, buckets: BUCKETS.map(() => 0) };
    s.count++; s.sum += seconds; BUCKETS.forEach((b, i) => { if (seconds <= b) s.buckets[i]++; }); this.series.set(k, s);
    const sk = `${method}|${route}|${Math.floor(status / 100)}xx`; this.statuses.set(sk, (this.statuses.get(sk) ?? 0) + 1);
  }
  render(): string {
    const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
    const out: string[] = ['# TYPE http_requests_total counter'];
    for (const [k, n] of this.statuses) { const [m, r, c] = k.split('|'); out.push(`http_requests_total{method="${esc(m)}",route="${esc(r)}",status="${c}"} ${n}`); }
    out.push('# TYPE http_request_duration_seconds histogram');
    for (const [k, s] of this.series) {
      const [m, r] = k.split('|'); const l = `method="${esc(m)}",route="${esc(r)}"`;
      BUCKETS.forEach((b, i) => out.push(`http_request_duration_seconds_bucket{${l},le="${b}"} ${s.buckets[i]}`));
      out.push(`http_request_duration_seconds_bucket{${l},le="+Inf"} ${s.count}`, `http_request_duration_seconds_sum{${l}} ${s.sum}`, `http_request_duration_seconds_count{${l}} ${s.count}`);
    }
    out.push('# TYPE process_uptime_seconds gauge', `process_uptime_seconds ${(Date.now() - this.started) / 1000}`, '# TYPE process_resident_memory_bytes gauge', `process_resident_memory_bytes ${process.memoryUsage().rss}`);
    return out.join('\n') + '\n';
  }
}

function tokenOk(header: string | undefined, token: string): boolean {
  const given = Buffer.from((header ?? '').replace(/^Bearer /, '')); const want = Buffer.from(token);
  return given.length === want.length && timingSafeEqual(given, want);
}

/** `/metrics` exists only when METRICS_TOKEN is set (>= 16 chars), and always requires it as a bearer token. */
export function metricsMiddleware(env: NodeJS.ProcessEnv = process.env) {
  const m = new HttpMetrics(); const token = env.METRICS_TOKEN && env.METRICS_TOKEN.length >= 16 ? env.METRICS_TOKEN : undefined;
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.path === '/metrics' && req.method === 'GET') {
      if (!token) { res.status(404).json({ statusCode: 404, message: 'Not Found' }); return; }
      if (!tokenOk(req.headers.authorization, token)) { res.status(401).json({ statusCode: 401, message: 'unauthorized' }); return; }
      res.type('text/plain; version=0.0.4').send(m.render()); return;
    }
    const t0 = process.hrtime.bigint();
    res.on('finish', () => { const route = (req.route?.path as string | undefined) ?? 'unmatched'; m.observe(req.method, route, res.statusCode, Number(process.hrtime.bigint() - t0) / 1e9); });
    next();
  };
}
