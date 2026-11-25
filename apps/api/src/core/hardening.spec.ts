import { productionProblems } from './production-config';
import { refuseTarget } from './ssrf';

const good: NodeJS.ProcessEnv = {
  NODE_ENV: 'production', AUTH_MODE: 'oidc', OIDC_ISSUER: 'https://id.example/realms/em', OIDC_JWKS_URI: 'https://id.example/jwks', OIDC_AUDIENCE: 'ecolemanager-api',
  DATABASE_URL: 'postgres://x', MESSAGE_KEY: Buffer.alloc(32, 1).toString('base64'), GPS_KEY: Buffer.alloc(32, 2).toString('base64'), WEBHOOK_KEY: Buffer.alloc(32, 3).toString('base64'),
  PAYMENT_WEBHOOK_SECRET: 'w'.repeat(32), CORS_ORIGINS: 'https://app.example',
  PAYMENT_MODE: 'live', PUSH_MODE: 'live', SMS_MODE: 'live', EMAIL_MODE: 'live', STORAGE_MODE: 'live', IDENTITY_MODE: 'live', MINISTRY_MODE: 'live', LLM_MODE: 'live', AI_MODE: 'live',
};

describe('production configuration check', () => {
  it('is silent outside production and accepts a complete production setup', () => {
    expect(productionProblems({ NODE_ENV: 'development', AUTH_MODE: 'sandbox' })).toEqual([]);
    expect(productionProblems(good)).toEqual([]);
  });
  it('refuses sandbox auth, weak or missing secrets, wildcard CORS and private webhooks', () => {
    const p = productionProblems({ ...good, AUTH_MODE: 'sandbox', MESSAGE_KEY: 'short', GPS_KEY: undefined, PAYMENT_WEBHOOK_SECRET: 'x', CORS_ORIGINS: '*', WEBHOOK_ALLOW_PRIVATE: 'true', DATABASE_URL: undefined }).join('\n');
    for (const m of ['AUTH_MODE', 'MESSAGE_KEY', 'GPS_KEY', 'PAYMENT_WEBHOOK_SECRET', 'CORS_ORIGINS', 'WEBHOOK_ALLOW_PRIVATE', 'DATABASE_URL']) expect(p).toContain(m);
  });
  it('requires OIDC settings and https CORS origins', () => {
    expect(productionProblems({ ...good, OIDC_JWKS_URI: undefined }).join()).toContain('OIDC_JWKS_URI');
    expect(productionProblems({ ...good, CORS_ORIGINS: 'http://app.example' }).join()).toContain('https');
  });
  it('refuses sandbox adapters unless explicitly allowed for staging', () => {
    expect(productionProblems({ ...good, PAYMENT_MODE: undefined, SMS_MODE: 'sandbox' }).join()).toMatch(/PAYMENT_MODE.*SMS_MODE|SMS_MODE.*PAYMENT_MODE/);
    expect(productionProblems({ ...good, PAYMENT_MODE: 'sandbox', ALLOW_SANDBOX_ADAPTERS: '1' })).toEqual([]);
  });
});

describe('SSRF guard for outbound calls', () => {
  const lookup = (map: Record<string, string[]>) => (async (h: string) => { if (!map[h]) throw new Error('ENOTFOUND'); return map[h].map((address) => ({ address, family: address.includes(':') ? 6 : 4 })); }) as any;
  it('allows a host that resolves to public addresses only', async () => {
    expect(await refuseTarget('https://ministere.example/api', false, lookup({ 'ministere.example': ['93.184.216.34'] }))).toBeNull();
  });
  it('refuses a public name that resolves to an internal address (DNS rebinding / internal alias)', async () => {
    expect(await refuseTarget('https://evil.example/x', false, lookup({ 'evil.example': ['93.184.216.34', '10.0.0.5'] }))).toMatch(/private/);
    expect(await refuseTarget('https://evil.example/x', false, lookup({ 'evil.example': ['169.254.169.254'] }))).toMatch(/private/);
  });
  it('refuses literal private hosts, plain http and unresolvable names', async () => {
    expect(await refuseTarget('https://127.0.0.1/x', false, lookup({}))).not.toBeNull();
    expect(await refuseTarget('http://ministere.example/x', false, lookup({ 'ministere.example': ['93.184.216.34'] }))).not.toBeNull();
    expect(await refuseTarget('https://nope.example/x', false, lookup({}))).toMatch(/resolve/);
  });
});
