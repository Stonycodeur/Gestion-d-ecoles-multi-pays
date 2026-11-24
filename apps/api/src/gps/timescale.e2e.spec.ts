import { Pool } from 'pg';

/** With TimescaleDB (CI api-web job sets TIMESCALE_EXPECTED=1): the GPS series is a hypertable and keeps RLS and purge behaviour. */
const on = !!process.env.DATABASE_ADMIN_URL && process.env.TIMESCALE_EXPECTED === '1';
(on ? describe : describe.skip)('GPS positions as a TimescaleDB hypertable', () => {
  jest.setTimeout(60000);
  let admin: Pool; let studentId: string;
  const T = '00000000-0000-4000-8000-000000009901';
  beforeAll(async () => {
    admin = new Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
    const c = await admin.connect();
    try {
      await c.query('BEGIN');
      await c.query("INSERT INTO tenants(id, slug, name, school_type, country_code, schema_name) VALUES ($1,'e2e_w','Lycée e2e_w','lycee','GA','tenant_e2e_w') ON CONFLICT DO NOTHING", [T]);
      await c.query("SELECT provision_tenant_schema('e2e_w')");
      await c.query('COMMIT');
    } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  });
  afterAll(async () => { await admin.end(); });
  const tx = async (fn: (q: (s: string, p?: unknown[]) => Promise<any[]>) => Promise<void>) => {
    const c = await admin.connect();
    try { await c.query('BEGIN'); await c.query("SET LOCAL search_path = tenant_e2e_w, public"); await c.query("SELECT set_config('app.tenant_id', $1, true), set_config('app.root_bypass','on',true)", [T]);
      await fn(async (s, p) => (await c.query(s, p)).rows); await c.query('COMMIT'); } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  };

  it('is a hypertable with a (id, recorded_at) key and forced row level security', async () => {
    const h = await admin.query("SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_schema = 'tenant_e2e_w' AND hypertable_name = 'gps_positions'");
    expect(h.rowCount).toBe(1);
    const pk = await admin.query("SELECT array_agg(a.attname ORDER BY a.attname) AS cols FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = 'tenant_e2e_w.gps_positions'::regclass AND c.contype = 'p'");
    expect(pk.rows[0].cols).toEqual(['id', 'recorded_at']);
    const rls = await admin.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'tenant_e2e_w.gps_positions'::regclass");
    expect(rls.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });
  it('spreads days over chunks and the retention DELETE still removes only old rows', async () => {
    await tx(async (q) => { studentId = (await q("INSERT INTO students(first_name, last_name) VALUES ('Ts','Db') RETURNING id"))[0].id; });
    await tx(async (q) => { for (const d of [0, 1, 3, 40, 41]) await q("INSERT INTO gps_positions(student_id, enc, accuracy_m, recorded_at) VALUES ($1,'x',5, NOW() - make_interval(days => $2))", [studentId, d]); });
    const chunks = await admin.query("SELECT count(*)::int AS n FROM timescaledb_information.chunks WHERE hypertable_schema = 'tenant_e2e_w' AND hypertable_name = 'gps_positions'");
    expect(chunks.rows[0].n).toBeGreaterThanOrEqual(4);
    await tx(async (q) => {
      const del = await q("WITH d AS (DELETE FROM gps_positions WHERE recorded_at < NOW() - make_interval(days => 30) RETURNING 1) SELECT COUNT(*)::int AS n FROM d");
      expect(del[0].n).toBe(2);
      expect((await q('SELECT COUNT(*)::int AS n FROM gps_positions'))[0].n).toBe(3);
    });
  });
  it('re-provisioning is idempotent', async () => { await admin.query("SELECT provision_tenant_schema('e2e_w')"); });
});
