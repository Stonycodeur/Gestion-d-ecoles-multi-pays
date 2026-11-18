import type { GradingScale, Band } from '../src/grading.ts';

export const LETTER_BANDS: Band[] = [
  ['A+',96,100,'green'],['A',86,95,'green'],['A-',81,85,'green'],
  ['B+',76,80,'blue'],['B',66,75,'blue'],['B-',61,65,'blue'],
  ['C+',56,60,'yellow'],['C',46,55,'yellow'],['C-',41,45,'yellow'],
  ['D+',36,40,'orange'],['D',26,35,'orange'],['D-',21,25,'orange'],
  ['E+',16,20,'red'],['E',6,15,'red'],['E-',1,5,'red'],
].map(([label, min, max, color]) => ({ label, min, max, color }) as Band);

const num = (code: string, max: number, step: number, pass: number, rounding: GradingScale['rounding'], decimals: number): GradingScale =>
  ({ code, type: 'numeric', min: 0, max, step, decimals, passMark: pass, rounding, bands: [] });

export const S20 = num('num20', 20, 0.25, 10, 'tenth', 1);
export const S10 = num('num10', 10, 0.5, 5, 'tenth', 1);
export const S100 = num('num100', 100, 1, 50, 'integer', 0);
export const SLETTERS: GradingScale = { code: 'letters', type: 'letter', min: 0, max: 100, step: 1, decimals: 0, passMark: 41, rounding: 'integer', bands: LETTER_BANDS };
