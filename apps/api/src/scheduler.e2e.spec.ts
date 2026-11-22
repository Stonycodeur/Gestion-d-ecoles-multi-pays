import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { join } from 'node:path';
import { Pool } from 'pg';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 's'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../packages/modules');
process.env.MESSAGE_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.WEBHOOK_KEY = Buffer.alloc(32, 9).toString('base64');

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Scheduler', () => {
  jest.setTimeout(60000);
  let app: INestApplication; let admin: Pool; let sched: import('./core/scheduler').SchedulerService; let lockKey: number;

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    const { AppModule } = await import('./app.module'); const m = await import('./core/scheduler');
    lockKey = m.SCHEDULER_LOCK;
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication(); await app.init();
    sched = app.get(m.SchedulerService);
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('runs the retention job for every school and reports no failure', async () => {
    const r = await sched.runOnce();
    expect(r.skipped).toBeUndefined(); expect(r.tenants).toBeGreaterThan(0); expect(r.jobs.locker_purge).toBe(r.tenants);
    expect(r.errors).toEqual([]);
  });
  it('purges an expired locker document and keeps a valid one', async () => {
    await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ('00000000-0000-4000-8000-000000009300','e2e_o','E2E O','college','GA','tenant_e2e_o') ON CONFLICT DO NOTHING");
    await admin.query("SELECT provision_tenant_schema('e2e_o')");
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_id', '00000000-0000-4000-8000-000000009300', true)"); await c.query('SET LOCAL search_path TO tenant_e2e_o, public');
      const st = (await c.query("INSERT INTO students(first_name, last_name, status) VALUES ('A','B','active') RETURNING id")).rows[0].id;
      await c.query("INSERT INTO locker_documents(student_id, kind, title, storage_key, content_type, retention_days, expires_at) VALUES ($1,'k','old','sched/old','text/plain',1, NOW() - INTERVAL '1 day'), ($1,'k','new','sched/new','text/plain',1, NOW() + INTERVAL '30 days')", [st]);
      await c.query('COMMIT');
    } finally { c.release(); }
    await sched.runOnce();
    const left = await admin.query("SELECT title FROM tenant_e2e_o.locker_documents ORDER BY title");
    expect(left.rows.map((x) => x.title)).toEqual(['new']);
  });
  it('another replica holding the advisory lock makes this tick skip, and the lock is released afterwards', async () => {
    const other = await admin.connect();
    try {
      await other.query('SELECT pg_advisory_lock($1)', [lockKey]);
      expect((await sched.runOnce()).skipped).toBe(true);
    } finally { await other.query('SELECT pg_advisory_unlock($1)', [lockKey]); other.release(); }
    expect((await sched.runOnce()).skipped).toBeUndefined();
  });
});
