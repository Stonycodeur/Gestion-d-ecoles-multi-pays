import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import { DEFAULT_REMINDER_RULE, allocatePayment, applyDiscounts, can, formatMoney, invoiceStatus, recoveryStats, reconcile, remindersDue, splitInstallments, toMinor,
  type Discount, type Installment, type Principal, type ReminderRule } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { date, mapDbError, num, optStr, str, uuid } from '../pedagogy/validate';
import { ModulesService } from '../modules/modules.service';
import { NotificationService } from '../comms/notification.service';
import { AuditService } from '../core/audit.service';
import { PaymentProviders, SandboxProvider } from './providers';
import { receiptPdf } from './receipt-pdf';

export const PAYMENT_MODULE = 'module-payment';
type Tenant = { id: string; slug: string; country: string; schoolType: string };
const MANUAL = ['cash', 'cheque', 'bank_transfer'];
const today = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class PaymentsService {
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly notif: NotificationService,
    private readonly providers: PaymentProviders, private readonly audit: AuditService) {}

  private tx<T>(slug: string, fn: (q: Q, t: Tenant) => Promise<T>): Promise<T> { return this.db.run(slug, fn).catch((e) => mapDbError(e)); }
  private authorize(p: Principal, slug: string, perm: string, r: Record<string, unknown> = {}) { const d = can(p, perm, { tenantId: slug, ...r }); if (!d.allowed) throw new ForbiddenException(d.reason); }
  requireEnabled(slug: string) { if (!this.modules.registry.isEnabled(slug, PAYMENT_MODULE)) throw new ForbiddenException('Payment module is not enabled for this school'); }
  /** Staff with billing:read, or the student / a linked guardian (billing:pay on that student). */
  private canSee(p: Principal, slug: string, studentId: string) {
    if (can(p, 'billing:read', { tenantId: slug }).allowed || can(p, 'billing:write', { tenantId: slug }).allowed) return;
    this.authorize(p, slug, 'billing:pay', { studentId });
  }
  private secret(): string { const s = process.env.PAYMENT_WEBHOOK_SECRET; if (!s || s.length < 16) throw new BadRequestException('payment secret not configured'); return s; }

  /** Currency and payment methods come from the country reference, never from code. */
  private async country(q: Q, t: Tenant) {
    const c = (await q('SELECT currency, payment_providers, default_locale FROM public.countries WHERE code = $1', [t.country]))[0];
    if (!c) throw new NotFoundException('country not configured');
    return { currency: c.currency as string, providers: c.payment_providers as { code: string; label: string; kind: string }[], locale: c.default_locale as string };
  }
  config(slug: string) {
    return this.tx(slug, async (q, t) => { const c = await this.country(q, t); return { currency: c.currency, methods: c.providers, mode: process.env.PAYMENT_MODE === 'live' ? 'live' : 'sandbox' }; });
  }

  // ---- fee plans & invoices -------------------------------------------------------------------------------------
  async createFeePlan(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'billing:write');
    return this.tx(slug, async (q, t) => {
      const c = await this.country(q, t);
      return (await q('INSERT INTO fee_plans(level_code, school_year, label, amount_minor, installments, first_due_on) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [str(b.level_code, 'level_code', 20), str(b.school_year, 'school_year', 20), str(b.label, 'label', 120), toMinor(num(b.amount, 'amount', 0, 1e12), c.currency),
          Math.round(num(b.installments ?? 1, 'installments', 1, 36)), date(b.first_due_on, 'first_due_on')]))[0];
    });
  }
  listFeePlans(slug: string, p: Principal) { this.requireEnabled(slug); this.authorize(p, slug, 'billing:read'); return this.tx(slug, (q) => q('SELECT * FROM fee_plans ORDER BY school_year DESC, level_code')); }

  private discounts(v: unknown): Discount[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v) || v.length > 10) throw new BadRequestException('discounts: at most 10');
    return v.map((d: any) => { if (!['percent', 'fixed'].includes(d?.type)) throw new BadRequestException('discount type must be percent|fixed'); return { type: d.type, value: num(d.value, 'discount.value', 0, 1e12), label: optStr(d.label, 'label', 80) ?? undefined }; });
  }
  private async persistInvoice(q: Q, t: Tenant, actor: string | null, o: { studentId: string; label: string; currency: string; gross: number; discountMinor: number; net: number; discounts: Discount[]; installments: Installment[] }) {
    await q('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice-no-${t.id}`]);
    const n = Number((await q('SELECT COUNT(*)::int AS n FROM invoices'))[0].n) + 1;
    const number = `INV-${new Date().getUTCFullYear()}-${String(n).padStart(5, '0')}`;
    const inv = (await q('INSERT INTO invoices(student_id, number, label, currency, gross_minor, discount_minor, net_minor, discounts, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [o.studentId, number, o.label, o.currency, o.gross, o.discountMinor, o.net, JSON.stringify(o.discounts), invoiceStatus(o.installments, today()), actor]))[0];
    for (const i of o.installments) await q('INSERT INTO installments(invoice_id, seq, due_on, amount_minor) VALUES ($1,$2,$3,$4)', [inv.id, i.seq, i.due_on, i.amount_minor]);
    return { ...inv, gross_minor: Number(inv.gross_minor), discount_minor: Number(inv.discount_minor), net_minor: Number(inv.net_minor), installments: o.installments };
  }
  async issueInvoice(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'billing:write');
    const studentId = uuid(b.student_id, 'student_id'), discounts = this.discounts(b.discounts);
    const inv = await this.tx(slug, async (q, t) => {
      if (!(await q('SELECT 1 FROM students WHERE id = $1', [studentId])).length) throw new NotFoundException('student not found');
      const c = await this.country(q, t);
      let gross: number, count: number, first: string, label: string;
      if (b.fee_plan_id) {
        const f = (await q('SELECT * FROM fee_plans WHERE id = $1', [uuid(b.fee_plan_id, 'fee_plan_id')]))[0];
        if (!f) throw new NotFoundException('fee plan not found');
        gross = Number(f.amount_minor); count = f.installments; first = String(f.first_due_on).slice(0, 10); label = f.label;
      } else { gross = toMinor(num(b.amount, 'amount', 0, 1e12), c.currency); count = Math.round(num(b.installments ?? 1, 'installments', 1, 36)); first = date(b.first_due_on, 'first_due_on'); label = str(b.label, 'label', 120); }
      const { discountMinor, netMinor } = applyDiscounts(gross, discounts);
      return this.persistInvoice(q, t, p.id, { studentId, label, currency: c.currency, gross, discountMinor, net: netMinor, discounts, installments: splitInstallments(netMinor, count, first) });
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'invoice.issue', entity: 'invoice', entityId: inv.id });
    await this.notif.notifyFamily(slug, studentId, 'invoice.issued', { text: `${inv.number} — ${formatMoney(inv.net_minor, inv.currency)}` }, { invoice_id: inv.id });
    return inv;
  }
  /** Enrolment invoice (spec: « facture à l'inscription »): module-payment computes the plan, the core persists it. No fee plan for the level = no invoice. */
  async invoiceOnEnrollment(slug: string, actor: string, studentId: string) {
    if (!this.modules.registry.isEnabled(slug, PAYMENT_MODULE)) return null;
    const plan = await this.tx(slug, async (q) => (await q(
      `SELECT f.* FROM students s JOIN classes c ON c.id = s.class_id JOIN fee_plans f ON f.level_code = c.level_code AND f.school_year = c.school_year WHERE s.id = $1 ORDER BY f.label LIMIT 1`, [studentId]))[0]);
    if (!plan) return null;
    const hook = await this.modules.registry.emitTo(slug, 'onStudentCreated', PAYMENT_MODULE, { feePlan: { amount_minor: Number(plan.amount_minor), installments: plan.installments, first_due_on: String(plan.first_due_on).slice(0, 10) } });
    const planned = (hook?.ok ? (hook as any).value?.invoice : null) as { gross_minor: number; discount_minor: number; net_minor: number; installments: Installment[] } | null;
    if (!planned) return null;
    const inv = await this.tx(slug, async (q, t) => { const c = await this.country(q, t);
      return this.persistInvoice(q, t, actor, { studentId, label: plan.label, currency: c.currency, gross: planned.gross_minor, discountMinor: planned.discount_minor, net: planned.net_minor, discounts: [], installments: planned.installments }); });
    await this.notif.notifyFamily(slug, studentId, 'invoice.issued', { text: `${inv.number} — ${formatMoney(inv.net_minor, inv.currency)}` }, { invoice_id: inv.id });
    return inv;
  }

  private async loadInvoices(q: Q, where: string, params: unknown[]) {
    const invs = await q(`SELECT i.*, s.first_name, s.last_name FROM invoices i JOIN students s ON s.id = i.student_id ${where} ORDER BY i.created_at DESC`, params);
    for (const i of invs) {
      i.installments = await q('SELECT seq, due_on::text AS due_on, amount_minor::bigint AS amount_minor, paid_minor::bigint AS paid_minor FROM installments WHERE invoice_id = $1 ORDER BY seq', [i.id]);
      for (const x of i.installments) { x.amount_minor = Number(x.amount_minor); x.paid_minor = Number(x.paid_minor); }
      i.gross_minor = Number(i.gross_minor); i.discount_minor = Number(i.discount_minor); i.net_minor = Number(i.net_minor);
      i.paid_minor = i.installments.reduce((a: number, x: Installment) => a + (x.paid_minor ?? 0), 0);
      i.status = invoiceStatus(i.installments, today(), i.status === 'cancelled');
      i.outstanding_minor = i.status === 'cancelled' ? 0 : i.net_minor - i.paid_minor;
      i.payments = await q('SELECT id, method, status, amount_minor::bigint AS amount_minor, created_at, confirmed_at FROM payments WHERE invoice_id = $1 ORDER BY created_at', [i.id]);
      for (const x of i.payments) x.amount_minor = Number(x.amount_minor);
    }
    return invs;
  }
  listInvoices(slug: string, p: Principal) { this.requireEnabled(slug); this.authorize(p, slug, 'billing:read'); return this.tx(slug, (q) => this.loadInvoices(q, '', [])); }
  studentInvoices(slug: string, p: Principal, studentId: string) {
    this.requireEnabled(slug); this.canSee(p, slug, uuid(studentId, 'student_id'));
    return this.tx(slug, (q) => this.loadInvoices(q, 'WHERE i.student_id = $1', [studentId]));
  }
  async getInvoice(slug: string, p: Principal, id: string) {
    this.requireEnabled(slug);
    const r = await this.tx(slug, (q) => this.loadInvoices(q, 'WHERE i.id = $1', [uuid(id, 'id')]));
    if (!r.length) throw new NotFoundException('invoice not found');
    this.canSee(p, slug, r[0].student_id);
    return r[0];
  }
  async cancelInvoice(slug: string, p: Principal, id: string) {
    this.requireEnabled(slug); this.authorize(p, slug, 'billing:write');
    await this.tx(slug, async (q) => {
      const inv = (await q('SELECT id FROM invoices WHERE id = $1 FOR UPDATE', [uuid(id, 'id')]))[0]; if (!inv) throw new NotFoundException('invoice not found');
      if ((await q("SELECT 1 FROM payments WHERE invoice_id = $1 AND status IN ('succeeded','pending')", [id])).length) throw new ConflictException('invoice has payments: refund first');
      await q("UPDATE invoices SET status = 'cancelled' WHERE id = $1", [id]);
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'invoice.cancel', entity: 'invoice', entityId: id });
    return { cancelled: true };
  }

  // ---- paying ----------------------------------------------------------------------------------------------------
  /** Online payment (mobile money / card). Idempotency-Key header: a retry returns the same payment instead of charging twice. */
  async pay(slug: string, p: Principal, invoiceId: string, b: any, idemKey?: string) {
    this.requireEnabled(slug);
    const key = idemKey ? str(idemKey, 'Idempotency-Key', 100) : null;
    const prep = await this.tx(slug, async (q, t) => {
      const inv = (await this.loadInvoices(q, 'WHERE i.id = $1', [uuid(invoiceId, 'id')]))[0];
      if (!inv) throw new NotFoundException('invoice not found');
      this.authorize(p, slug, 'billing:pay', { studentId: inv.student_id });
      if (key) { const ex = (await q('SELECT * FROM payments WHERE idempotency_key = $1', [key]))[0]; if (ex) { if (ex.invoice_id !== inv.id) throw new ConflictException('Idempotency-Key reused for another invoice'); return { replay: ex, inv, c: null, t }; } }
      if (inv.status === 'cancelled' || inv.outstanding_minor <= 0) throw new ConflictException('nothing to pay on this invoice');
      const c = await this.country(q, t);
      const method = c.providers.find((m) => m.code === str(b.method, 'method', 40));
      if (!method || !['mobile_money', 'card'].includes(method.kind)) throw new BadRequestException('method must be an online method of this country (mobile money or card); cash, cheque and transfer are recorded by the accounting office');
      const amount = b.amount_minor === undefined ? inv.outstanding_minor : Math.round(num(b.amount_minor, 'amount_minor', 1, inv.outstanding_minor));
      return { replay: null, inv, c, t, method, amount };
    });
    if (prep.replay) return { payment: this.slim(prep.replay), idempotent_replay: true };
    const provider = this.providers.get(prep.method!.code);
    const init = await provider.initiate({ reference: prep.inv.number, amountMinor: prep.amount!, currency: prep.inv.currency, payer: optStr(b.payer, 'payer', 40) ?? undefined, country: prep.t.country });
    const payment = await this.tx(slug, async (q) => (await q(
      "INSERT INTO payments(invoice_id, method, provider, provider_ref, idempotency_key, amount_minor, currency, status, payer, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9) RETURNING *",
      [prep.inv.id, prep.method!.code, prep.method!.code, init.providerRef, key, prep.amount, prep.inv.currency, optStr(b.payer, 'payer', 40), p.id]))[0]);
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'payment.initiate', entity: 'payment', entityId: payment.id, details: { method: prep.method!.code, amount_minor: prep.amount } });
    return { payment: this.slim(payment), instructions: init.instructions, redirect_url: init.redirectUrl, idempotent_replay: false };
  }
  private slim(x: any) { return { id: x.id, invoice_id: x.invoice_id, method: x.method, status: x.status, amount_minor: Number(x.amount_minor), currency: x.currency, provider_ref: x.provider_ref }; }

  /** Cash, cheque, bank transfer: recorded by the accounting office (the money is already received). */
  async recordManual(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'billing:write');
    const method = str(b.method, 'method', 20); if (!MANUAL.includes(method)) throw new BadRequestException(`method must be one of ${MANUAL.join('|')}`);
    const reference = str(b.reference ?? (method === 'cash' ? `cash-${Date.now()}` : ''), 'reference', 80);
    const out = await this.tx(slug, async (q, t) => {
      const c = await this.country(q, t);
      if (!c.providers.some((m) => m.code === method)) throw new BadRequestException('method not enabled for this country');
      const inv = (await q('SELECT id, student_id, status, currency FROM invoices WHERE id = $1 FOR UPDATE', [uuid(b.invoice_id, 'invoice_id')]))[0];
      if (!inv) throw new NotFoundException('invoice not found');
      if (method === 'cash' && b.cash_token !== undefined && !this.verifyCashToken(String(b.cash_token), inv.id)) throw new ForbiddenException('invalid or expired cash QR code');
      if (inv.status === 'cancelled') throw new ConflictException('invoice is cancelled');
      const amount = b.amount_minor !== undefined ? Math.round(num(b.amount_minor, 'amount_minor', 1, 1e15)) : toMinor(num(b.amount, 'amount', 0.01, 1e12), inv.currency);
      const pay = (await q("INSERT INTO payments(invoice_id, method, provider, provider_ref, amount_minor, currency, status, created_by) VALUES ($1,$2,'manual',$3,$4,$5,'pending',$6) RETURNING *",
        [inv.id, method, `${method}:${reference}`, amount, inv.currency, p.id]))[0];
      const done = await this.confirm(q, pay);
      return { pay, done, studentId: inv.student_id };
    });
    await this.afterConfirm(slug, out.done, out.studentId, p.id);
    return { payment: this.slim({ ...out.pay, status: 'succeeded' }), receipt_number: out.done.receipt, unallocated_minor: out.done.unallocated };
  }

  /** Marks the payment succeeded, allocates it to the oldest installments, updates the invoice and issues the receipt. Runs inside the caller's transaction. */
  private async confirm(q: Q, pay: any) {
    const inst = await q('SELECT id, seq, due_on::text AS due_on, amount_minor::bigint AS amount_minor, paid_minor::bigint AS paid_minor FROM installments WHERE invoice_id = $1 ORDER BY seq FOR UPDATE', [pay.invoice_id]);
    const list: (Installment & { id: string })[] = inst.map((i: any) => ({ id: i.id, seq: i.seq, due_on: i.due_on, amount_minor: Number(i.amount_minor), paid_minor: Number(i.paid_minor) }));
    const { allocations, unallocated } = allocatePayment(list, Number(pay.amount_minor));
    for (const a of allocations) { const row = list.find((i) => i.seq === a.seq)!; row.paid_minor = (row.paid_minor ?? 0) + a.amount_minor; await q('UPDATE installments SET paid_minor = $1 WHERE id = $2', [row.paid_minor, row.id]); }
    const status = invoiceStatus(list, today());
    await q('UPDATE invoices SET status = $1 WHERE id = $2', [status, pay.invoice_id]);
    await q("UPDATE payments SET status = 'succeeded', confirmed_at = NOW() WHERE id = $1", [pay.id]);
    await q('SELECT pg_advisory_xact_lock(hashtext($1))', [`receipt-no-${pay.tenant_id}`]);
    const n = Number((await q('SELECT COUNT(*)::int AS n FROM receipts'))[0].n) + 1;
    const receipt = `REC-${new Date().getUTCFullYear()}-${String(n).padStart(5, '0')}`;
    await q('INSERT INTO receipts(payment_id, number) VALUES ($1,$2)', [pay.id, receipt]);
    return { receipt, unallocated, status, amount: Number(pay.amount_minor), currency: pay.currency as string, paymentId: pay.id as string };
  }
  private async afterConfirm(slug: string, d: { receipt: string; unallocated: number; amount: number; currency: string; paymentId: string }, studentId: string, actor: string | null) {
    await this.audit.log({ actorId: actor ?? 'webhook', tenant: slug, action: 'payment.confirm', entity: 'payment', entityId: d.paymentId, details: { receipt: d.receipt, unallocated_minor: d.unallocated } });
    await this.notif.notifyFamily(slug, studentId, 'payment.confirmed', { amount: formatMoney(d.amount, d.currency) }, { payment_id: d.paymentId });
  }

  // ---- provider webhook (idempotent) -----------------------------------------------------------------------------
  /** Same code path for real providers and the sandbox. Safe to receive twice: the event id is unique, and a payment is confirmed once. */
  async handleWebhook(slug: string, providerCode: string, raw: string, headers: Record<string, string | undefined>) {
    this.requireEnabled(slug);
    let ev; try { ev = this.providers.get(providerCode).parseWebhook(raw, headers); } catch (e) { throw new ForbiddenException((e as Error).message); }
    const out = await this.tx(slug, async (q) => {
      const fresh = await q('INSERT INTO payment_events(provider, event_id, payload) VALUES ($1,$2,$3) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id', [providerCode, ev.eventId, raw]);
      if (!fresh.length) return { result: { duplicate: true } as Record<string, unknown>, done: null, studentId: '' };
      const pay = (await q('SELECT * FROM payments WHERE provider = $1 AND provider_ref = $2 FOR UPDATE', [providerCode, ev.providerRef]))[0];
      if (!pay) return { result: { ignored: 'unknown payment' }, done: null, studentId: '' };
      if (pay.status !== 'pending') return { result: { ignored: `already ${pay.status}` }, done: null, studentId: '' };
      if (ev.status === 'failed') { await q("UPDATE payments SET status = 'failed' WHERE id = $1", [pay.id]); return { result: { status: 'failed' }, done: null, studentId: '' }; }
      if (ev.amountMinor !== undefined && ev.amountMinor !== Number(pay.amount_minor)) return { result: { ignored: 'amount mismatch' }, done: null, studentId: '' };
      const done = await this.confirm(q, pay);
      const studentId = (await q('SELECT student_id FROM invoices WHERE id = $1', [pay.invoice_id]))[0].student_id as string;
      return { result: { status: 'succeeded', receipt: done.receipt }, done, studentId };
    });
    if (out.done) await this.afterConfirm(slug, out.done, out.studentId, null);
    return out.result;
  }
  /** Sandbox only: plays the role of the provider (signed event through the real webhook path). */
  async sandboxConfirm(slug: string, p: Principal, paymentId: string, b: any) {
    if (process.env.PAYMENT_MODE === 'live') throw new ForbiddenException('sandbox confirmation is disabled in live mode');
    const pay = await this.tx(slug, async (q) => (await q('SELECT p.*, i.student_id FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE p.id = $1', [uuid(paymentId, 'id')]))[0]);
    if (!pay) throw new NotFoundException('payment not found');
    this.canSee(p, slug, pay.student_id);
    if (!String(pay.provider_ref).startsWith('sbx_')) throw new BadRequestException('not a sandbox payment');
    const outcome = b?.outcome === 'failed' ? 'failed' : 'succeeded';
    const e = SandboxProvider.signedEvent(pay.provider_ref, outcome, Number(pay.amount_minor), b?.event_id ? str(b.event_id, 'event_id', 80) : undefined);
    return this.handleWebhook(slug, pay.provider, e.body, e.headers);
  }

  // ---- cash QR, receipts ---------------------------------------------------------------------------------------------
  private cashSig(id: string, exp: number) { return createHmac('sha256', this.secret()).update(`cash.${id}.${exp}`).digest('hex'); }
  private verifyCashToken(token: string, invoiceId: string): boolean {
    const [id, expS, sig] = token.split('.'); const exp = Number(expS);
    if (id !== invoiceId || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000) || !sig) return false;
    const a = Buffer.from(sig, 'hex'), b = Buffer.from(this.cashSig(id, exp), 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }
  async cashQr(slug: string, p: Principal, invoiceId: string) {
    const inv = await this.getInvoice(slug, p, invoiceId);
    const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
    const token = `${inv.id}.${exp}.${this.cashSig(inv.id, exp)}`;
    return { token, qr: await QRCode.toDataURL(token), expires_at: new Date(exp * 1000).toISOString() };
  }
  async receipt(slug: string, p: Principal, paymentId: string, locale = 'fr') {
    this.requireEnabled(slug);
    const r = await this.tx(slug, async (q, t) => {
      const row = (await q(`SELECT pay.*, r.number AS receipt_number, r.issued_at, i.number AS invoice_number, i.student_id, s.first_name, s.last_name, ten.name AS school
        FROM payments pay JOIN receipts r ON r.payment_id = pay.id JOIN invoices i ON i.id = pay.invoice_id JOIN students s ON s.id = i.student_id JOIN public.tenants ten ON ten.slug = $2 WHERE pay.id = $1`, [uuid(paymentId, 'id'), t.slug]))[0];
      if (!row) throw new NotFoundException('receipt not found');
      const inv = (await this.loadInvoices(q, 'WHERE i.id = $1', [row.invoice_id]))[0];
      return { row, outstanding: inv.outstanding_minor as number };
    });
    this.canSee(p, slug, r.row.student_id);
    const row = r.row;
    return receiptPdf({ school: row.school, number: row.receipt_number, date: new Date(row.issued_at).toISOString().slice(0, 10), student: `${row.first_name} ${row.last_name}`, invoice: row.invoice_number,
      method: row.method, amount: formatMoney(Number(row.amount_minor), row.currency, locale), balance: formatMoney(r.outstanding, row.currency, locale), locale });
  }

  // ---- back office -------------------------------------------------------------------------------------------------------
  /** Daily job (also callable by the accounting office). Exact day offsets + last_reminder_on make it safe to run several times a day. */
  async runReminders(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'billing:write');
    const day = b?.today ? date(b.today, 'today') : today();
    const rule = { ...DEFAULT_REMINDER_RULE, ...((this.modules.registry.config(slug, PAYMENT_MODULE).reminder_rule as Partial<ReminderRule>) ?? {}) };
    const due = await this.tx(slug, async (q) => {
      const rows = await q(`SELECT x.id, x.seq, x.due_on::text AS due_on, x.amount_minor::bigint AS amount_minor, x.paid_minor::bigint AS paid_minor, i.student_id, i.number, i.currency, x.last_reminder_on::text AS last
        FROM installments x JOIN invoices i ON i.id = x.invoice_id WHERE i.status <> 'cancelled' AND x.paid_minor < x.amount_minor`);
      const out: { id: string; studentId: string; text: string }[] = [];
      for (const r of rows) {
        if (r.last === day) continue;
        const d = remindersDue([{ seq: r.seq, due_on: r.due_on, amount_minor: Number(r.amount_minor), paid_minor: Number(r.paid_minor) }], day, rule)[0];
        if (!d) continue;
        out.push({ id: r.id, studentId: r.student_id, text: `${r.number} #${r.seq} — ${formatMoney(d.open_minor, r.currency)} (${d.kind === 'before' ? `J-${d.days}` : `J+${d.days}`})` });
        await q('UPDATE installments SET last_reminder_on = $1 WHERE id = $2', [day, r.id]);
      }
      await q(`UPDATE invoices i SET status = 'overdue' WHERE i.status IN ('open','partial') AND EXISTS (SELECT 1 FROM installments x WHERE x.invoice_id = i.id AND x.paid_minor < x.amount_minor AND x.due_on < $1::date)`, [day]);
      return out;
    });
    for (const d of due) await this.notif.notifyFamily(slug, d.studentId, 'payment.reminder', { text: d.text });
    return { sent: due.length };
  }
  async reconcileStatement(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'billing:write');
    if (!Array.isArray(b?.lines) || b.lines.length > 5000) throw new BadRequestException('lines: array of at most 5000');
    const lines = b.lines.map((l: any) => ({ ref: str(l.ref, 'ref', 120), amount_minor: Math.round(num(l.amount_minor, 'amount_minor', 0, 1e15)) }));
    const booked = await this.tx(slug, (q) => q('SELECT provider_ref, amount_minor::bigint AS amount_minor, status FROM payments'));
    return reconcile(lines, booked.map((x: any) => ({ provider_ref: x.provider_ref, amount_minor: Number(x.amount_minor), status: x.status })));
  }
  async stats(slug: string, p: Principal) {
    this.requireEnabled(slug); this.authorize(p, slug, 'billing:read');
    return this.tx(slug, async (q) => {
      const invs = await this.loadInvoices(q, '', []);
      const byMethod = await q("SELECT method, COUNT(*)::int AS payments, SUM(amount_minor)::bigint AS total FROM payments WHERE status = 'succeeded' GROUP BY method");
      return { ...recoveryStats(invs.map((i: any) => ({ net_minor: i.net_minor, paid_minor: i.paid_minor, status: i.status }))), by_method: byMethod.map((m: any) => ({ method: m.method, payments: m.payments, total: Number(m.total) })) };
    });
  }
}
