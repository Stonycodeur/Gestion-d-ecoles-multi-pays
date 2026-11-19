// OAA axes by school level (spec 7.5) and axis derivation from real data (spec 7.1, 7.6, 8.4).
// Everything is on the normalized 0-100 base; display conversion is done by the grading engine.
export type SchoolType = 'primary' | 'college' | 'lycee' | 'university';
export type AxisWeights = Record<string, number>;
export type Axes = Record<string, number>;

/** Default axes and weights per level. Extra-axis weights are not fixed by the spec (decision D-017): tenant config overrides them. */
export const OAA_LEVEL_PROFILES: Record<SchoolType, AxisWeights> = {
  primary: { academic: 1.0, social_contribution: 0.5, creativity: 1.0 },
  college: { academic: 1.0, physical: 1.0, adaptability: 1.0, social_contribution: 0.5 },
  lycee: { academic: 1.0, physical: 1.0, adaptability: 1.0, social_contribution: 0.5, orientation: 1.0 },
  university: { academic: 1.0, research: 1.0, professional: 1.0, social_contribution: 0.5 },
};

/** Generic form of the spec formula: sum(axis x weight) / sum(weights), rounded to an integer. */
export function computeOaaAxes(axes: Axes, weights: AxisWeights): number {
  const keys = Object.keys(weights);
  if (!keys.length) throw new RangeError('No axis configured');
  let sum = 0, acc = 0;
  for (const k of keys) {
    const v = axes[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 100) throw new RangeError(`Axis ${k} must be within 0-100`);
    if (weights[k] < 0) throw new RangeError(`Weight ${k} must be >= 0`);
    sum += weights[k]; acc += v * weights[k];
  }
  if (sum <= 0) throw new RangeError('Sum of weights must be > 0');
  return Math.round(acc / sum);
}

export interface Part { value: number | null | undefined; weight: number }
/** Weighted mean of the parts that exist; `fallback` when none does (new students start at the configured initial value). */
export function blend(parts: Part[], fallback: number): number {
  let w = 0, a = 0;
  for (const p of parts) {
    if (p.value === null || p.value === undefined || !Number.isFinite(p.value)) continue;
    w += p.weight; a += Math.min(100, Math.max(0, p.value)) * p.weight;
  }
  return w > 0 ? Math.round((a / w) * 100) / 100 : fallback;
}

export interface AxisSources {
  gradeAvgBySubjectCategory: Record<string, number | null>;   // category -> average 0-100 (academic, physical, creative, research, professional, orientation)
  quizAvg: number | null;                                     // subject quizzes -> academic (8.4)
  individualGameAvg: number | null;                           // games and individual challenges -> adaptability (8.4)
  groupChallengeAvg: number | null;                           // group challenges -> social contribution (8.4)
  attendanceAxis: number | null;                              // 100 - capped penalty (6.8)
  assessments: Record<string, number | null>;                 // teacher assessments per axis (skills, projects, clubs, behaviour)
}
export interface FeedWeights { quizInAcademic: number; gamesInAdaptability: number; assessmentInAxis: number; groupInSocial: number; attendanceInSocial: number }
export const DEFAULT_FEED_WEIGHTS: FeedWeights = { quizInAcademic: 0.25, gamesInAdaptability: 0.4, assessmentInAxis: 1, groupInSocial: 0.3, attendanceInSocial: 1 };

/** Computes every axis of the level profile from its sources. Axes without data keep the initial value. */
export function deriveAxes(profile: AxisWeights, src: AxisSources, initial: number, fw: FeedWeights = DEFAULT_FEED_WEIGHTS): Axes {
  const out: Axes = {};
  for (const axis of Object.keys(profile)) {
    const assess = src.assessments[axis];
    switch (axis) {
      case 'academic':
        out[axis] = blend([{ value: src.gradeAvgBySubjectCategory.academic, weight: 1 }, { value: src.quizAvg, weight: fw.quizInAcademic }, { value: assess, weight: fw.assessmentInAxis }], initial); break;
      case 'adaptability':
        out[axis] = blend([{ value: src.individualGameAvg, weight: fw.gamesInAdaptability }, { value: assess, weight: fw.assessmentInAxis }], initial); break;
      case 'social_contribution':
        out[axis] = blend([{ value: src.attendanceAxis, weight: fw.attendanceInSocial }, { value: src.groupChallengeAvg, weight: fw.groupInSocial }, { value: assess, weight: fw.assessmentInAxis }], initial); break;
      case 'physical':
        out[axis] = blend([{ value: src.gradeAvgBySubjectCategory.physical, weight: 1 }, { value: assess, weight: fw.assessmentInAxis }], initial); break;
      default:   // creativity, orientation, research, professional: subjects of that category + teacher assessments
        out[axis] = blend([{ value: src.gradeAvgBySubjectCategory[axis], weight: 1 }, { value: assess, weight: fw.assessmentInAxis }], initial);
    }
  }
  return out;
}

export interface PenaltyRule { code: string; label_fr: string; label_en: string }
export const DEFAULT_PENALTIES: PenaltyRule[] = [
  { code: 'privilege_suspension', label_fr: 'Suspension de privilèges (clubs, sorties)', label_en: 'Privileges suspended (clubs, outings)' },
];
/** A penalty is proposed (never applied automatically) when the score is under the penalty threshold (% of max). */
export function penaltyDue(score100: number, penaltyThreshold: number, active: boolean): boolean {
  return !active && score100 < penaltyThreshold;
}
