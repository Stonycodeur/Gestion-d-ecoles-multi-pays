import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

/** Phase 6b (spec 6.19): public API building blocks (OAuth2 client credentials, scopes, quotas, signed outgoing webhooks, SSRF guard). */
export const API_SCOPES = ['students:read', 'classes:read', 'news:read', 'grades:read', 'absences:read', 'schedule:read'] as const;
export const WEBHOOK_EVENTS = ['student.created', 'news.published', 'payment.confirmed', 'grade.published', 'absence.recorded'] as const;

export function parseScopes(requested: unknown, allowed: readonly string[]): string[] {
  const list = typeof requested === 'string' ? requested.split(/[\s,]+/).filter(Boolean) : Array.isArray(requested) ? requested.map(String) : [];
  if (!list.length) throw new Error('at least one scope is required');
  const bad = list.filter((s) => !allowed.includes(s));
  if (bad.length) throw new Error(`unknown or forbidden scope: ${bad.join(', ')}`);
  return [...new Set(list)];
}
export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export function generateClientCredentials(): { client_id: string; client_secret: string } {
  return { client_id: `cli_${randomBytes(8).toString('hex')}`, client_secret: randomBytes(32).toString('base64url') };
}
export function secretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(sha256(secret), 'hex'), b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface AccessClaims { cid: string; tenant: string; scopes: string[]; exp: number }
const b64 = (s: string) => Buffer.from(s).toString('base64url');
/** Stateless access token: base64url(claims).hmac. Short-lived (client credentials grant); revoking a client rejects its tokens at verification. */
export function signAccessToken(secret: string, c: AccessClaims): string { const p = b64(JSON.stringify(c)); return `${p}.${createHmac('sha256', secret).update(p).digest('base64url')}`; }
export function verifyAccessToken(secret: string, token: string, nowSec: number = Math.floor(Date.now() / 1000)): AccessClaims | null {
  const [p, sig] = token.split('.'); if (!p || !sig || token.split('.').length !== 2) return null;
  const expected = createHmac('sha256', secret).update(p).digest(); let given: Buffer;
  try { given = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try { const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as AccessClaims; return c.exp > nowSec && Array.isArray(c.scopes) ? c : null; } catch { return null; }
}

/** Fixed-window quota counter (in memory; use Redis for several API instances). */
export class QuotaCounter {
  private w = new Map<string, { start: number; n: number }>();
  hit(key: string, limit: number, windowMs = 3600_000, now: number = Date.now()): { allowed: boolean; remaining: number; resetAt: number } {
    const cur = this.w.get(key); const w = cur && now - cur.start < windowMs ? cur : { start: now, n: 0 };
    if (w.n >= limit) { this.w.set(key, w); return { allowed: false, remaining: 0, resetAt: w.start + windowMs }; }
    w.n++; this.w.set(key, w); return { allowed: true, remaining: limit - w.n, resetAt: w.start + windowMs };
  }
}

export function webhookHeaders(secret: string, event: string, body: string, nowSec: number = Math.floor(Date.now() / 1000)): Record<string, string> {
  return { 'content-type': 'application/json', 'x-em-event': event, 'x-em-timestamp': String(nowSec), 'x-em-signature': createHmac('sha256', secret).update(`${nowSec}.${body}`).digest('hex') };
}

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip); if (!v) return false;
  if (v === 4) { const [a, b] = ip.split('.').map(Number) as [number, number]; return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127); }
  const l = ip.toLowerCase(); if (l.startsWith('::ffff:')) return isPrivateIp(l.slice(7));
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
}
/** Static URL check for webhook targets; the dispatcher re-checks the resolved address (DNS rebinding). */
export function checkWebhookUrl(raw: string, allowPrivate = false): string | null {
  let u: URL; try { u = new URL(raw); } catch { return 'invalid URL'; }
  if (u.username || u.password) return 'credentials in URL are not allowed';
  if (allowPrivate) return u.protocol === 'http:' || u.protocol === 'https:' ? null : 'only http(s)';
  if (u.protocol !== 'https:') return 'only https is allowed';
  const h = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return 'host is not allowed';
  if (isPrivateIp(h)) return 'private addresses are not allowed';
  return null;
}
