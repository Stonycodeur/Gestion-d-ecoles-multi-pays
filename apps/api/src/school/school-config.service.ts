import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DEFAULT_COLOR_BANDS, can, type ColorBand, type Principal } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { AuditService } from '../core/audit.service';
import { NotificationService } from '../comms/notification.service';
import { ACTIVE_SCALE_SQL, rowToScale } from '../pedagogy/scale';
import { date, mapDbError, num, optStr, str, uuid } from '../pedagogy/validate';

const COLOR = /^(#[0-9a-f]{6}|[a-z]{3,20})$/i;

/** Validates a school colour override: unique minPct thresholds in 0..100, one band starting at 0. */
export function parseColorBands(v: unknown): ColorBand[] {
  if (!Array.isArray(v) || v.length < 2 || v.length > 10) throw new BadRequestException('color_bands must hold 2 to 10 bands');
  const out = v.map((b: any) => {
    const minPct = Number(b?.minPct);
    if (!Number.isFinite(minPct) || minPct < 0 || minPct > 100) throw new BadRequestException('minPct must be 0..100');
    if (typeof b?.color !== 'string' || !COLOR.test(b.color)) throw new BadRequestException('invalid colour');
    return { minPct, color: b.color, name: typeof b?.name === 'string' && b.name.length <= 40 ? b.name : b.color };
  });
  if (new Set(out.map((b) => b.minPct)).size !== out.length) throw new BadRequestException('minPct values must be unique');
  if (!out.some((b) => b.minPct === 0)) throw new BadRequestException('one band must start at 0');
  return out.sort((a, b) => b.minPct - a.minPct);
}

const isoWeekday = (d: string) => { const n = new Date(`${d}T00:00:00Z`).getUTCDay(); return n === 0 ? 7 : n; };

@Injectable()
export class SchoolConfigService {
  constructor(private readonly db: TenantDb, private readonly audit: AuditService, private readonly notif: NotificationService) {}

  authorize(p: Principal, tenant: string, perm: string) {
    const d = can(p, perm, { tenantId: tenant });
    if (!d.allowed) throw new ForbiddenException(d.reason);
  }
  private tx<T>(slug: string, fn: (q: Q, t: { id: string; slug: string; country: string; schoolType: string }) => Promise<T>): Promise<T> {
    return this.db.run(slug, fn).catch((e) => mapDbError(e));
  }

  // ---- reference data of the school's country ---------------------------------------------------------------------
  country(slug: string) {
    return this.tx(slug, async (q, t) => {
      const c = (await q('SELECT code, name_fr, name_en, languages, default_locale, currency, timezone, payment_providers, legal_framework FROM public.countries WHERE code = $1', [t.country]))[0];
      const es = (await q('SELECT cycle, label_fr, label_en, levels, national_exam, grading_scale_code, period_type FROM public.education_systems WHERE country_code = $1 AND school_type = $2', [t.country, t.schoolType]))[0] ?? null;
      const cal = await q('SELECT label, periods FROM public.academic_calendars WHERE country_code = $1 ORDER BY label', [t.country]);
      return { country: c, education_system: es, calendars: cal };
    });
  }

  // ---- grading configuration (spec 7.3) ---------------------------------------------------------------------------
  private async gradingState(q: Q, t: { id: string; slug: string; country: string; schoolType: string }) {
    const es = (await q('SELECT cycle, grading_scale_code FROM public.education_systems WHERE country_code = $1 AND school_type = $2', [t.country, t.schoolType]))[0];
    if (!es) throw new NotFoundException('no education system configured for this country and school type');
    const available = await q('SELECT code, type, min_value, max_value, step, decimals, pass_mark, rounding, display_format, bands FROM public.grading_scales WHERE country_code = $1 ORDER BY code', [t.country]);
    const active = rowToScale((await q(ACTIVE_SCALE_SQL, [t.slug]))[0]);
    const overrides = await q('SELECT cycle, grading_scale_code, color_bands, effective_from, (effective_from <= CURRENT_DATE) AS in_force FROM public.tenant_settings WHERE tenant_id = $1 ORDER BY effective_from DESC', [t.id]);
    const current = overrides.find((o: any) => o.in_force);
    const colors = (current?.color_bands as ColorBand[] | null) ?? DEFAULT_COLOR_BANDS;
    return { cycle: es.cycle as string, country_default: es.grading_scale_code as string, active, color_bands: colors, available, overrides, thresholds: { warning_pct: 50, penalty_pct: 40 } };
  }
  grading(slug: string) { return this.tx(slug, (q, t) => this.gradingState(q, t)); }

  async setGrading(slug: string, actor: string, b: any) {
    const code = str(b?.grading_scale_code, 'grading_scale_code', 40);
    const today = new Date().toISOString().slice(0, 10);
    const from = b?.effective_from ? date(b.effective_from, 'effective_from') : today;
    if (from < today) throw new BadRequestException('effective_from cannot be in the past: grades already entered keep their own scale');
    const colors = b?.color_bands === undefined || b.color_bands === null ? null : parseColorBands(b.color_bands);
    const out = await this.tx(slug, async (q, t) => {
      const es = (await q('SELECT cycle FROM public.education_systems WHERE country_code = $1 AND school_type = $2', [t.country, t.schoolType]))[0];
      if (!es) throw new NotFoundException('no education system configured for this country and school type');
      const ok = await q('SELECT 1 FROM public.grading_scales WHERE country_code = $1 AND code = $2', [t.country, code]);
      if (!ok.length) throw new BadRequestException('scale not allowed: the school can only choose among the scales of its country');
      await q(`INSERT INTO public.tenant_settings(tenant_id, cycle, grading_scale_code, color_bands, effective_from) VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (tenant_id, cycle, effective_from) DO UPDATE SET grading_scale_code = EXCLUDED.grading_scale_code, color_bands = EXCLUDED.color_bands`,
        [t.id, es.cycle, code, colors ? JSON.stringify(colors) : null, from]);
      return this.gradingState(q, t);
    });
    await this.audit.log({ actorId: actor, tenant: slug, action: 'grading.configure', entity: 'tenant_settings', entityId: code, details: { effective_from: from, colors: !!colors } });
    return out;
  }

  // ---- staff contracts and workload -------------------------------------------------------------------------------
  createContract(slug: string, actor: string, b: any) {
    const kind = str(b?.kind, 'kind', 40);
    const start = date(b?.start_date, 'start_date');
    const end = b?.end_date ? date(b.end_date, 'end_date') : null;
    if (end && end < start) throw new BadRequestException('end_date must be on or after start_date');
    const hours = b?.weekly_hours === undefined || b.weekly_hours === null ? null : Math.trunc(num(b.weekly_hours, 'weekly_hours', 1, 60));
    return this.tx(slug, async (q) => {
      const row = (await q('INSERT INTO contracts(teacher_id, kind, start_date, end_date, weekly_hours) VALUES ($1,$2,$3,$4,$5) RETURNING *', [uuid(b?.teacher_id, 'teacher_id'), kind, start, end, hours]))[0];
      await this.audit.log({ actorId: actor, tenant: slug, action: 'contract.create', entity: 'contract', entityId: row.id });
      return row;
    });
  }
  listContracts(slug: string, teacherId?: string) {
    return this.tx(slug, (q) => teacherId
      ? q('SELECT * FROM contracts WHERE teacher_id = $1 ORDER BY start_date DESC', [uuid(teacherId, 'teacher_id')])
      : q('SELECT * FROM contracts ORDER BY start_date DESC LIMIT 500'));
  }
  /** Teaching load per teacher: hours assigned to classes vs the contractual and the maximum weekly hours. */
  workload(slug: string) {
    return this.tx(slug, async (q) => {
      const rows = await q(`
        SELECT t.id AS teacher_id, t.first_name, t.last_name, t.max_weekly_hours,
               COALESCE((SELECT SUM(cs.weekly_hours) FROM class_subjects cs WHERE cs.teacher_id = t.id), 0)::int AS assigned_hours,
               (SELECT c.weekly_hours FROM contracts c WHERE c.teacher_id = t.id AND c.start_date <= CURRENT_DATE AND (c.end_date IS NULL OR c.end_date >= CURRENT_DATE)
                  ORDER BY c.start_date DESC LIMIT 1) AS contract_hours
        FROM teachers t ORDER BY t.last_name, t.first_name`);
      return rows.map((r: any) => {
        const limit = Math.min(r.max_weekly_hours, r.contract_hours ?? r.max_weekly_hours);
        return { ...r, limit_hours: limit, overloaded: r.assigned_hours > limit };
      });
    });
  }

  // ---- teacher substitution ---------------------------------------------------------------------------------------
  async substitute(slug: string, actor: string, b: any) {
    const slotId = uuid(b?.slot_id, 'slot_id');
    const subId = uuid(b?.substitute_teacher_id, 'substitute_teacher_id');
    const on = date(b?.on_date, 'on_date');
    const note = optStr(b?.note, 'note', 200);
    const r = await this.tx(slug, async (q) => {
      const slot = (await q(`SELECT s.*, sub.name AS subject_name, cl.name AS class_name FROM schedule_slots s
        JOIN subjects sub ON sub.id = s.subject_id JOIN classes cl ON cl.id = s.class_id WHERE s.id = $1`, [slotId]))[0];
      if (!slot) throw new NotFoundException('slot not found');
      if (isoWeekday(on) !== Number(slot.weekday)) throw new BadRequestException('on_date does not fall on the weekday of this slot');
      if (slot.teacher_id === subId) throw new BadRequestException('the substitute must differ from the regular teacher');
      const teacher = (await q('SELECT id, first_name, last_name, user_id FROM teachers WHERE id = $1', [subId]))[0];
      if (!teacher) throw new NotFoundException('substitute teacher not found');
      // The substitute must be free: no regular slot (unless that slot is itself covered that day) and no other substitution at the same period.
      const busy = await q(`
        SELECT 1 FROM schedule_slots s WHERE s.schedule_id = $1 AND s.teacher_id = $2 AND s.weekday = $3 AND s.period_index = $4
          AND NOT EXISTS (SELECT 1 FROM substitutions x WHERE x.slot_id = s.id AND x.on_date = $5)
        UNION ALL
        SELECT 1 FROM substitutions x JOIN schedule_slots s ON s.id = x.slot_id
          WHERE x.substitute_teacher_id = $2 AND x.on_date = $5 AND s.period_index = $4 AND x.slot_id <> $6`,
        [slot.schedule_id, subId, slot.weekday, slot.period_index, on, slotId]);
      if (busy.length) throw new ConflictException('the substitute teacher is not free at that period');
      const row = (await q(`INSERT INTO substitutions(slot_id, on_date, substitute_teacher_id) VALUES ($1,$2,$3)
        ON CONFLICT (slot_id, on_date) DO UPDATE SET substitute_teacher_id = EXCLUDED.substitute_teacher_id RETURNING *`, [slotId, on, subId]))[0];
      const orig = (await q('SELECT first_name, last_name, user_id FROM teachers WHERE id = $1', [slot.teacher_id]))[0];
      const students = await q('SELECT id FROM students WHERE class_id = $1', [slot.class_id]);
      const users = new Set<string>();
      for (const u of await q('SELECT user_id FROM directory WHERE class_ids @> ARRAY[$1]::uuid[]', [slot.class_id])) users.add(u.user_id);
      for (const s of students) for (const u of await q('SELECT user_id FROM directory WHERE student_id = $1 OR child_ids @> ARRAY[$1]::uuid[]', [s.id])) users.add(u.user_id);
      if (teacher.user_id) users.add(teacher.user_id);
      if (orig?.user_id) users.add(orig.user_id);
      return { row, text: `${slot.class_name} · ${slot.subject_name} · ${on} : ${teacher.first_name} ${teacher.last_name}${note ? ` (${note})` : ''}`, users: [...users] };
    });
    await this.audit.log({ actorId: actor, tenant: slug, action: 'schedule.substitute', entity: 'substitution', entityId: r.row.id });
    const notified = await this.notif.notify(slug, r.users, 'schedule.substitution', { text: r.text }, { slot_id: slotId, on_date: on });
    return { ...r.row, notified };
  }
  listSubstitutions(slug: string, from?: string, to?: string) {
    const f = from ? date(from, 'from') : '0001-01-01';
    const t2 = to ? date(to, 'to') : '9999-12-31';
    return this.tx(slug, (q) => q(`
      SELECT x.id, x.on_date, x.slot_id, s.class_id, s.subject_id, s.weekday, s.period_index, s.teacher_id AS original_teacher_id,
             x.substitute_teacher_id, ot.last_name AS original_last_name, st.last_name AS substitute_last_name, st.first_name AS substitute_first_name
      FROM substitutions x JOIN schedule_slots s ON s.id = x.slot_id JOIN teachers ot ON ot.id = s.teacher_id JOIN teachers st ON st.id = x.substitute_teacher_id
      WHERE x.on_date BETWEEN $1 AND $2 ORDER BY x.on_date, s.period_index`, [f, t2]));
  }
  async removeSubstitution(slug: string, actor: string, id: string) {
    const n = await this.tx(slug, async (q) => (await q('DELETE FROM substitutions WHERE id = $1 RETURNING id', [uuid(id, 'id')])).length);
    if (!n) throw new NotFoundException('substitution not found');
    await this.audit.log({ actorId: actor, tenant: slug, action: 'schedule.substitute.remove', entity: 'substitution', entityId: id });
    return { removed: true };
  }

  // ---- timetable of a student / class / teacher, for every role (ABAC checked here, not by route) -----------------------
  /** One call for web and mobile: latest published timetable (staff also see a draft), slots with names, upcoming substitutions. */
  async timetable(slug: string, p: Principal, q0: { student_id?: string; class_id?: string; mine?: string }) {
    const staff = p.isRoot || p.roles.some((r) => ['tenant_super_admin', 'admin', 'head', 'teacher', 'education_assistant'].includes(r));
    return this.tx(slug, async (q, t) => {
      let classId: string | undefined; let teacherId: string | undefined;
      const sid = q0.student_id ? uuid(q0.student_id, 'student_id') : (!q0.class_id && !q0.mine ? (p.studentId ?? p.childIds?.[0]) : undefined);
      if (sid) {
        const st = (await q('SELECT class_id FROM students WHERE id = $1', [sid]))[0];
        if (!st) throw new NotFoundException('student not found');
        const d = can(p, 'schedule:read', { tenantId: p.tenantId ?? undefined, studentId: sid, classId: st.class_id ?? undefined });
        if (!d.allowed) throw new ForbiddenException(d.reason);
        classId = st.class_id ?? undefined;
        if (!classId) return { schedule: null, slots: [], substitutions: [] };
      } else if (q0.class_id) {
        classId = uuid(q0.class_id, 'class_id');
        if (!staff) throw new ForbiddenException('staff only');
      } else if (q0.mine) {
        teacherId = (await q('SELECT id FROM teachers WHERE user_id = $1', [p.id]))[0]?.id;
        if (!teacherId) return { schedule: null, slots: [], substitutions: [] };
      } else if (!staff) throw new BadRequestException('student_id required');
      const sch = (await q(`SELECT id, status, school_year FROM schedules WHERE ${staff ? "status IN ('published','validated','draft')" : "status = 'published'"}
        ORDER BY (status = 'published') DESC, created_at DESC LIMIT 1`))[0];
      if (!sch) return { schedule: null, slots: [], substitutions: [] };
      const slots = await q(`SELECT s.id, s.class_id, c.name AS class_name, s.subject_id, sub.name AS subject_name, s.teacher_id, (te.first_name || ' ' || te.last_name) AS teacher_name,
          r.name AS room, s.weekday, s.period_index
        FROM schedule_slots s JOIN classes c ON c.id = s.class_id JOIN subjects sub ON sub.id = s.subject_id JOIN teachers te ON te.id = s.teacher_id LEFT JOIN rooms r ON r.id = s.room_id
        WHERE s.schedule_id = $1 AND ($2::uuid IS NULL OR s.class_id = $2) AND ($3::uuid IS NULL OR s.teacher_id = $3 OR EXISTS
          (SELECT 1 FROM substitutions x WHERE x.slot_id = s.id AND x.substitute_teacher_id = $3 AND x.on_date >= CURRENT_DATE))
        ORDER BY s.weekday, s.period_index`, [sch.id, classId ?? null, teacherId ?? null]);
      const ids = slots.map((x: any) => x.id);
      const subs = ids.length ? await q(`SELECT x.id, x.slot_id, x.on_date, (st.first_name || ' ' || st.last_name) AS substitute_name, x.substitute_teacher_id
        FROM substitutions x JOIN teachers st ON st.id = x.substitute_teacher_id
        WHERE x.slot_id = ANY($1::uuid[]) AND x.on_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 14 ORDER BY x.on_date`, [ids]) : [];
      return { schedule: sch, slots, substitutions: subs };
    });
  }

  /** What the signed-in person may do, so web and mobile show only the relevant entry screens. */
  abilities(p: Principal, tenant: string) {
    const ctx = { tenantId: tenant, classId: p.classIds?.[0], studentId: p.studentId ?? p.childIds?.[0] };
    const ok = (perm: string) => can(p, perm, perm === 'schedule:write' || perm === 'grades:write' || perm === 'absences:write' ? { tenantId: tenant, classId: p.classIds?.[0] } : ctx).allowed;
    return { roles: p.roles, grades_write: ok('grades:write'), absences_write: ok('absences:write'), absences_justify: ok('absences:justify'), schedule_write: ok('schedule:write'), grading_configure: ok('grading:configure'), contracts_write: ok('contracts:write') };
  }
}
