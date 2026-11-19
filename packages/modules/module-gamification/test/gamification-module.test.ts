import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../src/index.ts';

test('exam XP is computed from the configured rules', () => {
  const r = handlers.awardExamXp({ studentId: 's', examId: 'e', score100: 100 }, { tenantId: 't', config: { xp_rules: { examBase: 40 } } }) as any;
  assert.deepEqual(r, { studentId: 's', source: 'exam', ref: 'e', xp: 40 });
});
