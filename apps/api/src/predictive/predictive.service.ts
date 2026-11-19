import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { biasReport, can, generalAverage, predictRisk, recommendations, subjectAverages, RISK_FEATURES, type LinearRiskModel, type Principal, type RiskFeatures, type RiskLevel, type RiskPrediction } from '@ecolemanager/shared';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { mapDbError, str, uuid } from '../pedagogy/validate';
import { ModulesService } from '../modules/modules.service';
import { NotificationService } from '../comms/notification.service';

export const PREDICTIVE_MODULE = 'module-ia-predictive';
const ORDER: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

@Injectable()
export class PredictiveService {
  private readonly log = new Logger('Predictive');
  private model?: LinearRiskModel;
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly notif: NotificationService) {}

  private tx<T>(slug: string, fn: (q: Q) => Promise<T>): Promise<T> { return this.db.run(slug, fn).catch((e) => mapDbError(e)); }
  private cfg(slug: string) {
    const c = this.modules.registry.config(slug, PREDICTIVE_MODULE) as { thresholds?: { medium: number; high: number }; alert_level?: RiskLevel; family_visible?: boolean };
    return { thresholds: c.thresholds ?? { medium: 0.33, high: 0.66 }, alertLevel: (c.alert_level ?? 'high') as RiskLevel, familyVisible: c.family_visible === true };
  }
  requireEnabled(slug: string) {
    if (!this.modules.registry.isEnabled(slug, PREDICTIVE_MODULE)) throw new ForbiddenException('Predictive AI module is not enabled for this school');
  }
  private levelOf(p: number, t: { medium: number; high: number }): RiskLevel { return p >= t.high ? 'high' : p >= t.medium ? 'medium' : 'low'; }

  private loadModel(): LinearRiskModel {
    if (!this.model) {
      const path = process.env.AI_MODEL_PATH ?? resolve(join(__dirname, '../../../ai/model/model.json'));
      this.model = JSON.parse(readFileSync(path, 'utf8')) as LinearRiskModel;
    }
    return this.model;
  }

  /** Features of one student (null when there is not a single grade yet). Payment data is never read here. */
  async features(q: Q, studentId: string): Promise<RiskFeatures | null> {
    const g = await q(`SELECT e.subject_id, e.period_code, e.held_on, e.coefficient AS eval_coef, sub.coefficient AS subject_coef, gr.normalized
      FROM grades gr JOIN evaluations e ON e.id = gr.evaluation_id JOIN subjects sub ON sub.id = e.subject_id WHERE gr.student_id = $1`, [studentId]);
    if (!g.length) return null;
    const coefs: Record<string, number> = {}; for (const r of g) coefs[r.subject_id] = Number(r.subject_coef);
    const avgOf = (rows: any[]) => generalAverage(subjectAverages(rows.map((r) => ({ subjectId: r.subject_id, evaluationCoef: Number(r.eval_coef), normalized: Number(r.normalized) }))), coefs);
    const avg = avgOf(g) ?? 50;
    const byPeriod = new Map<string, any[]>();
    for (const r of g) { const a = byPeriod.get(r.period_code) ?? []; a.push(r); byPeriod.set(r.period_code, a); }
    const periods = [...byPeriod.entries()].map(([code, rows]) => ({ code, last: Math.max(...rows.map((r) => new Date(r.held_on).getTime())), avg: avgOf(rows) ?? avg })).sort((a, b) => a.last - b.last);
    const trend = periods.length >= 2 ? periods[periods.length - 1].avg - periods[periods.length - 2].avg : 0;
    const abs = (await q(`SELECT COUNT(*) FILTER (WHERE kind = 'absence' AND status IN ('unjustified','rejected'))::int AS unj, COUNT(*) FILTER (WHERE kind = 'late')::int AS late
      FROM absences WHERE student_id = $1 AND on_date >= CURRENT_DATE - 60`, [studentId]))[0];
    const oaa = (await q('SELECT score100 FROM oaa_scores WHERE student_id = $1', [studentId]))[0];
    const xp = (await q("SELECT COALESCE(SUM(xp),0)::int AS t FROM xp_events WHERE student_id = $1 AND created_at >= NOW() - INTERVAL '30 days'", [studentId]))[0];
    const quiz = (await q('SELECT AVG(score100)::float AS a FROM quiz_attempts WHERE student_id = $1 AND score100 IS NOT NULL', [studentId]))[0];
    return { avg100: avg, trend, unjustified_rate: abs.unj / 2, late_rate: abs.late / 2, oaa: oaa ? Number(oaa.score100) : 50, xp_30d: Number(xp.t), quiz_avg: quiz?.a ?? 50 };
  }

  /** sandbox (default): in-process model trained by apps/ai/train.py; live: the FastAPI service (XGBoost + SHAP). */
  async predict(items: { id: string; features: RiskFeatures }[]): Promise<Map<string, RiskPrediction>> {
    const out = new Map<string, RiskPrediction>();
    if (process.env.AI_MODE === 'live') {
      const r = await fetch(`${process.env.AI_SERVICE_URL}/predict`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-key': process.env.AI_SERVICE_KEY ?? '' },
        body: JSON.stringify({ students: items.map((i) => ({ id: i.id, features: i.features })) }) });
      if (!r.ok) throw new BadRequestException(`AI service error (${r.status})`);
      for (const p of ((await r.json()) as { predictions: (RiskPrediction & { id: string })[] }).predictions) out.set(p.id, p);
      return out;
    }
    const m = this.loadModel();
    for (const i of items) out.set(i.id, predictRisk(m, i.features));
    return out;
  }

  /** Scores a class (teacher: own class) or the whole school (direction). Alerts go to the direction; nothing is decided automatically. */
  async run(slug: string, p: Principal, classId?: string) {
    this.requireEnabled(slug);
    const d = can(p, 'predictive:read', { tenantId: slug, classId: classId ? uuid(classId, 'class_id') : undefined });
    if (!d.allowed) throw new ForbiddenException(d.reason);
    const cfg = this.cfg(slug);
    const students = await this.tx(slug, (q) => q(classId ? 'SELECT id, first_name, last_name FROM students WHERE class_id = $1' : 'SELECT id, first_name, last_name FROM students', classId ? [classId] : []));
    const items: { id: string; features: RiskFeatures }[] = [];
    let skipped = 0;
    await this.tx(slug, async (q) => { for (const s of students) { const f = await this.features(q, s.id); if (f) items.push({ id: s.id, features: f }); else skipped++; } });
    const preds = items.length ? await this.predict(items) : new Map<string, RiskPrediction>();
    let alerts = 0;
    for (const s of students) {
      const pr = preds.get(s.id);
      if (!pr) continue;
      const level = this.levelOf(pr.probability, cfg.thresholds);
      const prev = await this.tx(slug, async (q) => (await q('SELECT level FROM ai_predictions WHERE student_id = $1 ORDER BY created_at DESC LIMIT 1', [s.id]))[0]?.level as RiskLevel | undefined);
      await this.tx(slug, (q) => q('INSERT INTO ai_predictions(student_id, probability, level, factors, model_version) VALUES ($1,$2,$3,$4,$5)', [s.id, pr.probability, level, JSON.stringify(pr.factors), pr.modelVersion]));
      if (ORDER[level] >= ORDER[cfg.alertLevel] && (!prev || ORDER[prev] < ORDER[cfg.alertLevel])) {
        await this.notif.notifyAll(slug, 'ai.risk', { student: `${s.first_name} ${String(s.last_name).charAt(0)}.` }, { student_id: s.id }, ['head']);
        alerts++;
      }
    }
    return { scored: preds.size, skipped_insufficient_data: skipped, alerts, advisory_only: true };
  }

  async student(slug: string, p: Principal, studentId: string, lang: 'fr' | 'en' = 'fr') {
    this.requireEnabled(slug);
    const st = await this.tx(slug, async (q) => (await q('SELECT id, class_id FROM students WHERE id = $1', [uuid(studentId, 'student_id')]))[0]);
    if (!st) throw new NotFoundException('student not found');
    const staff = can(p, 'predictive:read', { tenantId: slug, studentId: st.id, classId: st.class_id ?? undefined });
    if (!staff.allowed) {
      // "same access rules as the OAA" (7.7): student / parent only when the school switches family visibility on
      const fam = can(p, 'oaa:read', { tenantId: slug, studentId: st.id, classId: st.class_id ?? undefined });
      if (!(fam.allowed && this.cfg(slug).familyVisible && !p.roles.some((r) => r === 'teacher'))) throw new ForbiddenException('predictions are reserved to the school staff');
    }
    return this.tx(slug, async (q) => {
      const hist = await q('SELECT id, probability::float AS probability, level, factors, model_version, created_at FROM ai_predictions WHERE student_id = $1 ORDER BY created_at DESC LIMIT 20', [studentId]);
      if (!hist.length) throw new NotFoundException('no prediction yet');
      const latest = hist[0];
      const pr: RiskPrediction = { probability: latest.probability, level: latest.level, factors: latest.factors, modelVersion: latest.model_version, advisoryOnly: true };
      return { latest: { id: latest.id, ...pr, created_at: latest.created_at }, recommendations: recommendations(pr, lang), history: hist.map((h: any) => ({ probability: h.probability, level: h.level, at: h.created_at })),
        notice: lang === 'en' ? 'Decision support only: a person reviews every alert.' : 'Aide à la décision : une personne examine chaque alerte.' };
    });
  }

  async dashboard(slug: string, p: Principal, classId?: string) {
    this.requireEnabled(slug);
    const d = can(p, 'predictive:read', { tenantId: slug, classId: classId ? uuid(classId, 'class_id') : undefined });
    if (!d.allowed) throw new ForbiddenException(d.reason);
    return this.tx(slug, async (q) => {
      const rows = await q(`SELECT DISTINCT ON (a.student_id) a.student_id, a.probability::float AS probability, a.level, a.factors, a.created_at, s.first_name, s.last_name, s.class_id
        FROM ai_predictions a JOIN students s ON s.id = a.student_id WHERE ($1::uuid IS NULL OR s.class_id = $1) ORDER BY a.student_id, a.created_at DESC`, [classId ?? null]);
      const counts = { low: 0, medium: 0, high: 0 } as Record<RiskLevel, number>;
      for (const r of rows) counts[r.level as RiskLevel]++;
      return { counts, high_risk: rows.filter((r: any) => r.level === 'high').sort((a: any, b: any) => b.probability - a.probability)
        .map((r: any) => ({ student_id: r.student_id, name: `${r.first_name} ${r.last_name}`, probability: r.probability, top_factors: (r.factors as any[]).slice(0, 3).map((f) => f.feature) })) };
    });
  }

  /** Teachers tell the system whether an alert was useful: input for the controlled retraining. */
  feedback(slug: string, p: Principal, predictionId: string, b: any) {
    this.requireEnabled(slug);
    if (!can(p, 'predictive:read', { tenantId: slug, classId: b?.class_id }).allowed && !can(p, 'predictive:read', { tenantId: slug }).allowed) throw new ForbiddenException('not allowed');
    if (typeof b?.useful !== 'boolean') throw new BadRequestException('useful (boolean) is required');
    return this.tx(slug, async (q) => (await q('INSERT INTO ai_feedback(prediction_id, user_id, useful, comment) VALUES ($1,$2,$3,$4) RETURNING id, useful', [uuid(predictionId, 'id'), p.id, b.useful, b.comment ? str(b.comment, 'comment', 500) : null]))[0]);
  }

  /** Periodic bias measurement (four-fifths rule on high-risk flags per group). Gender is used here only, never as a model input. */
  async bias(slug: string) {
    this.requireEnabled(slug);
    return this.tx(slug, async (q) => {
      const rows = await q(`SELECT DISTINCT ON (a.student_id) s.gender AS grp, a.level FROM ai_predictions a JOIN students s ON s.id = a.student_id WHERE s.gender IS NOT NULL ORDER BY a.student_id, a.created_at DESC`);
      return { ...biasReport(rows.map((r: any) => ({ group: r.grp as string, level: r.level as RiskLevel }))), features_used: [...RISK_FEATURES], excluded: ['payment data', 'gender'] };
    });
  }
}
