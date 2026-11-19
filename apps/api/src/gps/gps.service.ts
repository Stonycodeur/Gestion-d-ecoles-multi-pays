import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { acceptPosition, can, decryptText, encryptText, evaluateGeofences, inWindow, reportIntervalSec, trackingAllowed, type ConsentWindow, type GeoState, type Geofence, type Principal } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { mapDbError, num, optStr, str, uuid } from '../pedagogy/validate';
import { ModulesService } from '../modules/modules.service';
import { NotificationService } from '../comms/notification.service';
import { AuditService } from '../core/audit.service';

export const GPS_MODULE = 'module-gps';
type Tenant = { id: string; slug: string; country: string; schoolType: string };
const MAX_HISTORY = 1000;

@Injectable()
export class GpsService {
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly notif: NotificationService, private readonly audit: AuditService) {}

  private tx<T>(slug: string, fn: (q: Q, t: Tenant) => Promise<T>): Promise<T> { return this.db.run(slug, fn).catch((e) => mapDbError(e)); }
  private authorize(p: Principal, slug: string, perm: string, r: Record<string, unknown> = {}) { const d = can(p, perm, { tenantId: slug, ...r }); if (!d.allowed) throw new ForbiddenException(d.reason); }
  requireEnabled(slug: string) { if (!this.modules.registry.isEnabled(slug, GPS_MODULE)) throw new ForbiddenException('GPS module is not enabled for this school'); }
  private cfg(slug: string) { const c = this.modules.registry.config(slug, GPS_MODULE); return { retention: Number(c.retention_days ?? 30), school: Number(c.school_interval_sec ?? 30), outside: Number(c.outside_interval_sec ?? 300) }; }
  private key(): string { const k = process.env.GPS_KEY; if (!k) throw new BadRequestException('GPS_KEY is not configured'); return k; }
  private async log(q: Q, studentId: string, userId: string, action: string) { await q('INSERT INTO gps_access_log(student_id, user_id, action) VALUES ($1,$2,$3)', [studentId, userId, action]); }

  private parseWindow(w: any, tz: string): ConsentWindow {
    const days = Array.isArray(w?.days) ? w.days.map((d: unknown) => Math.round(num(d, 'day', 1, 7))) : [];
    if (!days.length) throw new BadRequestException('window.days: at least one day (1 = Monday .. 7 = Sunday)');
    for (const k of ['start', 'end']) if (typeof w?.[k] !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(w[k])) throw new BadRequestException(`window.${k} must be HH:MM`);
    const timezone = typeof w.timezone === 'string' ? w.timezone : tz;
    try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw new BadRequestException('window.timezone is not a valid IANA time zone'); }
    return { days, start: w.start, end: w.end, timezone };
  }
  private async consents(q: Q, studentId: string) {
    return (await q('SELECT guardian_user_id, granted, revoked_at, consent_window, retention_days FROM gps_consents WHERE student_id = $1', [studentId]))
      .map((c: any) => ({ guardian_user_id: c.guardian_user_id as string, granted: c.granted as boolean, revoked_at: c.revoked_at ? String(c.revoked_at) : null, window: c.consent_window as ConsentWindow, retention_days: c.retention_days as number }));
  }

  // ---- consent -------------------------------------------------------------------------------------------------------------
  /** Guardians grant (with time window and retention) or revoke. The student can only REVOKE (a minor cannot grant surveillance on themselves). Revoking purges the stored positions. */
  async setConsent(slug: string, p: Principal, studentId: string, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'gps:consent', { studentId: uuid(studentId, 'student_id') });
    const granted = b?.granted === true;
    const isStudent = p.studentId === studentId && !p.childIds?.includes(studentId);
    if (isStudent && granted) throw new ForbiddenException('only a guardian can grant tracking; the student can revoke');
    const out = await this.tx(slug, async (q, t) => {
      if (!(await q('SELECT 1 FROM students WHERE id = $1', [studentId])).length) throw new NotFoundException('student not found');
      const tz = (await q('SELECT timezone FROM public.countries WHERE code = $1', [t.country]))[0]?.timezone ?? 'UTC';
      if (isStudent) {
        await q('UPDATE gps_consents SET granted = FALSE, revoked_at = NOW(), updated_at = NOW() WHERE student_id = $1 AND granted', [studentId]);
      } else if (granted) {
        const w = this.parseWindow(b.window, tz); const max = this.cfg(slug).retention;
        const days = Math.round(num(b.retention_days ?? max, 'retention_days', 1, 365));
        if (days > max) throw new BadRequestException(`retention_days cannot exceed the school limit (${max})`);
        await q(`INSERT INTO gps_consents(student_id, guardian_user_id, granted, consent_window, retention_days, granted_at, revoked_at) VALUES ($1,$2,TRUE,$3,$4,NOW(),NULL)
          ON CONFLICT (student_id, guardian_user_id) DO UPDATE SET granted = TRUE, consent_window = $3, retention_days = $4, granted_at = NOW(), revoked_at = NULL, updated_at = NOW()`, [studentId, p.id, JSON.stringify(w), days]);
      } else {
        await q('UPDATE gps_consents SET granted = FALSE, revoked_at = NOW(), updated_at = NOW() WHERE student_id = $1 AND guardian_user_id = $2', [studentId, p.id]);
      }
      const active = (await this.consents(q, studentId)).some((c) => c.granted && !c.revoked_at);
      let purged = 0;
      if (!active) { purged = (await q('WITH d AS (DELETE FROM gps_positions WHERE student_id = $1 RETURNING 1) SELECT COUNT(*)::int AS n FROM d', [studentId]))[0].n; await q('DELETE FROM gps_state WHERE student_id = $1', [studentId]); }
      return { tracking_active: active, positions_purged: purged };
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: granted ? 'gps.consent.grant' : 'gps.consent.revoke', entity: 'student', entityId: studentId });
    return out;
  }
  async myConsent(slug: string, p: Principal, studentId: string) {
    this.requireEnabled(slug); this.authorize(p, slug, 'gps:consent', { studentId: uuid(studentId, 'student_id') });
    return this.tx(slug, async (q) => {
      const all = await this.consents(q, studentId);
      const mine = all.find((c) => c.guardian_user_id === p.id) ?? null;
      return { mine, tracking_active: all.some((c) => c.granted && !c.revoked_at), limit_days: this.cfg(slug).retention };   // other guardians' details are not exposed
    });
  }
  /** What the student's app must do right now: report every 30 s in school mode, nothing without consent / outside the window. */
  async policy(slug: string, p: Principal, studentId: string) {
    this.requireEnabled(slug); this.authorize(p, slug, 'gps:report', { studentId: uuid(studentId, 'student_id') });
    const cs = await this.tx(slug, (q) => this.consents(q, studentId));
    const now = Date.now(); const verdicts = cs.map((c) => trackingAllowed(c, now));
    const allowed = verdicts.some((v) => v.allowed); const c = this.cfg(slug);
    return { allowed, reason: allowed ? 'ok' : (verdicts[0]?.reason ?? 'no consent'), interval_sec: reportIntervalSec(allowed ? 'school' : 'off', c.school, c.outside) };
  }

  // ---- reporting (student app) ---------------------------------------------------------------------------------------------------
  async report(slug: string, p: Principal, studentId: string, b: any) {
    this.requireEnabled(slug); this.authorize(p, slug, 'gps:report', { studentId: uuid(studentId, 'student_id') });
    const at = b.recorded_at ? Date.parse(String(b.recorded_at)) : Date.now();
    if (Number.isNaN(at)) throw new BadRequestException('recorded_at must be an ISO date');
    const pos = { lat: num(b.lat, 'lat', -90, 90), lng: num(b.lng, 'lng', -180, 180), accuracy_m: num(b.accuracy_m ?? 10, 'accuracy_m', 0, 100000), at_ms: at };
    const ok = acceptPosition(pos, Date.now());
    if (!ok.ok) return { stored: false, reason: ok.reason };
    const key = this.key();
    const res = await this.tx(slug, async (q, t) => {
      const cs = await this.consents(q, studentId);
      const active = cs.filter((c) => trackingAllowed(c, at).allowed);
      if (!active.length) return { stored: false, reason: cs.length ? trackingAllowed(cs[0]!, at).reason : 'no consent', guardians: [] as string[], events: [] as any[], names: '' };
      await q('INSERT INTO gps_positions(student_id, enc, accuracy_m, recorded_at) VALUES ($1,$2,$3,$4)', [studentId, encryptText(JSON.stringify({ lat: pos.lat, lng: pos.lng }), key), pos.accuracy_m, new Date(at)]);
      const fences = (await q('SELECT id, kind, lat, lng, radius_m, expected_in_window, name FROM gps_geofences WHERE student_id = $1 OR student_id IS NULL', [studentId]))
        .map((f: any) => ({ id: f.id, kind: f.kind, lat: f.lat, lng: f.lng, radius_m: f.radius_m, expected_in_window: f.expected_in_window, name: f.name })) as (Geofence & { name: string })[];
      const prev = ((await q('SELECT state FROM gps_state WHERE student_id = $1', [studentId]))[0]?.state ?? { inside: [], out_of_zone: false }) as GeoState;
      const windowActive = active.some((c) => inWindow(c.window, at));
      const ev = evaluateGeofences(prev, pos, fences, windowActive);
      await q('INSERT INTO gps_state(student_id, state) VALUES ($1,$2) ON CONFLICT (student_id) DO UPDATE SET state = $2, updated_at = NOW()', [studentId, JSON.stringify(ev.state)]);
      for (const e of ev.events) await q('INSERT INTO gps_events(student_id, type, geofence_id, occurred_at) VALUES ($1,$2,$3,$4)', [studentId, e.type, e.geofence_id ?? null, new Date(at)]);
      const name = (await q('SELECT first_name FROM students WHERE id = $1', [studentId]))[0]?.first_name ?? '';
      return { stored: true as const, reason: 'ok', guardians: active.map((c) => c.guardian_user_id), names: name as string,
        events: ev.events.map((e) => ({ ...e, fence: fences.find((f) => f.id === e.geofence_id)?.name })) };
    });
    for (const e of res.events) {
      const what = e.type === 'arrival' ? `${res.names} : arrivée — ${e.fence}` : e.type === 'exit' ? `${res.names} : sortie — ${e.fence}` : `${res.names} : hors zone attendue`;
      await this.notif.notify(slug, res.guardians, 'gps.alert', { text: what }, { student_id: studentId, event: e.type });
    }
    return { stored: res.stored, reason: res.reason, events: res.events.map((e) => ({ type: e.type, geofence_id: e.geofence_id })) };
  }

  // ---- parent views (consent required, every access logged) -----------------------------------------------------------------
  private async parentAccess(q: Q, slug: string, p: Principal, studentId: string, liveView = false) {
    const mine = (await this.consents(q, studentId)).find((c) => c.guardian_user_id === p.id);
    const active = !!mine && trackingAllowed(mine, Date.now()).reason !== 'consent revoked' && mine.granted && !mine.revoked_at;
    this.authorize(p, slug, 'gps:read', { studentId, consentGranted: active });
    if (!active) throw new ForbiddenException('no active consent from this account');
    if (liveView && !inWindow(mine!.window, Date.now())) throw new ForbiddenException('outside the agreed time window');   // the live position is only visible inside the window the guardian agreed to
  }
  async live(slug: string, p: Principal, studentId: string) {
    this.requireEnabled(slug); uuid(studentId, 'student_id');
    const key = this.key();
    return this.tx(slug, async (q) => {
      await this.parentAccess(q, slug, p, studentId, true);
      const last = (await q('SELECT enc, accuracy_m, recorded_at FROM gps_positions WHERE student_id = $1 ORDER BY recorded_at DESC LIMIT 1', [studentId]))[0];
      const state = (await q('SELECT state FROM gps_state WHERE student_id = $1', [studentId]))[0]?.state ?? null;
      await this.log(q, studentId, p.id, 'view_live');
      if (!last) return { position: null, state };
      return { position: { ...JSON.parse(decryptText(last.enc, key)), accuracy_m: last.accuracy_m, recorded_at: last.recorded_at }, state };
    });
  }
  async history(slug: string, p: Principal, studentId: string, from?: string, to?: string) {
    this.requireEnabled(slug); uuid(studentId, 'student_id');
    const key = this.key(); const f = from ? new Date(from) : new Date(Date.now() - 86400000), t2 = to ? new Date(to) : new Date();
    if (Number.isNaN(f.getTime()) || Number.isNaN(t2.getTime())) throw new BadRequestException('from/to must be ISO dates');
    return this.tx(slug, async (q) => {
      await this.parentAccess(q, slug, p, studentId);
      const rows = await q('SELECT enc, accuracy_m, recorded_at FROM gps_positions WHERE student_id = $1 AND recorded_at BETWEEN $2 AND $3 ORDER BY recorded_at LIMIT $4', [studentId, f, t2, MAX_HISTORY]);
      await this.log(q, studentId, p.id, 'view_history');
      return rows.map((r: any) => ({ ...JSON.parse(decryptText(r.enc, key)), accuracy_m: r.accuracy_m, recorded_at: r.recorded_at }));
    });
  }
  async events(slug: string, p: Principal, studentId: string) {
    this.requireEnabled(slug); uuid(studentId, 'student_id');
    return this.tx(slug, async (q) => {
      await this.parentAccess(q, slug, p, studentId);
      await this.log(q, studentId, p.id, 'view_events');
      return q('SELECT e.type, e.occurred_at, g.name AS geofence FROM gps_events e LEFT JOIN gps_geofences g ON g.id = e.geofence_id WHERE e.student_id = $1 ORDER BY e.occurred_at DESC LIMIT 200', [studentId]);
    });
  }
  /** Who looked at the child's position and when: visible to the guardians and to the school's data protection owner (direction/admin). */
  async accessLog(slug: string, p: Principal, studentId: string) {
    this.requireEnabled(slug); uuid(studentId, 'student_id');
    if (!can(p, 'gps:configure', { tenantId: slug }).allowed) this.authorize(p, slug, 'gps:consent', { studentId });
    return this.tx(slug, (q) => q('SELECT user_id, action, at FROM gps_access_log WHERE student_id = $1 ORDER BY at DESC LIMIT 500', [studentId]));
  }

  // ---- geofences ---------------------------------------------------------------------------------------------------------------------
  async createGeofence(slug: string, p: Principal, b: any) {
    this.requireEnabled(slug);
    const studentId = b.student_id ? uuid(b.student_id, 'student_id') : null;
    if (studentId) this.authorize(p, slug, 'gps:consent', { studentId }); else this.authorize(p, slug, 'gps:configure');   // school-wide zones: direction / admin
    const kind = str(b.kind, 'kind', 10); if (!['school', 'home', 'safe'].includes(kind)) throw new BadRequestException('kind must be school|home|safe');
    if (!studentId && kind !== 'school') throw new BadRequestException('a school-wide zone must have kind school');
    return this.tx(slug, async (q) => (await q('INSERT INTO gps_geofences(student_id, name, kind, lat, lng, radius_m, expected_in_window) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [studentId, str(b.name, 'name', 80), kind, num(b.lat, 'lat', -90, 90), num(b.lng, 'lng', -180, 180), Math.round(num(b.radius_m, 'radius_m', 20, 5000)), b.expected_in_window === true || kind === 'school']))[0]);
  }
  async listGeofences(slug: string, p: Principal, studentId: string) {
    this.requireEnabled(slug); this.authorize(p, slug, 'gps:consent', { studentId: uuid(studentId, 'student_id') });
    return this.tx(slug, (q) => q('SELECT * FROM gps_geofences WHERE student_id = $1 OR student_id IS NULL ORDER BY name', [studentId]));
  }

  // ---- retention ---------------------------------------------------------------------------------------------------------------------
  /** Daily job: positions and events older than the retention agreed in the consent (school default when none) are deleted. */
  async purge(slug: string, p: Principal) {
    this.requireEnabled(slug); this.authorize(p, slug, 'gps:configure');
    const def = this.cfg(slug).retention;
    const out = await this.tx(slug, async (q) => {
      const days = `COALESCE((SELECT MIN(c.retention_days) FROM gps_consents c WHERE c.student_id = X.student_id AND c.granted AND c.revoked_at IS NULL), $1::int)`;
      const pos = (await q(`WITH d AS (DELETE FROM gps_positions X WHERE X.recorded_at < NOW() - make_interval(days => ${days}) RETURNING 1) SELECT COUNT(*)::int AS n FROM d`, [def]))[0].n;
      const ev = (await q(`WITH d AS (DELETE FROM gps_events X WHERE X.occurred_at < NOW() - make_interval(days => ${days}) RETURNING 1) SELECT COUNT(*)::int AS n FROM d`, [def]))[0].n;
      return { positions_deleted: pos as number, events_deleted: ev as number };
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'gps.purge', details: out });
    return out;
  }
}
