import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { signWebhook, verifyWebhook } from '@ecolemanager/shared';

export interface InitiateRequest { reference: string; amountMinor: number; currency: string; payer?: string; country: string }
export interface InitiateResult { providerRef: string; status: 'pending' | 'succeeded'; redirectUrl?: string; instructions?: string }
export interface WebhookEvent { eventId: string; providerRef: string; status: 'succeeded' | 'failed'; amountMinor?: number }

/** A payment provider. `sandbox` and `live` implementations follow the same flow: initiate -> (asynchronous) signed webhook -> confirmation. */
export interface PaymentProvider {
  readonly code: string;
  readonly mode: 'sandbox' | 'live';
  initiate(r: InitiateRequest): Promise<InitiateResult>;
  /** Verifies authenticity and returns the event, or throws. `raw` is the exact body received. */
  parseWebhook(raw: string, headers: Record<string, string | undefined>): WebhookEvent;
}

const webhookSecret = () => { const s = process.env.PAYMENT_WEBHOOK_SECRET; if (!s || s.length < 16) throw new Error('PAYMENT_WEBHOOK_SECRET (>= 16 chars) is required'); return s; };

/** Sandbox for ALL providers (mobile money, card): same flow as the real ones, confirmation arrives as a signed webhook. */
export class SandboxProvider implements PaymentProvider {
  readonly mode = 'sandbox' as const;
  constructor(readonly code: string) {}
  async initiate(r: InitiateRequest): Promise<InitiateResult> {
    return { providerRef: `sbx_${this.code}_${randomUUID()}`, status: 'pending', instructions: `SANDBOX: confirm with POST /payments/<id>/sandbox-confirm (ref ${r.reference})` };
  }
  parseWebhook(raw: string, h: Record<string, string | undefined>): WebhookEvent {
    const ts = Number(h['x-webhook-timestamp']), sig = h['x-webhook-signature'] ?? '';
    if (!verifyWebhook(webhookSecret(), ts, raw, sig)) throw new Error('invalid webhook signature');
    const b = JSON.parse(raw) as { id: string; provider_ref: string; status: 'succeeded' | 'failed'; amount_minor?: number };
    return { eventId: b.id, providerRef: b.provider_ref, status: b.status, amountMinor: b.amount_minor };
  }
  /** Builds a correctly signed event, exactly what the real provider would POST. */
  static signedEvent(providerRef: string, status: 'succeeded' | 'failed', amountMinor: number, eventId: string = randomUUID()) {
    const body = JSON.stringify({ id: eventId, provider_ref: providerRef, status, amount_minor: amountMinor });
    const ts = Math.floor(Date.now() / 1000);
    return { body, headers: { 'x-webhook-timestamp': String(ts), 'x-webhook-signature': signWebhook(webhookSecret(), ts, body) } };
  }
}

/** Stripe Checkout (card). Needs STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET (signature scheme `t=...,v1=...`). */
export class StripeProvider implements PaymentProvider {
  readonly code = 'stripe'; readonly mode = 'live' as const;
  async initiate(r: InitiateRequest): Promise<InitiateResult> {
    const key = process.env.STRIPE_SECRET_KEY; if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    const form = new URLSearchParams({ mode: 'payment', 'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': r.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(r.amountMinor), 'line_items[0][price_data][product_data][name]': r.reference,
      success_url: process.env.PAYMENT_RETURN_URL ?? 'https://example.invalid/paid', cancel_url: process.env.PAYMENT_RETURN_URL ?? 'https://example.invalid/cancelled', client_reference_id: r.reference });
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form });
    if (!res.ok) throw new Error(`Stripe error ${res.status}`);
    const j = (await res.json()) as { id: string; url: string };
    return { providerRef: j.id, status: 'pending', redirectUrl: j.url };
  }
  parseWebhook(raw: string, h: Record<string, string | undefined>): WebhookEvent {
    const secret = process.env.STRIPE_WEBHOOK_SECRET; if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET is not set');
    const parts = Object.fromEntries((h['stripe-signature'] ?? '').split(',').map((kv) => kv.split('=') as [string, string]));
    if (!verifyWebhook(secret, Number(parts.t), raw, parts.v1 ?? '')) throw new Error('invalid Stripe signature');
    const e = JSON.parse(raw) as { id: string; type: string; data: { object: { id: string; amount_total?: number } } };
    return { eventId: e.id, providerRef: e.data.object.id, status: e.type === 'checkout.session.completed' ? 'succeeded' : 'failed', amountMinor: e.data.object.amount_total };
  }
}

/** Airtel Money collection API (OAuth2 client credentials + merchant payment). Needs AIRTEL_BASE_URL, AIRTEL_CLIENT_ID, AIRTEL_CLIENT_SECRET.
 *  Callback authenticity: the operator callback is verified with the shared HMAC (AIRTEL_CALLBACK_SECRET) configured on the merchant account. */
export class AirtelMoneyProvider implements PaymentProvider {
  readonly code = 'airtel_money'; readonly mode = 'live' as const;
  private async token(): Promise<string> {
    const base = process.env.AIRTEL_BASE_URL, id = process.env.AIRTEL_CLIENT_ID, secret = process.env.AIRTEL_CLIENT_SECRET;
    if (!base || !id || !secret) throw new Error('AIRTEL_BASE_URL / AIRTEL_CLIENT_ID / AIRTEL_CLIENT_SECRET are required');
    const r = await fetch(`${base}/auth/oauth2/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: id, client_secret: secret, grant_type: 'client_credentials' }) });
    if (!r.ok) throw new Error(`Airtel auth error ${r.status}`);
    return ((await r.json()) as { access_token: string }).access_token;
  }
  async initiate(r: InitiateRequest): Promise<InitiateResult> {
    if (!r.payer) throw new Error('payer phone number is required for Mobile Money');
    const tx = randomUUID();
    const res = await fetch(`${process.env.AIRTEL_BASE_URL}/merchant/v2/payments/`, { method: 'POST',
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json', 'X-Country': r.country, 'X-Currency': r.currency },
      body: JSON.stringify({ reference: r.reference, subscriber: { country: r.country, currency: r.currency, msisdn: r.payer }, transaction: { amount: r.amountMinor, country: r.country, currency: r.currency, id: tx } }) });
    if (!res.ok) throw new Error(`Airtel payment error ${res.status}`);
    return { providerRef: tx, status: 'pending', instructions: 'Validez la demande sur votre téléphone / approve the prompt on your phone' };
  }
  parseWebhook(raw: string, h: Record<string, string | undefined>): WebhookEvent {
    const secret = process.env.AIRTEL_CALLBACK_SECRET; if (!secret) throw new Error('AIRTEL_CALLBACK_SECRET is not set');
    if (!verifyWebhook(secret, Number(h['x-webhook-timestamp']), raw, h['x-webhook-signature'] ?? '')) throw new Error('invalid callback signature');
    const b = JSON.parse(raw) as { transaction: { id: string; status_code: string; airtel_money_id?: string } };
    return { eventId: b.transaction.airtel_money_id ?? `${b.transaction.id}:${b.transaction.status_code}`, providerRef: b.transaction.id, status: b.transaction.status_code === 'TS' ? 'succeeded' : 'failed' };
  }
}

/** Moov Money: generic HTTPS collection adapter configured by MOOV_BASE_URL / MOOV_API_KEY / MOOV_CALLBACK_SECRET.
 *  The exact payload is operator-specific: it must be aligned with the documentation delivered with the merchant account (docs/INTEGRATIONS.md). */
export class MoovMoneyProvider implements PaymentProvider {
  readonly code = 'moov_money'; readonly mode = 'live' as const;
  async initiate(r: InitiateRequest): Promise<InitiateResult> {
    const base = process.env.MOOV_BASE_URL, key = process.env.MOOV_API_KEY;
    if (!base || !key) throw new Error('MOOV_BASE_URL / MOOV_API_KEY are required');
    if (!r.payer) throw new Error('payer phone number is required for Mobile Money');
    const ref = randomUUID();
    const res = await fetch(`${base}/collections`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ reference: ref, merchant_reference: r.reference, msisdn: r.payer, amount: r.amountMinor, currency: r.currency }) });
    if (!res.ok) throw new Error(`Moov payment error ${res.status}`);
    return { providerRef: ref, status: 'pending', instructions: 'Validez la demande sur votre téléphone / approve the prompt on your phone' };
  }
  parseWebhook(raw: string, h: Record<string, string | undefined>): WebhookEvent {
    const secret = process.env.MOOV_CALLBACK_SECRET; if (!secret) throw new Error('MOOV_CALLBACK_SECRET is not set');
    if (!verifyWebhook(secret, Number(h['x-webhook-timestamp']), raw, h['x-webhook-signature'] ?? '')) throw new Error('invalid callback signature');
    const b = JSON.parse(raw) as { id: string; reference: string; status: string };
    return { eventId: b.id, providerRef: b.reference, status: b.status === 'SUCCESS' ? 'succeeded' : 'failed' };
  }
}

/** Providers by country configuration code. PAYMENT_MODE=live uses the real ones; anything else (default) the sandbox. */
@Injectable()
export class PaymentProviders {
  private cache = new Map<string, PaymentProvider>();
  get(code: string): PaymentProvider {
    const live = process.env.PAYMENT_MODE === 'live';
    const key = `${code}:${live}`;
    if (!this.cache.has(key)) {
      const p = !live ? new SandboxProvider(code) : code === 'stripe' ? new StripeProvider() : code === 'airtel_money' ? new AirtelMoneyProvider() : code === 'moov_money' ? new MoovMoneyProvider() : null;
      if (!p) throw new Error(`no live provider for ${code}`);
      this.cache.set(key, p);
    }
    return this.cache.get(key)!;
  }
}
