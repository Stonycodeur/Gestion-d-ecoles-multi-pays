/** Copy of classifyReplay from packages/shared/src/offline.ts (see the parity test in packages/shared/test/web-parity.test.ts). */
export type ReplayVerdict = 'done' | 'retry' | 'conflict';

/** What to do with a queued write after the server answered `status` (0 = no answer). Only definitive refusals reach the conflict journal. */
export function classifyReplay(status: number): ReplayVerdict {
  if (status >= 200 && status < 300) return 'done';
  if (status === 0 || status === 401 || status === 408 || status === 425 || status === 429 || status >= 500) return 'retry';   // transient or re-authentication needed: keep the write and its order
  return 'conflict';
}
