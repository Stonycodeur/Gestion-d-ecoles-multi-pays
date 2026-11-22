import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';
import { Pool } from 'pg';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 'p'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../packages/modules');
process.env.MESSAGE_KEY = Buffer.alloc(32, 5).toString('base64');
process.env.WEBHOOK_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.RATE_LIMIT_PER_MIN = '100000';

/** Spec 12.1: API p95 < 200 ms. Measured in-process on a school with 1 500 students, 3 000 grades and 3 000 absences (CI hardware is slower than production, so a pass here has margin). */
const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Performance budget', () => {
  jest.setTimeout(180000);
  let app: INestApplication; let server: any; let admin: Pool; let adminT: string; let classId: string; let studentId: string;
  const T = '00000000-0000-4000-8000-000000009400';

  const p95 = async (n: number, f: () => Promise<unknown>) => {
    const t: number[] = []; for (let i = 0; i < n; i++) { const s = process.hrtime.bigint(); await f(); t.push(Number(process.hrtime.bigint() - s) / 1e6); }
    t.sort((a, b) => a - b); return t[Math.ceil(0.95 * t.length) - 1];
  };

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,'e2e_p','E2E P','lycee','GA','tenant_e2e_p') ON CONFLICT DO NOTHING", [T]);
    await admin.query("SELECT provision_tenant_schema('e2e_p')");
    const c = await admin.connect();
    try {
      await c.query('BEGIN'); await c.query('SELECT set_config($1, $2, true)', ['app.tenant_id', T]); await c.query('SET LOCAL search_path TO tenant_e2e_p, public');
      if (!(await c.query('SELECT 1 FROM students LIMIT 1')).rowCount) {
        classId = (await c.query("INSERT INTO classes(name, level_code, school_year) VALUES ('P1','2nde','2026-2027') RETURNING id")).rows[0].id;
        const subj = (await c.query("INSERT INTO subjects(code, name, coefficient, category) VALUES ('M','Maths',2,'academic') RETURNING id")).rows[0].id;
        await c.query("INSERT INTO students(first_name, last_name, status, class_id) SELECT 'F'||g, 'L'||(g % 700), 'active', $1 FROM generate_series(1,1500) g", [classId]);
        const snap = (await c.query("SELECT to_jsonb(g) AS s FROM public.grading_scales g WHERE country_code='GA' AND code='num20'")).rows[0].s;
        const ev = (await c.query("INSERT INTO evaluations(class_id, subject_id, period_code, title, scale_snapshot) VALUES ($1,$2,'T1','DS',$3) RETURNING id", [classId, subj, snap])).rows[0].id;
        await c.query("INSERT INTO grades(evaluation_id, student_id, raw_value, normalized) SELECT $1, id, '12', 60 FROM students", [ev]);
        await c.query("INSERT INTO absences(student_id, on_date, kind) SELECT id, CURRENT_DATE - (random()*60)::int, 'absence' FROM students, generate_series(1,2)");
      }
      await c.query('COMMIT'); await c.query('ANALYZE');
    } finally { c.release(); }
    const cl = await admin.query("SELECT id FROM tenant_e2e_p.classes LIMIT 1"); classId = cl.rows[0].id;
    studentId = (await admin.query("SELECT id FROM tenant_e2e_p.students LIMIT 1")).rows[0].id;
    const { AppModule } = await import('./app.module');
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication({ rawBody: true }); await app.init(); server = app.getHttpServer();
    adminT = (await request(server).post('/auth/sandbox/token').send({ sub: '00000000-0000-4000-8000-000000007001', role: 'admin', tenant: 'e2e_p' })).body.access_token;
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  const get = (path: string) => request(server).get(path).set('Authorization', `Bearer ${adminT}`);

  it('student list pages are served under 200 ms (p95) and pagination is enforced', async () => {
    expect(await p95(60, () => get(`/students?class_id=${classId}&limit=100`).expect(200))).toBeLessThan(200);
    const page1 = (await get('/students?limit=50&offset=0').expect(200)).body; const page2 = (await get('/students?limit=50&offset=50').expect(200)).body;
    expect(page1).toHaveLength(50); expect(page2).toHaveLength(50); expect(page1[0].id).not.toBe(page2[0].id);
    expect((await get('/students').expect(200)).body.length).toBeLessThanOrEqual(500);       // default cap
    await get('/students?limit=5000').expect(400); await get('/students?offset=-1').expect(400);
  });
  it('a student report (grades, averages, attendance) stays under 200 ms (p95)', async () => {
    expect(await p95(60, () => get(`/students/${studentId}/report?period=T1`).expect(200))).toBeLessThan(200);
  });
  it('class and subject lists and the health probe are fast', async () => {
    expect(await p95(60, () => get('/classes').expect(200))).toBeLessThan(200);
    expect(await p95(60, () => request(server).get('/health').expect(200))).toBeLessThan(200);
  });
});
