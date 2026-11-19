import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OAA_LEVEL_PROFILES, DEFAULT_FEED_WEIGHTS, DEFAULT_OAA_THRESHOLDS, absenceAlert, attendanceStats, can, deriveAxes, display, generalAverage,
  oaaAlert, oaaFeedFromGamification, penaltyDue, rank, socialAxisFromAttendance, subjectAverages, thresholdInScale,
  type AxisWeights, type Axes, type FeedWeights, type GameResult, type GradingScale, type HookResult, type Principal, type SchoolType } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { ACTIVE_SCALE_SQL, rowToScale } from '../pedagogy/scale';
import { mapDbError, num, optStr, str, uuid } from '../pedagogy/validate';
import { ModulesService } from '../modules/modules.service';
import { NotificationService } from '../comms/notification.service';

export const OAA_MODULE = 'module-oaa';
const AXIS_NAME = /^[a-z][a-z_]{1,30}$/;

interface Cfg { profile: AxisWeights; thresholds: { warning: number; penalty: number }; initial: number; rankingEnabled: boolean; feed: FeedWeights }

@Injectable()
export class OaaService {
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly notif: NotificationService) {}

  private tx<T>(slug: string, fn: (q: Q, t: { id: string; slug: string; country: string; schoolType: string }) => Promise<T>): Promise<T> {
    return this.db.run(slug, fn).catch((e) => mapDbError(e));
  }
  authorize(p: Principal, slug: string, perm: string, r: Record<string, unknown> = {}) {
    const d = can(p, perm, { tenantId: slug, ...r });
    if (!d.allowed) throw new ForbiddenException(d.reason);
  }
  requireEnabled(slug: string) {
    if (!this.modules.registry.isEnabled(slug, OAA_MODULE)) throw new ForbiddenException('OAA module is not enabled for this school');
  }

  async loadConfig(q: Q, schoolType: string): Promise<Cfg> {
    const row = (await q('SELECT * FROM oaa_config LIMIT 1'))[0];
    const profile = (row?.weights as AxisWeights | null) ?? OAA_LEVEL_PROFILES[schoolType as SchoolType] ?? OAA_LEVEL_PROFILES.college;
    return {
      profile, thresholds: (row?.thresholds as Cfg['thresholds']) ?? { ...DEFAULT_OAA_THRESHOLDS },
      initial: row ? Number(row.initial_value) : 50, rankingEnabled: row ? row.ranking_enabled === true : true,
      feed: { ...DEFAULT_FEED_WEIGHTS, ...((row?.feed_weights as Partial<FeedWeights> | null) ?? {}) },
    };
  }

  /** Collects the data behind every axis: grades by subject category, quizzes/games (8.4), attendance (6.8), teacher assessments. */
  private async gather(q: Q, studentId: string, cfg: Cfg) {
    const g = await q(`SELECT sub.category, sub.id AS subject_id, sub.coefficient AS subject_coef, e.coefficient AS eval_coef, gr.normalized
      FROM grades gr JOIN evaluations e ON e.id = gr.evaluation_id JOIN subjects sub ON sub.id = e.subject_id WHERE gr.student_id = $1`, [studentId]);
    const byCat = new Map<string, any[]>();
    for (const r of g) { const a = byCat.get(r.category) ?? []; a.push(r); byCat.set(r.category, a); }
    const gradeAvg: Record<string, number | null> = {};
    for (const [cat, rows] of byCat) {
      const avgs = subjectAverages(rows.map((r) => ({ subjectId: r.subject_id, evaluationCoef: Number(r.eval_coef), normalized: Number(r.normalized) })));
      const coefs: Record<string, number> = {}; for (const r of rows) coefs[r.subject_id] = Number(r.subject_coef);
      gradeAvg[cat] = generalAverage(avgs, coefs);
    }
    const games = (await q('SELECT kind, score100 FROM game_results WHERE student_id = $1', [studentId])).map((r: any) => ({ kind: r.kind, score100: Number(r.score100) })) as GameResult[];
    const feed = oaaFeedFromGamification(games);
    const att = await q('SELECT kind, status FROM absences WHERE student_id = $1', [studentId]);
    const assess = await q('SELECT axis, AVG(value)::float AS v FROM oaa_assessments WHERE student_id = $1 GROUP BY axis', [studentId]);
    const assessments: Record<string, number | null> = {};
    for (const a of assess) assessments[a.axis] = Number(a.v);
    return { gradeAvgBySubjectCategory: gradeAvg, ...feed, attendanceAxis: socialAxisFromAttendance(attendanceStats(att)), assessments };
  }

  /**
   * Recomputes the OAA of one student (hooks onStudentCreated / onGradeSubmitted / onExamCompleted).
   * Returns the hook result of module-oaa, or null when the module is disabled for the school.
   */
  async recompute(slug: string, studentId: string, event: 'onStudentCreated' | 'onGradeSubmitted' | 'onExamCompleted', reason: string): Promise<HookResult | null> {
    if (!this.modules.registry.isEnabled(slug, OAA_MODULE)) return null;
    const pre = await this.tx(slug, async (q, t) => {
      const cfg = await this.loadConfig(q, t.schoolType);
      const axes: Axes | undefined = event === 'onStudentCreated' ? undefined : deriveAxes(cfg.profile, await this.gather(q, studentId, cfg), cfg.initial, cfg.feed);
      const prev = (await q('SELECT score100, alert FROM oaa_scores WHERE student_id = $1', [studentId]))[0];
      const initialAxes = Object.fromEntries(Object.keys(cfg.profile).map((k) => [k, cfg.initial]));
      return { cfg, axes: axes ?? initialAxes, prev };
    });
    const res = await this.modules.registry.emitTo(slug, event, OAA_MODULE, { studentId, axes: pre.axes, profile: pre.cfg.profile, thresholds: pre.cfg.thresholds });
    if (!res || !res.ok) return res;
    const v = res.value as { score100: number; alert: 'ok' | 'warning' | 'penalty'; axes: Axes };
    await this.tx(slug, async (q) => {
      await q(`INSERT INTO oaa_scores(student_id, axes, score100, alert) VALUES ($1,$2,$3,$4)
               ON CONFLICT (student_id) DO UPDATE SET axes = EXCLUDED.axes, score100 = EXCLUDED.score100, alert = EXCLUDED.alert, updated_at = NOW()`,
        [studentId, JSON.stringify(v.axes), v.score100, v.alert]);
      await q('INSERT INTO oaa_history(student_id, axes, score100, reason) VALUES ($1,$2,$3,$4)', [studentId, JSON.stringify(v.axes), v.score100, reason]);
      const open = (await q("SELECT 1 FROM oaa_penalties WHERE student_id = $1 AND status IN ('proposed','applied')", [studentId])).length > 0;
      if (penaltyDue(v.score100, pre.cfg.thresholds.penalty, open)) await q("INSERT INTO oaa_penalties(student_id, score100, code) VALUES ($1,$2,'privilege_suspension')", [studentId, v.score100]);
    });
    if (v.alert !== 'ok' && v.alert !== pre.prev?.alert) await this.warn(slug, studentId, v.score100);
    return res;
  }

  /** Warning shown in the student's active scale ("11/20" or "C"), never as a raw 0-100 number. */
  private async warn(slug: string, studentId: string, score100: number) {
    const scale = await this.tx(slug, async (q) => rowToScale((await q(ACTIVE_SCALE_SQL, [slug]))[0]));
    await this.notif.notifyFamily(slug, studentId, 'oaa.warning', (lang) => ({ value: display(score100, scale, lang === 'ar' ? 'fr' : lang).text }), { student_id: studentId });
  }

  private view(row: any, scale: GradingScale, cfg: Cfg, locale: string) {
    const d = display(row.score100, scale, locale);
    return {
      student_id: row.student_id, score100: row.score100, axes: row.axes, alert: row.alert, updated_at: row.updated_at,
      display: { text: d.text, color: d.color, mention: d.mention ?? null, passed: d.passed },
      axes_display: Object.fromEntries(Object.entries(row.axes as Axes).map(([k, v]) => [k, display(v, scale, locale).text])),
      thresholds: {
        warning: { pct: cfg.thresholds.warning, in_scale: display(cfg.thresholds.warning, scale, locale).text, value: thresholdInScale(cfg.thresholds.warning, scale) },
        penalty: { pct: cfg.thresholds.penalty, in_scale: display(cfg.thresholds.penalty, scale, locale).text, value: thresholdInScale(cfg.thresholds.penalty, scale) },
      },
      scale: scale.code,
    };
  }

  async studentOaa(slug: string, p: Principal, studentId: string, locale = 'fr') {
    this.requireEnabled(slug);
    const st = await this.tx(slug, async (q) => (await q('SELECT id, class_id FROM students WHERE id = $1', [uuid(studentId, 'student_id')]))[0]);
    if (!st) throw new NotFoundException('student not found');
    this.authorize(p, slug, 'oaa:read', { studentId: st.id, classId: st.class_id ?? undefined });   // student: own, parent: child, teacher: own class, direction: all
    return this.tx(slug, async (q, t) => {
      const cfg = await this.loadConfig(q, t.schoolType);
      const scale = rowToScale((await q(ACTIVE_SCALE_SQL, [slug]))[0]);
      const row = (await q('SELECT * FROM oaa_scores WHERE student_id = $1', [studentId]))[0];
      if (!row) throw new NotFoundException('no OAA score yet');
      const hist = await q('SELECT score100, reason, created_at FROM oaa_history WHERE student_id = $1 ORDER BY created_at DESC LIMIT 100', [studentId]);
      return { ...this.view({ ...row, student_id: studentId }, scale, cfg, locale), history: hist.reverse().map((h: any) => ({ score100: h.score100, display: display(h.score100, scale, locale).text, reason: h.reason, at: h.created_at })) };
    });
  }

  /** Class dashboard (teacher: own class, direction: all). Ranking only when enabled by the school. */
  async classOaa(slug: string, p: Principal, classId: string, locale = 'fr') {
    this.requireEnabled(slug);
    this.authorize(p, slug, 'oaa:read', { classId: uuid(classId, 'class_id') });
    if (p.roles.every((r) => r === 'student' || r === 'guardian')) throw new ForbiddenException('class view is reserved to staff');
    return this.tx(slug, async (q, t) => {
      const cfg = await this.loadConfig(q, t.schoolType);
      const scale = rowToScale((await q(ACTIVE_SCALE_SQL, [slug]))[0]);
      const rows = await q(`SELECT o.*, s.first_name, s.last_name FROM oaa_scores o JOIN students s ON s.id = o.student_id WHERE s.class_id = $1 ORDER BY s.last_name, s.first_name`, [classId]);
      const ranks = cfg.rankingEnabled ? rank(rows.map((r: any) => ({ id: r.student_id, avg: r.score100 as number }))) : [];
      return { ranking_enabled: cfg.rankingEnabled, students: rows.map((r: any) => ({ ...this.view(r, scale, cfg, locale), first_name: r.first_name, last_name: r.last_name,
        rank: cfg.rankingEnabled ? ranks.find((x) => x.id === r.student_id)?.rank ?? null : null })) };
    });
  }

  async addAssessment(slug: string, p: Principal, studentId: string, b: any) {
    this.requireEnabled(slug);
    const st = await this.tx(slug, async (q) => (await q('SELECT id, class_id FROM students WHERE id = $1', [uuid(studentId, 'student_id')]))[0]);
    if (!st) throw new NotFoundException('student not found');
    this.authorize(p, slug, 'oaa:write', { studentId: st.id, classId: st.class_id ?? undefined });
    const axis = str(b.axis, 'axis', 30);
    const row = await this.tx(slug, async (q, t) => {
      const cfg = await this.loadConfig(q, t.schoolType);
      if (!(axis in cfg.profile)) throw new BadRequestException(`axis must be one of: ${Object.keys(cfg.profile).join(', ')}`);
      return (await q('INSERT INTO oaa_assessments(student_id, axis, value, label, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, axis, value, label',
        [studentId, axis, num(b.value, 'value', 0, 100), optStr(b.label, 'label', 200), p.id]))[0];
    });
    await this.recompute(slug, studentId, 'onExamCompleted', `assessment:${axis}`);
    return row;
  }

  // ---- configuration, penalties -----------------------------------------------------------------------------------
  getConfig(slug: string) { return this.tx(slug, async (q, t) => { const c = await this.loadConfig(q, t.schoolType); return { weights: c.profile, thresholds: c.thresholds, initial_value: c.initial, ranking_enabled: c.rankingEnabled, feed_weights: c.feed }; }); }
  async setConfig(slug: string, b: any) {
    let weights: AxisWeights | null = null;
    if (b.weights !== undefined && b.weights !== null) {
      weights = {};
      for (const [k, v] of Object.entries(b.weights as Record<string, unknown>)) {
        if (!AXIS_NAME.test(k)) throw new BadRequestException(`invalid axis name ${k}`);
        weights[k] = num(v, `weight ${k}`, 0, 10);
      }
      if (!Object.keys(weights).length || Object.values(weights).reduce((a, x) => a + x, 0) <= 0) throw new BadRequestException('weights must have a positive sum');
    }
    const th = b.thresholds ? { warning: num(b.thresholds.warning, 'warning', 0, 100), penalty: num(b.thresholds.penalty, 'penalty', 0, 100) } : { ...DEFAULT_OAA_THRESHOLDS };
    if (th.penalty > th.warning) throw new BadRequestException('penalty threshold cannot exceed the warning threshold');
    return this.tx(slug, async (q) => {
      await q('DELETE FROM oaa_config');
      return (await q('INSERT INTO oaa_config(weights, thresholds, initial_value, ranking_enabled, feed_weights) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [weights ? JSON.stringify(weights) : null, JSON.stringify(th), num(b.initial_value ?? 50, 'initial_value', 0, 100), b.ranking_enabled !== false, b.feed_weights ? JSON.stringify(b.feed_weights) : null]))[0];
    });
  }
  async recomputeAll(slug: string, classId?: string) {
    this.requireEnabled(slug);
    const ids = await this.tx(slug, (q) => q(classId ? 'SELECT id FROM students WHERE class_id = $1' : 'SELECT id FROM students', classId ? [uuid(classId, 'class_id')] : []));
    for (const s of ids) await this.recompute(slug, s.id, 'onExamCompleted', 'manual recompute');
    return { recomputed: ids.length };
  }
  listPenalties(slug: string, status?: string) {
    return this.tx(slug, (q) => q(`SELECT p.*, s.first_name, s.last_name FROM oaa_penalties p JOIN students s ON s.id = p.student_id ${status ? 'WHERE p.status = $1' : ''} ORDER BY p.created_at DESC LIMIT 200`, status ? [status] : []));
  }
  /** A penalty is only ever PROPOSED by the system; a human on the direction side applies or dismisses it. */
  decidePenalty(slug: string, p: Principal, id: string, decision: string) {
    if (!['applied', 'dismissed', 'lifted'].includes(decision)) throw new BadRequestException('decision must be applied|dismissed|lifted');
    return this.tx(slug, async (q) => {
      const r = await q('UPDATE oaa_penalties SET status = $2, decided_by = $3, decided_at = NOW() WHERE id = $1 RETURNING *', [uuid(id, 'id'), decision, p.id]);
      if (!r.length) throw new NotFoundException('penalty not found');
      return r[0];
    });
  }
  /** Used by tests and dashboards: alert level of a score for given thresholds. */
  static alertOf(score: number, t = DEFAULT_OAA_THRESHOLDS) { return oaaAlert(score, t); }
  static absenceLevel(recs: { kind: 'absence' | 'late'; status: any }[]) { return absenceAlert(attendanceStats(recs)); }
}
