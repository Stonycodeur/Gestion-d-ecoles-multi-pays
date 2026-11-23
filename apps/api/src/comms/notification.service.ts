import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { buildNotification, externalChannelsFor, smsText, type Lang, type NotificationType } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { Adapters } from '../adapters/adapters';
import { RealtimeGateway } from './realtime.gateway';

type Params = Record<string, string> | ((lang: Lang) => Record<string, string>);
const LANGS: Lang[] = ['fr', 'en', 'ar'];

/** In-app notification + push (FCM/APNs through the push adapter). Best effort: a push failure never fails the business action. */
@Injectable()
export class NotificationService {
  private readonly log = new Logger('Notifications');
  constructor(private readonly db: TenantDb, private readonly adapters: Adapters, private readonly rt: RealtimeGateway) {}

  async familyOf(q: Q, studentId: string): Promise<string[]> {
    const r = await q('SELECT user_id FROM directory WHERE student_id = $1 OR child_ids @> ARRAY[$1]::uuid[]', [studentId]);
    return r.map((x: any) => x.user_id as string);
  }

  async notify(slug: string, userIds: string[], type: NotificationType, params: Params = {}, data: Record<string, string> = {}): Promise<number> {
    const ids = [...new Set(userIds)];
    if (!ids.length) return 0;
    try {
      return await this.db.run(slug, async (q) => await this.deliver(q, slug, ids, type, params, data));
    } catch (e) { this.log.warn(`notify ${type} failed: ${(e as Error).message}`); return 0; }
  }

  async notifyFamily(slug: string, studentId: string, type: NotificationType, params: Params = {}, data: Record<string, string> = {}): Promise<number> {
    try {
      return await this.db.run(slug, async (q) => await this.deliver(q, slug, await this.familyOf(q, studentId), type, params, data));
    } catch (e) { this.log.warn(`notifyFamily ${type} failed: ${(e as Error).message}`); return 0; }
  }

  async notifyAll(slug: string, type: NotificationType, params: Params = {}, data: Record<string, string> = {}, roles?: string[]): Promise<number> {
    try {
      return await this.db.run(slug, async (q) => {
        const rows = await q(roles ? 'SELECT user_id FROM directory WHERE role = ANY($1::text[])' : 'SELECT user_id FROM directory', roles ? [roles] : []);
        return this.deliver(q, slug, rows.map((r: any) => r.user_id as string), type, params, data);
      });
    } catch (e) { this.log.warn(`notifyAll ${type} failed: ${(e as Error).message}`); return 0; }
  }

  private async deliver(q: Q, slug: string, userIds: string[], type: NotificationType, params: Params, data: Record<string, string>): Promise<number> {
    if (!userIds.length) return 0;
    const dir = await q('SELECT user_id, locale, email, phone, notify_sms, notify_email FROM directory WHERE user_id = ANY($1::uuid[])', [userIds]);
    const contact = new Map<string, any>(dir.map((d: any) => [d.user_id, d]));
    const locale = new Map<string, Lang>(dir.map((d: any) => [d.user_id, (LANGS.includes(d.locale) ? d.locale : 'fr') as Lang]));
    const push = this.adapters.push();
    let n = 0;
    for (const uid of userIds) {
      const lang = locale.get(uid) ?? 'fr';
      const p = typeof params === 'function' ? params(lang) : params;
      const msg = buildNotification(type, lang, p);
      await q('INSERT INTO notifications(user_id, type, title, body, data) VALUES ($1,$2,$3,$4,$5)', [uid, type, msg.title, msg.body, JSON.stringify(data)]);
      this.rt.emitToUsers(slug, [uid], 'notification', { type, ...msg, data });
      for (const t of await q('SELECT platform, token FROM device_tokens WHERE user_id = $1', [uid])) {
        try {
          await push.send({ platform: t.platform, token: t.token, title: msg.title, body: msg.body, data: { type, ...data } });
          if (push.mode === 'sandbox') await q('INSERT INTO push_outbox(user_id, platform, title, body, mode) VALUES ($1,$2,$3,$4,$5)', [uid, t.platform, msg.title, msg.body, 'sandbox']);
        } catch (e) { this.log.warn(`push failed: ${(e as Error).message}`); }
      }
      const c = contact.get(uid);
      if (c) {   // e-mail / SMS for the types that need them, best effort like push
        for (const ch of externalChannelsFor(type, { sms: c.notify_sms !== false, email: c.notify_email !== false }, { phone: c.phone, email: c.email })) {
          try { if (ch === 'sms') await this.adapters.sms().send(c.phone, smsText(msg.title, msg.body)); else await this.adapters.email().send(c.email, msg.title, msg.body); }
          catch (e) { this.log.warn(`${ch} failed: ${(e as Error).message}`); }
        }
      }
      n++;
    }
    return n;
  }

  /** The person's own switches for the optional channels (push and in-app are always on; the OS controls push). */
  async getPrefs(slug: string, userId: string) {
    const r = (await this.db.run(slug, (q) => q('SELECT notify_sms, notify_email, (phone IS NOT NULL) AS has_phone, (email IS NOT NULL) AS has_email FROM directory WHERE user_id = $1', [userId])))[0];
    return { sms: r ? r.notify_sms : true, email: r ? r.notify_email : true, has_phone: !!r?.has_phone, has_email: !!r?.has_email };
  }
  async setPrefs(slug: string, userId: string, b: any) {
    if (typeof b?.sms !== 'boolean' && typeof b?.email !== 'boolean') throw new BadRequestException('sms and/or email must be boolean');
    await this.db.run(slug, (q) => q('UPDATE directory SET notify_sms = COALESCE($2, notify_sms), notify_email = COALESCE($3, notify_email) WHERE user_id = $1', [userId, typeof b.sms === 'boolean' ? b.sms : null, typeof b.email === 'boolean' ? b.email : null]));
    return this.getPrefs(slug, userId);
  }
}
