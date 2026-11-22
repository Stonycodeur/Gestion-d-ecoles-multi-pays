import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyReplay as sharedClassify, challengeFor as sharedChallenge, parseCallback as sharedParse, buildAuthorizeUrl as sharedBuild } from '../src/index.ts';
import { classifyReplay as webClassify } from '../../../apps/web/lib/sync-rules.ts';
import { challengeFor as webChallenge, parseCallback as webParse, buildAuthorizeUrl as webBuild } from '../../../apps/web/lib/pkce.ts';

test('web copies behave exactly like the shared reference', async () => {
  for (let s = 0; s < 600; s++) assert.equal(webClassify(s), sharedClassify(s), String(s));
  const v = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(await webChallenge(v), await sharedChallenge(v));
  for (const q of ['?code=a&state=s', '?code=a&state=x', '?error=denied', '?state=s']) assert.deepEqual(webParse(q, 's'), sharedParse(q, 's'));
  const i = { authorizationEndpoint: 'https://sso/auth', clientId: 'c', redirectUri: 'https://app/cb', scope: 'openid', state: 's', challenge: 'ch', locale: 'fr' };
  assert.equal(webBuild(i), sharedBuild(i));
});
