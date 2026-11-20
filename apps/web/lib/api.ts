import { enqueue, flush } from './offline-queue';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3000';
export interface Session { school: string; token: string }

export const getSession = (): Session | null => {
  try { return JSON.parse(sessionStorage.getItem('em_session') ?? 'null') as Session | null; } catch { return null; }
};
export const setSession = (s: Session | null) => { if (s) sessionStorage.setItem('em_session', JSON.stringify(s)); else sessionStorage.removeItem('em_session'); };

const headers = (s: Session | null): Record<string, string> => ({
  'content-type': 'application/json', ...(s ? { 'x-tenant': s.school, authorization: `Bearer ${s.token}` } : {}),
});
const cacheKey = (p: string) => `em_cache:${p}`;

export interface ApiResult<T> { ok: boolean; status: number; data?: T; error?: string; queued?: boolean; fromCache?: boolean }

/** GET: network first, falls back to the last cached answer offline. Writes: queued when offline. */
/** `online: true` for writes that must never be queued (payments, quizzes, GPS): offline they fail visibly instead of being replayed later. */
export async function api<T = any>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; online?: boolean } = {}): Promise<ApiResult<T>> {
  const s = getSession(); const method = init.method ?? 'GET';
  try {
    const r = await fetch(`${API_BASE}${path}`, { method, headers: { ...headers(s), ...(init.headers ?? {}) }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const text = await r.text(); let data: any; try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
    if (r.ok && method === 'GET') { try { localStorage.setItem(cacheKey(path), text); } catch { /* ignore */ } }
    return r.ok ? { ok: true, status: r.status, data } : { ok: false, status: r.status, error: data?.message ? JSON.stringify(data.message) : r.statusText };
  } catch {
    if (method === 'GET') {
      const c = localStorage.getItem(cacheKey(path));
      return c ? { ok: true, status: 200, data: JSON.parse(c) as T, fromCache: true } : { ok: false, status: 0, error: 'offline' };
    }
    if (init.online) return { ok: false, status: 0, error: 'offline: this action needs a connection' };
    enqueue({ method, path, body: init.body });
    return { ok: true, status: 202, queued: true };
  }
}

export const replayQueue = () => flush(async (op) => {
  const r = await fetch(`${API_BASE}${op.path}`, { method: op.method, headers: headers(getSession()), body: op.body === undefined ? undefined : JSON.stringify(op.body) });
  return { status: r.status, message: r.statusText };
});

export const login = async (school: string, role: string): Promise<Session> => {
  const r = await fetch(`${API_BASE}/auth/sandbox/token`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tenant': school },
    body: JSON.stringify({ sub: `web-${role}`, role, tenant: school }) });
  if (!r.ok) throw new Error(`login failed (${r.status})`);
  return { school, token: (await r.json()).access_token as string };
};

/** Authenticated download (PDF receipts, bulletins): opens the file in a new tab. */
export async function openPdf(path: string): Promise<boolean> {
  try {
    const r = await fetch(`${API_BASE}${path}`, { headers: headers(getSession()) });
    if (!r.ok) return false;
    window.open(URL.createObjectURL(await r.blob()), '_blank');
    return true;
  } catch { return false; }
}
