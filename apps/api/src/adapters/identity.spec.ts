import { KeycloakIdentity } from './adapters';

const ID = '3f2b8c1e-0000-4000-8000-000000000001';
const env = { KC_URL: 'https://sso.example.org/', KC_REALM: 'ecole', KC_ADMIN_CLIENT_ID: 'admin-cli', KC_ADMIN_CLIENT_SECRET: 's' } as NodeJS.ProcessEnv;
const res = (status: number, body: unknown = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status });

describe('KeycloakIdentity', () => {
  it('disables the user then closes its sessions, with a service-account token', async () => {
    const calls: { url: string; method: string; body?: string; auth?: string }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? 'GET', body: init.body?.toString(), auth: (init.headers as Record<string, string>)?.authorization });
      return url.endsWith('/token') ? res(200, { access_token: 'T' }) : res(204);
    }) as unknown as typeof fetch;
    await new KeycloakIdentity(env, f).disableUser(ID);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://sso.example.org/realms/ecole/protocol/openid-connect/token',
      `PUT https://sso.example.org/admin/realms/ecole/users/${ID}`,
      `POST https://sso.example.org/admin/realms/ecole/users/${ID}/logout`,
    ]);
    expect(calls[0].body).toContain('grant_type=client_credentials');
    expect(JSON.parse(calls[1].body!)).toEqual({ enabled: false });
    expect(calls[1].auth).toBe('Bearer T');
  });
  it('treats an unknown user as nothing to disable, but fails on any other error', async () => {
    const mk = (status: number) => (async (url: string) => (url.endsWith('/token') ? res(200, { access_token: 'T' }) : res(status))) as unknown as typeof fetch;
    await expect(new KeycloakIdentity(env, mk(404)).disableUser(ID)).resolves.toBeUndefined();
    await expect(new KeycloakIdentity(env, mk(500)).disableUser(ID)).rejects.toThrow(/failed \(500\)/);
  });
  it('refuses malformed ids and missing configuration', async () => {
    await expect(new KeycloakIdentity(env, fetch).disableUser('../../x')).rejects.toThrow(/invalid/);
    await expect(new KeycloakIdentity({} as NodeJS.ProcessEnv, fetch).disableUser(ID)).rejects.toThrow(/KC_URL/);
  });
});
