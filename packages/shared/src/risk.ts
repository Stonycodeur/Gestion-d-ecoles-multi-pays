// Predictive risk (spec 7.7): explainable, decision-support only. Payment data is NEVER a feature.
export const RISK_FEATURES = ['avg100', 'trend', 'unjustified_rate', 'late_rate', 'oaa', 'xp_30d', 'quiz_avg'] as const;
export type RiskFeature = (typeof RISK_FEATURES)[number];
export type RiskFeatures = Record<RiskFeature, number>;
export type RiskLevel = 'low' | 'medium' | 'high';

/** Linear (logistic) model. For a linear model the SHAP value of a feature is exactly coef * (x - mean), so factors are exact. */
export interface LinearRiskModel { type: 'logistic'; version: string; features: string[]; intercept: number; coefs: number[]; means: number[]; stds: number[]; thresholds: { medium: number; high: number }; card?: Record<string, unknown> }

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
export interface RiskFactor { feature: string; contribution: number; value: number }
export interface RiskPrediction { probability: number; level: RiskLevel; factors: RiskFactor[]; modelVersion: string; advisoryOnly: true }

export function predictRisk(m: LinearRiskModel, x: Partial<RiskFeatures> & Record<string, number>): RiskPrediction {
  if (m.features.some((f) => /pay|invoice|fee|billing/i.test(f))) throw new Error('Payment data must not be used as a feature');
  let z = m.intercept;
  const factors: RiskFactor[] = [];
  m.features.forEach((f, i) => {
    const v = x[f];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError(`Missing feature ${f}`);
    const c = m.coefs[i] * ((v - m.means[i]) / (m.stds[i] || 1));
    z += c; factors.push({ feature: f, contribution: Math.round(c * 1000) / 1000, value: v });
  });
  const p = Math.round(sigmoid(z) * 1000) / 1000;
  const level: RiskLevel = p >= m.thresholds.high ? 'high' : p >= m.thresholds.medium ? 'medium' : 'low';
  return { probability: p, level, factors: factors.sort((a, b) => b.contribution - a.contribution), modelVersion: m.version, advisoryOnly: true };
}

const ADVICE: Record<string, { fr: string; en: string }> = {
  avg100: { fr: 'Soutien scolaire ciblé dans les matières les plus faibles', en: 'Targeted tutoring in the weakest subjects' },
  trend: { fr: 'Entretien avec l’élève : les résultats baissent', en: 'Meet the student: results are dropping' },
  unjustified_rate: { fr: 'Contacter la famille au sujet des absences non justifiées', en: 'Contact the family about unjustified absences' },
  late_rate: { fr: 'Échanger sur les retards récurrents', en: 'Discuss recurring lateness' },
  oaa: { fr: 'Revoir les axes OAA les plus bas avec l’équipe pédagogique', en: 'Review the lowest OAA axes with the teaching team' },
  xp_30d: { fr: 'Proposer des activités ludiques pour relancer l’engagement', en: 'Offer game-based activities to restart engagement' },
  quiz_avg: { fr: 'Revoir les notions des derniers quiz avec l’élève', en: 'Review recent quiz topics with the student' },
};
/** Suggested support actions from the factors that push the risk UP. Suggestions only: a human decides. */
export function recommendations(p: RiskPrediction, lang: 'fr' | 'en', max = 3): string[] {
  if (p.level === 'low') return [];
  return p.factors.filter((f) => f.contribution > 0.05).slice(0, max).map((f) => ADVICE[f.feature]?.[lang]).filter((x): x is string => !!x);
}

export interface BiasRow { group: string; n: number; highRiskRate: number }
export interface BiasReport { rows: BiasRow[]; disparateImpactRatio: number | null; flagged: boolean }
/** Four-fifths rule on the rate of "high risk" flags between groups (attributes are NOT model inputs). */
export function biasReport(items: { group: string; level: RiskLevel }[], minGroupSize = 5): BiasReport {
  const by = new Map<string, { n: number; hi: number }>();
  for (const it of items) { const g = by.get(it.group) ?? { n: 0, hi: 0 }; g.n++; if (it.level === 'high') g.hi++; by.set(it.group, g); }
  const rows = [...by].filter(([, g]) => g.n >= minGroupSize).map(([group, g]) => ({ group, n: g.n, highRiskRate: Math.round((g.hi / g.n) * 1000) / 1000 }));
  if (rows.length < 2) return { rows, disparateImpactRatio: null, flagged: false };
  const rates = rows.map((r) => r.highRiskRate);
  const max = Math.max(...rates), min = Math.min(...rates);
  const ratio = max === 0 ? 1 : Math.round((min / max) * 1000) / 1000;
  return { rows, disparateImpactRatio: ratio, flagged: ratio < 0.8 };
}
