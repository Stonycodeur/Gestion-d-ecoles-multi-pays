import { checkWebhookUrl, type ConnectorConfig } from '@ecolemanager/shared';

export interface MinistryPayload { id: string; dataset: string; format: 'csv' | 'json' | 'xml'; checksum: string; payload: string }
export interface MinistryResult { ok: boolean; reference?: string; error?: string; status?: number }
export interface MinistryAdapter { send(connector: ConnectorConfig, t: MinistryPayload): Promise<MinistryResult> }

/** Sandbox: same flow as live (accepts a payload, returns a reference) without any external call. MINISTRY_SANDBOX_FAIL_FIRST=n makes the first n sends fail (to exercise retries). */
export class SandboxMinistry implements MinistryAdapter {
  private failed = 0;
  async send(_c: ConnectorConfig, t: MinistryPayload): Promise<MinistryResult> {
    if (this.failed < Number(process.env.MINISTRY_SANDBOX_FAIL_FIRST ?? 0)) { this.failed++; return { ok: false, error: 'sandbox: simulated ministry outage', status: 503 }; }
    return { ok: true, reference: `SBX-${t.checksum.slice(0, 12)}`, status: 200 };
  }
}

const CT = { csv: 'text/csv; charset=utf-8', json: 'application/json', xml: 'application/xml' } as const;
/** Live: HTTPS POST to the ministry endpoint (connector.endpoint or MINISTRY_<CODE>_URL) with a bearer token MINISTRY_<CODE>_TOKEN. The transmission id is the idempotency key. */
export class HttpMinistry implements MinistryAdapter {
  async send(c: ConnectorConfig, t: MinistryPayload): Promise<MinistryResult> {
    const key = c.code.toUpperCase();
    const url = c.endpoint ?? process.env[`MINISTRY_${key}_URL`]; if (!url) return { ok: false, error: `no endpoint configured (MINISTRY_${key}_URL)` };
    const bad = checkWebhookUrl(url, false); if (bad) return { ok: false, error: `endpoint refused: ${bad}` };
    try {
      const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(15000), body: t.payload,
        headers: { 'content-type': CT[t.format], 'idempotency-key': t.id, 'x-checksum-sha256': t.checksum, 'x-dataset': t.dataset, authorization: `Bearer ${process.env[`MINISTRY_${key}_TOKEN`] ?? ''}` } });
      const text = (await r.text()).slice(0, 500);
      if (!r.ok) return { ok: false, status: r.status, error: `HTTP ${r.status}: ${text}` };
      let ref: string | undefined; try { ref = JSON.parse(text).reference; } catch { /* free text acknowledgement */ }
      return { ok: true, status: r.status, reference: ref ?? `HTTP-${r.status}` };
    } catch (e) { return { ok: false, error: (e as Error).message }; }
  }
}
export const makeMinistryAdapter = (): MinistryAdapter => (process.env.MINISTRY_MODE ?? 'sandbox') === 'live' ? new HttpMinistry() : new SandboxMinistry();
