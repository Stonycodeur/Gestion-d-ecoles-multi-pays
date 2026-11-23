import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { can, display, storeGrade, weightedAverage100, type Principal } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { AuditService } from '../core/audit.service';
import { Adapters } from '../adapters/adapters';
import { PedagogyService } from '../pedagogy/pedagogy.service';
import { SchoolConfigService } from './school-config.service';
import { ACTIVE_SCALE_SQL, rowToScale } from '../pedagogy/scale';
import { date, mapDbError, optStr, str, uuid } from '../pedagogy/validate';
import { transcriptPdf, timetablePdf } from './pdfs';

const LEVELS = ['not_acquired', 'in_progress', 'acquired', 'mastered'];
const MAX_FILE = 5 * 1024 * 1024;
const WIDE = ['root_super_admin', 'tenant_super_admin', 'admin', 'head', 'teacher', 'education_assistant', 'inspector'];

@Injectable()
export class AcademicService {
  constructor(private readonly db: TenantDb, private readonly audit: AuditService, private readonly adapters: Adapters, private readonly ped: PedagogyService, private readonly school: SchoolConfigService) {}
  private tx<T>(slug: string, fn: (q: Q, t: { id: string; slug: string; country: string; schoolType: string }) => Promise<T>) { return this.db.run(slug, fn).catch((e) => mapDbError(e)); }
  private deny(p: Principal, slug: string, perms: string[], r = {}) {
    for (const perm of perms) if (can(p, perm, { tenantId: slug, ...r }).allowed) return;
    throw new ForbiddenException('not allowed');
  }

  // ---- competencies --------------------------------------------------------------------------------------------------
  createCompetency(slug: string, p: Principal, b: any) {
    this.deny(p, slug, ['grading:configure', 'students:write']);
    return this.tx(slug, async (q) => {
      const row = (await q('INSERT INTO competencies(subject_id, code, label) VALUES ($1,$2,$3) RETURNING *', [uuid(b?.subject_id, 'subject_id'), str(b?.code, 'code', 30), str(b?.label, 'label', 200)]))[0];
      await this.audit.log({ actorId: p.id, tenant: slug, action: 'competency.create', entity: 'competency', entityId: row.id });
      return row;
    });
  }
  listCompetencies(slug: string, subjectId?: string) {
    return this.tx(slug, (q) => q('SELECT * FROM competencies WHERE ($1::uuid IS NULL OR subject_id = $1) ORDER BY subject_id, code', [subjectId ? uuid(subjectId, 'subject_id') : null]));
  }
  async assessCompetencies(slug: string, p: Principal, b: any) {
    const period = str(b?.period_code, 'period_code', 10);
    if (!Array.isArray(b?.entries) || !b.entries.length || b.entries.length > 500) throw new BadRequestException('entries: 1 to 500');
    return this.tx(slug, async (q) => {
      const classOf = new Map<string, string | null>();
      for (const e of b.entries) {
        if (!LEVELS.includes(e?.level)) throw new BadRequestException(`level must be one of ${LEVELS.join(', ')}`);
        const sid = uuid(e.student_id, 'student_id');
        if (!classOf.has(sid)) {
          const st = (await q('SELECT class_id FROM students WHERE id = $1', [sid]))[0];
          if (!st) throw new NotFoundException('student not found');
          classOf.set(sid, st.class_id);
        }
      }
      for (const cl of new Set(classOf.values())) this.deny(p, slug, ['grades:write'], { classId: cl ?? undefined });
      for (const e of b.entries) {
        await q(`INSERT INTO competency_assessments(student_id, competency_id, period_code, level, comment, assessed_by) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (student_id, competency_id, period_code) DO UPDATE SET level = EXCLUDED.level, comment = EXCLUDED.comment, assessed_by = EXCLUDED.assessed_by, assessed_on = CURRENT_DATE`,
          [uuid(e.student_id, 'student_id'), uuid(e.competency_id, 'competency_id'), period, e.level, optStr(e.comment, 'comment', 300), p.id]);
      }
      await this.audit.log({ actorId: p.id, tenant: slug, action: 'competency.assess', details: { period, count: b.entries.length } });
      return { saved: b.entries.length };
    });
  }
  studentCompetencies(slug: string, studentId: string, period: string) {
    return this.tx(slug, (q) => q(`SELECT c.id AS competency_id, c.code, c.label, sub.name AS subject, a.level, a.comment, a.assessed_on
      FROM competency_assessments a JOIN competencies c ON c.id = a.competency_id JOIN subjects sub ON sub.id = c.subject_id
      WHERE a.student_id = $1 AND a.period_code = $2 ORDER BY sub.name, c.code`, [uuid(studentId, 'student_id'), str(period, 'period', 10)]));
  }

  // ---- university: course units, ECTS credits, transcript ----------------------------------------------------------
  createUnit(slug: string, p: Principal, b: any) {
    this.deny(p, slug, ['grading:configure', 'students:write']);
    const credits = Math.trunc(Number(b?.credits));
    if (!Number.isFinite(credits) || credits < 1 || credits > 60) throw new BadRequestException('credits must be 1..60');
    return this.tx(slug, async (q) => {
      const row = (await q('INSERT INTO course_units(code, title, credits, semester) VALUES ($1,$2,$3,$4) RETURNING *', [str(b?.code, 'code', 30), str(b?.title, 'title', 200), credits, str(b?.semester, 'semester', 10)]))[0];
      await this.audit.log({ actorId: p.id, tenant: slug, action: 'unit.create', entity: 'course_unit', entityId: row.id });
      return row;
    });
  }
  listUnits(slug: string) { return this.tx(slug, (q) => q('SELECT * FROM course_units ORDER BY semester, code')); }
  async enterUnitResults(slug: string, p: Principal, b: any) {
    const year = str(b?.school_year, 'school_year', 20);
    if (!Array.isArray(b?.entries) || !b.entries.length || b.entries.length > 500) throw new BadRequestException('entries: 1 to 500');
    return this.tx(slug, async (q) => {
      const scale = await this.ped.activeScale(q, slug);
      const classes = new Set<string | null>();
      const prepared: { sid: string; unit: string; raw: string; norm: number }[] = [];
      for (const e of b.entries) {
        const sid = uuid(e?.student_id, 'student_id');
        const st = (await q('SELECT class_id FROM students WHERE id = $1', [sid]))[0];
        if (!st) throw new NotFoundException('student not found');
        classes.add(st.class_id);
        const v = typeof e.value === 'string' && Number.isNaN(Number(e.value)) ? e.value : Number(e.value);
        let g; try { g = storeGrade(v, scale); } catch { throw new BadRequestException('invalid grade for the active scale'); }
        if (typeof v === 'number' && (!Number.isFinite(v) || v < scale.min || v > scale.max)) throw new BadRequestException(`grade must be ${scale.min}..${scale.max}`);
        prepared.push({ sid, unit: uuid(e.unit_id, 'unit_id'), raw: String(g.rawValue), norm: g.normalized });
      }
      for (const cl of classes) this.deny(p, slug, ['grades:write'], { classId: cl ?? undefined });
      for (const e of prepared) {
        await q(`INSERT INTO unit_results(student_id, unit_id, school_year, raw_value, normalized, scale_snapshot, entered_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT (student_id, unit_id, school_year) DO UPDATE SET raw_value = EXCLUDED.raw_value, normalized = EXCLUDED.normalized, scale_snapshot = EXCLUDED.scale_snapshot, entered_by = EXCLUDED.entered_by`,
          [e.sid, e.unit, year, e.raw, e.norm, JSON.stringify(scale), p.id]);
      }
      await this.audit.log({ actorId: p.id, tenant: slug, action: 'unit.results', details: { year, count: prepared.length } });
      return { saved: prepared.length };
    });
  }
  /** Transcript: each unit shown in the scale it was entered in, validated against that scale's pass mark; weighted by ECTS credits. */
  transcript(slug: string, studentId: string, year: string, locale = 'fr') {
    return this.tx(slug, async (q, t) => {
      const st = (await q('SELECT first_name, last_name FROM students WHERE id = $1', [uuid(studentId, 'student_id')]))[0];
      if (!st) throw new NotFoundException('student not found');
      const rows = await q(`SELECT u.code, u.title, u.credits, u.semester, r.normalized, r.scale_snapshot FROM unit_results r JOIN course_units u ON u.id = r.unit_id
        WHERE r.student_id = $1 AND r.school_year = $2 ORDER BY u.semester, u.code`, [studentId, str(year, 'school_year', 20)]);
      const lines = rows.map((r: any) => {
        const sc = r.scale_snapshot as ReturnType<typeof rowToScale>;
        const norm = Number(r.normalized);
        const passPct = ((sc.passMark - sc.min) / (sc.max - sc.min)) * 100;
        return { code: r.code, title: r.title, semester: r.semester, credits: Number(r.credits), grade: display(norm, sc, locale).text, mention: display(norm, sc, locale).mention, normalized: norm, validated: norm >= passPct };
      });
      const avg = weightedAverage100(lines.map((l) => ({ score100: l.normalized, coefficient: l.credits })));
      const active = rowToScale((await q(ACTIVE_SCALE_SQL, [slug]))[0]);
      const shown = avg === null ? null : display(avg, active, locale);
      return { student: { id: studentId, first_name: st.first_name, last_name: st.last_name }, school_year: year, lines,
        credits_acquired: lines.filter((l) => l.validated).reduce((a, l) => a + l.credits, 0), credits_total: lines.reduce((a, l) => a + l.credits, 0),
        general: shown ? { text: shown.text, mention: shown.mention ?? null } : null, tenant: t.slug };
    });
  }
  async transcriptPdf(slug: string, studentId: string, year: string, locale = 'fr') {
    const tr = await this.transcript(slug, studentId, year, locale);
    const school = (await this.tx(slug, (q) => q('SELECT name FROM public.tenants WHERE slug = $1', [slug])))[0]?.name as string;
    return transcriptPdf({ school, student: `${tr.student.first_name} ${tr.student.last_name}`, year, locale, general: tr.general?.text ?? null, mention: tr.general?.mention ?? undefined,
      creditsAcquired: tr.credits_acquired, creditsTotal: tr.credits_total,
      lines: tr.lines.map((l) => ({ code: l.code, title: l.title, semester: l.semester, credits: l.credits, grade: l.mention ? `${l.grade} (${l.mention})` : l.grade, validated: l.validated })) });
  }

  // ---- timetable: month view and PDF -------------------------------------------------------------------------------
  /** Weekly pattern expanded into dated lessons for one month, substitutions applied. */
  async timetableMonth(slug: string, p: Principal, month: string, q0: { student_id?: string; class_id?: string; mine?: string }) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('month must be YYYY-MM');
    const first = new Date(`${month}-01T00:00:00Z`);
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const tt = await this.school.timetable(slug, p, q0, { from: iso(first), to: iso(last) });
    const subs = new Map<string, any>(tt.substitutions.map((s: any) => [`${s.slot_id}|${String(s.on_date).slice(0, 10)}`, s]));
    const days: { date: string; slots: any[] }[] = [];
    for (let d = new Date(first); d <= last; d = new Date(d.getTime() + 86400000)) {
      const wd = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
      const slots = tt.slots.filter((s: any) => Number(s.weekday) === wd).map((s: any) => {
        const sub = subs.get(`${s.id}|${iso(d)}`);
        return { ...s, substitute_name: sub?.substitute_name ?? null };
      });
      if (slots.length) days.push({ date: iso(d), slots });
    }
    return { month, schedule: tt.schedule, days };
  }
  async timetablePdf(slug: string, p: Principal, q0: { student_id?: string; class_id?: string; mine?: string }, locale = 'fr') {
    const tt = await this.school.timetable(slug, p, q0);
    if (!tt.schedule) throw new NotFoundException('no timetable available');
    const school = (await this.tx(slug, (q) => q('SELECT name FROM public.tenants WHERE slug = $1', [slug])))[0]?.name as string;
    return timetablePdf({ school, title: `${tt.schedule.school_year}`, locale, slots: tt.slots });
  }

  // ---- lesson log: scoped reading, attachments ---------------------------------------------------------------------
  /** Classes a user may read the lesson log of: staff all, student own class, guardian the classes of their children. */
  private async lessonClasses(q: Q, p: Principal): Promise<string[] | null> {
    if (p.isRoot || p.roles.some((r) => WIDE.includes(r))) return null;
    const ids = [p.studentId, ...(p.childIds ?? [])].filter((x): x is string => !!x);
    if (!ids.length) return [];
    return (await q('SELECT DISTINCT class_id FROM students WHERE id = ANY($1::uuid[]) AND class_id IS NOT NULL', [ids])).map((r: any) => r.class_id as string);
  }
  listLessons(slug: string, p: Principal, classId?: string, text?: string) {
    this.deny(p, slug, ['lessons:read'], p.studentId || p.childIds?.length ? { studentId: p.studentId ?? p.childIds?.[0] } : {});
    return this.tx(slug, async (q) => {
      const allowed = await this.lessonClasses(q, p);
      const cid = classId ? uuid(classId, 'class_id') : null;
      if (allowed && cid && !allowed.includes(cid)) throw new ForbiddenException('not your class');
      return q(`SELECT id, class_id, subject_id, on_date, title, content, homework, homework_due, is_exam, visa_at, quiz_id,
          (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', a->>'id', 'filename', a->>'filename', 'size_bytes', (a->>'size_bytes')::int)), '[]') FROM jsonb_array_elements(attachments) a) AS attachments
        FROM lessons WHERE ($1::uuid IS NULL OR class_id = $1) AND ($2::uuid[] IS NULL OR class_id = ANY($2)) AND ($3::text IS NULL OR search @@ plainto_tsquery('simple', $3))
        ORDER BY on_date DESC LIMIT 200`, [cid, allowed, text ? text.slice(0, 100) : null]);
    });
  }
  async addAttachment(slug: string, p: Principal, lessonId: string, b: any) {
    const buf = Buffer.from(typeof b?.content_base64 === 'string' ? b.content_base64 : '', 'base64');
    if (!buf.length || buf.length > MAX_FILE) throw new BadRequestException('file empty or larger than 5 MB');
    const filename = str(b?.filename, 'filename', 120).replace(/[^\w.\- ]/g, '_');
    const type = str(b?.content_type ?? 'application/octet-stream', 'content_type', 100);
    return this.tx(slug, async (q, t) => {
      const l = (await q('SELECT class_id, attachments FROM lessons WHERE id = $1', [uuid(lessonId, 'id')]))[0];
      if (!l) throw new NotFoundException('lesson not found');
      this.deny(p, slug, ['lessons:write'], { classId: l.class_id });
      if ((l.attachments as unknown[]).length >= 10) throw new BadRequestException('at most 10 attachments per lesson');
      const id = randomUUID(); const key = `${t.id}/lessons/${id}`;
      await this.adapters.storage().put(key, buf, type);
      const meta = { id, filename, content_type: type, size_bytes: buf.length, key };
      await q('UPDATE lessons SET attachments = attachments || $2::jsonb WHERE id = $1', [lessonId, JSON.stringify([meta])]);
      await this.audit.log({ actorId: p.id, tenant: slug, action: 'lesson.attach', entity: 'lesson', entityId: lessonId });
      return { id, filename, size_bytes: buf.length };
    });
  }
  async getAttachment(slug: string, p: Principal, lessonId: string, attId: string) {
    const meta = await this.tx(slug, async (q) => {
      const l = (await q('SELECT class_id, attachments FROM lessons WHERE id = $1', [uuid(lessonId, 'id')]))[0];
      if (!l) throw new NotFoundException('lesson not found');
      const allowed = await this.lessonClasses(q, p);
      if (allowed && !allowed.includes(l.class_id)) throw new ForbiddenException('not your class');
      const a = (l.attachments as any[]).find((x) => x.id === attId);
      if (!a) throw new NotFoundException('attachment not found');
      return a;
    });
    return { filename: meta.filename as string, contentType: meta.content_type as string, data: await this.adapters.storage().get(meta.key as string) };
  }
}
