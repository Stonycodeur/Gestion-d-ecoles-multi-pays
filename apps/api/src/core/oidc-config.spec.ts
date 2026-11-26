import { OidcConfig } from './oidc-config';

const doc = { issuer: 'https://sso.example.org/realms/ecole', authorization_endpoint: 'https://sso.example.org/auth', token_endpoint: 'https://sso.example.org/token', end_session_endpoint: 'https://sso.example.org/logout' };
const ok = (d: unknown) => (async () => ({ ok: true, status: 200, json: async () => d })) as unknown as typeof fetch;

describe('OIDC public configuration', () => {
  it('sandbox mode exposes no endpoint', async () => { expect(await new OidcConfig({ AUTH_MODE: 'sandbox' }).get()).toEqual({ mode: 'sandbox' }); });
  it('oidc mode returns the discovered endpoints and the public client ids', async () => {
    const c = await new OidcConfig({ OIDC_ISSUER: doc.issuer } as NodeJS.ProcessEnv, ok(doc)).get();
    expect(c).toMatchObject({ mode: 'oidc', token_endpoint: doc.token_endpoint, clients: { web: 'ecolemanager-web', mobile: 'ecolemanager-mobile' } });
    expect(JSON.stringify(c)).not.toMatch(/secret/i);
  });
  it('refuses a discovery document of another issuer and an insecure issuer', async () => {
    await expect(new OidcConfig({ OIDC_ISSUER: doc.issuer } as NodeJS.ProcessEnv, ok({ ...doc, issuer: 'https://evil.example/realms/x' })).get()).rejects.toThrow(/mismatch/);
    await expect(new OidcConfig({ OIDC_ISSUER: 'http://sso.example.org/realms/ecole' } as NodeJS.ProcessEnv, ok(doc)).get()).rejects.toThrow(/https/);
  });
  it('caches the discovery document', async () => {
    let n = 0; const f = (async () => { n++; return { ok: true, status: 200, json: async () => doc }; }) as unknown as typeof fetch;
    const c = new OidcConfig({ OIDC_ISSUER: doc.issuer } as NodeJS.ProcessEnv, f); await c.get(); await c.get(); expect(n).toBe(1);
  });
  it('password flow (hosted Supabase Auth) exposes the token endpoint and the public key only', async () => {
    const env = { AUTH_FLOW: 'password', SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' } as NodeJS.ProcessEnv;
    expect(await new OidcConfig(env).get()).toEqual({ mode: 'password', issuer: 'https://abc.supabase.co/auth/v1', token_endpoint: 'https://abc.supabase.co/auth/v1/token', api_key: 'sb_publishable_x' });
    await expect(new OidcConfig({ AUTH_FLOW: 'password', SUPABASE_URL: 'http://abc.supabase.co' } as NodeJS.ProcessEnv).get()).rejects.toThrow(/AUTH_FLOW=password/);
  });
});
