#!/usr/bin/env node
// Load test: measures p50/p95/p99 latency of read endpoints against the < 200 ms (p95) target (spec 12.1).
// Usage: API_BASE=http://localhost:3000 TENANT=lycee_a CONCURRENCY=20 DURATION_S=30 node infra/loadtest/p95.mjs
// Needs the sandbox auth mode (AUTH_MODE=sandbox) and the demo seed; exits 1 when a p95 exceeds P95_BUDGET_MS (default 200).
const base = process.env.API_BASE ?? 'http://localhost:3000';
const tenant = process.env.TENANT ?? 'lycee_a';
const conc = Number(process.env.CONCURRENCY ?? 20);
const durationMs = Number(process.env.DURATION_S ?? 30) * 1000;
const budget = Number(process.env.P95_BUDGET_MS ?? 200);
const paths = (process.env.PATHS ?? '/health,/settings/country,/settings/grading,/timetable,/lessons,/classes,/me/abilities,/me/students').split(',');

const loginRes = await fetch(`${base}/auth/sandbox/token`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant': tenant },
  body: JSON.stringify({ sub: '00000000-0000-4000-8000-0000000000aa', role: 'admin', tenant }) });
const tok = await loginRes.json();
if (!tok.access_token) { console.error('cannot obtain a sandbox token (AUTH_MODE=sandbox required)'); process.exit(2); }
const headers = { 'x-tenant': tenant, authorization: `Bearer ${tok.access_token}` };

const lat = new Map(paths.map((p) => [p, []])); const codes = new Map(); let stop = false;
setTimeout(() => { stop = true; }, durationMs);
async function worker(i) {
  for (let n = i; !stop; n++) {
    const p = paths[n % paths.length]; const t0 = performance.now();
    try { const r = await fetch(`${base}${p}`, { headers }); await r.arrayBuffer(); lat.get(p).push(performance.now() - t0); codes.set(`${p} ${r.status}`, (codes.get(`${p} ${r.status}`) ?? 0) + 1); }
    catch { codes.set(`${p} error`, (codes.get(`${p} error`) ?? 0) + 1); }
  }
}
await Promise.all(Array.from({ length: conc }, (_, i) => worker(i)));
const q = (a, f) => (a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : NaN);
let fail = false;
const bad = [...codes].filter(([k]) => !/ 2\d\d$/.test(k));   // a fast error is not a pass
if (bad.length) fail = true;
console.log('path'.padEnd(26), 'n'.padStart(7), 'p50'.padStart(8), 'p95'.padStart(8), 'p99'.padStart(8));
for (const [p, a] of lat) {
  a.sort((x, y) => x - y); const p95 = q(a, 0.95);
  if (!(p95 <= budget)) fail = true;
  console.log(p.padEnd(26), String(a.length).padStart(7), q(a, 0.5).toFixed(1).padStart(8), p95.toFixed(1).padStart(8), q(a, 0.99).toFixed(1).padStart(8));
}
console.log('status codes:', Object.fromEntries(codes));
console.log(bad.length ? `FAIL: non-2xx responses: ${bad.map(([k, n]) => `${k} x${n}`).join(', ')}` : fail ? `FAIL: p95 above ${budget} ms (or no data)` : `OK: every p95 <= ${budget} ms`);
process.exit(fail ? 1 : 0);
