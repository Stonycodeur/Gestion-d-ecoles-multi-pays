import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransitionInternship, internshipDays, validateApplication, computeExamFiche, validateFicheConfig, successRate, publicStat } from '../src/index.ts';
import type { ExamFicheConfig } from '../src/index.ts';

test('internship workflow: only allowed transitions per actor', () => {
  assert.ok(canTransitionInternship('requested', 'approved', 'staff'));
  assert.ok(!canTransitionInternship('requested', 'approved', 'student'));
  assert.ok(canTransitionInternship('requested', 'cancelled', 'student'));
  assert.ok(canTransitionInternship('in_progress', 'report_submitted', 'student'));
  assert.ok(!canTransitionInternship('approved', 'completed', 'staff'));
  assert.ok(!canTransitionInternship('completed', 'in_progress', 'staff'));
  assert.equal(internshipDays('2027-03-01', '2027-03-05'), 5);
  assert.throws(() => internshipDays('2027-03-05', '2027-03-01'));
});
const good = { first_name: 'Awa', last_name: 'Nze', level_code: '6e', guardian_name: 'M. Nze', guardian_email: 'nze@example.org', consent: true, birth_date: '2015-04-02' };
test('online application: validation, level whitelist, consent, honeypot', () => {
  const ok = validateApplication(good, ['6e', '5e']);
  assert.ok(ok.ok && ok.data.guardian_email === 'nze@example.org');
  assert.ok(!validateApplication({ ...good, level_code: 'Tle' }, ['6e']).ok);
  assert.ok(!validateApplication({ ...good, consent: false }, ['6e']).ok);
  assert.ok(!validateApplication({ ...good, guardian_email: 'bad', guardian_phone: undefined }, ['6e']).ok);
  assert.ok(!validateApplication({ ...good, guardian_email: undefined }, ['6e']).ok);   // one contact is mandatory
  const spam = validateApplication({ ...good, website: 'http://spam' }, ['6e']);
  assert.ok(!spam.ok && spam.spam === true);
  assert.ok(!validateApplication({ ...good, birth_date: '2999-01-01' }, ['6e']).ok);
});
const cfg: ExamFicheConfig = { exam_code: 'BEPC', continuous_weight: 0.4, exam_weight: 0.6, pass_pct: 50,
  components: [{ subject_code: 'MATH', coefficient: 3 }, { subject_code: 'FR', coefficient: 2 }], mentions: [{ label: 'Bien', min_pct: 70 }, { label: 'Assez bien', min_pct: 60 }] };
test('exam fiche: projection from continuous assessment only, then with exam marks', () => {
  const early = computeExamFiche(cfg, [{ subject_code: 'MATH', pct: 80 }, { subject_code: 'FR', pct: 60 }], []);
  assert.equal(early.continuous_pct, 72); assert.equal(early.exam_pct, null); assert.equal(early.projected_pct, 72); assert.equal(early.admitted, true);
  assert.deepEqual(early.missing_exam, ['MATH', 'FR']);
  const full = computeExamFiche(cfg, [{ subject_code: 'MATH', pct: 80 }, { subject_code: 'FR', pct: 60 }], [{ subject_code: 'MATH', pct: 50 }, { subject_code: 'FR', pct: 40 }]);
  // MATH 80*.4+50*.6=62 ; FR 60*.4+40*.6=48 ; (62*3+48*2)/5 = 56.4
  assert.equal(full.projected_pct, 56.4); assert.equal(full.admitted, true); assert.equal(full.mention, null);
  const mention = computeExamFiche(cfg, [{ subject_code: 'MATH', pct: 90 }, { subject_code: 'FR', pct: 80 }], [{ subject_code: 'MATH', pct: 70 }, { subject_code: 'FR', pct: 60 }]);
  assert.equal(mention.mention, 'Bien');
  assert.equal(computeExamFiche(cfg, [], []).admitted, null);
});
test('exam fiche config validation and public stats', () => {
  assert.deepEqual(validateFicheConfig(cfg), []);
  assert.ok(validateFicheConfig({ ...cfg, exam_weight: 0.5 }).length > 0);
  assert.throws(() => computeExamFiche({ ...cfg, components: [] }, [], []));
  assert.equal(successRate(37, 40), 92.5); assert.equal(successRate(0, 0), null); assert.equal(successRate(5, 4), null);
  assert.equal(publicStat(90, 10, 9), null); assert.equal(publicStat(90, 10, 12), 90);
});
