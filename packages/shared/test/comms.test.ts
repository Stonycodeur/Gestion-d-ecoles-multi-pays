import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { canMessage, refusedRecipients, substitutionProblems, isoWeekday, teacherWorkload, buildNotification, encryptText, decryptText, can } from '../src/index.ts';
import type { Party, Slot, Principal } from '../src/index.ts';

const teacher: Party = { userId: 't1', role: 'teacher', classIds: ['c1'] };
const otherTeacher: Party = { userId: 't2', role: 'teacher', classIds: ['c2'] };
const student: Party = { userId: 's1', role: 'student', studentId: 'st1', classIds: ['c1'] };
const mate: Party = { userId: 's2', role: 'student', studentId: 'st2', classIds: ['c1'] };
const stranger: Party = { userId: 's3', role: 'student', studentId: 'st3', classIds: ['c2'] };
const parent: Party = { userId: 'p1', role: 'guardian', childIds: ['st1'], childClassIds: ['c1'] };
const head: Party = { userId: 'h1', role: 'head' };

test('messaging table 6.9: parent', () => {
  assert.equal(canMessage(parent, student), true);          // own child
  assert.equal(canMessage(parent, mate), false);            // someone else's child
  assert.equal(canMessage(parent, teacher), true);          // teacher of own child
  assert.equal(canMessage(parent, otherTeacher), false);
  assert.equal(canMessage(parent, head), true);
  assert.equal(canMessage(parent, { ...parent, userId: 'p2' }), false);   // no parent-to-parent
});

test('messaging table 6.9: teacher', () => {
  assert.equal(canMessage(teacher, student), true);
  assert.equal(canMessage(teacher, stranger), false);
  assert.equal(canMessage(teacher, parent), true);
  assert.equal(canMessage(teacher, head), true);
  assert.equal(canMessage(teacher, otherTeacher), false);
});

test('messaging table 6.9: student, peers are an option', () => {
  assert.equal(canMessage(student, teacher), true);
  assert.equal(canMessage(student, otherTeacher), false);
  assert.equal(canMessage(student, mate), false);
  assert.equal(canMessage(student, mate, { allowStudentPeers: true }), true);
  assert.equal(canMessage(student, stranger, { allowStudentPeers: true }), false);   // other class
  assert.equal(canMessage(student, parent), false);
  assert.equal(canMessage(student, head), false);
});

test('messaging table 6.9: direction writes to everyone; nobody writes to self; accountant and assistant limits', () => {
  for (const p of [teacher, student, parent, otherTeacher]) assert.equal(canMessage(head, p), true);
  assert.equal(canMessage(head, head), false);
  assert.equal(canMessage({ userId: 'a', role: 'accountant' }, parent), true);
  assert.equal(canMessage({ userId: 'a', role: 'accountant' }, student), false);
  assert.equal(canMessage({ userId: 'e', role: 'education_assistant' }, student), true);
  assert.deepEqual(refusedRecipients(teacher, [student, stranger, parent]), ['s3']);
});

test('substitutions', () => {
  const published: Slot[] = [{ classId: 'c1', subjectId: 'm', teacherId: 'A', day: 2, period: 1 }, { classId: 'c2', subjectId: 'f', teacherId: 'B', day: 2, period: 1 }];
  assert.equal(isoWeekday('2026-11-17'), 2);   // Tuesday
  assert.deepEqual(substitutionProblems(published, published[0], '2026-11-17', 'C', []), []);
  assert.ok(substitutionProblems(published, published[0], '2026-11-18', 'C', []).length);                           // wrong weekday
  assert.ok(substitutionProblems(published, published[0], '2026-11-17', 'B', []).length);                           // busy elsewhere
  assert.ok(substitutionProblems(published, published[0], '2026-11-17', 'A', []).length);                           // is the titular
  assert.ok(substitutionProblems(published, published[0], '2026-11-17', 'C', [{ onDate: '2026-11-17', day: 2, period: 1, substituteId: 'C' }]).length);
});

test('workload', () => {
  assert.deepEqual(teacherWorkload(20, 24, 18), { assigned: 20, max: 24, remaining: 4, overload: false, contractHours: 18, belowContract: false });
  assert.equal(teacherWorkload(26, 24).overload, true);
  assert.equal(teacherWorkload(10, 24, 18).belowContract, true);
});

test('notifications are localized FR/EN/AR', () => {
  assert.equal(buildNotification('grade.published', 'fr', { subject: 'Maths', value: '14,6/20' }).title, 'Nouvelle note');
  assert.equal(buildNotification('grade.published', 'en', { subject: 'Maths', value: '14.6/20' }).body, 'Maths: 14.6/20');
  assert.equal(buildNotification('absence.recorded', 'fr', { kind: 'late' }).title, 'Retard signalé');
  assert.ok(buildNotification('schedule.published', 'ar').title.length > 0);
});

test('message encryption at rest: round trip, random IV, tamper detection, key size', () => {
  const key = randomBytes(32).toString('base64');
  const a = encryptText('Bonjour é', key), b = encryptText('Bonjour é', key);
  assert.notEqual(a, b);
  assert.equal(decryptText(a, key), 'Bonjour é');
  assert.throws(() => decryptText(a.slice(0, -2) + 'AA', key));
  assert.throws(() => decryptText(a, randomBytes(32).toString('base64')));
  assert.throws(() => encryptText('x', 'c2hvcnQ='));
  assert.equal(decryptText(encryptText('', key), key), '');
});

test('inspector: read-only on lessons and only until the expiry date', () => {
  const insp: Principal = { id: 'i', roles: ['inspector'], tenantId: 'T1', inspectorUntil: '2026-12-01T00:00:00Z' };
  const before = Date.parse('2026-11-20T00:00:00Z'), after = Date.parse('2026-12-02T00:00:00Z');
  assert.equal(can(insp, 'lessons:read', { tenantId: 'T1' }, before).allowed, true);
  assert.equal(can(insp, 'lessons:read', { tenantId: 'T1' }, after).allowed, false);
  assert.equal(can(insp, 'grades:read', { tenantId: 'T1' }, before).allowed, false);
  assert.equal(can(insp, 'lessons:write', { tenantId: 'T1' }, before).allowed, false);
  assert.equal(can({ ...insp, inspectorUntil: undefined }, 'lessons:read', { tenantId: 'T1' }, before).allowed, false);
});

import { externalChannelsFor, smsText } from '../src/index.ts';
test('SMS and e-mail are used only for the types that need them, when switched on and reachable', () => {
  const on = { sms: true, email: true };
  assert.deepEqual(externalChannelsFor('absence.recorded', on, { phone: '+241', email: 'a@b.c' }), ['sms', 'email']);
  assert.deepEqual(externalChannelsFor('absence.recorded', { sms: false, email: true }, { phone: '+241', email: 'a@b.c' }), ['email']);
  assert.deepEqual(externalChannelsFor('absence.recorded', on, { phone: null, email: 'a@b.c' }), ['email']);
  assert.deepEqual(externalChannelsFor('absence.recorded', on, {}), []);
  assert.deepEqual(externalChannelsFor('invoice.issued', on, { phone: '+241', email: 'a@b.c' }), ['email']);
  assert.deepEqual(externalChannelsFor('message.new', on, { phone: '+241', email: 'a@b.c' }), []);
});
test('SMS text fits one segment', () => {
  assert.equal(smsText('Absence', 'Ada absente le 2 nov.'), 'Absence: Ada absente le 2 nov.');
  assert.equal(smsText('T', 'x'.repeat(400)).length, 160);
});
