export interface Slot { classId: string; subjectId: string; teacherId: string; roomId?: string | null; day: number; period: number }
export interface Conflict { kind: 'teacher' | 'room' | 'class'; id: string; day: number; period: number; slotIndexes: number[] }

/** Business rules 6.5: one teacher, one room and one class cannot be in two places at once. */
export function detectConflicts(slots: Slot[]): Conflict[] {
  const seen = new Map<string, number[]>();
  const add = (kind: string, id: string | null | undefined, s: Slot, i: number) => {
    if (!id) return;
    const k = `${kind}|${id}|${s.day}|${s.period}`;
    const a = seen.get(k); if (a) a.push(i); else seen.set(k, [i]);
  };
  slots.forEach((s, i) => { add('teacher', s.teacherId, s, i); add('room', s.roomId, s, i); add('class', s.classId, s, i); });
  const out: Conflict[] = [];
  for (const [k, idx] of seen) {
    if (idx.length < 2) continue;
    const [kind, id, day, period] = k.split('|');
    out.push({ kind: kind as Conflict['kind'], id, day: Number(day), period: Number(period), slotIndexes: idx });
  }
  return out;
}

/** Would adding `s` to `slots` create a conflict? (used by drag and drop and substitutions) */
export function conflictsWith(slots: Slot[], s: Slot): Conflict[] {
  return detectConflicts([...slots, s]).filter((c) => c.slotIndexes.includes(slots.length));
}

export interface Requirement { classId: string; subjectId: string; teacherId: string; hours: number }
export interface GenInput {
  requirements: Requirement[];
  rooms: string[];
  days: number[];
  periodsPerDay: number;
  teacherUnavailable?: Record<string, { day: number; period: number }[]>;
  maxPerDaySubject?: number;
  nodeLimit?: number;
}
export interface GenResult { slots: Slot[]; unplaced: { classId: string; subjectId: string; remaining: number }[]; complete: boolean }

/** Constraint-based generation: ordered backtracking (hardest teachers first), spreading a subject over the week. */
export function generateTimetable(inp: GenInput): GenResult {
  const maxPerDay = inp.maxPerDaySubject ?? 2;
  const load = new Map<string, number>();
  for (const r of inp.requirements) load.set(r.teacherId, (load.get(r.teacherId) ?? 0) + r.hours);
  const reqs = [...inp.requirements].sort((a, b) => (load.get(b.teacherId)! - load.get(a.teacherId)!) || a.classId.localeCompare(b.classId) || a.subjectId.localeCompare(b.subjectId));
  const sessions: { r: Requirement; n: number }[] = [];
  for (const r of reqs) for (let n = 0; n < r.hours; n++) sessions.push({ r, n });

  const busy = { teacher: new Set<string>(), klass: new Set<string>(), room: new Set<string>() };
  const perDay = new Map<string, number>();
  const unavailable = new Set<string>();
  for (const [t, list] of Object.entries(inp.teacherUnavailable ?? {})) for (const u of list) unavailable.add(`${t}|${u.day}|${u.period}`);
  const placed: Slot[] = [];
  let best: Slot[] = [];
  let nodes = 0;
  const limit = inp.nodeLimit ?? 200000;

  const candidates = (idx: number) => {
    const { r, n } = sessions[idx];
    const out: { day: number; period: number; score: number }[] = [];
    inp.days.forEach((day, di) => {
      const sub = perDay.get(`${r.classId}|${r.subjectId}|${day}`) ?? 0;
      if (sub >= maxPerDay) return;
      for (let period = 0; period < inp.periodsPerDay; period++) {
        if (busy.teacher.has(`${r.teacherId}|${day}|${period}`) || busy.klass.has(`${r.classId}|${day}|${period}`)) continue;
        if (unavailable.has(`${r.teacherId}|${day}|${period}`)) continue;
        // prefer days where the subject is absent, rotating the preferred day per session
        const rot = (di - n + inp.days.length * 10) % inp.days.length;
        out.push({ day, period, score: sub * 1000 + rot * 10 + period });
      }
    });
    return out.sort((a, b) => a.score - b.score);
  };

  const dfs = (idx: number): boolean => {
    if (idx > best.length && placed.length > best.length) best = placed.slice();
    if (idx === sessions.length) return true;
    if (++nodes > limit) return false;
    const { r } = sessions[idx];
    for (const c of candidates(idx)) {
      let room: string | null = null;
      if (inp.rooms.length) {
        room = inp.rooms.find((x) => !busy.room.has(`${x}|${c.day}|${c.period}`)) ?? null;
        if (!room) continue;
      }
      const kT = `${r.teacherId}|${c.day}|${c.period}`, kC = `${r.classId}|${c.day}|${c.period}`, kR = room ? `${room}|${c.day}|${c.period}` : '';
      const kD = `${r.classId}|${r.subjectId}|${c.day}`;
      busy.teacher.add(kT); busy.klass.add(kC); if (kR) busy.room.add(kR); perDay.set(kD, (perDay.get(kD) ?? 0) + 1);
      placed.push({ classId: r.classId, subjectId: r.subjectId, teacherId: r.teacherId, roomId: room, day: c.day, period: c.period });
      if (dfs(idx + 1)) return true;
      placed.pop(); busy.teacher.delete(kT); busy.klass.delete(kC); if (kR) busy.room.delete(kR); perDay.set(kD, perDay.get(kD)! - 1);
      if (nodes > limit) return false;
    }
    return false;
  };

  const ok = dfs(0);
  const slots = ok ? placed.slice() : best;
  const remaining = new Map<string, number>();
  for (const r of inp.requirements) remaining.set(`${r.classId}|${r.subjectId}`, r.hours);
  for (const s of slots) remaining.set(`${s.classId}|${s.subjectId}`, remaining.get(`${s.classId}|${s.subjectId}`)! - 1);
  const unplaced = [...remaining].filter(([, v]) => v > 0).map(([k, v]) => ({ classId: k.split('|')[0], subjectId: k.split('|')[1], remaining: v }));
  return { slots, unplaced, complete: unplaced.length === 0 };
}

export interface ICalInput {
  slots: Slot[];
  periodTimes: { start: string; end: string }[];   // "HH:MM" per period index
  firstMonday: string;                             // YYYY-MM-DD of the Monday of the first week
  until: string;                                   // YYYY-MM-DD last day of the term
  timezone: string;                                // e.g. Africa/Libreville
  label: (s: Slot) => string;
}

const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
const fold = (l: string) => (l.length <= 75 ? l : l.match(/.{1,74}/g)!.join('\r\n '));

/** iCalendar export (spec 6.5): weekly recurring events until the end of the term. */
export function exportICal(i: ICalInput): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//EcoleManager Pro//EDT//FR', 'CALSCALE:GREGORIAN'];
  const base = new Date(`${i.firstMonday}T00:00:00Z`);
  i.slots.forEach((s, idx) => {
    const t = i.periodTimes[s.period];
    if (!t) return;
    const d = new Date(base.getTime() + (s.day - 1) * 86400000);
    const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
    const hm = (x: string) => x.replace(':', '') + '00';
    lines.push('BEGIN:VEVENT', `UID:slot-${idx}-${s.classId}-${s.day}-${s.period}@ecolemanager`,
      `DTSTAMP:${ymd}T000000Z`,
      `DTSTART;TZID=${i.timezone}:${ymd}T${hm(t.start)}`, `DTEND;TZID=${i.timezone}:${ymd}T${hm(t.end)}`,
      `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[s.day - 1]};UNTIL=${i.until.replace(/-/g, '')}T235959Z`,
      `SUMMARY:${esc(i.label(s))}`, 'END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
