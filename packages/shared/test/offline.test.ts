import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReplay, resolveConflict, mergeAttendance, replayOrder } from '../src/index.ts';

test('replay verdicts: transient failures are kept, only definitive refusals are conflicts', () => {
  for (const s of [200, 201, 204]) assert.equal(classifyReplay(s), 'done');
  for (const s of [0, 401, 408, 425, 429, 500, 502, 503, 504]) assert.equal(classifyReplay(s), 'retry', String(s));
  for (const s of [400, 403, 404, 409, 413, 422]) assert.equal(classifyReplay(s), 'conflict', String(s));
});
test('conflict policy per data type', () => {
  const c = { role: 'teacher', clientAt: '2026-01-02T10:00:00Z', serverUpdatedAt: '2026-01-02T11:00:00Z' };
  assert.equal(resolveConflict('grade', c), 'client');                         // teacher wins even when older
  assert.equal(resolveConflict('grade', { ...c, role: 'admin' }), 'server');
  assert.equal(resolveConflict('absence', c), 'merge'); assert.equal(resolveConflict('message', c), 'merge');
  assert.equal(resolveConflict('lesson', c), 'server');                        // client older
  assert.equal(resolveConflict('lesson', { ...c, clientAt: '2026-01-02T12:00:00Z' }), 'client');
  assert.equal(resolveConflict('other', c), 'server');
  assert.equal(mergeAttendance('late', 'absence'), 'absence'); assert.equal(mergeAttendance('late', 'late'), 'late');
});
test('replay order: teacher grades first, stable inside a priority', () => {
  const ops = [{ n: 'a' }, { n: 'g1', priority: 10 }, { n: 'b' }, { n: 'g2', priority: 10 }];
  assert.deepEqual(replayOrder(ops).map((o) => o.n), ['g1', 'g2', 'a', 'b']);
});
