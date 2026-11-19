import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../src/index.ts';

const config = { weights: { academic: 1, physical: 1, adaptability: 1, social_contribution: 0.5 }, thresholds: { warning: 50, penalty: 40 },
  initial_axes: { academic: 50, physical: 50, adaptability: 50, social_contribution: 50 } };
const ctx = { tenantId: 't', config };

test('initial OAA uses the configured initial axes', () => {
  const r = handlers.calculateInitialOAA({ studentId: 's' }, ctx) as any;
  assert.equal(r.score100, 50); assert.equal(r.alert, 'ok');
});
test('spec example: 80,70,75,60 -> 73', () => {
  const r = handlers.recalculateOAA({ studentId: 's', axes: { academic: 80, physical: 70, adaptability: 75, social_contribution: 60 } }, ctx) as any;
  assert.equal(r.score100, 73);
});
test('alert thresholds: 45 -> warning, 35 -> penalty', () => {
  const a = (v: number) => (handlers.updateOAA({ studentId: 's', axes: { academic: v, physical: v, adaptability: v, social_contribution: v } }, ctx) as any).alert;
  assert.equal(a(45), 'warning'); assert.equal(a(35), 'penalty'); assert.equal(a(50), 'ok');
});
test('level profile (primary) overrides the weights and recalculation needs axes', () => {
  const r = handlers.recalculateOAA({ studentId: 's', profile: { academic: 1, social_contribution: 0.5, creativity: 1 }, axes: { academic: 60, social_contribution: 60, creativity: 60 } }, ctx) as any;
  assert.equal(r.score100, 60);
  assert.throws(() => handlers.recalculateOAA({ studentId: 's' }, ctx));
});
