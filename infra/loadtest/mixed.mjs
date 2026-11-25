#!/usr/bin/env node
// Load test of the routes p95.mjs does not cover: PDF generation, database writes (with their notifications and OAA recomputation),
// the generative assistant and the predictive run. Every response is validated (a fast error is not a pass: PDFs must start with %PDF,
// writes must return 2xx and be counted). Same prerequisites as p95.mjs (AUTH_MODE=sandbox, demo seed, raised rate limits).
// Usage: API_BASE=http://localhost:3000 TENANT=ga_lycee DURATION_S=20 node infra/loadtest/mixed.mjs
const base = process.env.API_BASE ?? 'http://localhost:3000';
const tenant = process.env.TENANT ?? 'ga_lycee';
const durationMs = Number(process.env.DURATION_S ?? 20) * 1000;
const budgets = { report_pdf: 1500, timetable_pdf: 1500, absence_write: 500, ai_assist: 1000, predictive_run: 4000 };
for (const k of Object.keys(budgets)) if (process.env[`BUDGET_${k.toUpperCase()}_MS`]) budgets[k] = Number(process.env[`BUDGET_${k.toUpperCase()}_MS`]);

const jh = { 'content-type': 'application/json', 'x-tenant': tenant };
async function token(sub, role, extra = {}) {
  const r = await fetch(`${base}/auth/sandbox/token`, { method: 'POST', headers: jh, body: JSON.stringify({ sub, role, tenant, ...extra }) });
  const t = await r.json(); if (!t.access_token) { console.error('cannot obtain a sandbox token (AUTH_MODE=sandbox required)'); process.exit(2); }
  return { ...jh, authorization: `Bearer ${t.access_token}` };
}
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = await token(uid(0xaa), 'admin');
const get = async (p, h = admin) => (await fetch(`${base}${p}`, { headers: h })).json();
const students = await get('/students?limit=20'); const sl = Array.isArray(students) ? students : students.items ?? students.data ?? [];
const classes = await get('/classes'); const cl = Array.isArray(classes) ? classes : classes.items ?? [];
if (!sl.length || !cl.length) { console.error('demo seed required (students and classes not found)'); process.exit(2); }
const classId = cl[0].id;
const own = await get(`/students?class_id=${classId}&limit=20`); const cs = Array.isArray(own) ? own : own.items ?? own.data ?? [];
if (!cs.length) { console.error('the first class has no students in the demo seed'); process.exit(2); }

// the demo seed has no validated timetable: generate one (and report how long generation takes)
let genMs = null;
if ((await fetch(`${base}/timetable.pdf?class_id=${classId}`, { headers: admin })).status === 404) {
  const t0 = performance.now();
  const g = await fetch(`${base}/schedules/generate`, { method: 'POST', headers: admin, body: JSON.stringify({ school_year: '2026-2027', periods_per_day: 6 }) });
  genMs = performance.now() - t0;
  if (g.status !== 201 && g.status !== 200) { console.error(`schedule generation failed: HTTP ${g.status} ${await g.text()}`); process.exit(1); }
  const gj = await g.json(); const sid = gj.id ?? gj.schedule?.id;
  for (const a of ['validate', 'publish']) { const r = await fetch(`${base}/schedules/${sid}/${a}`, { method: 'POST', headers: admin }); if (!r.ok) console.error(`schedule ${a}: HTTP ${r.status}`); }
  console.log(`timetable generation: ${genMs.toFixed(0)} ms`);
}

const results = new Map(); let stop = false; setTimeout(() => { stop = true; }, durationMs);
const rec = (name) => { if (!results.has(name)) results.set(name, { lat: [], bad: new Map() }); return results.get(name); };
async function run(name, workers, cap, mk) {
  const heads = await Promise.all(Array.from({ length: workers }, (_, i) => mk.head(i)));
  await Promise.all(heads.map(async (h, i) => {
    const r = rec(name);
    for (let n = 0; !stop && n < cap; n++) {
      const t0 = performance.now();
      try {
        const res = await mk.call(h, i, n); const buf = Buffer.from(await res.arrayBuffer()); const ms = performance.now() - t0;
        const why = mk.check(res, buf); if (why) r.bad.set(why, (r.bad.get(why) ?? 0) + 1); else r.lat.push(ms);
      } catch (e) { r.bad.set(`error ${e.message}`, (r.bad.get(`error ${e.message}`) ?? 0) + 1); }
    }
  }));
}
const pdf = (res, buf) => (res.status !== 200 ? `HTTP ${res.status}` : buf.subarray(0, 4).toString() !== '%PDF' ? 'not a PDF' : null);
const created = (res) => (res.status === 200 || res.status === 201 ? null : `HTTP ${res.status}`);
let day = 0;
await Promise.all([
  run('report_pdf', 4, 10_000, { head: async () => admin, call: (h, i, n) => fetch(`${base}/students/${sl[(i + n) % sl.length].id}/report.pdf?period=T1`, { headers: h }), check: pdf }),
  run('timetable_pdf', 2, 10_000, { head: async () => admin, call: (h) => fetch(`${base}/timetable.pdf?class_id=${classId}`, { headers: h }), check: pdf }),
  // teachers record absences for their own class (administrators are not allowed to: ABAC)
  run('absence_write', 6, 10_000, { head: (i) => token(uid(0x200 + i), 'teacher', { class_ids: [classId] }),
    call: (h, i, n) => { const d = new Date(Date.UTC(2020, 0, 1) + (day++) * 86400000).toISOString().slice(0, 10);
      return fetch(`${base}/absences`, { method: 'POST', headers: h, body: JSON.stringify({ student_id: cs[(i + n) % cs.length].id, kind: 'absence', on_date: d }) }); }, check: created }),
  // one teacher per worker: the assistant allows 60 requests per user and hour, so each worker stays under 40
  run('ai_assist', 6, 40, { head: (i) => token(uid(0x100 + i), 'teacher', { class_ids: [classId] }),
    call: (h) => fetch(`${base}/ai/assist`, { method: 'POST', headers: h, body: JSON.stringify({ kind: 'summarize', lang: 'fr', text: 'Les fractions décimales servent à écrire des nombres non entiers. '.repeat(20) }) }), check: created }),
  run('predictive_run', 2, 6, { head: async () => admin, call: (h) => fetch(`${base}/predictive/run`, { method: 'POST', headers: h, body: '{}' }), check: created }),
]);

const q = (a, f) => (a.length ? a[Math.min(a.length - 1, Math.floor(f * a.length))] : NaN);
let fail = false;
console.log('scenario'.padEnd(16), 'ok'.padStart(6), 'bad'.padStart(5), 'p50'.padStart(8), 'p95'.padStart(8), 'p99'.padStart(8), 'budget'.padStart(8));
for (const [name, r] of results) {
  r.lat.sort((a, b) => a - b); const p95 = q(r.lat, 0.95); const bad = [...r.bad.values()].reduce((a, b) => a + b, 0);
  if (!r.lat.length || bad || !(p95 <= budgets[name])) fail = true;
  console.log(name.padEnd(16), String(r.lat.length).padStart(6), String(bad).padStart(5), q(r.lat, 0.5).toFixed(0).padStart(8), p95.toFixed(0).padStart(8), q(r.lat, 0.99).toFixed(0).padStart(8), String(budgets[name]).padStart(8));
  if (bad) console.log('   failures:', Object.fromEntries(r.bad));
}
console.log(fail ? 'FAIL: a scenario returned errors, produced no data or exceeded its p95 budget' : 'OK: all scenarios within budget');
process.exit(fail ? 1 : 0);
