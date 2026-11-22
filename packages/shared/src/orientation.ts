/** Phase 6a: pure rules for internships, online applications, exam fiche (BEPC/Brevet/CEP/…) and public statistics. No country rule is hard-coded: everything comes from configuration. */

export type InternshipStatus = 'requested' | 'approved' | 'rejected' | 'in_progress' | 'report_submitted' | 'completed' | 'cancelled';
export type InternshipActor = 'student' | 'staff';

const TRANSITIONS: Record<InternshipStatus, Partial<Record<InternshipStatus, InternshipActor[]>>> = {
  requested: { approved: ['staff'], rejected: ['staff'], cancelled: ['student', 'staff'] },
  approved: { in_progress: ['staff', 'student'], cancelled: ['staff'] },
  rejected: {},
  in_progress: { report_submitted: ['student'], cancelled: ['staff'] },
  report_submitted: { completed: ['staff'], in_progress: ['staff'] },   // staff can send the report back for rework
  completed: {},
  cancelled: {},
};
/** Whether `actor` may move an internship from `from` to `to`. */
export function canTransitionInternship(from: InternshipStatus, to: InternshipStatus, actor: InternshipActor): boolean {
  return (TRANSITIONS[from]?.[to] ?? []).includes(actor);
}
export function internshipDays(startOn: string, endOn: string): number {
  const a = Date.parse(startOn), b = Date.parse(endOn);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) throw new Error('invalid internship period');
  return Math.round((b - a) / 86400000) + 1;
}

// ---- online application (visitor space) -----------------------------------------------------------------------------
export interface ApplicationInput {
  first_name?: unknown; last_name?: unknown; birth_date?: unknown; level_code?: unknown;
  guardian_name?: unknown; guardian_email?: unknown; guardian_phone?: unknown; message?: unknown;
  consent?: unknown; website?: unknown;   // `website` is a honeypot: humans leave it empty
}
export interface ApplicationClean { first_name: string; last_name: string; birth_date: string | null; level_code: string; guardian_name: string; guardian_email: string | null; guardian_phone: string | null; message: string | null }
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE = /^\+?[0-9 ().-]{6,20}$/;
/** Validates a public enrolment request. Returns either the cleaned data or the list of field errors; a filled honeypot is reported as `spam`. */
export function validateApplication(i: ApplicationInput, levels: string[], now: number = Date.now()): { ok: true; data: ApplicationClean } | { ok: false; errors: string[]; spam?: boolean } {
  if (typeof i.website === 'string' && i.website.trim() !== '') return { ok: false, errors: ['rejected'], spam: true };
  const errors: string[] = [];
  const s = (v: unknown, name: string, max: number, required = true): string | null => {
    if (v === undefined || v === null || v === '') { if (required) errors.push(`${name} is required`); return null; }
    if (typeof v !== 'string' || v.trim().length === 0 || v.length > max) { errors.push(`${name} is invalid`); return null; }
    return v.trim();
  };
  const first = s(i.first_name, 'first_name', 80), last = s(i.last_name, 'last_name', 80), guardian = s(i.guardian_name, 'guardian_name', 120);
  const level = s(i.level_code, 'level_code', 40);
  if (level && !levels.includes(level)) errors.push('level_code is not offered by this school');
  const email = s(i.guardian_email, 'guardian_email', 254, false), phone = s(i.guardian_phone, 'guardian_phone', 20, false);
  if (email && !EMAIL.test(email)) errors.push('guardian_email is invalid');
  if (phone && !PHONE.test(phone)) errors.push('guardian_phone is invalid');
  if (!email && !phone) errors.push('guardian_email or guardian_phone is required');
  let birth: string | null = null;
  if (i.birth_date !== undefined && i.birth_date !== null && i.birth_date !== '') {
    if (typeof i.birth_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(i.birth_date) || Number.isNaN(Date.parse(i.birth_date))) errors.push('birth_date must be YYYY-MM-DD');
    else if (Date.parse(i.birth_date) > now) errors.push('birth_date cannot be in the future');
    else birth = i.birth_date;
  }
  const message = s(i.message, 'message', 2000, false);
  if (i.consent !== true) errors.push('consent is required (personal data of a minor)');
  if (errors.length) return { ok: false, errors };
  return { ok: true, data: { first_name: first!, last_name: last!, birth_date: birth, level_code: level!, guardian_name: guardian!, guardian_email: email, guardian_phone: phone, message } };
}

// ---- exam fiche (end of lower secondary: BEPC / Brevet; configurable per country) -----------------------------------------
export interface ExamFicheConfig {
  exam_code: string;
  continuous_weight: number;        // share of the continuous assessment (e.g. 0.4)
  exam_weight: number;              // share of the exam itself (e.g. 0.6)
  pass_pct: number;                 // admission threshold, % of the maximum
  components: { subject_code: string; coefficient: number }[];
  mentions?: { label: string; min_pct: number }[];   // sorted or not; highest matching wins
}
export interface PctMark { subject_code: string; pct: number }   // normalised 0-100
export interface ExamFiche {
  exam_code: string; continuous_pct: number | null; exam_pct: number | null; projected_pct: number | null;
  admitted: boolean | null; mention: string | null; missing_continuous: string[]; missing_exam: string[];
  subjects: { subject_code: string; coefficient: number; continuous_pct: number | null; exam_pct: number | null; combined_pct: number | null }[];
}
const r1 = (n: number) => Math.round(n * 10) / 10;
function weighted(items: { w: number; v: number }[]): number | null { const t = items.reduce((a, i) => a + i.w, 0); return t > 0 ? items.reduce((a, i) => a + i.w * i.v, 0) / t : null; }
export function validateFicheConfig(c: ExamFicheConfig): string[] {
  const e: string[] = [];
  if (!c.exam_code) e.push('exam_code required');
  if (!(c.continuous_weight >= 0 && c.exam_weight >= 0) || Math.abs(c.continuous_weight + c.exam_weight - 1) > 1e-9) e.push('continuous_weight + exam_weight must equal 1');
  if (!(c.pass_pct > 0 && c.pass_pct <= 100)) e.push('pass_pct must be in ]0,100]');
  if (!c.components?.length || c.components.some((x) => !x.subject_code || !(x.coefficient > 0))) e.push('components need subject_code and coefficient > 0');
  return e;
}
/** Projects an exam result from the continuous assessment and (partial) exam marks. Until the exam marks exist, the continuous average alone is the projection (marked by exam_pct = null). */
export function computeExamFiche(cfg: ExamFicheConfig, continuous: PctMark[], exam: PctMark[]): ExamFiche {
  const errs = validateFicheConfig(cfg); if (errs.length) throw new Error(errs.join('; '));
  const cm = new Map(continuous.map((m) => [m.subject_code, m.pct])), em = new Map(exam.map((m) => [m.subject_code, m.pct]));
  const subjects = cfg.components.map((c) => {
    const cp = cm.get(c.subject_code) ?? null, ep = em.get(c.subject_code) ?? null;
    const combined = cp !== null && ep !== null ? cp * cfg.continuous_weight + ep * cfg.exam_weight : null;
    return { subject_code: c.subject_code, coefficient: c.coefficient, continuous_pct: cp === null ? null : r1(cp), exam_pct: ep === null ? null : r1(ep), combined_pct: combined === null ? null : r1(combined) };
  });
  const avg = (pick: (s: (typeof subjects)[number]) => number | null) => weighted(subjects.filter((s) => pick(s) !== null).map((s) => ({ w: s.coefficient, v: pick(s)! })));
  const cAvg = avg((s) => s.continuous_pct), eAvg = avg((s) => s.exam_pct);
  const complete = subjects.every((s) => s.combined_pct !== null);
  const projected = complete ? avg((s) => s.combined_pct) : cAvg;
  const mention = projected === null ? null : ([...(cfg.mentions ?? [])].sort((a, b) => b.min_pct - a.min_pct).find((m) => projected >= m.min_pct)?.label ?? null);
  return {
    exam_code: cfg.exam_code, continuous_pct: cAvg === null ? null : r1(cAvg), exam_pct: eAvg === null ? null : r1(eAvg), projected_pct: projected === null ? null : r1(projected),
    admitted: projected === null ? null : projected >= cfg.pass_pct, mention,
    missing_continuous: subjects.filter((s) => s.continuous_pct === null).map((s) => s.subject_code), missing_exam: subjects.filter((s) => s.exam_pct === null).map((s) => s.subject_code), subjects,
  };
}

// ---- public statistics -----------------------------------------------------------------------------------------------
/** Success rate in % (one decimal) for exam candidates; null when nobody sat the exam. Publication needs a minimum cohort to avoid identifying pupils. */
export function successRate(passed: number, candidates: number): number | null {
  if (!(candidates > 0) || passed < 0 || passed > candidates) return null;
  return r1((passed / candidates) * 100);
}
export function publicStat(value: number, minCohort: number, cohort: number): number | null { return cohort >= minCohort ? value : null; }
