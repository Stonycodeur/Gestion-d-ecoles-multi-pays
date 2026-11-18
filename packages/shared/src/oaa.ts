// OAA (spec section 7): weights come from module config, never hard-coded in callers.
export interface OaaWeights { academic: number; physical: number; adaptability: number; social_contribution: number }
export interface OaaAxes { academic: number; physical: number; adaptability: number; social_contribution: number }

export const DEFAULT_OAA_WEIGHTS: OaaWeights = { academic: 1.0, physical: 1.0, adaptability: 1.0, social_contribution: 0.5 };
export const DEFAULT_OAA_THRESHOLDS = { warning: 50, penalty: 40 } as const; // % of scale max

/** (A*wA + P*wP + Ad*wAd + S*wS) / sum(weights), on the 0-100 base, rounded to an integer. */
export function computeOaa(axes: OaaAxes, weights: OaaWeights = DEFAULT_OAA_WEIGHTS): number {
  const keys = Object.keys(weights) as (keyof OaaWeights)[];
  for (const k of keys) {
    if (axes[k] < 0 || axes[k] > 100) throw new RangeError(`Axis ${k} must be within 0-100`);
  }
  const sum = keys.reduce((a, k) => a + weights[k], 0);
  if (sum <= 0) throw new RangeError('Sum of weights must be > 0');
  return Math.round(keys.reduce((a, k) => a + axes[k] * weights[k], 0) / sum);
}

export type OaaAlert = 'ok' | 'warning' | 'penalty';
export function oaaAlert(score100: number, t: { warning: number; penalty: number } = DEFAULT_OAA_THRESHOLDS): OaaAlert {
  if (score100 < t.penalty) return 'penalty';
  if (score100 < t.warning) return 'warning';
  return 'ok';
}
