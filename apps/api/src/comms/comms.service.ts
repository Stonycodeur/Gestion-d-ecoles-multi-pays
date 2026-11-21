import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, canMessage, decryptText, encryptText, refusedRecipients, type Party, type PartyRole, type Principal } from '@ecolemanager/shared';
import { randomUUID } from 'node:crypto';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { mapDbError, num, optStr, str, uuid } from '../pedagogy/validate';
import { Adapters } from '../adapters/adapters';
import { NotificationService } from './notification.service';
import { RealtimeGateway } from './realtime.gateway';

const MAX_FILE = 5 * 1024 * 1024;
const messageKey = () => {
  const k = process.env.MESSAGE_KEY;
  if (!k || Buffer.from(k, 'base64').length !== 32) throw new Error('MESSAGE_KEY (base64, 32 bytes) is required');
  return k;
};
const decode = (b64: unknown): Buffer => {
  if (typeof b64 !== 'string' || !b64) throw new BadRequestException('content_base64 is required');
  const buf = Buffer.from(b64, 'base64');
  if (!buf.length || buf.length > MAX_FILE) throw new BadRequestException('file empty or larger than 5 MB');
  return buf;
};
const AUDIENCE_OF: Record<string, string[]> = {
  head: ['all', 'staff', 'students', 'guardians'], tenant_super_admin: ['all', 'staff', 'students', 'guardians'], admin: ['all', 'staff', 'students', 'guardians'],
  teacher: ['all', 'staff'], education_assistant: ['all', 'staff'], accountant: ['all', 'staff'], student: ['all', 'students'], guardian: ['all', 'guardians'],
};

import { WebhooksService } from '../publicapi/webhooks.service';
@Injectable()
export class CommsService {
  constructor(private readonly db: TenantDb, private readonly adapters: Adapters, private readonly notif: NotificationService, private readonly rt: RealtimeGateway, private readonly webhooks: WebhooksService) {}

  private tx<T>(slug: string, fn: (q: Q, t: { id: string }) => Promise<T>): Promise<T> {
    return this.db.run(slug, fn).catch((e) => mapDbError(e));
  }
  authorize(p: Principal, slug: string, perm: string, r: Record<string, unknown> = {}) {
    const d = can(p, perm, { tenantId: slug, ...r });
    if (!d.allowed) throw new ForbiddenException(d.reason);
  }
  private canWrite(p: Principal, slug: string) {
    const a = can(p, 'messages:scoped', { tenantId: slug }), b = can(p, 'messages:all', { tenantId: slug });
    if (!a.allowed && !b.allowed) throw new ForbiddenException('messaging not allowed for this role');
  }

  // ---- directory ------------------------------------------------------------------------------------------------
  upsertDirectory(slug: string, b: any) {
    const role = str(b.role, 'role', 30);
    if (!['head', 'tenant_super_admin', 'admin', 'teacher', 'education_assistant', 'accountant', 'student', 'guardian'].includes(role)) throw new BadRequestException('invalid role');
    const ids = (v: unknown, n: string) => (Array.isArray(v) ? v.map((x) => uuid(x, n)) : []);
    return this.tx(slug, async (q) => (await q(
      `INSERT INTO directory(user_id, role, display_name, class_ids, child_ids, student_id, locale, email, phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (user_id) DO UPDATE SET role=EXCLUDED.role, display_name=EXCLUDED.display_name, class_ids=EXCLUDED.class_ids, child_ids=EXCLUDED.child_ids,
         student_id=EXCLUDED.student_id, locale=EXCLUDED.locale, email=EXCLUDED.email, phone=EXCLUDED.phone RETURNING *`,
      [uuid(b.user_id, 'user_id'), role, str(b.display_name, 'display_name', 120), ids(b.class_ids, 'class_ids'), ids(b.child_ids, 'child_ids'),
        b.student_id ? uuid(b.student_id, 'student_id') : null, ['fr', 'en', 'ar'].includes(b.locale) ? b.locale : 'fr', optStr(b.email, 'email', 200), optStr(b.phone, 'phone', 40)]))[0]);
  }
  listDirectory(slug: string) { return this.tx(slug, (q) => q('SELECT user_id, role, display_name FROM directory ORDER BY display_name')); }

  private async parties(q: Q, ids: string[]): Promise<Map<string, Party>> {
    const rows = await q('SELECT * FROM directory WHERE user_id = ANY($1::uuid[])', [ids]);
    const out = new Map<string, Party>();
    for (const d of rows) {
      let childClassIds: string[] | undefined;
      if (d.role === 'guardian' && d.child_ids?.length) childClassIds = (await q('SELECT DISTINCT class_id FROM students WHERE id = ANY($1::uuid[]) AND class_id IS NOT NULL', [d.child_ids])).map((x: any) => x.class_id);
      let classIds: string[] = d.class_ids ?? [];
      if (d.role === 'student' && d.student_id && !classIds.length) classIds = (await q('SELECT class_id FROM students WHERE id = $1 AND class_id IS NOT NULL', [d.student_id])).map((x: any) => x.class_id);
      out.set(d.user_id, { userId: d.user_id, role: d.role as PartyRole, classIds, childIds: d.child_ids ?? [], childClassIds, studentId: d.student_id ?? undefined });
    }
    return out;
  }
  private async options(_q: Q) {
    return { allowStudentPeers: process.env.ALLOW_STUDENT_PEER_MESSAGING === 'true' };
  }

  // ---- messaging --------------------------------------------------------------------------------------------------
  async createThread(slug: string, p: Principal, b: any) {
    this.canWrite(p, slug);
    const members = [...new Set<string>((Array.isArray(b.member_ids) ? b.member_ids : []).map((x: unknown) => uuid(x, 'member_ids')))].filter((x) => x !== p.id);
    if (!members.length || members.length > 200) throw new BadRequestException('member_ids required (1..200)');
    const first = str(b.body, 'body', 8000);
    const result = await this.tx(slug, async (q) => {
      const ps = await this.parties(q, [p.id, ...members]);
      const me = ps.get(p.id);
      if (!me) throw new ForbiddenException('you are not in the school directory');
      const unknown = members.filter((m) => !ps.has(m));
      if (unknown.length) throw new BadRequestException('unknown recipients');
      const refused = refusedRecipients(me, members.map((m) => ps.get(m)!), await this.options(q));
      if (refused.length) throw new ForbiddenException(`messaging not allowed to ${refused.length} recipient(s)`);
      const th = (await q('INSERT INTO threads(subject, created_by, context) VALUES ($1,$2,$3) RETURNING *', [str(b.subject, 'subject', 200), p.id, JSON.stringify(b.context ?? {})]))[0];
      for (const m of [p.id, ...members]) await q('INSERT INTO thread_members(thread_id, user_id) VALUES ($1,$2)', [th.id, m]);
      return { thread: th, members };
    });
    await this.postMessage(slug, p, result.thread.id, { body: first });
    return result.thread;
  }

  async postMessage(slug: string, p: Principal, threadId: string, b: any) {
    this.canWrite(p, slug);
    const body = str(b.body, 'body', 8000);
    const attachment = b.attachment ? { filename: str(b.attachment.filename, 'filename', 200), type: str(b.attachment.content_type ?? 'application/octet-stream', 'content_type', 100), data: decode(b.attachment.content_base64) } : null;
    const { msg, others } = await this.tx(slug, async (q, t) => {
      const m = await q('SELECT user_id FROM thread_members WHERE thread_id = $1', [uuid(threadId, 'thread_id')]);
      const ids = m.map((x: any) => x.user_id as string);
      if (!ids.includes(p.id)) throw new NotFoundException('thread not found');
      // re-check the rules at every post: roles/classes may have changed since the thread was created
      const ps = await this.parties(q, ids);
      const me = ps.get(p.id);
      const opts = await this.options(q);
      const refused = me ? refusedRecipients(me, ids.filter((i) => i !== p.id).map((i) => ps.get(i)).filter((x): x is Party => !!x), opts) : [];
      if (refused.length && !can(p, 'messages:all', { tenantId: slug }).allowed) throw new ForbiddenException('messaging no longer allowed for some members');
      const row = (await q('INSERT INTO messages(thread_id, sender_id, body_enc) VALUES ($1,$2,$3) RETURNING id, thread_id, sender_id, created_at', [threadId, p.id, encryptText(body, messageKey())]))[0];
      let att: any = null;
      if (attachment) {
        const key = `${t.id}/messages/${randomUUID()}`;
        await this.adapters.storage().put(key, attachment.data, attachment.type);
        att = (await q('INSERT INTO message_attachments(message_id, storage_key, filename, content_type, size_bytes) VALUES ($1,$2,$3,$4,$5) RETURNING id, filename, content_type, size_bytes', [row.id, key, attachment.filename, attachment.type, attachment.data.length]))[0];
      }
      return { msg: { ...row, body, attachment: att }, others: ids.filter((i) => i !== p.id) };
    });
    const from = await this.tx(slug, async (q) => (await q('SELECT display_name FROM directory WHERE user_id = $1', [p.id]))[0]?.display_name ?? '');
    this.rt.emitToUsers(slug, others, 'message', msg);
    await this.notif.notify(slug, others, 'message.new', { from }, { thread_id: threadId });
    return msg;
  }

  listThreads(slug: string, p: Principal) {
    return this.tx(slug, (q) => q(
      `SELECT t.id, t.subject, t.created_by, t.created_at,
         (SELECT MAX(created_at) FROM messages m WHERE m.thread_id = t.id) AS last_message_at,
         (SELECT COUNT(*)::int FROM messages m WHERE m.thread_id = t.id AND m.sender_id <> $1 AND (tm.last_read_at IS NULL OR m.created_at > tm.last_read_at)) AS unread
       FROM threads t JOIN thread_members tm ON tm.thread_id = t.id AND tm.user_id = $1 ORDER BY last_message_at DESC NULLS LAST`, [p.id]));
  }

  getThread(slug: string, p: Principal, threadId: string) {
    return this.tx(slug, async (q) => {
      const tm = await q('SELECT 1 FROM thread_members WHERE thread_id = $1 AND user_id = $2', [uuid(threadId, 'thread_id'), p.id]);
      if (!tm.length) throw new NotFoundException('thread not found');
      const rows = await q(`SELECT m.id, m.sender_id, m.body_enc, m.created_at, a.id AS att_id, a.filename, a.content_type, a.size_bytes
        FROM messages m LEFT JOIN message_attachments a ON a.message_id = m.id WHERE m.thread_id = $1 ORDER BY m.created_at`, [threadId]);
      await q('UPDATE thread_members SET last_read_at = NOW() WHERE thread_id = $1 AND user_id = $2', [threadId, p.id]);
      const key = messageKey();
      return rows.map((r: any) => ({ id: r.id, sender_id: r.sender_id, created_at: r.created_at, body: decryptText(r.body_enc, key),
        attachment: r.att_id ? { id: r.att_id, filename: r.filename, content_type: r.content_type, size_bytes: r.size_bytes } : null }));
    });
  }

  async attachment(slug: string, p: Principal, id: string) {
    const a = await this.tx(slug, async (q) => (await q(
      `SELECT a.* FROM message_attachments a JOIN messages m ON m.id = a.message_id JOIN thread_members tm ON tm.thread_id = m.thread_id AND tm.user_id = $2 WHERE a.id = $1`, [uuid(id, 'id'), p.id]))[0]);
    if (!a) throw new NotFoundException('attachment not found');
    return { filename: a.filename as string, contentType: a.content_type as string, data: await this.adapters.storage().get(a.storage_key) };
  }

  // ---- news, surveys, events -------------------------------------------------------------------------------------
  async publishNews(slug: string, p: Principal, b: any) {
    const audience = b.audience ?? 'all';
    const row = await this.tx(slug, async (q) => (await q('INSERT INTO news(title, body, audience, is_public, published_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [str(b.title, 'title', 200), str(b.body, 'body', 20000), audience, b.is_public === true, p.id]))[0]);
    const roles = audience === 'staff' ? ['head', 'tenant_super_admin', 'admin', 'teacher', 'education_assistant', 'accountant'] : audience === 'students' ? ['student'] : audience === 'guardians' ? ['guardian'] : undefined;
    if (row.is_public) this.webhooks.dispatch(slug, 'news.published', { id: row.id, title: row.title });
    await this.notif.notifyAll(slug, 'news.published', { title: row.title }, { news_id: row.id }, roles);
    return row;
  }
  listNews(slug: string, p: Principal) {
    const allowed = p.roles.flatMap((r) => AUDIENCE_OF[r] ?? ['all']);
    return this.tx(slug, (q) => q('SELECT * FROM news WHERE audience = ANY($1::text[]) ORDER BY published_at DESC LIMIT 100', [allowed.length ? allowed : ['all']]));
  }
  /** Newsletter: digest of the latest news sent by email to the opted-in directory entries. */
  async sendNewsletter(slug: string) {
    const { items, to } = await this.tx(slug, async (q) => ({
      items: await q("SELECT title, body FROM news WHERE published_at > NOW() - INTERVAL '30 days' AND audience = 'all' ORDER BY published_at DESC LIMIT 10"),
      to: await q('SELECT email FROM directory WHERE email IS NOT NULL'),
    }));
    if (!items.length) return { sent: 0 };
    const text = items.map((i: any) => `• ${i.title}\n${String(i.body).slice(0, 300)}`).join('\n\n');
    for (const r of to) await this.adapters.email().send(r.email, 'Newsletter', text);
    return { sent: to.length };
  }
  createSurvey(slug: string, p: Principal, b: any) {
    if (!Array.isArray(b.options) || b.options.length < 2 || b.options.length > 10) throw new BadRequestException('options: 2..10 choices');
    return this.tx(slug, async (q) => (await q('INSERT INTO surveys(question, options, closes_at, created_by) VALUES ($1,$2,$3,$4) RETURNING *',
      [str(b.question, 'question', 300), JSON.stringify(b.options.map((o: unknown) => str(o, 'option', 120))), b.closes_at ?? null, p.id]))[0]);
  }
  vote(slug: string, p: Principal, id: string, b: any) {
    return this.tx(slug, async (q) => {
      const s = (await q('SELECT * FROM surveys WHERE id = $1', [uuid(id, 'id')]))[0];
      if (!s) throw new NotFoundException('survey not found');
      if (s.closes_at && new Date(s.closes_at) < new Date()) throw new BadRequestException('survey closed');
      const idx = num(b.option_index, 'option_index', 0, s.options.length - 1);
      await q('INSERT INTO survey_votes(survey_id, user_id, option_index) VALUES ($1,$2,$3)', [id, p.id, idx]);
      return { ok: true };
    });
  }
  surveyResults(slug: string, id: string) {
    return this.tx(slug, async (q) => {
      const s = (await q('SELECT * FROM surveys WHERE id = $1', [uuid(id, 'id')]))[0];
      if (!s) throw new NotFoundException('survey not found');
      const votes = await q('SELECT option_index, COUNT(*)::int AS n FROM survey_votes WHERE survey_id = $1 GROUP BY option_index', [id]);
      return { question: s.question, options: (s.options as string[]).map((label, i) => ({ label, votes: votes.find((v: any) => v.option_index === i)?.n ?? 0 })) };
    });
  }
  listSurveys(slug: string) { return this.tx(slug, (q) => q('SELECT * FROM surveys ORDER BY closes_at NULLS LAST')); }
  createEvent(slug: string, b: any) {
    return this.tx(slug, async (q) => (await q('INSERT INTO events(title, description, starts_at, ends_at, location) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [str(b.title, 'title', 200), optStr(b.description, 'description', 4000), str(b.starts_at, 'starts_at', 40), b.ends_at ?? null, optStr(b.location, 'location', 200)]))[0]);
  }
  listEvents(slug: string) { return this.tx(slug, (q) => q('SELECT * FROM events ORDER BY starts_at')); }

  // ---- notifications & devices -----------------------------------------------------------------------------------
  listNotifications(slug: string, p: Principal) { return this.tx(slug, (q) => q('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100', [p.id])); }
  markRead(slug: string, p: Principal, id: string) { return this.tx(slug, async (q) => { await q('UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2', [uuid(id, 'id'), p.id]); return { ok: true }; }); }
  registerDevice(slug: string, p: Principal, b: any) {
    const platform = str(b.platform, 'platform', 10);
    if (!['android', 'ios', 'web'].includes(platform)) throw new BadRequestException('invalid platform');
    return this.tx(slug, async (q) => { await q('INSERT INTO device_tokens(user_id, platform, token) VALUES ($1,$2,$3) ON CONFLICT (user_id, token) DO NOTHING', [p.id, platform, str(b.token, 'token', 4096)]); return { ok: true }; });
  }
  pushOutbox(slug: string, p: Principal) { return this.tx(slug, (q) => q('SELECT platform, title, body, mode, sent_at FROM push_outbox WHERE user_id = $1 ORDER BY sent_at DESC LIMIT 50', [p.id])); }
  async sendTest(slug: string, userIds: unknown, text: string) {
    const ids = (Array.isArray(userIds) ? userIds : []).map((x) => uuid(x, 'user_ids'));
    return { delivered: await this.notif.notify(slug, ids, 'news.published', { title: str(text, 'text', 200) }) };
  }

  // ---- digital locker --------------------------------------------------------------------------------------------
  async lockerUpload(slug: string, p: Principal, b: any) {
    const retention = num(b.retention_days ?? 365 * 5, 'retention_days', 1, 36500);
    const data = decode(b.content_base64);
    const type = str(b.content_type ?? 'application/pdf', 'content_type', 100);
    return this.tx(slug, async (q, t) => {
      const key = `${t.id}/locker/${randomUUID()}`;
      await this.adapters.storage().put(key, data, type);
      return (await q(`INSERT INTO locker_documents(student_id, kind, title, storage_key, content_type, retention_days, expires_at, created_by)
        VALUES ($1,$2,$3,$4,$5,$6, NOW() + make_interval(days => $6::int), $7) RETURNING id, student_id, kind, title, retention_days, expires_at`,
        [uuid(b.student_id, 'student_id'), str(b.kind, 'kind', 40), str(b.title, 'title', 200), key, type, retention, p.id]))[0];
    });
  }
  async lockerList(slug: string, p: Principal, studentId: string) {
    const st = await this.tx(slug, async (q) => (await q('SELECT id, class_id FROM students WHERE id = $1', [uuid(studentId, 'student_id')]))[0]);
    if (!st) throw new NotFoundException('student not found');
    this.authorize(p, slug, 'locker:read', { studentId: st.id, classId: st.class_id ?? undefined });
    return this.tx(slug, (q) => q('SELECT id, kind, title, content_type, retention_days, expires_at, created_at FROM locker_documents WHERE student_id = $1 AND expires_at > NOW() ORDER BY created_at DESC', [studentId]));
  }
  async lockerDownload(slug: string, p: Principal, id: string) {
    const d = await this.tx(slug, async (q) => (await q('SELECT l.*, s.class_id FROM locker_documents l JOIN students s ON s.id = l.student_id WHERE l.id = $1 AND l.expires_at > NOW()', [uuid(id, 'id')]))[0]);
    if (!d) throw new NotFoundException('document not found');
    this.authorize(p, slug, 'locker:read', { studentId: d.student_id, classId: d.class_id ?? undefined });
    return { contentType: d.content_type as string, filename: `${d.title}`, data: await this.adapters.storage().get(d.storage_key) };
  }
  /** Retention purge: deletes expired documents and their files. Runs on demand and from a daily timer. */
  async lockerPurge(slug: string) {
    const expired = await this.tx(slug, (q) => q('DELETE FROM locker_documents WHERE expires_at <= NOW() RETURNING storage_key'));
    for (const e of expired) await this.adapters.storage().delete(e.storage_key).catch(() => undefined);
    return { purged: expired.length };
  }
}
