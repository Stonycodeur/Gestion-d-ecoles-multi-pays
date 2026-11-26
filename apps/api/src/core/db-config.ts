import type { PoolConfig } from 'pg';

/**
 * Pool settings for DATABASE_URL. Managed PostgreSQL services (Supabase pooler) sign their TLS certificate with their own CA,
 * which Node does not trust by default: set DATABASE_SSL_CA to that CA certificate (PEM, `\n` escapes accepted) to keep full
 * certificate verification. The `sslmode` of the URL is then dropped, because pg lets the URL override the explicit ssl option.
 */
export function poolConfig(env: NodeJS.ProcessEnv = process.env, url: string | undefined = env.DATABASE_URL): PoolConfig {
  const ca = env.DATABASE_SSL_CA?.replace(/\\n/g, '\n').trim();
  if (!url || !ca) return { connectionString: url };
  const u = new URL(url); u.searchParams.delete('sslmode');
  return { connectionString: u.toString(), ssl: { ca, rejectUnauthorized: true } };
}
