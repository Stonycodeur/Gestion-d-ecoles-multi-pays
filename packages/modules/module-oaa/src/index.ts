import { computeOaaAxes } from '../../../shared/src/oaa-axes.ts';
import { oaaAlert } from '../../../shared/src/oaa.ts';
import type { Axes, AxisWeights } from '../../../shared/src/oaa-axes.ts';
import type { HookHandler } from '../../../shared/src/modules.ts';

type Cfg = { weights: AxisWeights; thresholds: { warning: number; penalty: number }; initial_axes: Axes; initial_value?: number };
const cfg = (c: Record<string, unknown>) => c as unknown as Cfg;
interface Payload { studentId: string; axes?: Axes; profile?: AxisWeights; thresholds?: { warning: number; penalty: number } }

/** Weights come from the level profile when the core passes one (spec 7.5), otherwise from the module configuration. */
function result(p: Payload, c: Cfg, initial: boolean) {
  const weights = p.profile ?? c.weights;
  const axes: Axes = p.axes ?? Object.fromEntries(Object.keys(weights).map((k) => [k, c.initial_axes[k] ?? c.initial_value ?? 50]));
  if (!initial && !p.axes) throw new Error('axes are required to recalculate');
  const score100 = computeOaaAxes(axes, weights);
  return { studentId: p.studentId, axes, score100, alert: oaaAlert(score100, p.thresholds ?? c.thresholds) };
}

export const handlers: Record<string, HookHandler> = {
  calculateInitialOAA: (p: Payload, { config }) => result(p, cfg(config), true),
  recalculateOAA: (p: Payload, { config }) => result(p, cfg(config), false),
  updateOAA: (p: Payload, { config }) => result(p, cfg(config), false),
};
