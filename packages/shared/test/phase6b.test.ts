import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datasetFields, validateConnector, minimise, serialize, checksum, canMove, retryDelaySec, isDue, MAX_ATTEMPTS,
  parseScopes, generateClientCredentials, secretMatches, sha256, signAccessToken, verifyAccessToken, QuotaCounter, webhookHeaders, verifyWebhook, isPrivateIp, checkWebhookUrl, API_SCOPES,
  reviewSubmission, addedPermissions, consentCovers, isUpgrade, ratingSummary } from '../src/index.ts';

const conn = { code: 'men', mode: 'file' as const, formats: ['csv' as const, 'json' as const], datasets: ['resultats_BEPC', 'effectifs'] };
test('ministry: connector validation, default minimisation, per-connector override', () => {
  assert.deepEqual(validateConnector(conn), []);
  assert.ok(validateConnector({ ...conn, formats: ['pdf' as any] }).length);
  assert.deepEqual(datasetFields(conn, 'effectifs'), ['level_code', 'gender', 'count']);
  assert.deepEqual(datasetFields({ ...conn, fields: { resultats_BEPC: ['last_name'] } }, 'resultats_BEPC'), ['last_name']);
  assert.throws(() => datasetFields(conn, 'inconnu'));
  const rows = [{ last_name: 'Obiang', first_name: 'Ada', guardian_phone: '0102', passed: true }];
  assert.deepEqual(Object.keys(minimise(rows, datasetFields(conn, 'resultats_BEPC'))[0]!), ['last_name', 'first_name', 'birth_date', 'school_year', 'passed', 'mention']);
  assert.ok(!JSON.stringify(minimise(rows, datasetFields(conn, 'resultats_BEPC'))).includes('0102'));
});
test('ministry: csv escaping and formula injection, json, xml escaping, stable checksum', () => {
  const f = ['last_name', 'passed'];
  const csv = serialize('csv', 'resultats_BEPC', [{ last_name: '=cmd|"x"', passed: true }, { last_name: 'A,B', passed: false }], f);
  assert.equal(csv, "last_name,passed\n\"'=cmd|\"\"x\"\"\",true\n\"A,B\",false\n");
  assert.deepEqual(JSON.parse(serialize('json', 'd', [{ last_name: 'X', passed: true, extra: 1 }], f)), { dataset: 'd', count: 1, rows: [{ last_name: 'X', passed: true }] });
  assert.match(serialize('xml', 'd', [{ last_name: 'A<B&C', passed: true }], f), /<last_name>A&lt;B&amp;C<\/last_name>/);
  assert.equal(checksum(csv), checksum(csv)); assert.notEqual(checksum(csv), checksum(csv + ' '));
});
test('ministry: transmission state machine, back-off and due rules', () => {
  assert.ok(canMove('prepared', 'validated')); assert.ok(!canMove('prepared', 'sent')); assert.ok(canMove('failed', 'sent')); assert.ok(!canMove('sent', 'failed')); assert.ok(!canMove('rejected', 'validated'));
  assert.deepEqual([1, 2, 3, 4, 20].map(retryDelaySec), [60, 120, 240, 480, 21600]);
  const now = Date.parse('2027-01-01T10:00:00Z');
  assert.ok(isDue({ status: 'validated', attempts: 0, next_retry_at: null, scheduled_for: null }, now));
  assert.ok(!isDue({ status: 'validated', attempts: 0, next_retry_at: null, scheduled_for: '2027-01-02T00:00:00Z' }, now));
  assert.ok(isDue({ status: 'failed', attempts: 1, next_retry_at: '2027-01-01T09:00:00Z', scheduled_for: null }, now));
  assert.ok(!isDue({ status: 'failed', attempts: MAX_ATTEMPTS, next_retry_at: '2027-01-01T09:00:00Z', scheduled_for: null }, now));
  assert.ok(!isDue({ status: 'prepared', attempts: 0, next_retry_at: null, scheduled_for: null }, now));
});
test('public API: scopes, credentials, access tokens, quotas', () => {
  assert.deepEqual(parseScopes('students:read classes:read', API_SCOPES), ['students:read', 'classes:read']);
  assert.throws(() => parseScopes('admin:all', API_SCOPES)); assert.throws(() => parseScopes('', API_SCOPES));
  const c = generateClientCredentials(); assert.match(c.client_id, /^cli_[0-9a-f]{16}$/);
  assert.ok(secretMatches(c.client_secret, sha256(c.client_secret))); assert.ok(!secretMatches(c.client_secret + 'x', sha256(c.client_secret)));
  const secret = 's'.repeat(32), now = 1_800_000_000;
  const t = signAccessToken(secret, { cid: 'cli_1', tenant: 'e2e', scopes: ['students:read'], exp: now + 600 });
  assert.equal(verifyAccessToken(secret, t, now)?.cid, 'cli_1');
  assert.equal(verifyAccessToken(secret, t, now + 601), null);                       // expired
  assert.equal(verifyAccessToken('x'.repeat(32), t, now), null);                     // wrong key
  assert.equal(verifyAccessToken(secret, t.slice(0, -2) + 'AA', now), null);         // tampered signature
  const [p] = t.split('.'); assert.equal(verifyAccessToken(secret, `${p}x.${t.split('.')[1]}`, now), null);
  const q = new QuotaCounter();
  assert.deepEqual([1, 2, 3].map((i) => q.hit('c', 2, 1000, 100 + i).allowed), [true, true, false]);
  assert.ok(q.hit('c', 2, 1000, 1200).allowed);                                      // new window
});
test('public API: signed webhooks verify, SSRF guard', () => {
  const body = '{"a":1}', secret = 'k'.repeat(32), now = 1_800_000_000;
  const h = webhookHeaders(secret, 'student.created', body, now);
  assert.ok(verifyWebhook(secret, Number(h['x-em-timestamp']), body, h['x-em-signature']!, now));
  assert.ok(!verifyWebhook(secret, Number(h['x-em-timestamp']), body + ' ', h['x-em-signature']!, now));
  for (const ip of ['10.0.0.1', '127.0.0.1', '192.168.1.5', '172.20.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) assert.ok(isPrivateIp(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '2001:4860:4860::8888']) assert.ok(!isPrivateIp(ip), ip);
  assert.equal(checkWebhookUrl('https://hooks.example.org/x'), null);
  for (const u of ['http://hooks.example.org', 'https://localhost/x', 'https://10.1.1.1/x', 'https://user:pw@example.org', 'https://metadata.internal/', 'ftp://x', 'nope']) assert.ok(checkWebhookUrl(u), u);
  assert.equal(checkWebhookUrl('http://127.0.0.1:9/x', true), null);
});
const man = { name: 'module-quiz-pro', version: '1.0.0', core_version: '>=0.1.0', description: 'x', permissions: ['games:read'], hooks: { onGameCompleted: 'bonus' } };
test('marketplace: review, compatibility, risk, forbidden constructs, reserved names', () => {
  const ok = reviewSubmission({ manifest: man, handlers_source: { bonus: 'return { bonus: payload.score * 2 };' } }, '0.1.0', ['module-oaa']);
  assert.ok(ok.ok && ok.risk === 'low' && !ok.manual_review_required);
  assert.ok(!reviewSubmission({ manifest: { ...man, core_version: '>=9.0.0' }, handlers_source: { bonus: 'return 1;' } }, '0.1.0').ok);
  assert.ok(!reviewSubmission({ manifest: { ...man, name: 'module-oaa' }, handlers_source: { bonus: 'return 1;' } }, '0.1.0', ['module-oaa']).ok);
  assert.ok(!reviewSubmission({ manifest: man }, '0.1.0').ok);                                  // hook without source
  const bad = reviewSubmission({ manifest: man, handlers_source: { bonus: "return process.env.SECRET;" } }, '0.1.0');
  assert.ok(!bad.ok && bad.risk === 'high');
  const sensitive = reviewSubmission({ manifest: { ...man, permissions: ['billing:write', 'x:*'] }, handlers_source: { bonus: 'return 1;' } }, '0.1.0');
  assert.ok(sensitive.ok && sensitive.manual_review_required && sensitive.findings.length === 2);
  assert.ok(!reviewSubmission({ manifest: { name: 'bad' } }, '0.1.0').ok);
});
test('marketplace: consent, upgrades, ratings', () => {
  assert.deepEqual(addedPermissions(['a:b'], ['a:b', 'c:d']), ['c:d']);
  assert.ok(consentCovers(['a:b', 'c:d'], ['a:b'])); assert.ok(!consentCovers(['a:b'], ['a:b', 'c:d'])); assert.ok(!consentCovers(undefined, ['a:b']));
  assert.ok(isUpgrade('1.0.0', '1.1.0')); assert.ok(!isUpgrade('1.1.0', '1.1.0')); assert.ok(!isUpgrade('2.0.0', '1.9.9'));
  assert.deepEqual(ratingSummary([5, 4, 4]), { count: 3, average: 4.3 }); assert.deepEqual(ratingSummary([]), { count: 0, average: null }); assert.throws(() => ratingSummary([6]));
});
