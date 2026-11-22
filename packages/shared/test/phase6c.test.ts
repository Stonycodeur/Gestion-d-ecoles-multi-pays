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
