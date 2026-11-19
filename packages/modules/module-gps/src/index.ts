import type { HookHandler } from '../../../shared/src/modules.ts';
import { purgeCutoff } from '../../../shared/src/gps.ts';

/** Tracking is OFF for a new student until a guardian grants consent. This hook only validates the school retention setting. */
export const handlers: Record<string, HookHandler> = {
  defaultRetention: (_p: unknown, ctx: { config: Record<string, unknown> }) => {
    const days = Number(ctx.config.retention_days ?? 30);
    purgeCutoff(Date.now(), days);          // throws on an invalid configuration
    return { tracking: 'off_until_consent', retention_days: days };
  },
};
