import { InlineQueue, RabbitQueue, type JobQueue } from './queue';
import { ElasticsearchSearch, PostgresSearch, type SearchAdapter } from './search';
import { Injectable } from '@nestjs/common';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Every external service = interface + live implementation + sandbox implementation, chosen by *_MODE (spec 7).

export interface StorageAdapter {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}
const safeKey = (k: string) => {
  if (!/^[A-Za-z0-9/_.\-]+$/.test(k) || k.includes('..')) throw new Error('invalid storage key');
  return k;
};

export class LocalStorage implements StorageAdapter {
  constructor(private readonly dir: string) {}
  private path(k: string) { return join(resolve(this.dir), safeKey(k)); }
  async put(key: string, data: Buffer) { const p = this.path(key); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, data); }
  async get(key: string) { return readFileSync(this.path(key)); }
  async delete(key: string) { rmSync(this.path(key), { force: true }); }
}

/** MinIO / any S3-compatible store (live mode). Needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY. */
export class S3Storage implements StorageAdapter {
  private clientP?: Promise<any>;
  private async client() {
    if (!this.clientP) {
      this.clientP = import('@aws-sdk/client-s3').then((m) => new m.S3Client({
        endpoint: process.env.S3_ENDPOINT, region: process.env.S3_REGION ?? 'us-east-1', forcePathStyle: true,
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? '', secretAccessKey: process.env.S3_SECRET_KEY ?? '' },
      }));
    }
    return this.clientP;
  }
  async put(key: string, data: Buffer, contentType: string) {
    const m = await import('@aws-sdk/client-s3');
    await (await this.client()).send(new m.PutObjectCommand({ Bucket: process.env.S3_BUCKET, Key: safeKey(key), Body: data, ContentType: contentType }));
  }
  async get(key: string) {
    const m = await import('@aws-sdk/client-s3');
    const r = await (await this.client()).send(new m.GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: safeKey(key) }));
    return Buffer.from(await r.Body.transformToByteArray());
  }
  async delete(key: string) {
    const m = await import('@aws-sdk/client-s3');
    await (await this.client()).send(new m.DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: safeKey(key) }));
  }
}

export interface PushMessage { platform: string; token: string; title: string; body: string; data?: Record<string, string> }
export interface PushAdapter { readonly mode: 'sandbox' | 'live'; send(m: PushMessage): Promise<void> }

export class SandboxPush implements PushAdapter {
  readonly mode = 'sandbox' as const;
  readonly sent: PushMessage[] = [];
  async send(m: PushMessage) { this.sent.push(m); }
}

/** Firebase Cloud Messaging. iOS goes through FCM too: upload the APNs key in the Firebase console (docs/INTEGRATIONS.md). */
export class FcmPush implements PushAdapter {
  readonly mode = 'live' as const;
  async send(m: PushMessage) {
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    const { getMessaging } = await import('firebase-admin/messaging');
    const app = getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON ?? '{}')) });
    await getMessaging(app).send({ token: m.token, notification: { title: m.title, body: m.body }, data: m.data });
  }
}

export interface SmsAdapter { readonly mode: 'sandbox' | 'live'; send(to: string, text: string): Promise<void> }
export interface EmailAdapter { readonly mode: 'sandbox' | 'live'; send(to: string, subject: string, text: string): Promise<void> }

export class SandboxSms implements SmsAdapter { readonly mode = 'sandbox' as const; readonly sent: { to: string; text: string }[] = []; async send(to: string, text: string) { this.sent.push({ to, text }); } }
export class SandboxEmail implements EmailAdapter { readonly mode = 'sandbox' as const; readonly sent: { to: string; subject: string; text: string }[] = []; async send(to: string, subject: string, text: string) { this.sent.push({ to, subject, text }); } }

/** Twilio REST (live). Needs TWILIO_SID, TWILIO_TOKEN, TWILIO_FROM. */
export class TwilioSms implements SmsAdapter {
  readonly mode = 'live' as const;
  async send(to: string, text: string) {
    const sid = process.env.TWILIO_SID ?? '';
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${sid}:${process.env.TWILIO_TOKEN ?? ''}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: process.env.TWILIO_FROM ?? '', Body: text }),
    });
    if (!r.ok) throw new Error(`SMS failed (${r.status})`);
  }
}
export class SmtpEmail implements EmailAdapter {
  readonly mode = 'live' as const;
  async send(to: string, subject: string, text: string) {
    const nm = await import('nodemailer');
    await nm.createTransport(process.env.SMTP_URL ?? '').sendMail({ from: process.env.EMAIL_FROM, to, subject, text });
  }
}

/** Identity provider administration: disabling an account at deletion so that it can no longer sign in or refresh a token. */
export interface IdentityAdapter { readonly mode: 'sandbox' | 'live'; disableUser(userId: string): Promise<void> }
export class SandboxIdentity implements IdentityAdapter { readonly mode = 'sandbox' as const; readonly disabled: string[] = []; async disableUser(userId: string) { this.disabled.push(userId); } }

/** Keycloak admin REST (live). Needs KC_URL, KC_REALM and a service-account client with the realm-management `manage-users` role: KC_ADMIN_CLIENT_ID, KC_ADMIN_CLIENT_SECRET. */
export class KeycloakIdentity implements IdentityAdapter {
  readonly mode = 'live' as const;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly f: typeof fetch = fetch) {}
  private async token(base: string, realm: string): Promise<string> {
    const r = await this.f(`${base}/realms/${realm}/protocol/openid-connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.env.KC_ADMIN_CLIENT_ID ?? '', client_secret: this.env.KC_ADMIN_CLIENT_SECRET ?? '' }) });
    if (!r.ok) throw new Error(`identity provider token failed (${r.status})`);
    return ((await r.json()) as { access_token: string }).access_token;
  }
  async disableUser(userId: string) {
    if (!/^[0-9a-fA-F-]{8,64}$/.test(userId)) throw new Error('invalid identity-provider user id');
    const base = (this.env.KC_URL ?? '').replace(/\/$/, ''), realm = this.env.KC_REALM ?? '';
    if (!base || !realm) throw new Error('KC_URL and KC_REALM are required');
    const h = { 'content-type': 'application/json', authorization: `Bearer ${await this.token(base, realm)}` };
    const u = `${base}/admin/realms/${realm}/users/${userId}`;
    const put = await this.f(u, { method: 'PUT', headers: h, body: JSON.stringify({ enabled: false }) });
    if (put.status !== 404 && !put.ok) throw new Error(`disabling the account failed (${put.status})`);   // 404: never provisioned in the provider, nothing to disable
    if (put.ok) { const out = await this.f(`${u}/logout`, { method: 'POST', headers: h }); if (!out.ok) throw new Error(`closing sessions failed (${out.status})`); }
  }
}

@Injectable()
export class Adapters {
  private cache = new Map<string, unknown>();
  private pick<T>(name: string, mode: string | undefined, make: (live: boolean) => T): T {
    const key = `${name}:${mode ?? 'sandbox'}`;
    if (!this.cache.has(key)) this.cache.set(key, make(mode === 'live'));
    return this.cache.get(key) as T;
  }
  storage(): StorageAdapter { return this.pick('storage', process.env.STORAGE_MODE, (live) => (live ? new S3Storage() : new LocalStorage(process.env.STORAGE_DIR ?? join(tmpdir(), 'ecolemanager-storage')))); }
  push(): PushAdapter { return this.pick('push', process.env.PUSH_MODE, (live) => (live ? new FcmPush() : new SandboxPush())); }
  sms(): SmsAdapter { return this.pick('sms', process.env.SMS_MODE, (live) => (live ? new TwilioSms() : new SandboxSms())); }
  search(): SearchAdapter { return this.pick('search', process.env.SEARCH_MODE === 'elasticsearch' ? 'live' : 'sandbox', (live) => (live ? new ElasticsearchSearch() : new PostgresSearch())); }
  queue(): JobQueue { return this.pick('queue', process.env.QUEUE_MODE === 'rabbitmq' ? 'live' : 'sandbox', (live) => (live ? new RabbitQueue() : new InlineQueue())); }
  identity(): IdentityAdapter { return this.pick('identity', process.env.IDENTITY_MODE, (live) => (live ? new KeycloakIdentity() : new SandboxIdentity())); }
  email(): EmailAdapter { return this.pick('email', process.env.EMAIL_MODE, (live) => (live ? new SmtpEmail() : new SandboxEmail())); }
}
