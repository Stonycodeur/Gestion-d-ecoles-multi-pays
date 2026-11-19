import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOaaAxes, OAA_LEVEL_PROFILES, blend, deriveAxes, penaltyDue, levelFor, xpFor, evaluateBadges, seededShuffle, presentQuestions,
  checkTiming, scoreExam, leaderboard, teamPoints, oaaFeedFromGamification, predictRisk, recommendations, biasReport, computeOaa, display } from '../src/index.ts';
import { ModuleRegistry } from '../src/index.ts';
import type { LinearRiskModel, Question } from '../src/index.ts';

test('generic OAA formula equals the spec example for the college profile: 80,70,75,60 -> 73', () => {
  const v = computeOaaAxes({ academic: 80, physical: 70, adaptability: 75, social_contribution: 60 }, OAA_LEVEL_PROFILES.college);
  assert.equal(v, 73);
  assert.equal(v, computeOaa({ academic: 80, physical: 70, adaptability: 75, social_contribution: 60 }));
});

test('level profiles (7.5): primary = academic+social+creativity, university = academic+research+professional+social', () => {
  assert.deepEqual(Object.keys(OAA_LEVEL_PROFILES.primary), ['academic', 'social_contribution', 'creativity']);
  assert.deepEqual(Object.keys(OAA_LEVEL_PROFILES.university), ['academic', 'research', 'professional', 'social_contribution']);
  assert.ok('orientation' in OAA_LEVEL_PROFILES.lycee && 'physical' in OAA_LEVEL_PROFILES.lycee);
  assert.equal(computeOaaAxes({ academic: 60, social_contribution: 60, creativity: 60 }, OAA_LEVEL_PROFILES.primary), 60);
  assert.throws(() => computeOaaAxes({ academic: 101, physical: 0, adaptability: 0, social_contribution: 0 }, OAA_LEVEL_PROFILES.college), RangeError);
  assert.throws(() => computeOaaAxes({ academic: 50 }, OAA_LEVEL_PROFILES.college), RangeError);   // missing axis
});

test('the 73/100 example is displayed as 14,6/20, 7,3/10, 73/100 and B in the active scale', () => {
  const num = (max: number, decimals: number) => ({ code: `n${max}`, type: 'numeric' as const, min: 0, max, step: 0.1, decimals, passMark: max / 2, rounding: 'tenth' as const, bands: [] });
  assert.match(display(73, num(20, 1), 'fr').text, /14,6/);
  assert.match(display(73, num(10, 1), 'fr').text, /7,3/);
  assert.match(display(73, num(100, 0), 'fr').text, /73/);
});

test('axes derivation: sources feed the right axes (8.4) and empty axes keep the initial value', () => {
  const src = { gradeAvgBySubjectCategory: { academic: 80, physical: null }, quizAvg: 100, individualGameAvg: 90, groupChallengeAvg: 100, attendanceAxis: 90, assessments: {} };
  const ax = deriveAxes(OAA_LEVEL_PROFILES.college, src, 50);
  assert.equal(ax.academic, 84);            // (80*1 + 100*0.25) / 1.25
  assert.equal(ax.physical, 50);            // no EPS grade yet -> initial value
  assert.equal(ax.adaptability, 90);        // only individual games
  assert.equal(ax.social_contribution, 92.31);   // (90*1 + 100*0.3) / 1.3
  assert.equal(blend([{ value: null, weight: 1 }], 42), 42);
});

test('penalty is proposed only below the threshold and only once', () => {
  assert.equal(penaltyDue(39, 40, false), true); assert.equal(penaltyDue(40, 40, false), false); assert.equal(penaltyDue(10, 40, true), false);
});

test('XP levels Novice -> Apprenant -> Expert -> Maître', () => {
  assert.equal(levelFor(0).level.label_fr, 'Novice'); assert.equal(levelFor(99).level.label_fr, 'Novice');
  assert.equal(levelFor(100).level.label_fr, 'Apprenant'); assert.equal(levelFor(500).level.label_fr, 'Expert');
  const m = levelFor(2000); assert.equal(m.level.label_fr, 'Maître'); assert.equal(m.next, null); assert.equal(m.progressPct, 100);
  assert.equal(levelFor(300).progressPct, 50); assert.equal(levelFor(300).xpToNext, 200);
});

test('XP rules: perfect quiz bonus, boss threshold', () => {
  assert.equal(xpFor('quiz', 100), 25); assert.equal(xpFor('quiz', 50), 5); assert.equal(xpFor('homework', null), 10);
  assert.equal(xpFor('boss', 80), 50); assert.ok(xpFor('boss', 30) < 50);
});

test('badges are awarded once', () => {
  const stats = { perfectQuizzes: 1, attendanceStreakDays: 25, quizCount: 12, quizAvg: 85, totalXp: 400, bossesDefeated: 0 };
  assert.deepEqual(evaluateBadges(stats, []).map((b) => b.code).sort(), ['assidu', 'champion_quiz', 'sans_faute']);
  assert.deepEqual(evaluateBadges(stats, ['sans_faute', 'assidu']).map((b) => b.code), ['champion_quiz']);
});

const qs: Question[] = [1, 2, 3, 4].map((i) => ({ id: `q${i}`, prompt: `Q${i}`, choices: ['a', 'b', 'c'], correct: i % 3, points: 5 }));

test('anti-cheat: shuffle is deterministic per attempt, differs between attempts, and never leaks the answers', () => {
  const a = presentQuestions(qs, 'attempt-1'), b = presentQuestions(qs, 'attempt-1'), c = presentQuestions(qs, 'attempt-2');
  assert.deepEqual(a, b);
  const orders = new Set(Array.from({ length: 8 }, (_, k) => presentQuestions(qs, `attempt-${k}`).map((q) => q.id).join()));
  assert.ok(orders.size > 1, 'different attempts must get different orders');
  assert.ok(!JSON.stringify(a).includes('correct'));
  assert.deepEqual(seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 'z').sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('anti-cheat timing: timeout refused, too-fast flagged', () => {
  assert.deepEqual(checkTiming(0, 100_000, 60, 4), { ok: false, flags: ['timeout'] });
  assert.deepEqual(checkTiming(0, 62_000, 60, 4), { ok: true, flags: [] });       // within grace
  assert.deepEqual(checkTiming(0, 2_000, 60, 4), { ok: true, flags: ['too_fast'] });
  assert.equal(checkTiming(5000, 1000, null, 4).ok, false);
});

test('exam scoring by mode', () => {
  const all = Object.fromEntries(qs.map((q) => [q.id, q.correct]));
  assert.deepEqual(scoreExam('qcm', qs, all), { score100: 100, earned: 20, total: 20, correctCount: 4, perfect: true });
  assert.equal(scoreExam('qcm', qs, { q1: 1 }).score100, 25);
  const esc = scoreExam('escape_game', qs, { ...all, q1: [0, 2, qs[0].correct] });          // third attempt right
  assert.equal(esc.escaped, true);
  assert.equal(scoreExam('escape_game', qs, { ...all, q1: [2, 2, 2, qs[0].correct] }).escaped, false);   // 4th attempt ignored
  assert.equal(scoreExam('boss', qs, { q1: 1, q2: 2, q3: 0 }).bossDefeated, true);
  assert.equal(scoreExam('boss', qs, { q1: 1 }).bossDefeated, false);
  assert.throws(() => scoreExam('qcm', [], {}), RangeError);
});

test('leaderboard ranks ties together; team points = member average', () => {
  const l = leaderboard([{ id: 'a', points: 50 }, { id: 'b', points: 80 }, { id: 'c', points: 50 }, { id: 'd', points: 10 }]);
  assert.deepEqual(l.map((x) => [x.id, x.rank]), [['b', 1], ['a', 2], ['c', 2], ['d', 4]]);
  assert.equal(teamPoints([10, 20, 30]), 20); assert.equal(teamPoints([]), 0);
});

test('table 8.4: gamification results feed the right OAA sources', () => {
  const f = oaaFeedFromGamification([{ kind: 'quiz', score100: 80 }, { kind: 'quiz', score100: 60 }, { kind: 'game', score100: 90 }, { kind: 'individual_challenge', score100: 70 }, { kind: 'group_challenge', score100: 100 }]);
  assert.deepEqual(f, { quizAvg: 70, individualGameAvg: 80, groupChallengeAvg: 100 });
  assert.deepEqual(oaaFeedFromGamification([]), { quizAvg: null, individualGameAvg: null, groupChallengeAvg: null });
});

const model: LinearRiskModel = { type: 'logistic', version: 't1', features: ['avg100', 'unjustified_rate', 'xp_30d'], intercept: -0.5, coefs: [-1.2, 0.8, -0.3], means: [60, 1, 50], stds: [15, 1, 30], thresholds: { medium: 0.33, high: 0.66 } };

test('risk model: weak student is high risk, factors are exact linear SHAP contributions, advisory only', () => {
  const weak = predictRisk(model, { avg100: 30, unjustified_rate: 4, xp_30d: 0 });
  assert.equal(weak.level, 'high'); assert.equal(weak.advisoryOnly, true);
  assert.equal(weak.factors[0].feature, 'avg100');
  assert.equal(weak.factors[0].contribution, 2.4);          // -1.2 * (30-60)/15
  const strong = predictRisk(model, { avg100: 85, unjustified_rate: 0, xp_30d: 120 });
  assert.equal(strong.level, 'low'); assert.deepEqual(recommendations(strong, 'fr'), []);
  assert.ok(recommendations(weak, 'en').length > 0);
  assert.throws(() => predictRisk(model, { avg100: 30 } as any), RangeError);
});

test('payment data can never be a model feature', () => {
  assert.throws(() => predictRisk({ ...model, features: ['avg100', 'unpaid_invoices', 'xp_30d'] }, { avg100: 1, unpaid_invoices: 1, xp_30d: 1 }), /Payment data/);
});

test('bias report: four-fifths rule between groups, small groups ignored', () => {
  const mk = (group: string, hi: number, n: number) => Array.from({ length: n }, (_, i) => ({ group, level: (i < hi ? 'high' : 'low') as 'high' | 'low' }));
  const ok = biasReport([...mk('A', 2, 10), ...mk('B', 2, 10)]);
  assert.equal(ok.flagged, false); assert.equal(ok.disparateImpactRatio, 1);
  const bad = biasReport([...mk('A', 1, 10), ...mk('B', 5, 10)]);
  assert.equal(bad.flagged, true); assert.equal(bad.disparateImpactRatio, 0.2);
  assert.equal(biasReport([...mk('A', 1, 10), ...mk('B', 5, 3)]).disparateImpactRatio, null);
});

test('registry: emit can exclude a module, emitTo runs only the named enabled module', async () => {
  const reg = new ModuleRegistry('1.0.0');
  const mk = (name: string) => ({ name, version: '1.0.0', core_version: '>=0.1.0', description: name, permissions: [], hooks: { onGradeSubmitted: 'h' } });
  reg.register(mk('module-a'), { h: () => 'A' }); reg.register(mk('module-b'), { h: () => 'B' });
  reg.enable('t', 'module-a'); reg.enable('t', 'module-b');
  assert.deepEqual((await reg.emit('t', 'onGradeSubmitted', {}, ['module-a'])).map((r) => r.module), ['module-b']);
  assert.deepEqual(await reg.emitTo('t', 'onGradeSubmitted', 'module-a', {}), { module: 'module-a', ok: true, value: 'A' });
  reg.disable('t', 'module-a');
  assert.equal(await reg.emitTo('t', 'onGradeSubmitted', 'module-a', {}), null);
  assert.equal(await reg.emitTo('t', 'onGradeSubmitted', 'zzz', {}), null);
});

test('TypeScript risk model reproduces the Python reference outputs (golden file) exactly', async () => {
  const { readFileSync } = await import('node:fs');
  const dir = new URL('../../../apps/ai/model/', import.meta.url);
  const m = JSON.parse(readFileSync(new URL('model.json', dir), 'utf8'));
  const golden = JSON.parse(readFileSync(new URL('golden.json', dir), 'utf8')) as { input: Record<string, number>; output: any }[];
  assert.ok(golden.length >= 10);
  for (const g of golden) {
    const r = predictRisk(m, g.input);
    assert.equal(r.probability, g.output.probability);
    assert.equal(r.level, g.output.level);
    assert.deepEqual(r.factors.map((f) => [f.feature, f.contribution]), g.output.factors.map((f: any) => [f.feature, f.contribution]));
  }
});
