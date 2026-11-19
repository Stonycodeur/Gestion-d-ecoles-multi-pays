import type { HookHandler } from '../../../shared/src/modules.ts';

/** A new grade makes the stored prediction stale: the core re-scores those students on its next run (no automatic decision is ever taken). */
export const handlers: Record<string, HookHandler> = {
  markForRescore: (p: { studentIds?: string[] }) => ({ stale: p.studentIds ?? [] }),
};
