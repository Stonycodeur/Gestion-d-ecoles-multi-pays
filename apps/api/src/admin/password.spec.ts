import { generatePassword, strongEnough } from './password';

describe('temporary password', () => {
  it('is 16 chars long with every character class and never repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p).toHaveLength(16);
      expect(strongEnough(p)).toBe(true);
      expect(/[^A-Za-z0-9!@#$%*?_-]/.test(p)).toBe(false);
      expect(/[0OIl1]/.test(p)).toBe(false);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
  it('rejects weak custom passwords', () => {
    for (const p of ['short1A', 'alllowercase123', 'ALLUPPERCASE123', 'NoDigitsHereAtAll', 42, undefined]) expect(strongEnough(p)).toBe(false);
    expect(strongEnough('Abcdefghij1')).toBe(true);
  });
});
