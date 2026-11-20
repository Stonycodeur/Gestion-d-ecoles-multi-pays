import { createHmac, timingSafeEqual } from 'node:crypto';

/** Money is always integer MINOR units (centimes). The number of decimals of a currency comes from ICU (XAF/XOF: 0, EUR/USD: 2),
 *  never from a hard-coded country rule. */
export function minorDigits(currency: string): number {
  return new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
}
export function toMinor(amount: number, currency: string): number {
  if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Amount must be a non-negative number');
  return Math.round(amount * 10 ** minorDigits(currency));
}
export function fromMinor(minor: number, currency: string): number { return minor / 10 ** minorDigits(currency); }
export function formatMoney(minor: number, currency: string, locale = 'fr'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(fromMinor(minor, currency));
}

export interface Discount { type: 'percent' | 'fixed'; value: number; label?: string }
export function applyDiscounts(baseMinor: number, discounts: Discount[]): { discountMinor: number; netMinor: number } {
  if (!Number.isInteger(baseMinor) || baseMinor < 0) throw new RangeError('Base must be a non-negative integer (minor units)');
  let discount = 0;
  for (const d of discounts) {
    if (d.value < 0) throw new RangeError('Discount cannot be negative');
    if (d.type === 'percent') { if (d.value > 100) throw new RangeError('Percent discount over 100'); discount += Math.round(baseMinor * d.value / 100); }
    else discount += Math.round(d.value);
  }
  discount = Math.min(discount, baseMinor);
  return { discountMinor: discount, netMinor: baseMinor - discount };
}

export interface Installment { seq: number; due_on: string; amount_minor: number; paid_minor?: number }
function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}
/** Splits a total into `count` installments, monthly by default. The sum is exact: the remainder goes to the first installments. */
export function splitInstallments(totalMinor: number, count: number, firstDue: string, everyMonths = 1): Installment[] {
  if (!Number.isInteger(totalMinor) || totalMinor < 0) throw new RangeError('Total must be a non-negative integer');
  if (!Number.isInteger(count) || count < 1 || count > 36) throw new RangeError('Installment count must be 1..36');
  const base = Math.floor(totalMinor / count); let rest = totalMinor - base * count;
  return Array.from({ length: count }, (_, i) => {
    const extra = rest > 0 ? 1 : 0; rest -= extra;
    return { seq: i + 1, due_on: addMonths(firstDue, i * everyMonths), amount_minor: base + extra };
  });
}

/** Allocates a payment to the oldest unpaid installments first. */
export function allocatePayment(installments: Installment[], amountMinor: number): { allocations: { seq: number; amount_minor: number }[]; unallocated: number } {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) throw new RangeError('Payment must be a positive integer');
  let left = amountMinor; const allocations: { seq: number; amount_minor: number }[] = [];
  for (const i of [...installments].sort((a, b) => a.seq - b.seq)) {
    const open = i.amount_minor - (i.paid_minor ?? 0);
    if (open <= 0 || left <= 0) continue;
    const take = Math.min(open, left); allocations.push({ seq: i.seq, amount_minor: take }); left -= take;
  }
  return { allocations, unallocated: left };
}

export type InvoiceStatus = 'open' | 'partial' | 'paid' | 'overdue' | 'cancelled';
export function invoiceStatus(installments: Installment[], today: string, cancelled = false): InvoiceStatus {
  if (cancelled) return 'cancelled';
  const total = installments.reduce((a, i) => a + i.amount_minor, 0), paid = installments.reduce((a, i) => a + Math.min(i.paid_minor ?? 0, i.amount_minor), 0);
  if (total > 0 && paid >= total) return 'paid';
  if (installments.some((i) => (i.paid_minor ?? 0) < i.amount_minor && i.due_on < today)) return 'overdue';
  return paid > 0 ? 'partial' : 'open';
}

export interface ReminderRule { daysBefore: number[]; daysAfter: number[] }
export const DEFAULT_REMINDER_RULE: ReminderRule = { daysBefore: [3], daysAfter: [1, 7, 15] };
const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
/** Reminders due TODAY for unpaid installments (exact day offsets, so a daily job never sends the same one twice). */
export function remindersDue(installments: Installment[], today: string, rule: ReminderRule = DEFAULT_REMINDER_RULE): { seq: number; kind: 'before' | 'after'; days: number; open_minor: number }[] {
  const out: { seq: number; kind: 'before' | 'after'; days: number; open_minor: number }[] = [];
  for (const i of installments) {
    const open = i.amount_minor - (i.paid_minor ?? 0); if (open <= 0) continue;
    const d = dayDiff(i.due_on, today);               // > 0: due in d days ; < 0: overdue
    if (d > 0 && rule.daysBefore.includes(d)) out.push({ seq: i.seq, kind: 'before', days: d, open_minor: open });
    if (d < 0 && rule.daysAfter.includes(-d)) out.push({ seq: i.seq, kind: 'after', days: -d, open_minor: open });
  }
  return out;
}

/** Signed outgoing/incoming webhooks: HMAC-SHA256 over `${timestamp}.${body}`. */
export function signWebhook(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}
export function verifyWebhook(secret: string, timestamp: number, body: string, signature: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!Number.isFinite(timestamp) || Math.abs(nowSec - timestamp) > toleranceSec) return false;
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;   // Buffer.from(.., 'hex') silently truncates invalid input
  const expected = Buffer.from(signWebhook(secret, timestamp, body), 'hex'), given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface BankLine { ref: string; amount_minor: number }
export interface BookedPayment { provider_ref: string; amount_minor: number; status: string }
/** Bank statement vs recorded payments. Only `succeeded` payments are expected on the statement. */
export function reconcile(bank: BankLine[], booked: BookedPayment[]) {
  const ok = booked.filter((p) => p.status === 'succeeded'); const byRef = new Map(ok.map((p) => [p.provider_ref, p]));
  const matched: string[] = [], amountMismatch: { ref: string; bank: number; booked: number }[] = [], missingInBooks: string[] = [];
  for (const l of bank) {
    const p = byRef.get(l.ref);
    if (!p) { missingInBooks.push(l.ref); continue; }
    if (p.amount_minor !== l.amount_minor) amountMismatch.push({ ref: l.ref, bank: l.amount_minor, booked: p.amount_minor }); else matched.push(l.ref);
  }
  const bankRefs = new Set(bank.map((l) => l.ref));
  return { matched, amountMismatch, missingInBooks, missingInBank: ok.filter((p) => !bankRefs.has(p.provider_ref)).map((p) => p.provider_ref) };
}

export interface InvoiceSummary { net_minor: number; paid_minor: number; status: InvoiceStatus }
export function recoveryStats(invoices: InvoiceSummary[]) {
  const live = invoices.filter((i) => i.status !== 'cancelled');
  const billed = live.reduce((a, i) => a + i.net_minor, 0), collected = live.reduce((a, i) => a + Math.min(i.paid_minor, i.net_minor), 0);
  return { billed, collected, outstanding: billed - collected, rate: billed ? Math.round((collected / billed) * 1000) / 10 : 100,
    overdue_count: live.filter((i) => i.status === 'overdue').length };
}
