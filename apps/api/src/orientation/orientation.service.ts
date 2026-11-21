import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, canTransitionInternship, computeExamFiche, internshipDays, validateFicheConfig, type ExamFicheConfig, type InternshipStatus, type Principal } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { date, mapDbError, num, optStr, str, uuid } from '../pedagogy/validate';
import { ModulesService } from '../modules/modules.service';
import { NotificationService } from '../comms/notification.service';
import { AuditService } from '../core/audit.service';

export const ORIENTATION_MODULE = 'module-orientation';
type Tenant = { id: string; slug: string; country: string; schoolType: string };
const STAFF_ROLES = ['tenant_super_admin', 'admin', 'head', 'teacher', 'education_assistant'];

@Injectable()
export class OrientationService {
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly notif: NotificationService, private readonly audit: AuditService) {}
  private tx<T>(slug: string, fn: (q: Q, t: Tenant) => Promise<T>): Promise<T> { return this.db.run(slug, fn).catch((e) => mapDbError(e)); }
  private authorize(p: Principal, slug: string, perm: string, r: Record<string, unknown> = {}) { const d = can(p, perm, { tenantId: slug, ...r }); if (!d.allowed) throw new ForbiddenException(d.reason); }
  requireEnabled(slug: string) { if (!this.modules.registry.isEnabled(slug, ORIENTATION_MODULE)) throw new ForbiddenException('orientation module is not enabled for this school'); }
  private isStaff(p: Principal) { return !!p.isRoot || p.roles.some((r) => STAFF_ROLES.includes(r)); }

  // ---- career paths and career sheets --------------------------------------------------------------------------------
  async listPaths(slug: string, p: Principal, kind?: string) {
    this.requireEnabled(slug); this.authorize(p, slug, 'orientation:read');
    return this.tx(slug, (q) => kind ? q('SELECT * FROM career_paths WHERE kind = $1 ORDER BY title', [kind]) : q('SELECT * FROM career_paths ORDER BY title'));
  }
  async createPath(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'orientation:write');
    if (b.kind !== undefined && !['path', 'career_sheet'].includes(b.kind)) throw new BadRequestException('kind must be path or career_sheet');
    const steps = Array.isArray(b.steps) ? b.steps.slice(0, 30).map((s: unknown) => str(s, 'step', 300)) : [];
    const row = await this.tx(slug, async (q) => (await q('INSERT INTO career_paths(title, kind, from_level, to_level, description, steps, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [str(b.title, 'title', 200), b.kind ?? 'path', optStr(b.from_level, 'from_level', 40), optStr(b.to_level, 'to_level', 40), str(b.description, 'description', 5000), JSON.stringify(steps), p.id]))[0]);
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'orientation.path.create', entity: 'career_path', entityId: row.id });
    return row;
  }

  // ---- internships -----------------------------------------------------------------------------------------------------
  private scopeIds(p: Principal): string[] | null { if (this.isStaff(p)) return null; return p.studentId ? [p.studentId] : (p.childIds ?? []); }
  async listInternships(slug: string, p: Principal, status?: string) {
    this.requireEnabled(slug);
    const ids = this.scopeIds(p);
    if (ids !== null) this.authorize(p, slug, 'internships:read', { studentId: ids[0] }); else this.authorize(p, slug, 'internships:manage', { classId: undefined });
    return this.tx(slug, (q) => q(`SELECT i.*, s.first_name, s.last_name FROM internships i JOIN students s ON s.id = i.student_id
      WHERE ($1::uuid[] IS NULL OR i.student_id = ANY($1::uuid[])) AND ($2::text IS NULL OR i.status = $2) ORDER BY i.created_at DESC`, [ids, status ?? null]));
  }
  async requestInternship(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug);
    const studentId = uuid(b.student_id, 'student_id');
    const staff = this.isStaff(p);
    this.authorize(p, slug, staff ? 'internships:manage' : 'internships:request', staff ? {} : { studentId });
    const start = date(b.start_on, 'start_on'), end = date(b.end_on, 'end_on');
    const days = (() => { try { return internshipDays(start, end); } catch { throw new BadRequestException('end_on must not be before start_on'); } })();
    if (days > 120) throw new BadRequestException('an internship cannot exceed 120 days');
    const row = await this.tx(slug, async (q) => {
      if (!(await q('SELECT 1 FROM students WHERE id = $1', [studentId])).length) throw new NotFoundException('student not found');
      return (await q('INSERT INTO internships(student_id, organisation, supervisor_name, supervisor_email, start_on, end_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [studentId, str(b.organisation, 'organisation', 200), optStr(b.supervisor_name, 'supervisor_name', 120), optStr(b.supervisor_email, 'supervisor_email', 200), start, end, p.id]))[0];
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'internship.request', entity: 'internship', entityId: row.id });
    return row;
  }
  async transition(slug: string, p: Principal, id: string, b: any) {
    this.requireEnabled(slug);
    const to = String(b?.to) as InternshipStatus;
    const out = await this.tx(slug, async (q) => {
      const cur = (await q('SELECT * FROM internships WHERE id = $1 FOR UPDATE', [uuid(id, 'id')]))[0];
      if (!cur) throw new NotFoundException('internship not found');
      const staff = this.isStaff(p);
      this.authorize(p, slug, staff ? 'internships:manage' : 'internships:request', staff ? {} : { studentId: cur.student_id });
      if (!canTransitionInternship(cur.status, to, staff ? 'staff' : 'student')) throw new BadRequestException(`transition ${cur.status} -> ${to} is not allowed for this actor`);
      if (to === 'rejected' && !b.note) throw new BadRequestException('a note is required when rejecting');
      const row = (await q('UPDATE internships SET status = $2, decision_note = COALESCE($3, decision_note), updated_at = NOW() WHERE id = $1 RETURNING *', [cur.id, to, optStr(b.note, 'note', 1000)]))[0];
      return { row, studentId: cur.student_id as string };
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: `internship.${to}`, entity: 'internship', entityId: id });
    await this.notif.notifyFamily(slug, out.studentId, 'internship.update', { text: `${out.row.organisation}: ${to}` }, { internship_id: id });
    return out.row;
  }
  async submitReport(slug: string, p: Principal, id: string, b: any) {
    this.requireEnabled(slug);
    const text = str(b?.text, 'text', 20000);
    return this.tx(slug, async (q) => {
      const cur = (await q('SELECT * FROM internships WHERE id = $1 FOR UPDATE', [uuid(id, 'id')]))[0];
      if (!cur) throw new NotFoundException('internship not found');
      this.authorize(p, slug, 'internships:request', { studentId: cur.student_id });
      if (!canTransitionInternship(cur.status, 'report_submitted', 'student')) throw new BadRequestException('the internship must be in progress to submit a report');
      return (await q("UPDATE internships SET status = 'report_submitted', report_text = $2, report_submitted_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *", [cur.id, text]))[0];
    });
  }

  // ---- exam fiche (BEPC / Brevet / CEP …) ----------------------------------------------------------------------------
  private async ficheConfig(q: Q, t: Tenant): Promise<ExamFicheConfig> {
    const r = (await q('SELECT national_exam FROM public.education_systems WHERE country_code = $1 AND school_type = $2', [t.country, t.schoolType]))[0];
    const cfg = r?.national_exam?.fiche as ExamFicheConfig | undefined;
    if (!cfg) throw new NotFoundException('no exam fiche is configured for this country and school type');
    const errs = validateFicheConfig(cfg); if (errs.length) throw new BadRequestException(`invalid exam fiche configuration: ${errs.join('; ')}`);
    return cfg;
  }
  async fiche(slug: string, p: Principal, studentId: string, schoolYear?: string) {
    this.requireEnabled(slug); this.authorize(p, slug, 'exam:read', { studentId: uuid(studentId, 'student_id') });
    const data = await this.tx(slug, async (q, t) => {
      const cfg = await this.ficheConfig(q, t);
      const st = (await q('SELECT s.id, s.first_name, s.last_name, c.school_year FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1', [studentId]))[0];
      if (!st) throw new NotFoundException('student not found');
      const year = schoolYear ?? st.school_year ?? '';
      const continuous = await q(`SELECT sub.code AS subject_code, SUM(g.normalized * e.coefficient) / SUM(e.coefficient) AS pct FROM grades g JOIN evaluations e ON e.id = g.evaluation_id JOIN subjects sub ON sub.id = e.subject_id
        WHERE g.student_id = $1 GROUP BY sub.code`, [studentId]);
      const exam = await q('SELECT subject_code, pct FROM exam_results WHERE student_id = $1 AND exam_code = $2 AND school_year = $3', [studentId, cfg.exam_code, year]);
      const outcome = (await q('SELECT passed, mention FROM exam_outcomes WHERE student_id = $1 AND exam_code = $2 AND school_year = $3', [studentId, cfg.exam_code, year]))[0] ?? null;
      return { cfg, st, year, continuous: continuous.map((r: any) => ({ subject_code: r.subject_code as string, pct: Number(r.pct) })), exam: exam.map((r: any) => ({ subject_code: r.subject_code as string, pct: Number(r.pct) })), outcome };
    });
    const hook = await this.modules.registry.emitTo(slug, 'onExamCompleted', ORIENTATION_MODULE, { config: data.cfg, continuous: data.continuous, exam: data.exam });
    const fiche = hook?.ok ? (hook as any).value.fiche : computeExamFiche(data.cfg, data.continuous, data.exam);
    return { student: { id: data.st.id, first_name: data.st.first_name, last_name: data.st.last_name }, school_year: data.year, fiche, outcome: data.outcome, advisory: true };   // projection only: never an official result
  }
  async saveExamMarks(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'exam:write');
    const studentId = uuid(b.student_id, 'student_id'); const year = str(b.school_year, 'school_year', 20);
    const marks = Array.isArray(b.marks) ? b.marks : [];
    if (!marks.length || marks.length > 40) throw new BadRequestException('marks: 1..40 entries');
    const out = await this.tx(slug, async (q, t) => {
      const cfg = await this.ficheConfig(q, t); const allowed = new Set(cfg.components.map((c) => c.subject_code));
      for (const m of marks) {
        const code = str(m.subject_code, 'subject_code', 40); if (!allowed.has(code)) throw new BadRequestException(`subject ${code} is not part of ${cfg.exam_code}`);
        await q(`INSERT INTO exam_results(student_id, exam_code, school_year, subject_code, pct) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (student_id, exam_code, school_year, subject_code) DO UPDATE SET pct = EXCLUDED.pct`, [studentId, cfg.exam_code, year, code, num(m.pct, 'pct', 0, 100)]);
      }
      return { saved: marks.length, exam_code: cfg.exam_code };
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'exam.marks.save', entity: 'student', entityId: studentId });
    return out;
  }
  /** The official outcome of the exam (passed / mention) is recorded by a human; it feeds public statistics and ministry transmissions. */
  async recordOutcome(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'exam:write');
    const studentId = uuid(b.student_id, 'student_id'); const year = str(b.school_year, 'school_year', 20);
    if (typeof b.passed !== 'boolean') throw new BadRequestException('passed must be a boolean');
    const row = await this.tx(slug, async (q, t) => {
      const cfg = await this.ficheConfig(q, t);
      return (await q(`INSERT INTO exam_outcomes(student_id, exam_code, school_year, passed, mention, recorded_by) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (student_id, exam_code, school_year) DO UPDATE SET passed = EXCLUDED.passed, mention = EXCLUDED.mention, recorded_by = EXCLUDED.recorded_by RETURNING *`,
        [studentId, cfg.exam_code, year, b.passed, optStr(b.mention, 'mention', 60), p.id]))[0];
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'exam.outcome.record', entity: 'student', entityId: studentId });
    return row;
  }
}
