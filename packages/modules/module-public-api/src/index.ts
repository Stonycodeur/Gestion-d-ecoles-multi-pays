import type { HookHandler } from '../../../shared/src/modules.ts';

/** Declarative module: routes and persistence live in the core services gated by the module flag; no hooks. */
export const handlers: Record<string, HookHandler> = {};
