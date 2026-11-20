/** Parent GPS tracking rules (spec 10): revocable consent with time window, geofencing, retention. Pure and testable. */
export interface ConsentWindow { days: number[]; start: string; end: string; timezone: string }   // days: 1 = Monday .. 7 = Sunday ; "HH:MM"
const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
function localParts(ms: number, timezone: string): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return { day: WEEKDAY[get('weekday')]!, minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}
const toMin = (hhmm: string) => { const m = /^(\d{2}):(\d{2})$/.exec(hhmm); if (!m) throw new RangeError(`Invalid time ${hhmm}`); return Number(m[1]) * 60 + Number(m[2]); };

/** True when tracking is allowed at `ms`. A window may cross midnight (22:00 -> 06:00): the weekday of the START applies. */
export function inWindow(w: ConsentWindow, ms: number): boolean {
  const s = toMin(w.start), e = toMin(w.end), { day, minutes } = localParts(ms, w.timezone);
  if (s <= e) return w.days.includes(day) && minutes >= s && minutes <= e;
  if (minutes >= s) return w.days.includes(day);
  const prev = day === 1 ? 7 : day - 1;
  return minutes <= e && w.days.includes(prev);
}

export interface Consent { granted: boolean; revoked_at?: string | null; window: ConsentWindow }
export function trackingAllowed(c: Consent | null | undefined, ms: number): { allowed: boolean; reason: string } {
  if (!c) return { allowed: false, reason: 'no consent' };
  if (!c.granted) return { allowed: false, reason: 'consent not granted' };
  if (c.revoked_at) return { allowed: false, reason: 'consent revoked' };
  if (!inWindow(c.window, ms)) return { allowed: false, reason: 'outside the agreed time window' };
  return { allowed: true, reason: 'ok' };
}

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371008.8, rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface Position { lat: number; lng: number; accuracy_m: number; at_ms: number }
export interface PositionPolicy { maxAccuracyM: number; maxAgeSec: number; maxFutureSec: number }
export const DEFAULT_POSITION_POLICY: PositionPolicy = { maxAccuracyM: 100, maxAgeSec: 600, maxFutureSec: 60 };
/** Rejects invalid coordinates, imprecise fixes (they would trigger false geofence events) and stale/future timestamps. */
export function acceptPosition(p: Position, nowMs: number, policy: PositionPolicy = DEFAULT_POSITION_POLICY): { ok: boolean; reason?: string } {
  if (!(p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180)) return { ok: false, reason: 'invalid coordinates' };
  if (!(p.accuracy_m >= 0) || p.accuracy_m > policy.maxAccuracyM) return { ok: false, reason: 'accuracy too low' };
  if (nowMs - p.at_ms > policy.maxAgeSec * 1000) return { ok: false, reason: 'position too old' };
  if (p.at_ms - nowMs > policy.maxFutureSec * 1000) return { ok: false, reason: 'position in the future' };
  return { ok: true };
}

export interface Geofence { id: string; kind: 'school' | 'home' | 'safe'; lat: number; lng: number; radius_m: number; expected_in_window?: boolean }
export interface GeoState { inside: string[]; out_of_zone: boolean }
export interface GeoEvent { type: 'arrival' | 'exit' | 'out_of_zone'; geofence_id?: string }
/** Transition-based: an event is produced once when the state changes (no notification storm while the child stays inside). */
export function evaluateGeofences(prev: GeoState, pos: Position, fences: Geofence[], windowActive: boolean): { state: GeoState; events: GeoEvent[] } {
  const inside = fences.filter((f) => haversineM(pos, f) <= f.radius_m).map((f) => f.id);
  const events: GeoEvent[] = [];
  for (const id of inside) if (!prev.inside.includes(id)) events.push({ type: 'arrival', geofence_id: id });
  for (const id of prev.inside) if (!inside.includes(id) && fences.some((f) => f.id === id)) events.push({ type: 'exit', geofence_id: id });
  const expected = fences.filter((f) => f.expected_in_window);
  const outside = windowActive && expected.length > 0 && !expected.some((f) => inside.includes(f.id)) && inside.length === 0;
  // out_of_zone only after the child was seen in an expected zone: a first fix elsewhere is not an incident
  const wasInExpected = prev.inside.some((id) => expected.some((f) => f.id === id)) || prev.out_of_zone;
  let out = prev.out_of_zone;
  if (outside && wasInExpected && !prev.out_of_zone) { events.push({ type: 'out_of_zone' }); out = true; }
  if (!outside && inside.length > 0) out = false;
  return { state: { inside, out_of_zone: out }, events };
}

export function purgeCutoff(nowMs: number, retentionDays: number): number {
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) throw new RangeError('Retention must be 1..365 days');
  return nowMs - retentionDays * 86400000;
}
/** Reporting interval requested from the student's app: 30 s in school mode (spec 10), slower otherwise, none without consent. */
export function reportIntervalSec(mode: 'school' | 'outside' | 'off', schoolSec = 30, outsideSec = 300): number | null {
  return mode === 'school' ? schoolSec : mode === 'outside' ? outsideSec : null;
}
