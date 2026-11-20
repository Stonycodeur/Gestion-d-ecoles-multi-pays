import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minorDigits, toMinor, fromMinor, formatMoney, applyDiscounts, splitInstallments, allocatePayment, invoiceStatus, remindersDue, signWebhook, verifyWebhook,
  reconcile, recoveryStats, inWindow, trackingAllowed, haversineM, acceptPosition, evaluateGeofences, purgeCutoff, reportIntervalSec } from '../src/index.ts';
import type { ConsentWindow, Geofence } from '../src/index.ts';

test('currency decimals come from ICU: XAF has none, EUR has two', () => {
  assert.equal(minorDigits('XAF'), 0); assert.equal(minorDigits('EUR'), 2);
  assert.equal(toMinor(150000, 'XAF'), 150000); assert.equal(toMinor(12.5, 'EUR'), 1250); assert.equal(fromMinor(1250, 'EUR'), 12.5);
  assert.match(formatMoney(150000, 'XAF', 'fr'), /150\s?000/);
  assert.throws(() => toMinor(-1, 'XAF'));
});
test('discounts: percent + fixed, capped at the base', () => {
  assert.deepEqual(applyDiscounts(100000, [{ type: 'percent', value: 10 }, { type: 'fixed', value: 5000 }]), { discountMinor: 15000, netMinor: 85000 });
  assert.equal(applyDiscounts(1000, [{ type: 'fixed', value: 5000 }]).netMinor, 0);
  assert.throws(() => applyDiscounts(1000, [{ type: 'percent', value: 101 }]));
});
test('installments: exact sum, end-of-month safe, bounds', () => {
  const s = splitInstallments(100000, 3, '2026-10-31');
  assert.deepEqual(s.map((i) => i.amount_minor), [33334, 33333, 33333]); assert.equal(s.reduce((a, i) => a + i.amount_minor, 0), 100000);
  assert.deepEqual(s.map((i) => i.due_on), ['2026-10-31', '2026-11-30', '2026-12-31']);
  assert.throws(() => splitInstallments(10, 0, '2026-10-01'));
});
test('payment allocation: oldest first, overpayment reported', () => {
  const inst = splitInstallments(90000, 3, '2026-10-01');
  assert.deepEqual(allocatePayment(inst, 40000), { allocations: [{ seq: 1, amount_minor: 30000 }, { seq: 2, amount_minor: 10000 }], unallocated: 0 });
  inst[0]!.paid_minor = 30000;
  assert.deepEqual(allocatePayment(inst, 70000).allocations.map((a) => a.seq), [2, 3]);
  assert.equal(allocatePayment(inst, 70000).unallocated, 10000);
});
test('invoice status', () => {
  const inst = splitInstallments(60000, 2, '2026-10-01');
  assert.equal(invoiceStatus(inst, '2026-09-01'), 'open');
  assert.equal(invoiceStatus(inst, '2026-10-15'), 'overdue');
  inst[0]!.paid_minor = 30000; assert.equal(invoiceStatus(inst, '2026-10-02'), 'partial');
  inst[1]!.paid_minor = 30000; assert.equal(invoiceStatus(inst, '2027-01-01'), 'paid');
  assert.equal(invoiceStatus(inst, '2026-01-01', true), 'cancelled');
});
test('reminders fire on exact day offsets only', () => {
  const inst = [{ seq: 1, due_on: '2026-10-10', amount_minor: 1000 }];
  assert.equal(remindersDue(inst, '2026-10-07').length, 1);
  assert.equal(remindersDue(inst, '2026-10-08').length, 0);
  assert.deepEqual(remindersDue(inst, '2026-10-17')[0], { seq: 1, kind: 'after', days: 7, open_minor: 1000 });
  assert.equal(remindersDue([{ ...inst[0]!, paid_minor: 1000 }], '2026-10-07').length, 0);
});
test('webhook signature: valid, tampered, replayed', () => {
  const body = '{"id":"evt_1"}', now = 1_800_000_000, sig = signWebhook('s3cret', now, body);
  assert.equal(verifyWebhook('s3cret', now, body, sig, now), true);
  assert.equal(verifyWebhook('s3cret', now, body + ' ', sig, now), false);
  assert.equal(verifyWebhook('other', now, body, sig, now), false);
  assert.equal(verifyWebhook('s3cret', now, body, sig, now + 3600), false);
  assert.equal(verifyWebhook('s3cret', now, body, 'zz', now), false);
  assert.equal(verifyWebhook('s3cret', now, body, sig + 'x', now), false);   // trailing garbage must not be ignored
});
test('reconciliation and recovery statistics', () => {
  const r = reconcile([{ ref: 'A', amount_minor: 100 }, { ref: 'B', amount_minor: 200 }, { ref: 'X', amount_minor: 5 }],
    [{ provider_ref: 'A', amount_minor: 100, status: 'succeeded' }, { provider_ref: 'B', amount_minor: 250, status: 'succeeded' }, { provider_ref: 'C', amount_minor: 9, status: 'succeeded' }, { provider_ref: 'D', amount_minor: 9, status: 'failed' }]);
  assert.deepEqual(r, { matched: ['A'], amountMismatch: [{ ref: 'B', bank: 200, booked: 250 }], missingInBooks: ['X'], missingInBank: ['C'] });
  assert.deepEqual(recoveryStats([{ net_minor: 1000, paid_minor: 1000, status: 'paid' }, { net_minor: 1000, paid_minor: 250, status: 'overdue' }, { net_minor: 500, paid_minor: 0, status: 'cancelled' }]),
    { billed: 2000, collected: 1250, outstanding: 750, rate: 62.5, overdue_count: 1 });
});

const W: ConsentWindow = { days: [1, 2, 3, 4, 5], start: '07:00', end: '18:00', timezone: 'Africa/Libreville' };   // UTC+1
const at = (iso: string) => Date.parse(iso);
test('consent window honours the school time zone and weekdays', () => {
  assert.equal(inWindow(W, at('2026-11-18T07:30:00Z')), true);    // Wed 08:30 local
  assert.equal(inWindow(W, at('2026-11-18T05:30:00Z')), false);   // Wed 06:30 local
  assert.equal(inWindow(W, at('2026-11-18T17:30:00Z')), false);   // Wed 18:30 local
  assert.equal(inWindow(W, at('2026-11-21T09:00:00Z')), false);   // Saturday
  const night: ConsentWindow = { days: [5], start: '22:00', end: '06:00', timezone: 'UTC' };
  assert.equal(inWindow(night, at('2026-11-20T23:00:00Z')), true);   // Fri 23:00
  assert.equal(inWindow(night, at('2026-11-21T02:00:00Z')), true);   // Sat 02:00 belongs to Friday's window
  assert.equal(inWindow(night, at('2026-11-22T02:00:00Z')), false);
});
test('tracking requires a granted, non-revoked consent inside the window', () => {
  const t = at('2026-11-18T07:30:00Z');
  assert.equal(trackingAllowed(null, t).allowed, false);
  assert.equal(trackingAllowed({ granted: false, window: W }, t).allowed, false);
  assert.equal(trackingAllowed({ granted: true, revoked_at: '2026-11-01', window: W }, t).reason, 'consent revoked');
  assert.equal(trackingAllowed({ granted: true, window: W }, at('2026-11-18T20:00:00Z')).reason, 'outside the agreed time window');
  assert.equal(trackingAllowed({ granted: true, window: W }, t).allowed, true);
});
test('haversine and position acceptance', () => {
  const d = haversineM({ lat: 0.3901, lng: 9.4544 }, { lat: 0.3901, lng: 9.4644 });
  assert.ok(d > 1100 && d < 1120, String(d));
  const now = 1_800_000_000_000;
  assert.equal(acceptPosition({ lat: 0, lng: 0, accuracy_m: 20, at_ms: now - 1000 }, now).ok, true);
  assert.equal(acceptPosition({ lat: 91, lng: 0, accuracy_m: 20, at_ms: now }, now).ok, false);
  assert.equal(acceptPosition({ lat: 0, lng: 0, accuracy_m: 500, at_ms: now }, now).reason, 'accuracy too low');
  assert.equal(acceptPosition({ lat: 0, lng: 0, accuracy_m: 5, at_ms: now - 3_600_000 }, now).reason, 'position too old');
  assert.equal(acceptPosition({ lat: 0, lng: 0, accuracy_m: 5, at_ms: now + 3_600_000 }, now).reason, 'position in the future');
});
test('geofencing emits arrival / exit / out_of_zone once per transition', () => {
  const school: Geofence = { id: 'school', kind: 'school', lat: 0.39, lng: 9.45, radius_m: 150, expected_in_window: true };
  const home: Geofence = { id: 'home', kind: 'home', lat: 0.40, lng: 9.47, radius_m: 100 };
  const P = (lat: number, lng: number) => ({ lat, lng, accuracy_m: 10, at_ms: 0 });
  let st = { inside: [] as string[], out_of_zone: false };
  let r = evaluateGeofences(st, P(0.5, 9.6), [school, home], true);                      // first fix far away: no incident
  assert.deepEqual(r.events, []); st = r.state;
  r = evaluateGeofences(st, P(0.39, 9.45), [school, home], true); assert.deepEqual(r.events, [{ type: 'arrival', geofence_id: 'school' }]); st = r.state;
  r = evaluateGeofences(st, P(0.39, 9.4501), [school, home], true); assert.deepEqual(r.events, []); st = r.state;     // still inside: silence
  r = evaluateGeofences(st, P(0.5, 9.6), [school, home], true);
  assert.deepEqual(r.events, [{ type: 'exit', geofence_id: 'school' }, { type: 'out_of_zone' }]); st = r.state;
  r = evaluateGeofences(st, P(0.51, 9.61), [school, home], true); assert.deepEqual(r.events, []); st = r.state;       // already flagged
  r = evaluateGeofences(st, P(0.39, 9.45), [school, home], true); assert.deepEqual(r.events, [{ type: 'arrival', geofence_id: 'school' }]);
  assert.equal(r.state.out_of_zone, false);
  r = evaluateGeofences({ inside: ['school'], out_of_zone: false }, P(0.5, 9.6), [school, home], false);               // outside the window: exit but no incident
  assert.deepEqual(r.events, [{ type: 'exit', geofence_id: 'school' }]);
});
test('retention cutoff and reporting interval', () => {
  assert.equal(purgeCutoff(30 * 86400000 + 5, 30), 5);
  assert.throws(() => purgeCutoff(0, 0));
  assert.equal(reportIntervalSec('school'), 30); assert.equal(reportIntervalSec('off'), null);
});
