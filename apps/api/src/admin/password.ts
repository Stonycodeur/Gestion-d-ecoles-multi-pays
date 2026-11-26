import { randomBytes, randomInt } from 'node:crypto';

const LOWER = 'abcdefghijkmnopqrstuvwxyz', UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ', DIGIT = '23456789', SYMBOL = '!@#$%*?-_';
const pick = (set: string) => set[randomInt(set.length)];

/** Temporary password shown once to the root super-admin: 16 characters, all four classes, no look-alike characters (0/O, 1/l/I). */
export function generatePassword(length = 16): string {
  const all = LOWER + UPPER + DIGIT + SYMBOL;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGIT), pick(SYMBOL)];
  const extra = randomBytes(length);
  for (let i = chars.length; i < length; i++) chars.push(all[extra[i] % all.length]);
  for (let i = chars.length - 1; i > 0; i--) { const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}
export const strongEnough = (p: unknown): p is string => typeof p === 'string' && p.length >= 10 && p.length <= 128 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p);
