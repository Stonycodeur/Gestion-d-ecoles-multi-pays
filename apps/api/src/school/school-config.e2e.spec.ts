import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { join } from 'node:path';
import { Pool } from 'pg';

process.env.AUTH_MODE = 'sandbox';
process.env.SANDBOX_JWT_SECRET = 'y'.repeat(40);
process.env.MODULES_DIR = join(__dirname, '../../../../packages/modules');

const enabled = !!process.env.DATABASE_URL && !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('School configuration e2e: grading scale, contracts, substitutions', () => {
  jest.setTimeout(60000);
  let app: INestApplication; let server: any; let admin: Pool;
  const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  let adminT: string, headT: string, guardianT: string, adminOther: string;
  const ids: Record<string, string> = {};
  const tok = async (role: string, tenant: string, n: number, extra: object = {}) =>
    (await request(server).post('/auth/sandbox/token').send({ sub: U(n), role, tenant, ...extra })).body.access_token as string;
  const call = (m: 'get' | 'post' | 'put' | 'delete', path: string, t: string) => (request(server) as any)[m](path).set('Authorization', `Bearer ${t}`);
  const nextMonday = () => { const d = new Date(); d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7)); return d.toISOString().slice(0, 10); };

  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    for (const [slug, id] of [['e2e_q', U(9101)], ['e2e_r', U(9102)]]) {
      await admin.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,$2,$3,'lycee','GA',$4) ON CONFLICT DO NOTHING", [id, slug, `Lycée ${slug}`, `tenant_${slug}`]);
      await admin.query('SELECT provision_tenant_schema($1)', [slug]);
    }
    const { AppModule } = await import('../app.module');
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication(); await app.init(); server = app.getHttpServer();
    adminT = await tok('admin', 'e2e_q', 11); headT = await tok('head', 'e2e_q', 12); adminOther = await tok('admin', 'e2e_r', 13);
    guardianT = await tok('guardian', 'e2e_q', 14, { child_ids: [U(555)] });
  });
  afterAll(async () => { await app.close(); await admin.end(); });

  it('exposes the country reference and the active scale from configuration only', async () => {
    const c = (await call('get', '/settings/country', adminT).expect(200)).body;
    expect(c.country.code).toBe('GA'); expect(c.country.currency).toBe('XAF'); expect(c.education_system.cycle).toBe('upper_secondary');
    const g = (await call('get', '/settings/grading', guardianT).expect(200)).body;
    expect(g.active.code).toBe('num20'); expect(g.active.max).toBe(20);
    expect(g.available.map((s: any) => s.code)).toEqual(expect.arrayContaining(['num10', 'num20']));
    expect(g.color_bands[0].minPct).toBe(81);
  });

  it('only a school administrator can change the scale, and only within the scales of the country', async () => {
    await call('put', '/settings/grading', guardianT).send({ grading_scale_code: 'num10' }).expect(403);
    await call('put', '/settings/grading', adminT).send({ grading_scale_code: 'letters' }).expect(400);          // letters belong to another country
    await call('put', '/settings/grading', adminT).send({ grading_scale_code: 'num10', effective_from: '2000-01-01' }).expect(400);   // never rewrite the past
    await call('put', '/settings/grading', adminT).send({ grading_scale_code: 'num10', color_bands: [{ minPct: 50, color: 'green' }, { minPct: 10, color: 'red' }] }).expect(400);   // no band at 0
    await call('put', '/settings/grading', adminT).send({ grading_scale_code: 'num10', color_bands: [{ minPct: 0, color: 'javascript:alert(1)' }, { minPct: 50, color: 'green' }] }).expect(400);
  });

  it('keeps grades already entered on their original scale after a mid-year change, and isolates schools', async () => {
    ids.cls = (await call('post', '/classes', adminT).send({ name: '2nde A', level_code: '2nde', school_year: '2026-2027' }).expect(201)).body.id;
    ids.math = (await call('post', '/subjects', adminT).send({ code: 'MATH', name: 'Mathématiques', coefficient: 4 }).expect(201)).body.id;
    ids.s1 = (await call('post', '/students', adminT).send({ first_name: 'Ada', last_name: 'Obiang', class_id: ids.cls }).expect(201)).body.student.id;
    const ev1 = (await call('post', '/evaluations', headT).send({ class_id: ids.cls, subject_id: ids.math, period_code: 'T1', title: 'DS1' }).expect(201)).body;
    expect(ev1.scale_snapshot.max).toBe(20);
    await call('post', `/evaluations/${ev1.id}/grades`, headT).send({ entries: [{ student_id: ids.s1, value: 15 }] }).expect(201);

    const bands = [{ minPct: 0, color: 'red', name: 'faible' }, { minPct: 50, color: 'yellow', name: 'moyen' }, { minPct: 75, color: 'green', name: 'bien' }];
    const out = (await call('put', '/settings/grading', adminT).send({ grading_scale_code: 'num10', color_bands: bands }).expect(200)).body;
    expect(out.active.code).toBe('num10'); expect(out.active.max).toBe(10);
    expect(out.color_bands.map((b: any) => b.minPct)).toEqual([75, 50, 0]);

    const ev2 = (await call('post', '/evaluations', headT).send({ class_id: ids.cls, subject_id: ids.math, period_code: 'T1', title: 'DS2' }).expect(201)).body;
    expect(ev2.scale_snapshot.max).toBe(10);
    const old = await admin.query("SELECT scale_snapshot->>'max' AS max FROM tenant_e2e_q.evaluations WHERE id = $1", [ev1.id]);
    expect(old.rows[0].max).toBe('20');                                                   // old evaluation untouched
    const g = await admin.query('SELECT normalized::float AS n FROM tenant_e2e_q.grades WHERE evaluation_id = $1', [ev1.id]);
    expect(g.rows[0].n).toBe(75);                                                          // still comparable on the 0-100 base
    await call('post', `/evaluations/${ev2.id}/grades`, headT).send({ entries: [{ student_id: ids.s1, value: 7.5 }] }).expect(201);
    const g2 = await admin.query('SELECT normalized::float AS n FROM tenant_e2e_q.grades WHERE evaluation_id = $1', [ev2.id]);
    expect(g2.rows[0].n).toBe(75);

    const other = (await call('get', '/settings/grading', adminOther).expect(200)).body;
    expect(other.active.code).toBe('num20');                                              // the other school is unaffected
    expect(other.overrides).toHaveLength(0);
    await call('put', '/settings/grading', adminT).send({ grading_scale_code: 'num20' }).expect(200);   // same-day change is an upsert
  });

  it('records contracts and flags overloaded teachers', async () => {
    ids.t1 = (await call('post', '/teachers', adminT).send({ first_name: 'Jean', last_name: 'Mba', max_weekly_hours: 20 }).expect(201)).body.id;
    await call('post', '/staff/contracts', guardianT).send({ teacher_id: ids.t1, kind: 'CDI', start_date: '2026-09-01' }).expect(403);
    await call('post', '/staff/contracts', adminT).send({ teacher_id: ids.t1, kind: 'CDD', start_date: '2026-09-01', end_date: '2025-01-01', weekly_hours: 10 }).expect(400);
    await call('post', '/staff/contracts', adminT).send({ teacher_id: ids.t1, kind: 'CDD', start_date: '2020-09-01', weekly_hours: 3 }).expect(201);
    expect((await call('get', `/staff/contracts?teacher_id=${ids.t1}`, headT).expect(200)).body).toHaveLength(1);
    await call('post', '/class-subjects', adminT).send({ class_id: ids.cls, subject_id: ids.math, teacher_id: ids.t1, weekly_hours: 4 }).expect(201);
    const w = (await call('get', '/staff/workload', headT).expect(200)).body.find((x: any) => x.teacher_id === ids.t1);
    expect(w).toMatchObject({ assigned_hours: 4, contract_hours: 3, limit_hours: 3, overloaded: true });
  });

  it('replaces a teacher for one date: conflicts refused, family notified, removable', async () => {
    ids.t2 = (await call('post', '/teachers', adminT).send({ first_name: 'Awa', last_name: 'Nze' }).expect(201)).body.id;
    ids.t3 = (await call('post', '/teachers', adminT).send({ first_name: 'Paul', last_name: 'Ona' }).expect(201)).body.id;
    ids.fr = (await call('post', '/subjects', adminT).send({ code: 'FR', name: 'Français', coefficient: 3 }).expect(201)).body.id;
    ids.cls2 = (await call('post', '/classes', adminT).send({ name: '2nde B', level_code: '2nde', school_year: '2026-2027' }).expect(201)).body.id;
    ids.sch = (await admin.query("INSERT INTO tenant_e2e_q.schedules(tenant_id, school_year) SELECT id, '2026-2027' FROM public.tenants WHERE slug = 'e2e_q' RETURNING id")).rows[0].id;
    const slot = (await call('post', `/schedules/${ids.sch}/slots`, adminT).send({ class_id: ids.cls, subject_id: ids.math, teacher_id: ids.t1, weekday: 1, period_index: 2 }).expect(201)).body;
    const busy = (await call('post', `/schedules/${ids.sch}/slots`, adminT).send({ class_id: ids.cls2, subject_id: ids.fr, teacher_id: ids.t2, weekday: 1, period_index: 2 }).expect(201)).body;
    const monday = nextMonday();
    const tuesday = new Date(Date.parse(`${monday}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    await call('post', '/substitutions', guardianT).send({ slot_id: slot.id, on_date: monday, substitute_teacher_id: ids.t3 }).expect(403);
    await call('post', '/substitutions', adminT).send({ slot_id: slot.id, on_date: tuesday, substitute_teacher_id: ids.t3 }).expect(400);   // wrong weekday
    await call('post', '/substitutions', adminT).send({ slot_id: slot.id, on_date: monday, substitute_teacher_id: ids.t1 }).expect(400);   // same teacher
    await call('post', '/substitutions', adminT).send({ slot_id: slot.id, on_date: monday, substitute_teacher_id: ids.t2 }).expect(409);   // teaches elsewhere then
    expect(busy.id).toBeTruthy();
    await admin.query("INSERT INTO tenant_e2e_q.directory(tenant_id, user_id, role, display_name, student_id, child_ids) SELECT id, $1, 'guardian', 'Mme Obiang', NULL, ARRAY[$2]::uuid[] FROM public.tenants WHERE slug='e2e_q'", [U(14), ids.s1]);
    const res = (await call('post', '/substitutions', adminT).send({ slot_id: slot.id, on_date: monday, substitute_teacher_id: ids.t3, note: 'absent' }).expect(201)).body;
    expect(res.substitute_teacher_id).toBe(ids.t3); expect(res.notified).toBeGreaterThanOrEqual(1);
    const list = (await call('get', `/substitutions?from=${monday}&to=${monday}`, guardianT).expect(200)).body;
    expect(list).toHaveLength(1); expect(list[0]).toMatchObject({ substitute_last_name: 'Ona', original_last_name: 'Mba' });
    const n = await admin.query("SELECT count(*)::int AS c FROM tenant_e2e_q.notifications WHERE user_id = $1 AND type = 'schedule.substitution'", [U(14)]);
    expect(n.rows[0].c).toBe(1);
    await call('get', `/substitutions`, adminOther).expect(200).expect((r: any) => expect(r.body).toHaveLength(0));   // tenant isolation
    await call('delete', `/substitutions/${res.id}`, adminT).expect(200);
    await call('delete', `/substitutions/${res.id}`, adminT).expect(404);
  });
});
