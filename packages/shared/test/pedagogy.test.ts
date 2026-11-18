import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectConflicts, conflictsWith, generateTimetable, exportICal, subjectAverages, generalAverage, rank, buildReportCard,
  attendanceStats, absenceAlert, socialAxisFromAttendance, toNormalized, classStats } from '../src/index.ts';
import type { Slot } from '../src/index.ts';
import { S20, S10, SLETTERS } from './fixtures.ts';

const sl = (o: Partial<Slot> & { day: number; period: number }): Slot => ({ classId: 'c1', subjectId: 's1', teacherId: 't1', roomId: 'r1', ...o });

test('conflict detection: teacher, room and class', () => {
  assert.deepEqual(detectConflicts([sl({ day: 1, period: 0 }), sl({ day: 1, period: 1 })]), []);
  const c = detectConflicts([sl({ day: 1, period: 0 }), sl({ day: 1, period: 0, classId: 'c2', roomId: 'r2' })]);
  assert.deepEqual(c.map((x) => x.kind), ['teacher']);
  const r = detectConflicts([sl({ day: 1, period: 0 }), sl({ day: 1, period: 0, classId: 'c2', teacherId: 't2' })]);
  assert.deepEqual(r.map((x) => x.kind), ['room']);
  const k = detectConflicts([sl({ day: 1, period: 0 }), sl({ day: 1, period: 0, teacherId: 't2', roomId: 'r2' })]);
  assert.deepEqual(k.map((x) => x.kind), ['class']);
  assert.deepEqual(detectConflicts([sl({ day: 1, period: 0, roomId: null }), sl({ day: 1, period: 0, classId: 'c2', teacherId: 't2', roomId: null })]), []);
  assert.equal(conflictsWith([sl({ day: 2, period: 3 })], sl({ day: 2, period: 3, classId: 'c9', roomId: 'r9' })).length, 1);
});

test('generation: complete, conflict-free, respects availability and max per day', () => {
  const requirements = [
    { classId: 'A', subjectId: 'math', teacherId: 'tm', hours: 4 }, { classId: 'B', subjectId: 'math', teacherId: 'tm', hours: 4 },
    { classId: 'A', subjectId: 'fr', teacherId: 'tf', hours: 4 }, { classId: 'B', subjectId: 'fr', teacherId: 'tf', hours: 4 },
    { classId: 'A', subjectId: 'eps', teacherId: 'te', hours: 2 }, { classId: 'B', subjectId: 'eps', teacherId: 'te', hours: 2 },
  ];
  const teacherUnavailable = { tm: [{ day: 1, period: 0 }, { day: 1, period: 1 }] };
  const r = generateTimetable({ requirements, rooms: ['r1', 'r2'], days: [1, 2, 3, 4, 5], periodsPerDay: 6, teacherUnavailable });
  assert.equal(r.complete, true);
  assert.equal(r.slots.length, 20);
  assert.deepEqual(detectConflicts(r.slots), []);
  assert.equal(r.slots.some((s) => s.teacherId === 'tm' && s.day === 1 && s.period < 2), false);
  const perDay = new Map<string, number>();
  for (const s of r.slots) perDay.set(`${s.classId}${s.subjectId}${s.day}`, (perDay.get(`${s.classId}${s.subjectId}${s.day}`) ?? 0) + 1);
  assert.ok([...perDay.values()].every((n) => n <= 2));
});

test('generation: impossible demand is reported, never silently dropped', () => {
  const r = generateTimetable({ requirements: [{ classId: 'A', subjectId: 'm', teacherId: 't', hours: 5 }, { classId: 'B', subjectId: 'm', teacherId: 't', hours: 5 }], rooms: [], days: [1], periodsPerDay: 6, maxPerDaySubject: 6 });
  assert.equal(r.complete, false);
  assert.equal(r.slots.length, 6);
  assert.equal(r.unplaced.reduce((a, u) => a + u.remaining, 0), 4);
  assert.deepEqual(detectConflicts(r.slots), []);
});

test('iCal export', () => {
  const ics = exportICal({ slots: [sl({ day: 2, period: 1 })], periodTimes: [{ start: '07:30', end: '08:25' }, { start: '08:30', end: '09:25' }], firstMonday: '2026-10-05', until: '2027-06-30', timezone: 'Africa/Libreville', label: () => 'Maths, 2nde A' });
  assert.match(ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;TZID=Africa\/Libreville:20261006T083000/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=TU;UNTIL=20270630T235959Z/);
  assert.match(ics, /SUMMARY:Maths\\, 2nde A/);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

test('averages: evaluation coefs inside subject, subject coefs for the general average', () => {
  const g = [
    { subjectId: 'math', evaluationCoef: 1, normalized: toNormalized(10, S20) }, { subjectId: 'math', evaluationCoef: 2, normalized: toNormalized(16, S20) },
    { subjectId: 'fr', evaluationCoef: 1, normalized: toNormalized(12, S20) },
  ];
  const sa = subjectAverages(g);
  assert.equal(Math.round(sa.math * 100) / 100, 70);          // (10*1 + 16*2)/3 = 14 -> 70
  assert.equal(sa.fr, 60);
  const gen = generalAverage(sa, { math: 4, fr: 3 })!;
  assert.equal(Math.round(gen * 100) / 100, 65.71);            // (70*4 + 60*3)/7
  assert.equal(generalAverage({}, {}), null);
  assert.deepEqual(classStats([50, 70, 90]), { min: 50, max: 90, mean: 70 });
});

test('ranking uses competition ranking and skips missing averages', () => {
  const r = rank([{ id: 'a', avg: 80 }, { id: 'b', avg: 70 }, { id: 'c', avg: 70.001 }, { id: 'd', avg: 60 }, { id: 'e', avg: null }]);
  assert.deepEqual(r.map((x) => x.rank), [1, 2, 2, 4, null]);
});

test('report card is displayed in the active scale (/20, /10, letters)', () => {
  const grades = [{ subjectId: 'math', evaluationCoef: 1, normalized: 73 }];
  const coefs = { math: 4 };
  assert.equal(buildReportCard({ grades, subjectCoefs: coefs, scale: S20 }).general?.text, '14,6/20');
  assert.equal(buildReportCard({ grades, subjectCoefs: coefs, scale: S10 }).general?.text, '7,3/10');
  assert.equal(buildReportCard({ grades, subjectCoefs: coefs, scale: SLETTERS }).lines[0].average.text, 'B');
  assert.equal(buildReportCard({ grades: [], subjectCoefs: {}, scale: S20 }).general, null);
});

test('absences: stats, alert thresholds, impact on the social axis', () => {
  const s = attendanceStats([
    { kind: 'absence', status: 'justified' }, { kind: 'absence', status: 'unjustified' }, { kind: 'absence', status: 'rejected' },
    { kind: 'absence', status: 'pending' }, { kind: 'late', status: 'unjustified' },
  ]);
  assert.deepEqual(s, { absences: 4, unjustified: 2, justified: 1, pending: 1, lates: 1 });
  assert.equal(absenceAlert(s), 'ok');
  assert.equal(absenceAlert({ ...s, unjustified: 3 }), 'warning');
  assert.equal(absenceAlert({ ...s, unjustified: 5 }), 'critical');
  assert.equal(socialAxisFromAttendance(s), 100 - (2 * 5 + 1));
  assert.equal(socialAxisFromAttendance({ ...s, unjustified: 50 }), 70);   // capped
  assert.equal(socialAxisFromAttendance({ absences: 3, unjustified: 0, justified: 3, pending: 0, lates: 0 }), 100);
});
