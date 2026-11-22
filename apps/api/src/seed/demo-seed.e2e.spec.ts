import { Pool } from 'pg';
import { seedDemo } from './demo-seed';

const enabled = !!process.env.DATABASE_ADMIN_URL;
(enabled ? describe : describe.skip)('Gabon demo seed', () => {
  let admin: Pool;
  beforeAll(() => { admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL }); });
  afterAll(async () => { await admin.end(); });

  it('creates one school per cycle, every role, grades in the local scale, and is idempotent', async () => {
    const first = await seedDemo(admin);
    const second = await seedDemo(admin);
    expect(second).toHaveLength(0);
    const roles = new Set(first.map((a) => a.role));
    for (const r of ['tenant_super_admin', 'admin', 'head', 'teacher', 'education_assistant', 'accountant', 'student', 'guardian', 'inspector']) expect(roles.has(r)).toBe(true);
    const t = await admin.query(`SELECT school_type FROM tenants WHERE slug LIKE 'ga\\_%' ORDER BY school_type`);
    expect(t.rows.map((r) => r.school_type)).toEqual(['college', 'lycee', 'primary', 'university']);
    const g = await admin.query(`SELECT count(*)::int AS n, max(normalized) AS mx FROM tenant_ga_college.grades`);
    expect(g.rows[0].n).toBeGreaterThan(0); expect(Number(g.rows[0].mx)).toBeLessThanOrEqual(100);
    const snap = await admin.query(`SELECT scale_snapshot->>'code' AS c FROM tenant_ga_primaire.evaluations LIMIT 1`);
    expect(snap.rows[0].c).toBe('num10');
    const pw = await admin.query(`SELECT count(*)::int AS n FROM users WHERE email LIKE '%.demo' AND password_hash NOT LIKE '!%'`);
    expect(pw.rows[0].n).toBe(0);
  });

  it('refuses to run in production without explicit override', async () => {
    const prev = process.env.NODE_ENV; process.env.NODE_ENV = 'production'; delete process.env.ALLOW_DEMO_SEED;
    await expect(seedDemo(admin)).rejects.toThrow(/production/);
    process.env.NODE_ENV = prev;
  });
});
