import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../src/index.ts';

test('a new grade marks the student for re-scoring, nothing else', () => {
  assert.deepEqual(handlers.markForRescore({ studentIds: ['a', 'b'] }, { tenantId: 't', config: {} }), { stale: ['a', 'b'] });
});
