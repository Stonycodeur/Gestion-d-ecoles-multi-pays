import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';
import { Pool } from 'pg';
import { signWebhook } from '@ecolemanager/shared';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 'r'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../packages/modules');
process.env.MESSAGE_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.GPS_KEY = Buffer.alloc(32, 3).toString('base64');
process.env.PAYMENT_WEBHOOK_SECRET = 'w'.repeat(32);
process.env.PAYMENT_MODE = 'sandbox';
process.env.PUSH_MODE = 'sandbox';

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Phase 5 e2e (payments + parent GPS)', () => {
  jest.setTimeout(120000);
  let app: INestApplication; let server: any; let admin: Pool;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n + 900).padStart(12, '0')}`;
  const ids: Record<string, string> = {};
  let adminT: string, headT: string, accountantT: string, teacherT: string, guardianT: string, guardian2T: string, otherGuardianT: string, studentT: string;
  const tok = async (role: string, n: number, extra: object = {}) => (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant: 'e2e_h', ...extra })).body.access_token as string;
  const call = (m: 'get' | 'post', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);
  const bin = (path: string, t: string) => call('get', path, t).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
  const secret = 'w'.repeat(32);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,'e2e_h','Lycée H','lycee','GA','tenant_e2e_h') ON CONFLICT DO NOTHING", [U(9003)]);
    await admin.query("SELECT provision_tenant_schema('e2e_h')");
    const { AppModule } = await import('./app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true }); await app.init(); server = app.getHttpServer();
    adminT = await tok('admin', 1); headT = await tok('head', 2); accountantT = await tok('accountant', 3);
    for (const m of ['module-payment', 'module-gps']) await call('post', `/modules/${m}/enable`, adminT).send({}).expect(201);
    ids.cls = (await call('post', '/classes', adminT).send({ name: '2nde A', level_code: '2nde', school_year: '2026-2027' }).expect(201)).body.id;
    ids.s2 = (await call('post', '/students', adminT).send({ first_name: 'Ben', last_name: 'Ndong', class_id: ids.cls }).expect(201)).body.student.id;
    await call('post', '/fee-plans', accountantT).send({ level_code: '2nde', school_year: '2026-2027', label: 'Scolarité 2026-2027', amount: 300000, installments: 3, first_due_on: '2026-10-01' }).expect(201);
    const s1 = (await call('post', '/students', adminT).send({ first_name: 'Ada', last_name: 'Obiang', class_id: ids.cls }).expect(201)).body;
    ids.s1 = s1.student.id; ids.enrolmentInvoice = s1.invoice;
    teacherT = await tok('teacher', 4, { class_ids: [ids.cls] });
    guardianT = await tok('guardian', 5, { child_ids: [ids.s1] });
    guardian2T = await tok('guardian', 6, { child_ids: [ids.s1] });
    otherGuardianT = await tok('guardian', 7, { child_ids: [ids.s2] });
    studentT = await tok('student', 8, { student_id: ids.s1 });
    const dir = (b: object) => call('post', '/directory', adminT).send(b).expect(201);
    await dir({ user_id: U(2), role: 'head', display_name: 'Directeur' });
    await dir({ user_id: U(5), role: 'guardian', display_name: 'Parent 1', child_ids: [ids.s1] });
    await dir({ user_id: U(6), role: 'guardian', display_name: 'Parent 2', child_ids: [ids.s1] });
    await dir({ user_id: U(8), role: 'student', display_name: 'Ada', student_id: ids.s1 });
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  // ------------------------------------------------------------------------------------------ payments
  it('country reference drives currency and methods; enrolment creates the invoice from the fee plan', async () => {
    const cfg = (await call('get', '/payments/config', guardianT).expect(200)).body;
    expect(cfg.currency).toBe('XAF'); expect(cfg.methods.map((m: any) => m.code)).toEqual(expect.arrayContaining(['airtel_money', 'moov_money', 'stripe', 'cash']));
    expect(ids.enrolmentInvoice).toBeTruthy(); expect((ids.enrolmentInvoice as any).net_minor).toBe(300000);
    const inv = (await call('get', `/students/${ids.s1}/invoices`, guardianT).expect(200)).body;
    expect(inv.length).toBe(1); ids.inv = inv[0].id;
    expect(inv[0].installments.map((i: any) => i.amount_minor)).toEqual([100000, 100000, 100000]);
    expect(inv[0].outstanding_minor).toBe(300000);
  });

  it('who can see invoices', async () => {
    await call('get', `/students/${ids.s1}/invoices`, otherGuardianT).expect(403);
    await call('get', `/students/${ids.s1}/invoices`, studentT).expect(200);
    await call('get', `/students/${ids.s1}/invoices`, teacherT).expect(403);
    expect((await call('get', '/invoices', accountantT).expect(200)).body.length).toBe(1);
    await call('get', '/invoices', guardianT).expect(403);
    await call('get', `/invoices/${ids.inv}`, otherGuardianT).expect(403);
  });

  it('online payment: method rules, amount cap, Idempotency-Key replay', async () => {
    await call('post', `/invoices/${ids.inv}/pay`, guardianT).send({ method: 'cash' }).expect(400);             // cash is recorded by the office
    await call('post', `/invoices/${ids.inv}/pay`, guardianT).send({ method: 'nope' }).expect(400);
    await call('post', `/invoices/${ids.inv}/pay`, guardianT).send({ method: 'airtel_money', amount_minor: 999999999 }).expect(400);
    await call('post', `/invoices/${ids.inv}/pay`, otherGuardianT).send({ method: 'airtel_money', payer: '077000000' }).expect(403);
    const a = (await call('post', `/invoices/${ids.inv}/pay`, guardianT).set('Idempotency-Key', 'k-1').send({ method: 'airtel_money', amount_minor: 100000, payer: '077000000' }).expect(201)).body;
    expect(a.payment.status).toBe('pending'); expect(a.idempotent_replay).toBe(false); ids.pay1 = a.payment.id; ids.ref1 = a.payment.provider_ref;
    const b = (await call('post', `/invoices/${ids.inv}/pay`, guardianT).set('Idempotency-Key', 'k-1').send({ method: 'airtel_money', amount_minor: 100000, payer: '077000000' }).expect(201)).body;
    expect(b.idempotent_replay).toBe(true); expect(b.payment.id).toBe(ids.pay1);
    expect((await call('get', `/invoices/${ids.inv}`, guardianT).expect(200)).body.paid_minor).toBe(0);   // nothing is paid until the provider confirms
  });

  it('webhook is idempotent: one confirmation, one receipt, no double allocation', async () => {
    const r1 = (await call('post', `/payments/${ids.pay1}/sandbox-confirm`, guardianT).send({ event_id: 'evt-1' }).expect(201)).body;
    expect(r1.status).toBe('succeeded'); expect(r1.receipt).toMatch(/^REC-\d{4}-00001$/);
    expect((await call('post', `/payments/${ids.pay1}/sandbox-confirm`, guardianT).send({ event_id: 'evt-1' }).expect(201)).body).toEqual({ duplicate: true });          // same event redelivered
    expect((await call('post', `/payments/${ids.pay1}/sandbox-confirm`, guardianT).send({ event_id: 'evt-2' }).expect(201)).body.ignored).toBe('already succeeded');    // new event, same payment
    const inv = (await call('get', `/invoices/${ids.inv}`, guardianT).expect(200)).body;
    expect(inv.paid_minor).toBe(100000); expect(inv.installments[0].paid_minor).toBe(100000); expect(inv.installments[1].paid_minor).toBe(0);
    expect((await admin.query('SELECT COUNT(*)::int AS n FROM tenant_e2e_h.receipts')).rows[0].n).toBe(1);
    const notes = (await call('get', '/notifications', guardianT).expect(200)).body;
    expect(notes.filter((n: any) => n.type === 'payment.confirmed').length).toBe(1);
  });

  it('real HTTP webhook: bad signature refused, valid one accepted, replay and wrong amount ignored, failure recorded', async () => {
    const p = (await call('post', `/invoices/${ids.inv}/pay`, guardianT).send({ method: 'moov_money', amount_minor: 50000, payer: '066000000' }).expect(201)).body.payment;
    const send = (body: string, sig?: string, ts = Math.floor(Date.now() / 1000)) => request(server).post('/payments/webhooks/moov_money/e2e_h').set('content-type', 'application/json')
      .set('x-webhook-timestamp', String(ts)).set('x-webhook-signature', sig ?? signWebhook(secret, ts, body)).send(body);
    const evt = JSON.stringify({ id: 'http-1', provider_ref: p.provider_ref, status: 'succeeded', amount_minor: 40000 });
    await send(evt, 'deadbeef').expect(403);
    expect((await send(evt).expect(201)).body.ignored).toBe('amount mismatch');                                       // amount must match what was requested
    const ok = JSON.stringify({ id: 'http-2', provider_ref: p.provider_ref, status: 'succeeded', amount_minor: 50000 });
    expect((await send(ok).expect(201)).body.status).toBe('succeeded');
    expect((await send(ok).expect(201)).body).toEqual({ duplicate: true });
    const old = Math.floor(Date.now() / 1000) - 3600;
    await send(JSON.stringify({ id: 'http-3', provider_ref: 'x', status: 'succeeded' }), undefined, old).expect(403);   // replayed old timestamp
    const p2 = (await call('post', `/invoices/${ids.inv}/pay`, guardianT).send({ method: 'airtel_money', amount_minor: 10000, payer: '077000000' }).expect(201)).body.payment;
    expect((await call('post', `/payments/${p2.id}/sandbox-confirm`, guardianT).send({ outcome: 'failed' }).expect(201)).body.status).toBe('failed');
    expect((await call('get', `/invoices/${ids.inv}`, guardianT).expect(200)).body.paid_minor).toBe(150000);
  });

  it('cash (QR), cheque and transfer are recorded by the accounting office only', async () => {
    await call('post', '/payments/manual', guardianT).send({ invoice_id: ids.inv, method: 'cash', amount_minor: 1000 }).expect(403);
    const qr = (await call('get', `/invoices/${ids.inv}/cash-qr`, guardianT).expect(200)).body;
    expect(qr.qr).toMatch(/^data:image\/png;base64,/);
    await call('post', '/payments/manual', accountantT).send({ invoice_id: ids.inv, method: 'cash', amount_minor: 20000, cash_token: qr.token + 'x' }).expect(403);
    const c = (await call('post', '/payments/manual', accountantT).send({ invoice_id: ids.inv, method: 'cash', amount_minor: 20000, cash_token: qr.token, reference: 'C-1' }).expect(201)).body;
    expect(c.receipt_number).toMatch(/^REC-/);
    await call('post', '/payments/manual', accountantT).send({ invoice_id: ids.inv, method: 'cash', amount_minor: 20000, reference: 'C-1' }).expect(409);        // same reference twice
    await call('post', '/payments/manual', accountantT).send({ invoice_id: ids.inv, method: 'cheque', amount_minor: 30000, reference: 'CHQ-889' }).expect(201);
    await call('post', '/payments/manual', accountantT).send({ invoice_id: ids.inv, method: 'bitcoin', amount_minor: 1 }).expect(400);
    const inv = (await call('get', `/invoices/${ids.inv}`, guardianT).expect(200)).body;
    expect(inv.paid_minor).toBe(200000); expect(inv.outstanding_minor).toBe(100000);
    expect(inv.installments.map((i: any) => i.paid_minor)).toEqual([100000, 100000, 0]);
  });

  it('receipts are PDFs, visible to the family only', async () => {
    const pdf = (await bin(`/payments/${ids.pay1}/receipt?locale=en`, guardianT).expect(200)).body as Buffer;
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    await call('get', `/payments/${ids.pay1}/receipt`, otherGuardianT).expect(403);
  });

  it('reminders fire on exact offsets, once per day, and reach the family', async () => {
    const day = '2026-10-29';                                                              // 3 days before installment 2 (2026-11-01)... already paid: nothing; installment 3 is due 2026-12-01
    expect((await call('post', '/billing/reminders/run', accountantT).send({ today: '2026-11-28' }).expect(201)).body.sent).toBe(1);   // J-3 of installment 3
    expect((await call('post', '/billing/reminders/run', accountantT).send({ today: '2026-11-28' }).expect(201)).body.sent).toBe(0);   // already sent that day
    expect((await call('post', '/billing/reminders/run', accountantT).send({ today: day }).expect(201)).body.sent).toBe(0);
    const notes = (await call('get', '/notifications', guardianT).expect(200)).body;
    expect(notes.some((n: any) => n.type === 'payment.reminder')).toBe(true);
    await call('post', '/billing/reminders/run', guardianT).send({}).expect(403);
  });

  it('reconciliation, recovery statistics, cancellation rules', async () => {
    const r = (await call('post', '/billing/reconcile', accountantT).send({ lines: [{ ref: ids.ref1, amount_minor: 100000 }, { ref: 'UNKNOWN', amount_minor: 5 }] }).expect(201)).body;
    expect(r.matched).toContain(ids.ref1); expect(r.missingInBooks).toEqual(['UNKNOWN']); expect(r.missingInBank.length).toBeGreaterThanOrEqual(1);
    const st = (await call('get', '/billing/stats', accountantT).expect(200)).body;
    expect(st.billed).toBe(300000); expect(st.collected).toBe(200000); expect(st.rate).toBeCloseTo(66.7, 1);
    expect(st.by_method.map((m: any) => m.method)).toEqual(expect.arrayContaining(['airtel_money', 'moov_money', 'cash', 'cheque']));
    await call('post', `/invoices/${ids.inv}/cancel`, accountantT).expect(409);                  // has payments
    const extra = (await call('post', '/invoices', accountantT).send({ student_id: ids.s2, label: 'Cantine', amount: 12000, first_due_on: '2026-12-01', discounts: [{ type: 'percent', value: 50 }] }).expect(201)).body;
    expect(extra.net_minor).toBe(6000);
    await call('post', `/invoices/${extra.id}/cancel`, accountantT).expect(201);
    await call('post', '/invoices', guardianT).send({ student_id: ids.s2, label: 'x', amount: 1, first_due_on: '2026-12-01' }).expect(403);
  });

  // ------------------------------------------------------------------------------------------------ GPS
  const pos = (lat: number, lng: number, extra: object = {}) => ({ lat, lng, accuracy_m: 10, ...extra });
  const allDays = { days: [1, 2, 3, 4, 5, 6, 7], start: '00:00', end: '23:59', timezone: 'UTC' };

  it('no tracking without consent; only a guardian can grant; window and retention are validated', async () => {
    expect((await call('get', `/gps/students/${ids.s1}/policy`, studentT).expect(200)).body).toMatchObject({ allowed: false, interval_sec: null });
    expect((await call('post', `/gps/students/${ids.s1}/positions`, studentT).send(pos(0.5, 9.6)).expect(201)).body.stored).toBe(false);
    await call('post', `/gps/students/${ids.s1}/consent`, studentT).send({ granted: true, window: allDays }).expect(403);       // a minor cannot grant surveillance on themselves
    await call('post', `/gps/students/${ids.s1}/consent`, otherGuardianT).send({ granted: true, window: allDays }).expect(403);
    await call('post', `/gps/students/${ids.s1}/consent`, guardianT).send({ granted: true, window: { days: [], start: '07:00', end: '18:00' } }).expect(400);
    await call('post', `/gps/students/${ids.s1}/consent`, guardianT).send({ granted: true, window: { ...allDays, start: '7h' } }).expect(400);
    await call('post', `/gps/students/${ids.s1}/consent`, guardianT).send({ granted: true, window: allDays, retention_days: 90 }).expect(400);
    expect((await call('post', `/gps/students/${ids.s1}/consent`, guardianT).send({ granted: true, window: allDays }).expect(201)).body.tracking_active).toBe(true);
    expect((await call('get', `/gps/students/${ids.s1}/policy`, studentT).expect(200)).body).toMatchObject({ allowed: true, interval_sec: 30 });
    const mine = (await call('get', `/gps/students/${ids.s1}/consent`, guardianT).expect(200)).body;
    expect(mine.mine.granted).toBe(true); expect((await call('get', `/gps/students/${ids.s1}/consent`, guardian2T).expect(200)).body.mine).toBeNull();
  });

  it('geofencing: arrival / exit / out-of-zone once per transition, imprecise fixes ignored, parents alerted', async () => {
    await call('post', '/gps/geofences', guardianT).send({ name: 'Lycée', kind: 'school', lat: 0.39, lng: 9.45, radius_m: 150 }).expect(403);   // school zones: direction only
    await call('post', '/gps/geofences', headT).send({ name: 'Lycée', kind: 'school', lat: 0.39, lng: 9.45, radius_m: 150 }).expect(201);
    await call('post', '/gps/geofences', guardianT).send({ student_id: ids.s1, name: 'Maison', kind: 'home', lat: 0.4, lng: 9.47, radius_m: 100 }).expect(201);
    const rep = async (lat: number, lng: number, extra: object = {}) => (await call('post', `/gps/students/${ids.s1}/positions`, studentT).send(pos(lat, lng, extra)).expect(201)).body;
    expect((await rep(0.5, 9.6)).events).toEqual([]);                                                       // first fix elsewhere: no incident
    expect((await rep(0.39, 9.45, { accuracy_m: 900 })).stored).toBe(false);                                 // too imprecise
    expect((await rep(0.39, 9.45)).events.map((e: any) => e.type)).toEqual(['arrival']);
    expect((await rep(0.39, 9.4501)).events).toEqual([]);
    expect((await rep(0.5, 9.6)).events.map((e: any) => e.type)).toEqual(['exit', 'out_of_zone']);
    expect((await rep(0.51, 9.61)).events).toEqual([]);
    const alerts = (await call('get', '/notifications', guardianT).expect(200)).body.filter((n: any) => n.type === 'gps.alert');
    expect(alerts.length).toBe(3);
    expect((await call('get', '/notifications', otherGuardianT).expect(200)).body.some((n: any) => n.type === 'gps.alert')).toBe(false);
  });

  it('live map and history: consent required, positions encrypted at rest, every access logged', async () => {
    const live = (await call('get', `/gps/students/${ids.s1}/live`, guardianT).expect(200)).body;
    expect(live.position.lat).toBeCloseTo(0.51, 3); expect(live.state.out_of_zone).toBe(true);
    await call('get', `/gps/students/${ids.s1}/live`, guardian2T).expect(403);        // linked guardian but has not consented with this account
    for (const t of [otherGuardianT, studentT, teacherT, headT]) await call('get', `/gps/students/${ids.s1}/live`, t).expect(403);
    const hist = (await call('get', `/gps/students/${ids.s1}/history`, guardianT).expect(200)).body;
    expect(hist.length).toBeGreaterThanOrEqual(5);
    const raw = (await admin.query('SELECT enc FROM tenant_e2e_h.gps_positions LIMIT 3')).rows.map((r) => r.enc).join('');
    expect(raw).not.toMatch(/"lat"|"lng"/);   // plaintext JSON never reaches the table
    expect((await call('get', `/gps/students/${ids.s1}/events`, guardianT).expect(200)).body.map((e: any) => e.type)).toEqual(expect.arrayContaining(['arrival', 'exit', 'out_of_zone']));
    const log = (await call('get', `/gps/students/${ids.s1}/access-log`, guardianT).expect(200)).body;
    expect(log.map((l: any) => l.action)).toEqual(expect.arrayContaining(['view_live', 'view_history']));
    await call('get', `/gps/students/${ids.s1}/access-log`, headT).expect(200);
    await call('get', `/gps/students/${ids.s1}/access-log`, otherGuardianT).expect(403);
  });

  it('retention purge deletes old data, keeps recent data; revocation purges everything and stops tracking', async () => {
    await admin.query("INSERT INTO tenant_e2e_h.gps_positions(tenant_id, student_id, enc, accuracy_m, recorded_at) VALUES ($1,$2,'old',5, NOW() - INTERVAL '40 days')", [U(9003), ids.s1]);
    await call('post', '/gps/purge', guardianT).expect(403);
    const purge = (await call('post', '/gps/purge', headT).expect(201)).body;
    expect(purge.positions_deleted).toBe(1);
    expect((await call('get', `/gps/students/${ids.s1}/history`, guardianT).expect(200)).body.length).toBeGreaterThanOrEqual(5);
    const rev = (await call('post', `/gps/students/${ids.s1}/consent`, guardianT).send({ granted: false }).expect(201)).body;
    expect(rev.tracking_active).toBe(false); expect(rev.positions_purged).toBeGreaterThanOrEqual(5);
    await call('get', `/gps/students/${ids.s1}/live`, guardianT).expect(403);
    expect((await call('post', `/gps/students/${ids.s1}/positions`, studentT).send(pos(0.39, 9.45)).expect(201)).body.stored).toBe(false);
    expect((await admin.query('SELECT COUNT(*)::int AS n FROM tenant_e2e_h.gps_positions WHERE student_id = $1', [ids.s1])).rows[0].n).toBe(0);
  });

  it('the student can revoke tracking at any time', async () => {
    await call('post', `/gps/students/${ids.s1}/consent`, guardianT).send({ granted: true, window: allDays }).expect(201);
    expect((await call('post', `/gps/students/${ids.s1}/consent`, studentT).send({ granted: false }).expect(201)).body.tracking_active).toBe(false);
  });

  it('modules can be switched off per school', async () => {
    await call('post', '/modules/module-payment/disable', adminT).send({}).expect(201);
    await call('get', '/payments/config', guardianT).expect(200);                        // config is harmless; business endpoints are closed
    await call('get', '/invoices', accountantT).expect(403);
    await call('post', '/modules/module-gps/disable', adminT).send({}).expect(201);
    await call('get', `/gps/students/${ids.s1}/policy`, studentT).expect(403);
  });
});
