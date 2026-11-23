import { Pool } from 'pg';

/**
 * Gabon demo seed: one school per cycle (primary, college, lycee, university) with an account for every role.
 * Idempotent (a school that already exists is left untouched). Run: `npm run seed:demo` with DATABASE_ADMIN_URL set.
 * Demo accounts have NO password: they sign in through the sandbox identity provider (AUTH_MODE=sandbox) using the
 * printed user ids. The seed refuses to run in production unless ALLOW_DEMO_SEED=1.
 */
export interface DemoAccount { tenant: string; role: string; email: string; user_id: string; display_name: string }

const SCHOOLS = [
  { slug: 'ga_primaire', name: 'École primaire de démonstration (Libreville)', type: 'primary', cycle: 'primary', scale: 'num10', levels: ['CE2', 'CM1'] },
  { slug: 'ga_college', name: 'Collège de démonstration (Libreville)', type: 'college', cycle: 'lower_secondary', scale: 'num20', levels: ['6e', '3e'] },
  { slug: 'ga_lycee', name: 'Lycée de démonstration (Port-Gentil)', type: 'lycee', cycle: 'upper_secondary', scale: 'num20', levels: ['2nde', 'Terminale'] },
  { slug: 'ga_universite', name: 'Université de démonstration (Franceville)', type: 'university', cycle: 'higher', scale: 'num20_lmd', levels: ['L1', 'L2'] },
] as const;
const STAFF_ROLES = ['tenant_super_admin', 'admin', 'head', 'education_assistant', 'accountant', 'inspector'] as const;
const SUBJECTS = [['MATH', 'Mathématiques', 3, 'academic'], ['FR', 'Français', 3, 'academic'], ['EPS', 'Éducation physique', 1, 'physical']] as const;
const FIRST = ['Marie', 'Jean', 'Aïcha', 'Brice', 'Estelle', 'Landry', 'Nadège', 'Prince'];
const LAST = ['Mba', 'Obame', 'Nzé', 'Ondo', 'Moussavou', 'Ndong', 'Mintsa', 'Essono'];
const SCHOOL_YEAR = '2025-2026';

export async function seedDemo(admin: Pool, log: (s: string) => void = () => undefined): Promise<DemoAccount[]> {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== '1') throw new Error('demo seed refused in production (set ALLOW_DEMO_SEED=1 to override)');
  const accounts: DemoAccount[] = [];
  const roleId = async (code: string) => Number((await admin.query('SELECT id FROM roles WHERE code=$1', [code])).rows[0].id);

  for (const sc of SCHOOLS) {
    const exists = await admin.query('SELECT id FROM tenants WHERE slug=$1', [sc.slug]);
    if (exists.rowCount) { log(`${sc.slug}: already present, skipped`); continue; }
    // One transaction: a school row without its schema would break every per-school job (scheduler, exports) that runs meanwhile.
    const c0 = await admin.connect(); let t: string;
    try {
      await c0.query('BEGIN');
      t = (await c0.query(
        `INSERT INTO tenants(slug, name, school_type, country_code, schema_name) VALUES ($1,$2,$3,'GA',$4) RETURNING id`, [sc.slug, sc.name, sc.type, `tenant_${sc.slug}`])).rows[0].id as string;
      await c0.query('SELECT provision_tenant_schema($1)', [sc.slug]);
      await c0.query('COMMIT');
    } catch (e) { await c0.query('ROLLBACK'); throw e; } finally { c0.release(); }
    const S = `tenant_${sc.slug}`;
    const tx = async <T>(f: (q: (sql: string, p?: unknown[]) => Promise<any>) => Promise<T>) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const c = await admin.connect();
      try { await c.query('BEGIN'); await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]); await c.query(`SET LOCAL search_path TO ${S}, public`); const r = await f((sql, p) => c.query(sql, p)); await c.query('COMMIT'); return r; }
      catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    };
    const mkUser = async (role: string, label: string, n = 0) => {
      const email = `demo.${role}${n || ''}@${sc.slug}.demo`;
      const id = (await admin.query('INSERT INTO users(email, password_hash, tenant_id) VALUES ($1,$2,$3) RETURNING id', [email, '!no-password-sandbox-only', t])).rows[0].id as string;
      await admin.query('INSERT INTO user_roles(user_id, role_id, tenant_id) VALUES ($1,$2,$3)', [id, await roleId(role), t]);
      accounts.push({ tenant: sc.slug, role, email, user_id: id, display_name: label });
      return { id, email };
    };

    for (const m of ['module-oaa', 'module-gamification', 'module-ia-predictive', 'module-payment', 'module-gps', 'module-orientation', 'module-resources', 'module-visitor', 'module-xr', 'module-ai-assistant'])
      await admin.query('INSERT INTO feature_flags(tenant_id, module_name, enabled) VALUES ($1,$2,TRUE) ON CONFLICT DO NOTHING', [t, m]);

    const staff: Record<string, { id: string; email: string }> = {};
    for (const r of STAFF_ROLES) staff[r] = await mkUser(r, `${r} ${sc.slug}`);
    const scale = (await admin.query(`SELECT to_jsonb(g) AS s, max_value FROM grading_scales g WHERE country_code='GA' AND code=$1`, [sc.scale])).rows[0];
    const max = Number(scale.max_value);

    await tx(async (q) => {
      const classIds: string[] = [];
      for (const lv of sc.levels) classIds.push((await q('INSERT INTO classes(name, level_code, school_year) VALUES ($1,$2,$3) RETURNING id', [`${lv} A`, lv, SCHOOL_YEAR])).rows[0].id);
      const subj: string[] = [];
      for (const [code, name, coef, cat] of SUBJECTS) subj.push((await q('INSERT INTO subjects(code, name, coefficient, category) VALUES ($1,$2,$3,$4) RETURNING id', [code, name, coef, cat])).rows[0].id);
      const rooms = [(await q(`INSERT INTO rooms(name, capacity) VALUES ('Salle 1', 40) RETURNING id`)).rows[0].id];
      void rooms;
      const teachers: { id: string; user: string }[] = [];
      for (let i = 0; i < 2; i++) {
        const u = await mkUser('teacher', `Prof. ${LAST[i]}`, i + 1);
        const tid = (await q('INSERT INTO teachers(first_name, last_name, user_id) VALUES ($1,$2,$3) RETURNING id', [FIRST[i], LAST[i], u.id])).rows[0].id;
        await q('INSERT INTO directory(user_id, role, display_name, class_ids, email) VALUES ($1,$2,$3,$4,$5)', [u.id, 'teacher', `Prof. ${LAST[i]}`, classIds, u.email]);
        await q('INSERT INTO contracts(teacher_id, kind, start_date, weekly_hours) VALUES ($1,$2,CURRENT_DATE,$3)', [tid, 'CDI', 18]);
        teachers.push({ id: tid, user: u.id });
      }
      for (const r of STAFF_ROLES) await q('INSERT INTO directory(user_id, role, display_name, email) VALUES ($1,$2,$3,$4)', [staff[r].id, r, `${r} ${sc.slug}`, staff[r].email]);
      for (const cid of classIds) for (const [i, sid] of subj.entries()) await q('INSERT INTO class_subjects(class_id, subject_id, teacher_id, weekly_hours) VALUES ($1,$2,$3,$4)', [cid, sid, teachers[i % 2].id, 3 + i]);

      let n = 0;
      for (const [ci, cid] of classIds.entries()) {
        const evs: string[] = [];
        for (const [si, sid] of subj.entries())
          evs.push((await q(`INSERT INTO evaluations(class_id, subject_id, period_code, title, coefficient, scale_snapshot) VALUES ($1,$2,'T1',$3,1,$4) RETURNING id`, [cid, sid, `Devoir ${SUBJECTS[si][1]}`, scale.s])).rows[0].id);
        for (let k = 0; k < 4; k++, n++) {
          const first = FIRST[(n + ci) % FIRST.length]; const last = LAST[(n * 3 + ci) % LAST.length];
          const su = await mkUser('student', `${first} ${last}`, n + 1);
          const stu = (await q('INSERT INTO students(first_name, last_name, birth_date, status, class_id, user_id, gender) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
            [first, last, `${sc.type === 'university' ? 2004 : sc.type === 'primary' ? 2015 : 2010}-0${1 + k}-15`, 'active', cid, su.id, k % 2 ? 'F' : 'M'])).rows[0].id as string;
          await q('INSERT INTO directory(user_id, role, display_name, class_ids, student_id, email) VALUES ($1,$2,$3,$4,$5,$6)', [su.id, 'student', `${first} ${last}`, [cid], stu, su.email]);
          if (k < 2) {
            const gu = await mkUser('guardian', `Parent de ${first}`, n + 1);
            await q('INSERT INTO guardians(student_id, full_name, relation, phone, email, user_id) VALUES ($1,$2,$3,$4,$5,$6)', [stu, `Parent de ${first}`, 'parent', '+241 00 00 00 00', gu.email, gu.id]);
            await q('INSERT INTO directory(user_id, role, display_name, child_ids, email) VALUES ($1,$2,$3,$4,$5)', [gu.id, 'guardian', `Parent de ${first}`, [stu], gu.email]);
          }
          for (const [ei, ev] of evs.entries()) {
            const pct = 35 + ((n * 17 + ei * 23) % 60); // deterministic spread 35..94 %
            const raw = Math.round(((pct / 100) * max) * 4) / 4;
            await q('INSERT INTO grades(evaluation_id, student_id, raw_value, normalized, entered_by) VALUES ($1,$2,$3,$4,$5)', [ev, stu, String(raw), Math.round((raw / max) * 10000) / 100, teachers[0].user]);
          }
          if (k === 3) await q(`INSERT INTO absences(student_id, on_date, period_index, kind, status, recorded_by) VALUES ($1, CURRENT_DATE - 2, 1, 'absence', 'unjustified', $2)`, [stu, teachers[0].user]);
        }
      }
    });
    log(`${sc.slug}: seeded`);
  }
  return accounts;
}

if (require.main === module) {
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) { console.error('DATABASE_ADMIN_URL is required'); process.exit(1); }
  const pool = new Pool({ connectionString: url });
  seedDemo(pool, console.log).then((a) => {
    const seen = new Set<string>();
    console.table(a.filter((x) => { const k = x.tenant + x.role; if (seen.has(k)) return false; seen.add(k); return true; }).map(({ tenant, role, email, user_id }) => ({ tenant, role, email, user_id })));
    return pool.end();
  }).catch((e) => { console.error(e); process.exit(1); });
}
