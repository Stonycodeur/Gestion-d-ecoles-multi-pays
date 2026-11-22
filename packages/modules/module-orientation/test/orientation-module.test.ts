import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handlers } from '../src/index.ts';

test('projectFiche delegates to the shared computation', () => {
  const cfg = { exam_code: 'BEPC', continuous_weight: 0.4, exam_weight: 0.6, pass_pct: 50, components: [{ subject_code: 'MATH', coefficient: 1 }] };
  const out = handlers.projectFiche({ config: cfg, continuous: [{ subject_code: 'MATH', pct: 70 }], exam: [] }, { tenantId: 't', config: {} }) as any;
  assert.equal(out.fiche.projected_pct, 70); assert.equal(out.fiche.admitted, true);
});
