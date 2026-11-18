import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ModuleRegistry, validateManifest } from '../../../shared/src/modules.ts';
import { handlers } from '../src/index.ts';

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('module-oaa manifest is valid and loads without touching the core', async () => {
  assert.deepEqual(validateManifest(manifest), []);
  const reg = new ModuleRegistry('0.1.0');
  reg.register(manifest, handlers);
  reg.enable('t1', 'module-oaa');
  const axes = { academic: 80, physical: 70, adaptability: 75, social_contribution: 60 };
  const r = await reg.emit('t1', 'onGradeSubmitted', { studentId: 's1', axes });
  assert.equal(r.length, 1);
  assert.equal(r[0].ok, true);
  assert.equal((r[0].value as { score100: number }).score100, 73);
  assert.equal((r[0].value as { alert: string }).alert, 'ok');
});

test('per-tenant config overrides weights and thresholds', async () => {
  const reg = new ModuleRegistry('0.1.0');
  reg.register(manifest, handlers);
  reg.enable('t2', 'module-oaa', { weights: { academic: 1, physical: 1, adaptability: 1, social_contribution: 1 }, thresholds: { warning: 80, penalty: 40 } });
  const r = await reg.emit('t2', 'onExamCompleted', { studentId: 's', axes: { academic: 80, physical: 70, adaptability: 75, social_contribution: 60 } });
  assert.equal((r[0].value as { score100: number }).score100, 71);
  assert.equal((r[0].value as { alert: string }).alert, 'warning');
});

test('initial OAA on student creation, disabled module is silent', async () => {
  const reg = new ModuleRegistry('0.1.0');
  reg.register(manifest, handlers);
  assert.equal((await reg.emit('t3', 'onStudentCreated', { studentId: 's' })).length, 0);
  reg.enable('t3', 'module-oaa');
  const r = await reg.emit('t3', 'onStudentCreated', { studentId: 's' });
  assert.equal((r[0].value as { score100: number }).score100, 50);
});
