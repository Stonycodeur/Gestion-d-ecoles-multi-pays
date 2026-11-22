import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeFor, buildAuthorizeUrl, parseCallback, randomToken, decodeClaims } from '../src/index.ts';

test('RFC 7636 appendix B vector', async () => {
  assert.equal(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  await assert.rejects(() => challengeFor('short'));
});
test('random tokens are url-safe, long enough and different each time', () => {
  const a = randomToken(), b = randomToken(); assert.notEqual(a, b); assert.match(a, /^[A-Za-z0-9_-]{43,}$/);
});
test('authorize URL carries S256 PKCE and state', () => {
  const u = new URL(buildAuthorizeUrl({ authorizationEndpoint: 'https://sso.example/auth', clientId: 'ecolemanager-web', redirectUri: 'https://app/auth/callback', scope: 'openid', state: 's1', challenge: 'c1', locale: 'fr' }));
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256'); assert.equal(u.searchParams.get('response_type'), 'code'); assert.equal(u.searchParams.get('state'), 's1'); assert.equal(u.searchParams.get('kc_locale'), 'fr');
});
test('callback: CSRF state check, provider errors, missing code', () => {
  assert.deepEqual(parseCallback('?code=abc&state=s1', 's1'), { code: 'abc' });
  assert.deepEqual(parseCallback('?code=abc&state=evil', 's1'), { error: 'state mismatch' });
  assert.deepEqual(parseCallback('?code=abc&state=s1', null), { error: 'state mismatch' });
  assert.deepEqual(parseCallback('?error=access_denied&error_description=No', 's1'), { error: 'No' });
  assert.deepEqual(parseCallback('?state=s1', 's1'), { error: 'missing code' });
});
test('claims decoding is tolerant', () => {
  const p = Buffer.from(JSON.stringify({ tenant: 'ga_lycee', roles: ['teacher'] })).toString('base64url');
  assert.equal(decodeClaims(`h.${p}.s`).tenant, 'ga_lycee'); assert.deepEqual(decodeClaims('garbage'), {});
});
