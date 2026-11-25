import { Injectable, Logger } from '@nestjs/common';
import { checkWebhookUrl, decryptText, encryptText, webhookHeaders } from '@ecolemanager/shared';
import { refuseTarget } from '../core/ssrf';
import { randomBytes } from 'node:crypto';
import { TenantDb } from '../pedagogy/tenant-db.service';

const MAX_ATTEMPTS = 5;

/** Signed outgoing webhooks (spec 6.19). Each delivery is recorded; failures can be retried; targets are checked against SSRF (static + resolved addresses). */
import { ModulesService } from '../modules/modules.service';
@Injectable()
export class WebhooksService {
  private readonly log = new Logger('Webhooks');
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService) {}
  private get allowPrivate() { return process.env.WEBHOOK_ALLOW_PRIVATE === 'true'; }
  private key() { const k = process.env.WEBHOOK_KEY ?? process.env.MESSAGE_KEY; if (!k) throw new Error('WEBHOOK_KEY (32 bytes, base64) is required'); return k; }

  newSecret(): { secret: string; enc: string } { const secret = randomBytes(32).toString('base64url'); return { secret, enc: encryptText(secret, this.key()) }; }
  checkUrl(url: string): string | null { return checkWebhookUrl(url, this.allowPrivate); }

  /** Fire-and-forget from the core: never throws and never blocks the business transaction. */
  dispatch(slug: string, event: string, data: unknown): void { void this.dispatchAsync(slug, event, data).catch((e) => this.log.warn(`dispatch ${event} failed: ${(e as Error).message}`)); }
  async dispatchAsync(slug: string, event: string, data: unknown): Promise<number> {
    if (!this.modules.registry.isEnabled(slug, 'module-public-api')) return 0;
    const deliveries = await this.db.run(slug, async (q) => {
      const hooks = await q('SELECT id FROM webhooks_out WHERE active AND $1 = ANY(events)', [event]);
      const out: string[] = [];
      for (const h of hooks) {
        const payload = { event, created_at: new Date().toISOString(), tenant: slug, data };
        out.push((await q('INSERT INTO webhook_deliveries(webhook_id, event, payload) VALUES ($1,$2,$3) RETURNING id', [h.id, event, JSON.stringify(payload)]))[0].id);
      }
      return out;
    });
    await Promise.all(deliveries.map((id) => this.attempt(slug, id)));
    return deliveries.length;
  }
  async attempt(slug: string, deliveryId: string): Promise<'delivered' | 'failed'> {
    const d = await this.db.run(slug, async (q) => (await q(`SELECT d.id, d.event, d.payload, d.attempts, w.url, w.secret_enc, w.active FROM webhook_deliveries d JOIN webhooks_out w ON w.id = d.webhook_id WHERE d.id = $1`, [deliveryId]))[0]);
    if (!d) throw new Error('delivery not found');
    let status = 0, error: string | null = null;
    try {
      const bad = await refuseTarget(d.url, this.allowPrivate); if (bad) throw new Error(`target refused: ${bad}`);
      const body = JSON.stringify(d.payload);
      const r = await fetch(d.url, { method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { ...webhookHeaders(decryptText(d.secret_enc, this.key()), d.event, body), 'x-em-delivery': d.id } });
      status = r.status; if (!(r.status >= 200 && r.status < 300)) error = `HTTP ${r.status}`;
    } catch (e) { error = (e as Error).message; }
    await this.db.run(slug, (q) => q(`UPDATE webhook_deliveries SET attempts = attempts + 1, response_status = $2, last_error = $3, status = $4, delivered_at = CASE WHEN $4 = 'delivered' THEN NOW() ELSE delivered_at END WHERE id = $1`, [deliveryId, status || null, error, error ? 'failed' : 'delivered']));
    return error ? 'failed' : 'delivered';
  }
  async retryFailed(slug: string): Promise<{ retried: number; delivered: number }> {
    const ids = await this.db.run(slug, (q) => q("SELECT id FROM webhook_deliveries WHERE status = 'failed' AND attempts < $1 ORDER BY created_at LIMIT 100", [MAX_ATTEMPTS]));
    let delivered = 0; for (const r of ids) if ((await this.attempt(slug, r.id)) === 'delivered') delivered++;
    return { retried: ids.length, delivered };
  }
}
