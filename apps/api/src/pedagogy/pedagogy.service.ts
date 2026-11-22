import { Logger, BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { buildReportCard, can, detectConflicts, generateTimetable, exportICal, toNormalized, attendanceStats, absenceAlert,
  rank, subjectAverages, generalAverage, display, type GradingScale, type Principal, type Resource, type Slot } from '@ecolemanager/shared';
import { TenantDb, type Q } from './tenant-db.service';
import { ModulesService } from '../modules/modules.service';
import { AuditService } from '../core/audit.service';
import { date, mapDbError, num, optStr, str, uuid } from './validate';
import { reportPdf } from './pdf';
import { NotificationService } from '../comms/notification.service';
import { OaaService } from '../oaa/oaa.service';
import { PaymentsService } from '../payments/payments.service';

import { ACTIVE_SCALE_SQL, rowToScale } from './scale';
export { ACTIVE_SCALE_SQL, rowToScale };

import { WebhooksService } from '../publicapi/webhooks.service';
@Injectable()
export class PedagogyService {
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly audit: AuditService, private readonly notif: NotificationService, private readonly oaa: OaaService, private readonly payments: PaymentsService, private readonly webhooks: WebhooksService) {}

  authorize(p: Principal, tenant: string, perm: string, r: Resource = {}) {
    const d = can(p, perm, { tenantId: tenant, ...r });
    if (!d.allowed) throw new ForbiddenException(d.reason);
  }

  private async tx<T>(slug: string, fn: (q: Q, t: { id: string; slug: string; country: string; schoolType: string }) => Promise<T>): Promise<T> {
    try { return await this.db.run(slug, fn); } catch (e) { return mapDbError(e); }
  }

  // ---- reference data -------------------------------------------------------------------------------------------
  createClass(slug: string, b: any) {
    return this.tx(slug, async (q) => (await q('INSERT INTO classes(name, level_code, section, school_year) VALUES ($1,$2,$3,$4) RETURNING *',
      [str(b.name, 'name', 80), str(b.level_code, 'level_code', 20), optStr(b.section, 'section', 20), str(b.school_year, 'school_year', 20)]))[0]);
  }
  listClasses(slug: string) { return this.tx(slug, (q) => q('SELECT * FROM classes ORDER BY name')); }
  createSubject(slug: string, b: any) {
    const category = b.category ?? 'academic';
    if (!['academic', 'physical', 'creativity', 'research', 'professional', 'orientation'].includes(category)) throw new BadRequestException('invalid subject category');
    return this.tx(slug, async (q) => (await q('INSERT INTO subjects(code, name, coefficient, category) VALUES ($1,$2,$3,$4) RETURNING *',
      [str(b.code, 'code', 20), str(b.name, 'name', 120), num(b.coefficient ?? 1, 'coefficient', 0.1, 20), category]))[0]);   // category feeds the OAA axes (physical = EPS...)
  }
  listSubjects(slug: string) { return this.tx(slug, (q) => q('SELECT * FROM subjects ORDER BY name')); }
  createTeacher(slug: string, b: any) {
    return this.tx(slug, async (q) => (await q('INSERT INTO teachers(first_name, last_name, max_weekly_hours) VALUES ($1,$2,$3) RETURNING *',
      [str(b.first_name, 'first_name', 80), str(b.last_name, 'last_name', 80), num(b.max_weekly_hours ?? 24, 'max_weekly_hours', 1, 60)]))[0]);
  }
  createRoom(slug: string, b: any) {
    return this.tx(slug, async (q) => (await q('INSERT INTO rooms(name, capacity) VALUES ($1,$2) RETURNING *', [str(b.name, 'name', 60), b.capacity ?? null]))[0]);
  }
  assignSubject(slug: string, b: any) {
    return this.tx(slug, async (q) => (await q('INSERT INTO class_subjects(class_id, subject_id, teacher_id, weekly_hours) VALUES ($1,$2,$3,$4) RETURNING *',
      [uuid(b.class_id, 'class_id'), uuid(b.subject_id, 'subject_id'), uuid(b.teacher_id, 'teacher_id'), num(b.weekly_hours, 'weekly_hours', 1, 40)]))[0]);
  }

  // ---- students -------------------------------------------------------------------------------------------------
  async createStudent(slug: string, actor: string, b: any) {
    const s = await this.tx(slug, async (q) => {
      const row = (await q('INSERT INTO students(first_name, last_name, birth_date, class_id, gender) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [str(b.first_name, 'first_name', 80), str(b.last_name, 'last_name', 80), b.birth_date ? date(b.birth_date, 'birth_date') : null, b.class_id ? uuid(b.class_id, 'class_id') : null,
          ['F', 'M', 'X'].includes(b.gender) ? b.gender : null]))[0];   // gender: optional, used only to audit AI bias
      for (const g of Array.isArray(b.guardians) ? b.guardians : []) {
        await q('INSERT INTO guardians(student_id, full_name, relation, phone, email) VALUES ($1,$2,$3,$4,$5)',
          [row.id, str(g.full_name, 'guardian.full_name', 120), optStr(g.relation, 'relation', 40), optStr(g.phone, 'phone', 40), optStr(g.email, 'email', 120)]);
      }
      return row;
    });
    await this.audit.log({ actorId: actor, tenant: slug, action: 'student.create', entity: 'student', entityId: s.id });
    this.webhooks.dispatch(slug, 'student.created', { id: s.id, class_id: s.class_id ?? null });   // minimised: no names, no contact data
    const oaaHook = await this.oaa.recompute(slug, s.id, 'onStudentCreated', 'enrolment');   // module-oaa: initial score, persisted by the core
    const hooks = [...(oaaHook ? [oaaHook] : []), ...(await this.modules.registry.emit(slug, 'onStudentCreated', { studentId: s.id }, ['module-oaa', 'module-payment']))];
    const invoice = await this.payments.invoiceOnEnrollment(slug, actor, s.id).catch((e) => { new Logger('Enrolment').warn(`enrolment invoice failed: ${(e as Error).message}`); return null; });   // module-payment: invoice at enrolment (never blocks enrolment)
    return { student: s, hooks, invoice };
  }
  /** Paginated (spec 12.1): `limit` 1..1000 (default 500), `offset` >= 0; stable order so pages never overlap. */
  listStudents(slug: string, classId?: string, limit?: string, offset?: string) {
    const lim = limit === undefined ? 500 : Number(limit); const off = offset === undefined ? 0 : Number(offset);
    if (!Number.isInteger(lim) || lim < 1 || lim > 1000) throw new BadRequestException('limit must be an integer between 1 and 1000');
    if (!Number.isInteger(off) || off < 0) throw new BadRequestException('offset must be a non-negative integer');
    return this.tx(slug, (q) => classId
      ? q('SELECT * FROM students WHERE class_id = $1 ORDER BY last_name, first_name, id LIMIT $2 OFFSET $3', [uuid(classId, 'class_id'), lim, off])
      : q('SELECT * FROM students ORDER BY last_name, first_name, id LIMIT $1 OFFSET $2', [lim, off]));
  }
  async getStudent(slug: string, id: string) {
    const r = await this.tx(slug, (q) => q('SELECT * FROM students WHERE id = $1', [uuid(id, 'id')]));
    if (!r.length) throw new NotFoundException('student not found');
    return r[0];
  }

  // ---- timetable ------------------------------------------------------------------------------------------------
  async generateSchedule(slug: string, actor: string, b: any) {
    const year = str(b.school_year, 'school_year', 20);
    const days: number[] = Array.isArray(b.days) ? b.days.map((d: unknown) => num(d, 'day', 1, 7)) : [1, 2, 3, 4, 5];
    const periodsPerDay = num(b.periods_per_day ?? 6, 'periods_per_day', 1, 14);
    const res = await this.tx(slug, async (q) => {
      const reqs = await q<{ class_id: string; subject_id: string; teacher_id: string; weekly_hours: number }>('SELECT class_id, subject_id, teacher_id, weekly_hours FROM class_subjects');
      if (!reqs.length) throw new BadRequestException('no class_subjects defined');
      const rooms = (await q<{ id: string }>('SELECT id FROM rooms ORDER BY name')).map((r) => r.id);
      const gen = generateTimetable({ requirements: reqs.map((r) => ({ classId: r.class_id, subjectId: r.subject_id, teacherId: r.teacher_id, hours: r.weekly_hours })), rooms, days, periodsPerDay });
      const sch = (await q('INSERT INTO schedules(school_year) VALUES ($1) RETURNING id', [year]))[0];
      for (const s of gen.slots) {
        await q('INSERT INTO schedule_slots(schedule_id, class_id, subject_id, teacher_id, room_id, weekday, period_index) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [sch.id, s.classId, s.subjectId, s.teacherId, s.roomId ?? null, s.day, s.period]);
      }
      return { scheduleId: sch.id as string, complete: gen.complete, unplaced: gen.unplaced, slots: gen.slots.length };
    });
    await this.audit.log({ actorId: actor, tenant: slug, action: 'schedule.generate', entity: 'schedule', entityId: res.scheduleId });
    return res;
  }
  private async slots(q: Q, scheduleId: string): Promise<(Slot & { id: string })[]> {
    return (await q('SELECT id, class_id, subject_id, teacher_id, room_id, weekday, period_index FROM schedule_slots WHERE schedule_id = $1 ORDER BY weekday, period_index', [uuid(scheduleId, 'schedule_id')]))
      .map((r: any) => ({ id: r.id, classId: r.class_id, subjectId: r.subject_id, teacherId: r.teacher_id, roomId: r.room_id, day: r.weekday, period: r.period_index }));
  }
  async getSchedule(slug: string, id: string, p: Principal) {
    return this.tx(slug, async (q) => {
      const sch = (await q('SELECT * FROM schedules WHERE id = $1', [uuid(id, 'id')]))[0];
      if (!sch) throw new NotFoundException('schedule not found');
      // Staff see drafts; students and parents only see published timetables (6.5: validated by the head before publication).
      const staff = p.roles.some((r) => ['root_super_admin', 'tenant_super_admin', 'admin', 'head', 'teacher', 'education_assistant'].includes(r));
      if (!staff && sch.status !== 'published') throw new ForbiddenException('timetable not published');
      const slots = await this.slots(q, id);
      return { schedule: sch, slots, conflicts: detectConflicts(slots) };
    });
  }
  async addSlot(slug: string, id: string, b: any) {
    return this.tx(slug, async (q) => {
      const cur = await this.slots(q, id);
      const s: Slot = { classId: uuid(b.class_id, 'class_id'), subjectId: uuid(b.subject_id, 'subject_id'), teacherId: uuid(b.teacher_id, 'teacher_id'),
        roomId: b.room_id ? uuid(b.room_id, 'room_id') : null, day: num(b.weekday, 'weekday', 1, 7), period: num(b.period_index, 'period_index', 0, 20) };
      const c = detectConflicts([...cur, s]).filter((x) => x.slotIndexes.includes(cur.length));
      if (c.length) throw new ConflictException({ message: 'timetable conflict', conflicts: c });
      return (await q('INSERT INTO schedule_slots(schedule_id, class_id, subject_id, teacher_id, room_id, weekday, period_index) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [uuid(id, 'schedule_id'), s.classId, s.subjectId, s.teacherId, s.roomId, s.day, s.period]))[0];
    });
  }
  /** Drag and drop (web): move a slot, refused with the list of conflicts if the target cell is taken. Only drafts can be edited. */
  async moveSlot(slug: string, scheduleId: string, slotId: string, b: any) {
    return this.tx(slug, async (q) => {
      const sch = (await q('SELECT status FROM schedules WHERE id = $1', [uuid(scheduleId, 'schedule_id')]))[0];
      if (!sch) throw new NotFoundException('schedule not found');
      if (sch.status !== 'draft') throw new ConflictException('only a draft timetable can be edited');
      const all = await this.slots(q, scheduleId);
      const idx = all.findIndex((x) => x.id === slotId);
      if (idx < 0) throw new NotFoundException('slot not found');
      const moved: Slot & { id: string } = { ...all[idx], day: num(b.weekday, 'weekday', 1, 7), period: num(b.period_index, 'period_index', 0, 20) };
      const next = all.map((x, i) => (i === idx ? moved : x));
      const c = detectConflicts(next).filter((x) => x.slotIndexes.includes(idx));
      if (c.length) throw new ConflictException({ message: 'timetable conflict', conflicts: c });
      return (await q('UPDATE schedule_slots SET weekday = $2, period_index = $3 WHERE id = $1 RETURNING *', [slotId, moved.day, moved.period]))[0];
    });
  }
  async setScheduleStatus(slug: string, id: string, actor: string, to: 'validated' | 'published') {
    const r = await this.tx(slug, async (q) => {
      const cur = (await q('SELECT status FROM schedules WHERE id = $1', [uuid(id, 'id')]))[0];
      if (!cur) throw new NotFoundException('schedule not found');
      if (to === 'validated' && cur.status !== 'draft') throw new ConflictException('only a draft can be validated');
      if (to === 'published' && cur.status !== 'validated') throw new ConflictException('the head must validate before publication');
      const conflicts = detectConflicts(await this.slots(q, id));
      if (conflicts.length) throw new ConflictException({ message: 'timetable has conflicts', conflicts });
      return (await q('UPDATE schedules SET status = $2, validated_by = COALESCE(validated_by, $3), validated_at = COALESCE(validated_at, NOW()) WHERE id = $1 RETURNING *', [id, to, actor]))[0];
    });
    await this.audit.log({ actorId: actor, tenant: slug, action: `schedule.${to}`, entity: 'schedule', entityId: id });
    if (to === 'published') await this.notif.notifyAll(slug, 'schedule.published', {}, { schedule_id: id });
    return r;
  }
  async ical(slug: string, id: string, query: { first_monday: string; until: string; timezone?: string }) {
    return this.tx(slug, async (q) => {
      const slots = await this.slots(q, id);
      const names = new Map<string, string>((await q('SELECT id, name FROM subjects')).map((r: any) => [r.id, r.name]));
      return exportICal({ slots, firstMonday: date(query.first_monday, 'first_monday'), until: date(query.until, 'until'), timezone: query.timezone ?? 'UTC',
        periodTimes: Array.from({ length: 14 }, (_, i) => ({ start: `${String(7 + i).padStart(2, '0')}:30`, end: `${String(8 + i).padStart(2, '0')}:25` })),
        label: (s) => names.get(s.subjectId) ?? 'Cours' });
    });
  }

  // ---- evaluations and grades -------------------------------------------------------------------------------------
  async activeScale(q: Q, slug: string): Promise<GradingScale> {
    const r = await q(ACTIVE_SCALE_SQL, [slug]);
    if (!r.length) throw new BadRequestException('no grading scale configured for this country/school type');
    return rowToScale(r[0]);
  }
  async createEvaluation(slug: string, b: any) {
    return this.tx(slug, async (q) => {
      const scale = await this.activeScale(q, slug);   // frozen: later scale changes never touch these grades
      return (await q('INSERT INTO evaluations(class_id, subject_id, period_code, title, held_on, coefficient, scale_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [uuid(b.class_id, 'class_id'), uuid(b.subject_id, 'subject_id'), str(b.period_code, 'period_code', 10), str(b.title, 'title', 120),
          b.held_on ? date(b.held_on, 'held_on') : new Date().toISOString().slice(0, 10), num(b.coefficient ?? 1, 'coefficient', 0.1, 20), JSON.stringify(scale)]))[0];
    });
  }
  async classOfEvaluation(slug: string, id: string): Promise<string> {
    const r = await this.tx(slug, (q) => q('SELECT class_id FROM evaluations WHERE id = $1', [uuid(id, 'id')]));
    if (!r.length) throw new NotFoundException('evaluation not found');
    return r[0].class_id;
  }
  async submitGrades(slug: string, evaluationId: string, actor: string, b: any) {
    if (!Array.isArray(b.entries) || !b.entries.length || b.entries.length > 500) throw new BadRequestException('entries required (1..500)');
    const out = await this.tx(slug, async (q) => {
      const ev = (await q('SELECT * FROM evaluations WHERE id = $1', [uuid(evaluationId, 'id')]))[0];
      if (!ev) throw new NotFoundException('evaluation not found');
      const scale = ev.scale_snapshot as GradingScale;
      let saved = 0;
      for (const e of b.entries) {
        const raw = typeof e.value === 'string' && scale.type === 'letter' ? e.value : Number(e.value);
        if (typeof raw === 'number') {
          const k = (raw - scale.min) / scale.step;
          if (!Number.isFinite(raw) || Math.abs(k - Math.round(k)) > 1e-9) throw new BadRequestException(`value ${e.value} does not respect the step ${scale.step}`);
        }
        let normalized: number;
        try { normalized = toNormalized(raw, scale); } catch (err) { throw new BadRequestException((err as Error).message); }
        await q(`INSERT INTO grades(evaluation_id, student_id, raw_value, normalized, entered_by) VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (evaluation_id, student_id) DO UPDATE SET raw_value = EXCLUDED.raw_value, normalized = EXCLUDED.normalized, entered_by = EXCLUDED.entered_by, updated_at = NOW()`,
          [evaluationId, uuid(e.student_id, 'student_id'), String(raw), normalized, actor]);
        saved++;
      }
      const subj = (await q('SELECT s.name FROM subjects s WHERE s.id = $1', [ev.subject_id]))[0]?.name ?? '';
      const shown = (b.entries as any[]).map((e) => ({ id: e.student_id as string, normalized: toNormalized(typeof e.value === 'string' && scale.type === 'letter' ? e.value : Number(e.value), scale) }));
      return { saved, scale: scale.code, scaleObj: scale, subj, shown, studentIds: b.entries.map((e: any) => e.student_id as string) };
    });
    await this.audit.log({ actorId: actor, tenant: slug, action: 'grades.submit', entity: 'evaluation', entityId: evaluationId, details: { count: out.saved } });
    const hooks = await this.modules.registry.emit(slug, 'onGradeSubmitted', { evaluationId, studentIds: out.studentIds }, ['module-oaa']);
    for (const sid of out.studentIds) { const h = await this.oaa.recompute(slug, sid, 'onGradeSubmitted', `grade:${evaluationId}`); if (h) hooks.push(h); }
    for (const sh of out.shown) {
      await this.notif.notifyFamily(slug, sh.id, 'grade.published', (lang) => ({ subject: out.subj, value: display(sh.normalized, out.scaleObj, lang === 'ar' ? 'fr' : lang).text }), { evaluation_id: evaluationId });
    }
    return { saved: out.saved, scale: out.scale, hooks };
  }

  private async reportData(q: Q, slug: string, studentId: string, period: string) {
    const st = (await q('SELECT s.*, c.name AS class_name, c.school_year FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1', [uuid(studentId, 'student_id')]))[0];
    if (!st) throw new NotFoundException('student not found');
    const scale = await this.activeScale(q, slug);
    const subjectCoefs: Record<string, number> = {};
    for (const r of await q('SELECT id, coefficient FROM subjects')) subjectCoefs[r.id] = Number(r.coefficient);
    // grades keep their original scale; only the normalized value is used, so a mid-year scale change does not alter averages
    const rows = await q(`SELECT g.student_id, e.subject_id, e.coefficient, g.normalized FROM grades g JOIN evaluations e ON e.id = g.evaluation_id
                          JOIN students s ON s.id = g.student_id WHERE e.period_code = $1 AND s.class_id IS NOT DISTINCT FROM $2`, [period, st.class_id]);
    const byStudent = new Map<string, { subjectId: string; evaluationCoef: number; normalized: number }[]>();
    for (const r of rows) { const a = byStudent.get(r.student_id) ?? []; a.push({ subjectId: r.subject_id, evaluationCoef: Number(r.coefficient), normalized: Number(r.normalized) }); byStudent.set(r.student_id, a); }
    const classmates = (await q('SELECT id FROM students WHERE class_id IS NOT DISTINCT FROM $1', [st.class_id])).map((r: any) => r.id as string);
    const ranks = rank(classmates.map((id) => ({ id, avg: generalAverage(subjectAverages(byStudent.get(id) ?? []), subjectCoefs) })));
    const mine = ranks.find((r) => r.id === studentId);
    const subjectNames = new Map<string, string>((await q('SELECT id, name FROM subjects')).map((r: any) => [r.id, r.name]));
    return { st, scale, subjectCoefs, subjectNames, grades: byStudent.get(studentId) ?? [], rank: mine?.rank ?? null, classSize: classmates.length };
  }
  async report(slug: string, studentId: string, period: string, locale = 'fr') {
    return this.tx(slug, async (q) => {
      const d = await this.reportData(q, slug, studentId, str(period, 'period', 10));
      const card = buildReportCard({ grades: d.grades, subjectCoefs: d.subjectCoefs, scale: d.scale, locale, rank: d.rank, classSize: d.classSize });
      return { student: { id: d.st.id, first_name: d.st.first_name, last_name: d.st.last_name, class: d.st.class_name }, period, scale: d.scale.code,
        lines: card.lines.map((l) => ({ ...l, subject: d.subjectNames.get(l.subjectId) })), general: card.general, rank: card.rank, classSize: card.classSize };
    });
  }
  async reportPdf(slug: string, studentId: string, period: string, locale = 'fr') {
    const r = await this.report(slug, studentId, period, locale);
    const info = await this.tx(slug, async (q) => ({ school: (await q('SELECT name FROM public.tenants WHERE slug = $1', [slug]))[0]?.name as string,
      year: ((await q('SELECT school_year FROM classes c JOIN students s ON s.class_id = c.id WHERE s.id = $1', [studentId]))[0]?.school_year as string) ?? '' }));
    return reportPdf({ school: info.school, student: `${r.student.first_name} ${r.student.last_name}`, className: r.student.class ?? '', period, year: info.year, locale,
      lines: r.lines.map((l) => ({ subject: l.subject ?? '', coefficient: l.coefficient, average: l.average.text, mention: l.average.mention })),
      general: r.general?.text ?? null, rank: r.rank, classSize: r.classSize });
  }
  async archiveReport(slug: string, studentId: string, period: string, year: string, actor: string) {
    const payload = await this.report(slug, studentId, period);
    await this.tx(slug, (q) => q(`INSERT INTO report_cards(student_id, period_code, school_year, payload) VALUES ($1,$2,$3,$4)
      ON CONFLICT (student_id, period_code, school_year) DO UPDATE SET payload = EXCLUDED.payload, archived_at = NOW()`, [studentId, period, str(year, 'school_year', 20), JSON.stringify(payload)]));
    await this.audit.log({ actorId: actor, tenant: slug, action: 'report.archive', entity: 'student', entityId: studentId });
    return payload;
  }

  // ---- absences -------------------------------------------------------------------------------------------------
  recordAbsence(slug: string, actor: string, b: any) {
    const kind = b.kind === 'late' ? 'late' : b.kind === 'absence' ? 'absence' : null;
    if (!kind) throw new BadRequestException('kind must be absence|late');
    return this.tx(slug, async (q) => (await q('INSERT INTO absences(student_id, on_date, period_index, kind, minutes_late, recorded_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [uuid(b.student_id, 'student_id'), date(b.on_date, 'on_date'), b.period_index ?? null, kind, kind === 'late' ? num(b.minutes_late ?? 0, 'minutes_late', 0, 600) : null, actor]))[0])
      .then(async (row: any) => {
        const name = await this.tx(slug, async (q) => { const r = (await q('SELECT first_name, last_name FROM students WHERE id = $1', [row.student_id]))[0]; return r ? `${r.first_name} ${r.last_name}` : ''; });
        await this.notif.notifyFamily(slug, row.student_id, 'absence.recorded', { kind, student: name, date: String(b.on_date) }, { absence_id: row.id });
        await this.oaa.recompute(slug, row.student_id, 'onExamCompleted', 'attendance');   // social-contribution axis (6.8)
        return row;
      });
  }
  async studentOfAbsence(slug: string, id: string): Promise<string> {
    const r = await this.tx(slug, (q) => q('SELECT student_id FROM absences WHERE id = $1', [uuid(id, 'id')]));
    if (!r.length) throw new NotFoundException('absence not found');
    return r[0].student_id;
  }
  justify(slug: string, absenceId: string, actor: string, b: any) {
    return this.tx(slug, async (q) => {
      const j = (await q('INSERT INTO justifications(absence_id, reason, document_key, submitted_by) VALUES ($1,$2,$3,$4) RETURNING *', [uuid(absenceId, 'id'), str(b.reason, 'reason', 1000), optStr(b.document_key, 'document_key', 200), actor]))[0];
      await q("UPDATE absences SET status = 'pending' WHERE id = $1", [absenceId]);
      return j;
    });
  }
  async decideJustification(slug: string, id: string, actor: string, decision: string) {
    if (decision !== 'accepted' && decision !== 'rejected') throw new BadRequestException('decision must be accepted|rejected');
    const j = await this.tx(slug, async (q) => {
      const j = (await q('UPDATE justifications SET decision = $2, decided_by = $3, decided_at = NOW() WHERE id = $1 AND decision = $4 RETURNING *', [uuid(id, 'id'), decision, actor, 'pending']))[0];
      if (!j) throw new NotFoundException('pending justification not found');
      await q('UPDATE absences SET status = $2 WHERE id = $1', [j.absence_id, decision === 'accepted' ? 'justified' : 'rejected']);
      return j;
    });
    const sid = await this.tx(slug, async (q) => (await q('SELECT student_id FROM absences WHERE id = $1', [j.absence_id]))[0]?.student_id as string | undefined);
    if (sid) await this.oaa.recompute(slug, sid, 'onExamCompleted', 'justification');
    return j;
  }
  async attendance(slug: string, studentId: string) {
    return this.tx(slug, async (q) => {
      const recs = await q('SELECT kind, status FROM absences WHERE student_id = $1', [uuid(studentId, 'student_id')]);
      const stats = attendanceStats(recs);
      return { stats, alert: absenceAlert(stats) };   // threshold alerts feed the notifications module (Phase 3); social axis feeds the OAA
    });
  }

  // ---- lessons (cahier de textes) ---------------------------------------------------------------------------------
  createLesson(slug: string, actor: string, b: any) {
    return this.tx(slug, async (q) => (await q(`INSERT INTO lessons(class_id, subject_id, on_date, title, content, homework, homework_due, is_exam, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'published') RETURNING *`,
      [uuid(b.class_id, 'class_id'), uuid(b.subject_id, 'subject_id'), date(b.on_date, 'on_date'), str(b.title, 'title', 200), typeof b.content === 'string' ? b.content : '',
        optStr(b.homework, 'homework', 4000), b.homework_due ? date(b.homework_due, 'homework_due') : null, b.is_exam === true]))[0]);
  }
  listLessons(slug: string, classId?: string, text?: string) {
    return this.tx(slug, (q) => q(`SELECT id, class_id, subject_id, on_date, title, content, homework, homework_due, is_exam, visa_at FROM lessons
        WHERE ($1::uuid IS NULL OR class_id = $1) AND ($2::text IS NULL OR search @@ plainto_tsquery('simple', $2)) ORDER BY on_date DESC LIMIT 200`,
      [classId ? uuid(classId, 'class_id') : null, text ? text.slice(0, 100) : null]));
  }
  visaLesson(slug: string, id: string, actor: string) {
    return this.tx(slug, async (q) => {
      const r = (await q('UPDATE lessons SET visa_by = $2, visa_at = NOW() WHERE id = $1 RETURNING id, visa_at', [uuid(id, 'id'), actor]))[0];
      if (!r) throw new NotFoundException('lesson not found');
      return r;
    });
  }
}
