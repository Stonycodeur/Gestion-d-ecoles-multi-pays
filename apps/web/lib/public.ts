import { API_BASE } from './api';

/** Unauthenticated calls to the public space (the school code is in the path). */
export async function pub<T = any>(school: string, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  try {
    const r = await fetch(`${API_BASE}/public/${encodeURIComponent(school)}${path}`, { method: init.method ?? 'GET', headers: { 'content-type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    const text = await r.text(); let data: any; try { data = text ? JSON.parse(text) : undefined; } catch { data = text; }
    return r.ok ? { ok: true, status: r.status, data } : { ok: false, status: r.status, error: Array.isArray(data?.errors) ? data.errors.join(', ') : (data?.message ?? r.statusText) };
  } catch { return { ok: false, status: 0, error: 'offline' }; }
}
