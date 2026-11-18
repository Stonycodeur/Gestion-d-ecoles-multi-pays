// Grading engine: pure functions, no country-specific rule inside.
// Everything comes from a GradingScale (data), see infra/sql/030_seed_countries.sql.

export type ScaleType = 'numeric' | 'letter' | 'mixed' | 'competency';
export type Rounding = 'integer' | 'tenth' | 'quarter' | 'half' | 'none';

export interface Band {
  label: string;
  /** Range on the normalized 0-100 base, inclusive. */
  min: number;
  max: number;
  color?: string;
  mention?: string;
}

export interface GradingScale {
  code: string;
  type: ScaleType;
  min: number;
  max: number;
  step: number;
  decimals: number;
  passMark: number;
  rounding: Rounding;
  bands: Band[];
}

export interface ColorBand { minPct: number; color: string; name: string }

/** Default colors, identical for every scale, overridable per school (spec 3 bis). */
export const DEFAULT_COLOR_BANDS: ColorBand[] = [
  { minPct: 81, color: 'green', name: 'vert' },
  { minPct: 61, color: 'blue', name: 'bleu' },
  { minPct: 41, color: 'yellow', name: 'jaune' },
  { minPct: 21, color: 'orange', name: 'orange' },
  { minPct: 0, color: 'red', name: 'rouge' },
];

export function roundBy(value: number, rule: Rounding, decimals = 2): number {
  switch (rule) {
    case 'integer': return Math.round(value);
    case 'tenth': return Math.round(value * 10) / 10;
    case 'quarter': return Math.round(value * 4) / 4;
    case 'half': return Math.round(value * 2) / 2;
    default: { const f = 10 ** decimals; return Math.round(value * f) / f; }
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function findBand(score100: number, scale: GradingScale): Band | undefined {
  const s = Math.round(score100);
  const exact = scale.bands.find((b) => s >= b.min && s <= b.max);
  if (exact) return exact;
  // Out of every band (e.g. 0 with the letters model): nearest lowest band.
  const sorted = [...scale.bands].sort((a, b) => a.min - b.min);
  return s < (sorted[0]?.min ?? 0) ? sorted[0] : sorted[sorted.length - 1];
}

/** Value entered in a scale (number, or band label) -> normalized 0-100. */
export function toNormalized(input: number | string, scale: GradingScale): number {
  if (typeof input === 'string') {
    const band = scale.bands.find((b) => b.label === input);
    if (!band) throw new Error(`Unknown grade label "${input}" for scale ${scale.code}`);
    return (band.min + band.max) / 2;
  }
  if (input < scale.min || input > scale.max) {
    throw new RangeError(`Grade ${input} outside ${scale.min}-${scale.max} (${scale.code})`);
  }
  return ((input - scale.min) / (scale.max - scale.min)) * 100;
}

export interface Displayed {
  /** Numeric value in the scale (undefined for pure letter scales). */
  value?: number;
  label?: string;
  text: string;
  color: string;
  mention?: string;
  passed: boolean;
}

export function colorForPct(pct: number, colors: ColorBand[] = DEFAULT_COLOR_BANDS): string {
  const sorted = [...colors].sort((a, b) => b.minPct - a.minPct);
  return (sorted.find((c) => pct >= c.minPct) ?? sorted[sorted.length - 1]).color;
}

function fmt(n: number, decimals: number, locale: string): string {
  const s = n.toFixed(decimals).replace(/\.?0+$/, (m) => (m.startsWith('.') ? '' : m));
  return locale.startsWith('fr') ? s.replace('.', ',') : s;
}

/** Normalized 0-100 -> display in the active scale. */
export function display(
  score100: number,
  scale: GradingScale,
  locale = 'fr',
  colors: ColorBand[] = DEFAULT_COLOR_BANDS,
): Displayed {
  const score = clamp(score100, 0, 100);
  const band = scale.bands.length ? findBand(score, scale) : undefined;
  const color = band?.color ?? colorForPct(score, colors);
  if (scale.type === 'letter') {
    return { label: band?.label, text: band?.label ?? '', color, mention: band?.mention,
      passed: score >= (scale.passMark / scale.max) * 100 };
  }
  const raw = scale.min + (score / 100) * (scale.max - scale.min);
  const value = roundBy(raw, scale.rounding, scale.decimals);
  return {
    value, label: band?.label,
    text: `${fmt(value, scale.decimals, locale)}/${fmt(scale.max, 0, locale)}`,
    color, mention: band?.mention, passed: value >= scale.passMark,
  };
}

/** Thresholds are stored as a % of the scale maximum, shown in the local scale. */
export function thresholdInScale(pct: number, scale: GradingScale): number {
  return scale.min + (pct / 100) * (scale.max - scale.min);
}

export interface WeightedGrade { score100: number; coefficient: number }

/** Weighted average computed on the normalized base, so mixed scales stay comparable. */
export function weightedAverage100(grades: WeightedGrade[]): number | null {
  const total = grades.reduce((a, g) => a + g.coefficient, 0);
  if (total <= 0) return null;
  return grades.reduce((a, g) => a + g.score100 * g.coefficient, 0) / total;
}

/** A stored grade keeps its original scale; only the normalized value is compared. */
export interface StoredGrade { rawValue: number | string; scaleCode: string; normalized: number }

export function storeGrade(input: number | string, scale: GradingScale): StoredGrade {
  return { rawValue: input, scaleCode: scale.code, normalized: toNormalized(input, scale) };
}
