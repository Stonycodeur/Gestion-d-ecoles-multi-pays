import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { join } from 'node:path';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 'c'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../../packages/modules');
process.env.SMS_MODE = 'sandbox'; process.env.EMAIL_MODE = 'sandbox'; process.env.PUSH_MODE = 'sandbox';

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Notification channels e2e: absences reach families by SMS and e-mail unless switched off', () => {
  let app: INestApplication; let server: any; let admin: Pool;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n + 7000).padStart(12, '0')}`;
  const tok = async (role: string, n: number, extra: object = {}) => (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant: 'e2e_u', ...extra })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'put', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,'e2e_u','Lycée e2e_u','lycee','GA','tenant_e2e_u') ON CONFLICT DO NOTHING", [U(9001)]);
      await c.query("SELECT provision_tenant_schema('e2e_u')");
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    const { AppModule } = await import('../app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication(); await app.init(); server = app.getHttpServer();
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('sends SMS and e-mail for an absence, honours the switches, and keeps other types in-app', async () => {
    const { Adapters } = await import('../adapters/adapters');
    const ad = app.get(Adapters); const sms = ad.sms() as any; const mail = ad.email() as any;
    const adminT = await tok('admin', 1);
    const cls = (await call('post', '/classes', adminT).send({ name: '2nde A', level_code: '2nde', school_year: '2026-2027' }).expect(201)).body.id;
    const stu = (await call('post', '/students', adminT).send({ first_name: 'Ada', last_name: 'Obiang', birth_date: '2010-04-05', class_id: cls }).expect(201)).body.student.id;
    await call('post', '/directory', adminT).send({ user_id: U(2), role: 'guardian', display_name: 'Marie Obiang', child_ids: [stu], email: 'marie@example.org', phone: '+24101020304' }).expect(201);
    await call('post', '/directory', adminT).send({ user_id: U(3), role: 'guardian', display_name: 'Sans contact', child_ids: [stu] }).expect(201);
    const teacher = await tok('teacher', 4, { class_ids: [cls] });
    const guardian = await tok('guardian', 2, { child_ids: [stu] });

    expect((await call('get', '/me/notification-preferences', guardian).expect(200)).body).toMatchObject({ sms: true, email: true, has_phone: true, has_email: true });
    const s0 = sms.sent.length, m0 = mail.sent.length;
    await call('post', '/absences', teacher).send({ student_id: stu, on_date: '2026-11-02', kind: 'absence' }).expect(201);
    expect(sms.sent.slice(s0).map((x: any) => x.to)).toEqual(['+24101020304']);                  // the contact-less guardian gets neither
    expect(mail.sent.slice(m0).map((x: any) => x.to)).toEqual(['marie@example.org']);
    expect(sms.sent[s0].text.length).toBeLessThanOrEqual(160);

    await call('put', '/me/notification-preferences', guardian).send({ sms: false }).expect(200);
    const s1 = sms.sent.length, m1 = mail.sent.length;
    await call('post', '/absences', teacher).send({ student_id: stu, on_date: '2026-11-03', kind: 'absence' }).expect(201);
    expect(sms.sent.length).toBe(s1);                                                              // SMS switched off
    expect(mail.sent.length).toBe(m1 + 1);                                                         // e-mail still on
    await call('put', '/me/notification-preferences', guardian).send({ sms: 'yes' }).expect(400);
    await call('put', '/me/notification-preferences', guardian).send({}).expect(400);

    const inApp = (await call('get', '/notifications', guardian).expect(200)).body;
    expect(inApp.filter((n: any) => n.type === 'absence.recorded').length).toBe(2);               // the in-app notification is never optional
  });
});
