import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../src/index.ts';

const ctx = { tenantId: 't', config: {} };
test('enrolment invoice: discount then exact installment split', () => {
  const r = handlers.planInvoice({ feePlan: { amount_minor: 300000, installments: 3, first_due_on: '2026-10-01' }, discounts: [{ type: 'percent', value: 10 }] }, ctx) as any;
  assert.equal(r.invoice.net_minor, 270000); assert.deepEqual(r.invoice.installments.map((i: any) => i.amount_minor), [90000, 90000, 90000]);
});
test('no fee plan for the level: no invoice, no error', () => {
  assert.deepEqual(handlers.planInvoice({}, ctx), { invoice: null });
});
