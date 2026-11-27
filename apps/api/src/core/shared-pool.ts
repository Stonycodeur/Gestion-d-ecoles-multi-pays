import { Pool } from 'pg';
import { poolConfig } from './db-config';

let pool: Pool | undefined;
/** One small pool shared by the platform-level services (profiles, geography, roles, trash). Undefined without DATABASE_URL: those services then keep their data in memory (sandbox, unit tests). */
export function sharedPool(): Pool | undefined {
  if (!process.env.DATABASE_URL) return undefined;
  pool ??= new Pool({ ...poolConfig(), max: 4 });
  return pool;
}
export async function closeSharedPool(): Promise<void> { await pool?.end(); pool = undefined; }
