/** Offline sync rules shared by the PWA and the mobile app (spec 12.4). The Dart client mirrors these tables (see apps/mobile/lib/core/offline_queue.dart). */
export type ReplayVerdict = 'done' | 'retry' | 'conflict';

/** What to do with a queued write after the server answered `status` (0 = no answer). Only definitive refusals reach the conflict journal. */
export function classifyReplay(status: number): ReplayVerdict {
  if (status >= 200 && status < 300) return 'done';
  if (status === 0 || status === 401 || status === 408 || status === 425 || status === 429 || status >= 500) return 'retry';   // transient or re-authentication needed: keep the write and its order
  return 'conflict';
}

export type SyncKind = 'grade' | 'absence' | 'lesson' | 'message' | 'other';
export type Resolution = 'client' | 'server' | 'merge';

/** Conflict policy per data type: who wins when the record changed on the server while the user was offline. */
export function resolveConflict(kind: SyncKind, ctx: { role: string; clientAt: string; serverUpdatedAt: string }): Resolution {
  const clientNewer = Date.parse(ctx.clientAt) >= Date.parse(ctx.serverUpdatedAt);
  switch (kind) {
    case 'grade': return ctx.role === 'teacher' ? 'client' : 'server';   // teacher entries have priority, nobody else can overwrite a grade
    case 'absence': return 'merge';                                        // union of marks; an absence outweighs a lateness
    case 'message': return 'merge';                                        // append-only
    case 'lesson': return clientNewer ? 'client' : 'server';              // last writer wins, the loser is journaled
    default: return 'server';
  }
}

/** Merge two attendance marks for the same student and slot. */
export function mergeAttendance(a: 'absence' | 'late', b: 'absence' | 'late'): 'absence' | 'late' { return a === 'absence' || b === 'absence' ? 'absence' : 'late'; }

/** Replay order: higher priority first (teacher grades), arrival order inside a priority. */
export function replayOrder<T extends { priority?: number }>(ops: T[]): T[] {
  return ops.map((o, i) => ({ o, i })).sort((x, y) => (y.o.priority ?? 0) - (x.o.priority ?? 0) || x.i - y.i).map((x) => x.o);
}
