import { computeOaa, oaaAlert } from '../../../shared/src/oaa.ts';
import type { OaaAxes, OaaWeights } from '../../../shared/src/oaa.ts';
import type { HookHandler } from '../../../shared/src/modules.ts';

type Cfg = { weights: OaaWeights; thresholds: { warning: number; penalty: number }; initial_axes: OaaAxes };
const cfg = (c: Record<string, unknown>) => c as unknown as Cfg;

function result(axes: OaaAxes, c: Cfg) {
  const score100 = computeOaa(axes, c.weights);
  return { axes, score100, alert: oaaAlert(score100, c.thresholds) };
}

export const handlers: Record<string, HookHandler> = {
  calculateInitialOAA: (p: { studentId: string }, { config }) => ({ studentId: p.studentId, ...result(cfg(config).initial_axes, cfg(config)) }),
  recalculateOAA: (p: { studentId: string; axes: OaaAxes }, { config }) => ({ studentId: p.studentId, ...result(p.axes, cfg(config)) }),
  updateOAA: (p: { studentId: string; axes: OaaAxes }, { config }) => ({ studentId: p.studentId, ...result(p.axes, cfg(config)) }),
};
