import { display, weightedAverage100 } from './grading.ts';
import type { GradingScale, Displayed, ColorBand } from './grading.ts';

export interface GradeIn { subjectId: string; evaluationCoef: number; normalized: number }

/** Subject average over a period: evaluations weighted by their own coefficient, on the 0-100 base. */
export function subjectAverages(grades: GradeIn[]): Record<string, number> {
  const by = new Map<string, GradeIn[]>();
  for (const g of grades) { const a = by.get(g.subjectId); if (a) a.push(g); else by.set(g.subjectId, [g]); }
  const out: Record<string, number> = {};
  for (const [s, list] of by) {
    const avg = weightedAverage100(list.map((g) => ({ score100: g.normalized, coefficient: g.evaluationCoef })));
    if (avg !== null) out[s] = avg;
  }
  return out;
}

/** General average: subject averages weighted by the subject coefficient (default 1). Subjects without grades are ignored. */
export function generalAverage(subjectAvgs: Record<string, number>, subjectCoefs: Record<string, number>): number | null {
  return weightedAverage100(Object.entries(subjectAvgs).map(([s, a]) => ({ score100: a, coefficient: subjectCoefs[s] ?? 1 })));
}

/** Competition ranking (1, 2, 2, 4); averages compared at 2 decimals so display ties rank together. */
export function rank<T extends { id: string; avg: number | null }>(rows: T[]): (T & { rank: number | null })[] {
  const scored = rows.filter((r) => r.avg !== null).map((r) => ({ r, k: Math.round((r.avg as number) * 100) })).sort((a, b) => b.k - a.k);
  const ranks = new Map<string, number>();
  scored.forEach((x, i) => ranks.set(x.r.id, i > 0 && scored[i - 1].k === x.k ? ranks.get(scored[i - 1].r.id)! : i + 1));
  return rows.map((r) => ({ ...r, rank: ranks.get(r.id) ?? null }));
}

export function classStats(avgs: number[]) {
  if (!avgs.length) return null;
  return { min: Math.min(...avgs), max: Math.max(...avgs), mean: avgs.reduce((a, b) => a + b, 0) / avgs.length };
}

export interface ReportLine { subjectId: string; coefficient: number; average: Displayed }
export interface ReportCard { lines: ReportLine[]; general: Displayed | null; rank: number | null; classSize: number }

/** Report card content, every value shown in the student's active scale. */
export function buildReportCard(p: {
  grades: GradeIn[]; subjectCoefs: Record<string, number>; scale: GradingScale; locale?: string; colors?: ColorBand[];
  rank?: number | null; classSize?: number;
}): ReportCard {
  const subj = subjectAverages(p.grades);
  const gen = generalAverage(subj, p.subjectCoefs);
  return {
    lines: Object.entries(subj).map(([subjectId, a]) => ({ subjectId, coefficient: p.subjectCoefs[subjectId] ?? 1, average: display(a, p.scale, p.locale, p.colors) })),
    general: gen === null ? null : display(gen, p.scale, p.locale, p.colors),
    rank: p.rank ?? null, classSize: p.classSize ?? 0,
  };
}
