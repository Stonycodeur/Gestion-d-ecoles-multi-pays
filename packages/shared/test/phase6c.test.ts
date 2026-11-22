import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pseudonymize, restore, ageYears, ageBand, tutorPolicy, containsBlocked, filterTutorOutput, validateQcm, parseJsonLoose, SAFE_REDIRECT } from '../src/index.ts';

test('pseudonymisation: names, e-mails and phones are replaced consistently and restorable', () => {
  const p = pseudonymize('Ada Obiang (ada@ecole.ga, +241 06 12 34 56) a rendu son devoir. ada obiang est brillante, Obiang aussi.', ['Ada Obiang']);
  assert.ok(!/Ada|Obiang|ada@|241 06/i.test(p.text), p.text);
  assert.equal(new Set(p.text.match(/\[NOM\d+\]/g)).size, 2);   // Ada, Obiang
  assert.equal(restore(p.text, p.map), 'Ada Obiang (ada@ecole.ga, +241 06 12 34 56) a rendu son devoir. ada obiang est brillante, Obiang aussi.'
    .replace('ada obiang est', 'Ada Obiang est'));   // a token restores the first-seen spelling
  assert.ok(p.redactions >= 6);
  assert.equal(pseudonymize('Le mot Adagio reste', ['Ada']).text, 'Le mot Adagio reste');   // whole words only
  assert.equal(restore('[NOM9]', {}), '[NOM9]');
});

test('age bands: unknown age is the strictest; blocked terms differ by band', () => {
  assert.equal(ageYears('2014-06-15', new Date('2026-06-14T00:00:00Z')), 11); assert.equal(ageYears('2014-06-15', new Date('2026-06-15T00:00:00Z')), 12);
  assert.equal(ageYears(null), null); assert.equal(ageYears('nope'), null);
  assert.equal(ageBand(null), 'child'); assert.equal(ageBand(11), 'child'); assert.equal(ageBand(12), 'teen'); assert.equal(ageBand(15), 'teen'); assert.equal(ageBand(16), 'older');
  assert.ok(containsBlocked('parle de drogue', tutorPolicy('child').blocked)); assert.equal(containsBlocked('parle de drogue', tutorPolicy('older').blocked), null);
  assert.ok(containsBlocked('un mot interdit', tutorPolicy('older', ['Interdit']).blocked));
});

test('tutor output is refused or capped by band', () => {
  const pol = tutorPolicy('child');
  assert.deepEqual(filterTutorOutput('Parlons de violence', pol, 'fr'), { text: SAFE_REDIRECT.fr, blocked: true });
  const long = filterTutorOutput('a'.repeat(5000), pol, 'en'); assert.equal(long.text.length, 600); assert.equal(long.blocked, false);
});

test('model output: only well-formed QCM items survive', () => {
  const r = validateQcm([
    { prompt: 'Capitale ?', choices: ['Libreville', 'Paris'], correct: 0 },
    { prompt: 'Doublon', choices: ['a', 'A'], correct: 0 }, { prompt: 'Index', choices: ['a', 'b'], correct: 2 }, { prompt: '', choices: ['a', 'b'], correct: 0 }, 'x',
    { prompt: 'Points', choices: ['a', 'b', 'c'], correct: 2, points: 3 },
  ]);
  assert.equal(r.ok.length, 2); assert.equal(r.rejected, 4); assert.equal(r.ok[0]!.points, 1); assert.equal(r.ok[1]!.points, 3);
  assert.deepEqual(validateQcm('nope'), { ok: [], rejected: 1 });
  assert.equal(validateQcm(Array.from({ length: 80 }, () => ({ prompt: 'p', choices: ['a', 'b'], correct: 0 })), 50).ok.length, 50);
});

test('loose JSON parsing handles fences and prose, and fails clearly', () => {
  assert.deepEqual(parseJsonLoose('Voici :\n```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(parseJsonLoose('{"x":2} fin'), { x: 2 });
  assert.throws(() => parseJsonLoose('aucun json')); assert.throws(() => parseJsonLoose('[1,2'));
});

import { validateXrAsset, viewerMode, XR_MAX_BYTES } from '../src/index.ts';
const good = { title: 'Volcan', kind: 'model_3d', format: 'glb', url: 'https://cdn.ecole.ga/volcan.glb', size_bytes: 1_000_000, alt_text: 'Modèle 3D d’un volcan en coupe' };
test('xr: asset validation (formats, size, url, alt text, iOS companion)', () => {
  assert.deepEqual(validateXrAsset(good), []);
  assert.deepEqual(validateXrAsset({ ...good, ios_url: 'https://cdn.ecole.ga/volcan.usdz' }), []);
  assert.deepEqual(validateXrAsset({ title: 'T', kind: 'panorama_360', format: 'jpg', url: '/media/cour.jpg', size_bytes: 5, alt_text: 'Cour de récréation' }), []);
  assert.ok(validateXrAsset({ ...good, alt_text: '' }).some((e) => /alt_text/.test(e)));
  assert.ok(validateXrAsset({ ...good, format: 'exe' }).length);
  assert.ok(validateXrAsset({ ...good, format: 'usdz', url: 'https://x.ga/a.usdz' }).some((e) => /usdz/.test(e)));
  assert.ok(validateXrAsset({ ...good, url: 'http://insecure.ga/volcan.glb' }).length);
  assert.ok(validateXrAsset({ ...good, url: '//evil.ga/volcan.glb' }).length);
  assert.ok(validateXrAsset({ ...good, url: 'https://cdn.ecole.ga/volcan.png' }).some((e) => /extension/.test(e)));
  assert.ok(validateXrAsset({ ...good, size_bytes: XR_MAX_BYTES.model_3d + 1 }).some((e) => /too heavy/.test(e)));
  assert.ok(validateXrAsset({ ...good, size_bytes: 0 }).length); assert.ok(validateXrAsset({ ...good, kind: 'video' }).length);
  assert.ok(validateXrAsset({ ...good, ios_url: 'https://x.ga/a.glb' }).length);
  assert.ok(validateXrAsset({ title: 'P', kind: 'panorama_360', format: 'jpg', url: 'https://x.ga/a.jpg', size_bytes: 1, alt_text: 'Un panorama', ios_url: 'https://x.ga/a.usdz' }).length);
});
test('xr: the viewer always degrades to something that works', () => {
  assert.equal(viewerMode('model_3d', { webxrAr: true, webgl: true }), 'ar');
  assert.equal(viewerMode('model_3d', { webgl: true }), 'orbit_3d');
  assert.equal(viewerMode('model_3d', { webgl: false }), 'image_only');
  assert.equal(viewerMode('panorama_360', { webxrVr: true, webgl: true }), 'vr');
  assert.equal(viewerMode('panorama_360', {}), 'panorama_drag');
  assert.equal(viewerMode('panorama_360', { webgl: false }), 'image_only');
});
