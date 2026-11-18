// Offline writes (spec 12.4): failed mutations are queued in the browser and replayed in order when the connection returns.
// Conflicts (server answers 4xx) are not retried: they go to a journal the user can consult.
export interface QueuedOp { id: string; method: string; path: string; body?: unknown; at: string }
export interface ConflictEntry { op: QueuedOp; status: number; message: string; at: string }

const QK = 'em_queue', CK = 'em_conflicts';
const read = <T,>(k: string): T[] => { try { return JSON.parse(localStorage.getItem(k) ?? '[]') as T[]; } catch { return []; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or unavailable */ } };

export const pendingOps = () => read<QueuedOp>(QK);
export const conflictJournal = () => read<ConflictEntry>(CK);
export function enqueue(op: Omit<QueuedOp, 'id' | 'at'>): QueuedOp {
  const full = { ...op, id: crypto.randomUUID(), at: new Date().toISOString() };
  write(QK, [...pendingOps(), full]);
  return full;
}

export async function flush(send: (op: QueuedOp) => Promise<{ status: number; message: string }>): Promise<{ sent: number; conflicts: number; remaining: number }> {
  let sent = 0, conflicts = 0;
  const rest = pendingOps();
  while (rest.length) {
    const op = rest[0];
    let r: { status: number; message: string };
    try { r = await send(op); } catch { break; }            // still offline: keep order, try later
    rest.shift();
    if (r.status >= 200 && r.status < 300) sent++;
    else { conflicts++; write(CK, [...conflictJournal(), { op, status: r.status, message: r.message, at: new Date().toISOString() }]); }
    write(QK, rest);
  }
  write(QK, rest);
  return { sent, conflicts, remaining: rest.length };
}
