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
    const admin = await import('firebase-admin');
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON ?? '{}')) });
    await admin.messaging().send({ token: m.token, notification: { title: m.title, body: m.body }, data: m.data });
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
  email(): EmailAdapter { return this.pick('email', process.env.EMAIL_MODE, (live) => (live ? new SmtpEmail() : new SandboxEmail())); }
}
