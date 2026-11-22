import { buildKeycloakUser, provisionKeycloak, type DirRow } from './keycloak-users';

const row: DirRow = { user_id: '11111111-1111-4111-8111-111111111111', role: 'guardian', display_name: 'Parent de Marie', email: 'p@x.demo', class_ids: [], child_ids: ['22222222-2222-4222-8222-222222222222'], student_id: null, tenant: 'ga_lycee' };

describe('Keycloak demo users', () => {
  it('keeps the directory id as the Keycloak id and exposes the claims the API reads, with a temporary password', () => {
    const u = buildKeycloakUser(row, 'Temp-pass-123');
    expect(u.id).toBe(row.user_id); expect(u.attributes).toMatchObject({ roles: ['guardian'], tenant: ['ga_lycee'], child_ids: row.child_ids });
    expect(u.credentials[0]).toMatchObject({ temporary: true });
    expect(buildKeycloakUser({ ...row, role: 'student', student_id: 'sid' }, 'Temp-pass-123').attributes.student_id).toEqual(['sid']);
  });
  it('is idempotent (409 = already there), fails loudly otherwise, and refuses a weak password', async () => {
    const calls: string[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push(url);
      if (url.includes('/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'adm' }) };
      return { ok: false, status: JSON.parse(String(init.body)).email === 'dup@x.demo' ? 409 : 201 };
    }) as unknown as typeof fetch;
    const o = { baseUrl: 'http://kc', adminUser: 'a', adminPassword: 'b', password: 'Temp-pass-123', fetchFn: f };
    expect(await provisionKeycloak([row, { ...row, email: 'dup@x.demo' }], o)).toEqual({ created: 1, existing: 1 });
    await expect(provisionKeycloak([row], { ...o, password: 'short' })).rejects.toThrow(/10 characters/);
    const bad = (async (url: string) => (url.includes('/token') ? { ok: true, status: 200, json: async () => ({ access_token: 'x' }) } : { ok: false, status: 500 })) as unknown as typeof fetch;
    await expect(provisionKeycloak([row], { ...o, fetchFn: bad })).rejects.toThrow(/refused/);
  });
});
