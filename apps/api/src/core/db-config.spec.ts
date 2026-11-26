import { poolConfig } from './db-config';

describe('database pool configuration', () => {
  const url = 'postgresql://u:p@host:5432/postgres?sslmode=require';
  it('keeps the URL untouched without a CA', () => { expect(poolConfig({} as NodeJS.ProcessEnv, url)).toEqual({ connectionString: url }); });
  it('verifies the certificate with the provided CA and drops sslmode from the URL', () => {
    const c = poolConfig({ DATABASE_SSL_CA: '-----BEGIN CERTIFICATE-----\\nabc\\n-----END CERTIFICATE-----' } as NodeJS.ProcessEnv, url);
    expect(c.ssl).toEqual({ ca: '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----', rejectUnauthorized: true });
    expect(c.connectionString).toBe('postgresql://u:p@host:5432/postgres');
  });
  it('returns no connection string when DATABASE_URL is unset', () => { expect(poolConfig({} as NodeJS.ProcessEnv).connectionString).toBeUndefined(); });
});
