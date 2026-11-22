import { Pool } from 'pg';

/** Provisions the demo accounts in Keycloak with the SAME id as in the school directory (the token `sub` must equal directory.user_id).
 *  Run after `seed:demo`: `KEYCLOAK_URL=… KC_ADMIN=… KC_ADMIN_PASSWORD=… DEMO_PASSWORD=… npm run seed:keycloak`. Passwords are temporary (changed at first login). */
export interface DirRow { user_id: string; role: string; display_name: string; email: string | null; class_ids: string[]; child_ids: string[]; student_id: string | null; tenant: string }

export function buildKeycloakUser(r: DirRow, password: string) {
  const [first, ...rest] = r.display_name.split(' ');
  return {
    id: r.user_id, username: r.email ?? r.user_id, email: r.email ?? undefined, firstName: first, lastName: rest.join(' ') || '-', enabled: true, emailVerified: true,
    attributes: { roles: [r.role], tenant: [r.tenant], class_ids: r.class_ids, child_ids: r.child_ids, ...(r.student_id ? { student_id: [r.student_id] } : {}) },
    credentials: [{ type: 'password', value: password, temporary: true }],
  };
}

export async function provisionKeycloak(rows: DirRow[], o: { baseUrl: string; adminUser: string; adminPassword: string; realm?: string; password: string; fetchFn?: typeof fetch }): Promise<{ created: number; existing: number }> {
  if (o.password.length < 10) throw new Error('DEMO_PASSWORD must be at least 10 characters');
  const f = o.fetchFn ?? fetch; const realm = o.realm ?? 'ecolemanager'; const base = o.baseUrl.replace(/\/$/, '');
  const tr = await f(`${base}/realms/master/protocol/openid-connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: o.adminUser, password: o.adminPassword }) });
  if (!tr.ok) throw new Error(`Keycloak admin login failed (${tr.status})`);
  const token = ((await tr.json()) as { access_token: string }).access_token;
  let created = 0, existing = 0;
  for (const r of rows) {
    const res = await f(`${base}/admin/realms/${realm}/users`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(buildKeycloakUser(r, o.password)) });
    if (res.status === 201) created++; else if (res.status === 409) existing++; else throw new Error(`Keycloak refused ${r.email} (${res.status})`);
  }
  return { created, existing };
}

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== '1') throw new Error('refused in production');
  const need = (k: string) => process.env[k] ?? (() => { throw new Error(`${k} is required`); })();
  const pool = new Pool({ connectionString: need('DATABASE_ADMIN_URL') });
  const rows: DirRow[] = [];
  for (const t of (await pool.query(`SELECT slug FROM tenants WHERE slug LIKE 'ga\\_%' ORDER BY slug`)).rows) {
    const c = await pool.connect();
    try {
      await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id', (SELECT id::text FROM tenants WHERE slug = $1), true)`, [t.slug]);
      const r = await c.query(`SELECT user_id, role, display_name, email, class_ids, child_ids, student_id FROM tenant_${t.slug}.directory`);
      rows.push(...r.rows.map((x) => ({ ...x, tenant: t.slug as string }))); await c.query('COMMIT');
    } finally { c.release(); }
  }
  console.log(await provisionKeycloak(rows, { baseUrl: need('KEYCLOAK_URL'), adminUser: need('KC_ADMIN'), adminPassword: need('KC_ADMIN_PASSWORD'), password: need('DEMO_PASSWORD') }));
  await pool.end();
}
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
