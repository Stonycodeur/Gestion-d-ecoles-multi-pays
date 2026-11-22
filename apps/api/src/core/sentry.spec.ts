import { buildEvent, parseDsn, reportError } from './sentry';

describe('sentry reporter', () => {
  it('parses a DSN into the store URL and auth header', () => {
    const t = parseDsn('https://abc123@o1.ingest.sentry.io/42')!;
    expect(t.url).toBe('https://o1.ingest.sentry.io/api/42/store/'); expect(t.auth).toContain('sentry_key=abc123');
    expect(parseDsn('not a dsn')).toBeUndefined();
  });
  it('events carry no request body, headers or query string', () => {
    const ev = buildEvent(new Error('boom'), { method: 'POST', route: '/grades/:id' });
    expect(JSON.stringify(ev)).not.toMatch(/authorization|cookie|password/i); expect(ev.request).toEqual({ method: 'POST', url: '/grades/:id' });
  });
  it('is a no-op without DSN and never throws when the network fails', async () => {
    expect(await reportError(new Error('x'), {}, undefined)).toBe(false);
    expect(await reportError(new Error('x'), {}, 'https://k@h.example/1', (async () => { throw new Error('net'); }) as unknown as typeof fetch)).toBe(false);
    let sent = ''; const ok = await reportError(new Error('x'), { route: '/r' }, 'https://k@h.example/1', (async (_u: string, i: RequestInit) => { sent = String(i.body); return { ok: true }; }) as unknown as typeof fetch);
    expect(ok).toBe(true); expect(sent).toContain('"route":"/r"');
  });
});
