import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { MAX_ATTEMPTS, can, canMove, checksum, datasetFields, isDue, retryDelaySec, serialize, validateConnector, type ConnectorConfig, type MinistryFormat, type Principal, type TransmissionStatus } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { mapDbError, optStr, str, uuid } from '../pedagogy/validate';
import { NotificationService } from '../comms/notification.service';
import { AuditService } from '../core/audit.service';
import { makeMinistryAdapter, type MinistryAdapter } from './ministry.adapter';

type Tenant = { id: string; slug: string; country: string; schoolType: string };

/** Ministry integration (spec 6.18): connectors come from the country reference; prepare -> head validates -> send (or schedule) -> log -> retry. */
@Injectable()
export class MinistryService {
  private readonly adapter: MinistryAdapter = makeMinistryAdapter();
  constructor(private readonly db: TenantDb, private readonly notif: NotificationService, private readonly audit: AuditService) {}
  private tx<T>(slug: string, fn: (q: Q, t: Tenant) => Promise<T>): Promise<T> { return this.db.run(slug, fn).catch((e) => mapDbError(e)); }
  private authorize(p: Principal, slug: string, perm: string) { const d = can(p, perm, { tenantId: slug }); if (!d.allowed) throw new ForbiddenException(d.reason); }
  private live() { return (process.env.MINISTRY_MODE ?? 'sandbox') === 'live'; }

  private async connectorsOf(q: Q, t: Tenant): Promise<ConnectorConfig[]> {
    const r = (await q('SELECT ministry_connectors FROM public.countries WHERE code = $1', [t.country]))[0];
    return ((r?.ministry_connectors ?? []) as ConnectorConfig[]).filter((c) => validateConnector(c).length === 0);
  }
  async connectors(slug: string, p: Principal) {
    this.authorize(p, slug, 'ministry:prepare');
    const list = await this.tx(slug, (q, t) => this.connectorsOf(q, t));
    return { mode: this.live() ? 'live' : 'sandbox', connectors: list.map((c) => ({ code: c.code, label_fr: c.label_fr, label_en: c.label_en, mode: c.mode, formats: c.formats, datasets: c.datasets, fields: Object.fromEntries(c.datasets.map((d) => { try { return [d, datasetFields(c, d)]; } catch { return [d, []]; } })) })) };
  }
  private async collect(q: Q, dataset: string, year: string): Promise<Record<string, unknown>[]> {
    if (dataset.startsWith('effectifs')) return q(`SELECT c.level_code, COALESCE(s.gender, 'unknown') AS gender, COUNT(*)::int AS count FROM students s JOIN classes c ON c.id = s.class_id
      WHERE s.status IN ('enrolled','active') AND c.school_year = $1 GROUP BY c.level_code, s.gender ORDER BY c.level_code, gender`, [year]);
    if (dataset.startsWith('statistiques_rentree')) return q(`SELECT c.level_code, COUNT(DISTINCT c.id)::int AS class_count, COUNT(s.id)::int AS student_count FROM classes c LEFT JOIN students s ON s.class_id = c.id AND s.status IN ('enrolled','active')
      WHERE c.school_year = $1 GROUP BY c.level_code ORDER BY c.level_code`, [year]);
    if (dataset.startsWith('resultats_')) return q(`SELECT s.last_name, s.first_name, s.birth_date::text AS birth_date, o.school_year, o.passed, o.mention FROM exam_outcomes o JOIN students s ON s.id = o.student_id
      WHERE o.exam_code = $1 AND o.school_year = $2 ORDER BY s.last_name, s.first_name`, [dataset.slice('resultats_'.length), year]);
    throw new BadRequestException(`unsupported dataset ${dataset}`);
  }
  private async log(q: Q, id: string, event: string, detail: unknown = {}) { await q('INSERT INTO ministry_logs(transmission_id, event, detail) VALUES ($1,$2,$3)', [id, event, JSON.stringify(detail)]); }
  private pub(r: any) { const { payload: _p, ...rest } = r; return rest; }

  async prepare(slug: string, p: Principal, b: any) {
    this.authorize(p, slug, 'ministry:prepare');
    const year = str(b?.school_year, 'school_year', 20), dataset = str(b?.dataset, 'dataset', 60), format = String(b?.format) as MinistryFormat;
    const scheduled = b?.scheduled_for ? new Date(str(b.scheduled_for, 'scheduled_for', 40)) : null;
    if (scheduled && Number.isNaN(scheduled.getTime())) throw new BadRequestException('scheduled_for must be an ISO date');
    const row = await this.tx(slug, async (q, t) => {
      const c = (await this.connectorsOf(q, t)).find((x) => x.code === b?.connector);
      if (!c) throw new NotFoundException('connector not found for this country');
      if (!c.datasets.includes(dataset)) throw new BadRequestException(`dataset ${dataset} is not offered by ${c.code}`);
      if (!c.formats.includes(format)) throw new BadRequestException(`format must be one of ${c.formats.join(', ')}`);
      const rows = await this.collect(q, dataset, year);
      if (!rows.length) throw new BadRequestException('nothing to transmit for this dataset and school year');
      const payload = serialize(format, dataset, rows, datasetFields(c, dataset));
      const r = (await q(`INSERT INTO ministry_transmissions(connector_code, dataset, format, school_year, payload, checksum, rows_count, sandbox, scheduled_for, prepared_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [c.code, dataset, format, year, payload, checksum(payload), rows.length, !this.live() || c.sandbox === true, scheduled, p.id]))[0];
      await this.log(q, r.id, 'prepared', { rows: rows.length, fields: datasetFields(c, dataset), by: p.id });
      return r;
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'ministry.prepare', entity: 'transmission', entityId: row.id });
    return this.pub(row);
  }
  async list(slug: string, p: Principal, status?: string) {
    this.authorize(p, slug, 'ministry:prepare');
    return this.tx(slug, (q) => q('SELECT id, connector_code, dataset, format, school_year, status, checksum, rows_count, sandbox, scheduled_for, attempts, last_error, next_retry_at, validated_at, sent_at, created_at FROM ministry_transmissions WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC LIMIT 200', [status ?? null]));
  }
  async get(slug: string, p: Principal, id: string, withPayload = false) {
    this.authorize(p, slug, 'ministry:prepare');
    return this.tx(slug, async (q) => {
      const r = (await q('SELECT * FROM ministry_transmissions WHERE id = $1', [uuid(id, 'id')]))[0]; if (!r) throw new NotFoundException('transmission not found');
      const logs = await q('SELECT event, detail, at FROM ministry_logs WHERE transmission_id = $1 ORDER BY at, id', [id]);
      return withPayload ? { ...r, logs } : { ...this.pub(r), logs };
    });
  }
  /** Direction validation: nothing leaves the school before a head/admin with ministry:send approves the exact checksum. */
  async validate(slug: string, p: Principal, id: string, b: any) {
    this.authorize(p, slug, 'ministry:send');
    const out = await this.tx(slug, async (q) => {
      const r = (await q('SELECT * FROM ministry_transmissions WHERE id = $1 FOR UPDATE', [uuid(id, 'id')]))[0]; if (!r) throw new NotFoundException('transmission not found');
      const to: TransmissionStatus = b?.approve === true ? 'validated' : 'rejected';
      if (!canMove(r.status, to)) throw new BadRequestException(`cannot move ${r.status} -> ${to}`);
      if (to === 'validated' && b?.checksum !== r.checksum) throw new BadRequestException('checksum of the reviewed content must be confirmed');
      const u = (await q('UPDATE ministry_transmissions SET status = $2, validated_by = $3, validated_at = NOW() WHERE id = $1 RETURNING *', [r.id, to, p.id]))[0];
      await this.log(q, r.id, to, { by: p.id, note: optStr(b?.note, 'note', 500) });
      return u;
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: `ministry.${out.status}`, entity: 'transmission', entityId: id });
    return this.pub(out);
  }
  async cancel(slug: string, p: Principal, id: string) {
    this.authorize(p, slug, 'ministry:send');
    return this.tx(slug, async (q) => {
      const r = (await q('SELECT status FROM ministry_transmissions WHERE id = $1 FOR UPDATE', [uuid(id, 'id')]))[0]; if (!r) throw new NotFoundException('transmission not found');
      if (!canMove(r.status, 'cancelled')) throw new BadRequestException(`cannot cancel a ${r.status} transmission`);
      await q("UPDATE ministry_transmissions SET status = 'cancelled' WHERE id = $1", [id]); await this.log(q, id, 'cancelled', { by: p.id }); return { id, status: 'cancelled' };
    });
  }
  /** One attempt. Live API connectors call the ministry; live FILE connectors are exported (download) and confirmed by hand with markSent. */
  async send(slug: string, p: Principal | null, id: string) {
    if (p) this.authorize(p, slug, 'ministry:send');
    const out = await this.tx(slug, async (q, t) => {
      const r = (await q('SELECT * FROM ministry_transmissions WHERE id = $1 FOR UPDATE', [uuid(id, 'id')]))[0]; if (!r) throw new NotFoundException('transmission not found');
      if (!canMove(r.status, 'sent')) throw new BadRequestException(`a ${r.status} transmission cannot be sent`);
      if (r.attempts >= MAX_ATTEMPTS) throw new BadRequestException('maximum number of attempts reached');
      const c = (await this.connectorsOf(q, t)).find((x) => x.code === r.connector_code);
      if (!c) throw new NotFoundException('connector no longer configured');
      if (!r.sandbox && c.mode === 'file') throw new BadRequestException('file connector: download the export and confirm with mark-sent once uploaded to the ministry');
      const res = await this.adapter.send(c, { id: r.id, dataset: r.dataset, format: r.format, checksum: r.checksum, payload: r.payload });
      const attempts = r.attempts + 1;
      const u = res.ok
        ? (await q("UPDATE ministry_transmissions SET status = 'sent', attempts = $2, sent_at = NOW(), last_error = NULL, next_retry_at = NULL, response = $3 WHERE id = $1 RETURNING *", [r.id, attempts, JSON.stringify(res)]))[0]
        : (await q("UPDATE ministry_transmissions SET status = 'failed', attempts = $2, last_error = $3, next_retry_at = NOW() + ($4 || ' seconds')::interval, response = $5 WHERE id = $1 RETURNING *", [r.id, attempts, res.error ?? 'error', String(retryDelaySec(attempts)), JSON.stringify(res)]))[0];
      await this.log(q, r.id, res.ok ? 'sent' : 'failed', { attempt: attempts, reference: res.reference, error: res.error, status: res.status, sandbox: r.sandbox });
      return u;
    });
    await this.audit.log({ actorId: p?.id ?? 'system', tenant: slug, action: `ministry.${out.status}`, entity: 'transmission', entityId: id });
    await this.notif.notifyAll(slug, 'ministry.update', { text: `${out.dataset} ${out.school_year}: ${out.status}` }, { transmission_id: id }, ['tenant_super_admin', 'admin', 'head']);
    return this.pub(out);
  }
  async markSent(slug: string, p: Principal, id: string, b: any) {
    this.authorize(p, slug, 'ministry:send');
    return this.tx(slug, async (q) => {
      const r = (await q('SELECT * FROM ministry_transmissions WHERE id = $1 FOR UPDATE', [uuid(id, 'id')]))[0]; if (!r) throw new NotFoundException('transmission not found');
      if (!canMove(r.status, 'sent')) throw new BadRequestException(`a ${r.status} transmission cannot be marked sent`);
      const u = (await q("UPDATE ministry_transmissions SET status = 'sent', sent_at = NOW(), attempts = attempts + 1, response = $2 WHERE id = $1 RETURNING *", [id, JSON.stringify({ manual: true, reference: optStr(b?.reference, 'reference', 100) })]))[0];
      await this.log(q, id, 'sent', { manual: true, by: p.id, reference: b?.reference ?? null }); return this.pub(u);
    });
  }
  /** Planned sending and "relance": processes transmissions that are due (scheduled or failed with an elapsed back-off). Called on demand or by a scheduler. */
  async runDue(slug: string, p: Principal | null) {
    if (p) this.authorize(p, slug, 'ministry:send');
    const rows = await this.tx(slug, (q) => q("SELECT id, status, attempts, next_retry_at::text, scheduled_for::text FROM ministry_transmissions WHERE status IN ('validated','failed')"));
    const due = rows.filter((r: any) => isDue({ status: r.status, attempts: r.attempts, next_retry_at: r.next_retry_at, scheduled_for: r.scheduled_for }));
    const results: { id: string; status: string }[] = [];
    for (const r of due) { try { const o = await this.send(slug, p, r.id); results.push({ id: r.id, status: o.status }); } catch (e) { results.push({ id: r.id, status: `error: ${(e as Error).message}` }); } }
    return { processed: results.length, results };
  }
  async file(slug: string, p: Principal, id: string) {
    const r = await this.get(slug, p, id, true); this.authorize(p, slug, 'ministry:send');
    if (!['validated', 'sent', 'failed'].includes(r.status)) throw new BadRequestException('only validated transmissions can be exported');
    return r as { payload: string; format: MinistryFormat; checksum: string; dataset: string; school_year: string };
  }

  // ---- time-limited inspector accounts (spec 6.6 / 6.18) --------------------------------------------------------------
  async createInspector(slug: string, p: Principal, b: any) {
    this.authorize(p, slug, 'inspectors:manage');
    const userId = uuid(b?.user_id, 'user_id'); const name = str(b?.display_name, 'display_name', 120);
    const until = new Date(str(b?.expires_at, 'expires_at', 40));
    if (Number.isNaN(until.getTime()) || until.getTime() <= Date.now()) throw new BadRequestException('expires_at must be a future date');
    if (until.getTime() - Date.now() > 90 * 86400000) throw new BadRequestException('an inspector account lasts at most 90 days');
    const row = await this.tx(slug, async (q) => {
      await q("INSERT INTO directory(user_id, role, display_name) VALUES ($1,'inspector',$2) ON CONFLICT (user_id) DO UPDATE SET role = 'inspector', display_name = EXCLUDED.display_name", [userId, name]);
      return (await q('INSERT INTO inspector_access(user_id, expires_at, created_by) VALUES ($1,$2,$3) RETURNING id, user_id, expires_at', [userId, until, p.id]))[0];
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'inspector.create', entity: 'user', entityId: userId, details: { expires_at: until.toISOString() } });
    return row;
  }
  async inspectors(slug: string, p: Principal) { this.authorize(p, slug, 'inspectors:manage'); return this.tx(slug, (q) => q('SELECT a.id, a.user_id, d.display_name, a.expires_at, a.expires_at > NOW() AS active FROM inspector_access a LEFT JOIN directory d ON d.user_id = a.user_id ORDER BY a.expires_at DESC')); }
  async revokeInspector(slug: string, p: Principal, id: string) {
    this.authorize(p, slug, 'inspectors:manage');
    const n = await this.tx(slug, async (q) => (await q('UPDATE inspector_access SET expires_at = NOW() WHERE id = $1 RETURNING 1', [uuid(id, 'id')])).length);
    if (!n) throw new NotFoundException('inspector access not found');
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'inspector.revoke', entity: 'inspector_access', entityId: id });
    return { id, revoked: true };
  }
  /** Used by the guard: latest expiry of the inspector's access, or null. */
  async inspectorUntil(slug: string, userId: string): Promise<Date | null> {
    const r = await this.db.run(slug, (q) => q('SELECT MAX(expires_at) AS until FROM inspector_access WHERE user_id = $1', [userId]));
    return r[0]?.until ? new Date(r[0].until) : null;
  }
}
