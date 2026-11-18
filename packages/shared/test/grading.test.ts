import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOaa, oaaAlert, display, toNormalized, thresholdInScale, weightedAverage100, storeGrade, colorForPct, roundBy } from '../src/index.ts';
import { S10, S20, S100, SLETTERS } from './fixtures.ts';

const axes = { academic: 80, physical: 70, adaptability: 75, social_contribution: 60 };

test('OAA spec example: 80,70,75,60 -> 73/100', () => {
  assert.equal(computeOaa(axes), 73);
});

test('OAA 73 displayed per active scale: 14,6/20, 7,3/10, 73/100, letter B', () => {
  assert.equal(display(73, S20, 'fr').text, '14,6/20');
  assert.equal(display(73, S10, 'fr').text, '7,3/10');
  assert.equal(display(73, S100, 'fr').text, '73/100');
  assert.equal(display(73, SLETTERS, 'fr').text, 'B');
  assert.equal(display(73, S20, 'en').text, '14.6/20');
});

test('OAA weights come from config, not code', () => {
  assert.equal(computeOaa(axes, { academic: 1, physical: 1, adaptability: 1, social_contribution: 1 }), 71);
  assert.throws(() => computeOaa({ ...axes, academic: 101 }), RangeError);
});

test('letters model: every band boundary', () => {
  const cases: [number, string][] = [[100,'A+'],[96,'A+'],[95,'A'],[86,'A'],[85,'A-'],[81,'A-'],[80,'B+'],[76,'B+'],
    [75,'B'],[66,'B'],[65,'B-'],[61,'B-'],[60,'C+'],[56,'C+'],[55,'C'],[46,'C'],[45,'C-'],[41,'C-'],[40,'D+'],
    [36,'D+'],[35,'D'],[26,'D'],[25,'D-'],[21,'D-'],[20,'E+'],[16,'E+'],[15,'E'],[6,'E'],[5,'E-'],[1,'E-'],[0,'E-']];
  for (const [s, l] of cases) assert.equal(display(s, SLETTERS).text, l, `score ${s}`);
  assert.equal(display(72.857, SLETTERS).text, 'B'); // rounded to integer first
});

test('rounding rules', () => {
  assert.equal(roundBy(14.62, 'quarter'), 14.5);
  assert.equal(roundBy(14.63, 'quarter'), 14.75);
  assert.equal(roundBy(14.74, 'half'), 14.5);
  assert.equal(roundBy(14.56, 'tenth'), 14.6);
  assert.equal(roundBy(14.5, 'integer'), 15);
});

test('alert/penalty thresholds shown in local scale (50% = 10/20 or 5/10; 40% = 8/20 or 4/10)', () => {
  assert.equal(thresholdInScale(50, S20), 10);
  assert.equal(thresholdInScale(50, S10), 5);
  assert.equal(thresholdInScale(40, S20), 8);
  assert.equal(thresholdInScale(40, S10), 4);
  assert.equal(thresholdInScale(40, S100), 40);
  assert.equal(oaaAlert(39), 'penalty');
  assert.equal(oaaAlert(45), 'warning');
  assert.equal(oaaAlert(50), 'ok');
});

test('default colors: green>=81, blue 61-80, yellow 41-60, orange 21-40, red<=20', () => {
  const exp: [number, string][] = [[100,'green'],[81,'green'],[80,'blue'],[61,'blue'],[60,'yellow'],[41,'yellow'],[40,'orange'],[21,'orange'],[20,'red'],[0,'red']];
  for (const [p, c] of exp) assert.equal(colorForPct(p), c, `pct ${p}`);
  assert.equal(display(73, S20).color, 'blue');
  // per-school override
  assert.equal(colorForPct(73, [{ minPct: 70, color: 'teal', name: 'x' }, { minPct: 0, color: 'grey', name: 'y' }]), 'teal');
});

test('input conversion and validation', () => {
  assert.equal(toNormalized(14.6, S20), 73);
  assert.equal(toNormalized(7.3, S10), 73);
  assert.equal(toNormalized('B', SLETTERS), 70.5);
  assert.throws(() => toNormalized(21, S20), RangeError);
  assert.throws(() => toNormalized('Z', SLETTERS));
});

test('pass mark per scale', () => {
  assert.equal(display(50, S20).passed, true);
  assert.equal(display(49, S20).passed, false);
});

test('weighted averages with coefficients on different scales', () => {
  const g = [
    { score100: toNormalized(14, S20), coefficient: 3 }, // 70
    { score100: toNormalized(8, S10), coefficient: 2 },  // 80
    { score100: toNormalized(60, S100), coefficient: 1 }, // 60
  ];
  const avg = weightedAverage100(g)!;
  assert.equal(Math.round(avg * 100) / 100, 71.67);
  assert.equal(display(avg, S20).text, '14,3/20');
  assert.equal(weightedAverage100([]), null);
  assert.equal(weightedAverage100([{ score100: 50, coefficient: 0 }]), null);
});

test('old grades keep their original scale after a mid-year scale change', () => {
  const old = storeGrade(14, S20);          // entered when the school used /20
  const fresh = storeGrade('B', SLETTERS);  // school switches to letters
  assert.equal(old.scaleCode, 'num20');
  assert.equal(old.rawValue, 14);
  assert.equal(fresh.scaleCode, 'letters');
  assert.equal(old.normalized, 70);
  assert.equal(display(old.normalized, S20).text, '14/20'); // still readable in origin scale
  const avg = weightedAverage100([{ score100: old.normalized, coefficient: 1 }, { score100: fresh.normalized, coefficient: 1 }])!;
  assert.equal(avg, 70.25); // comparable through the 0-100 base
});
