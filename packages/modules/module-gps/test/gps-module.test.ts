import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../src/index.ts';

test('new students are not tracked until consent; retention is validated', () => {
  assert.deepEqual(handlers.defaultRetention({}, { tenantId: 't', config: { retention_days: 45 } }), { tracking: 'off_until_consent', retention_days: 45 });
  assert.deepEqual(handlers.defaultRetention({}, { tenantId: 't', config: {} }), { tracking: 'off_until_consent', retention_days: 30 });
  assert.throws(() => handlers.defaultRetention({}, { tenantId: 't', config: { retention_days: 0 } }));
});
