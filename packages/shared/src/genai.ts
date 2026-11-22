/** Generative assistant rules (spec 6.20): pseudonymisation before any model call, age-filtered tutoring, validation of model output. Pure functions. */

export const AI_KINDS = ['summarize', 'qcm', 'exercises', 'translate', 'correction_help', 'tutor'] as const;
export type AiKind = (typeof AI_KINDS)[number];
export const STAFF_KINDS: readonly AiKind[] = ['summarize', 'qcm', 'exercises', 'translate', 'correction_help'];
export const MAX_INPUT_CHARS = 8000;

// ---- pseudonymisation -------------------------------------------------------------------------------------------------------
export interface Pseudonymised { text: string; map: Record<string, string>; redactions: number }
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?<![\w])\+?\d[\d .-]{6,}\d(?![\w])/g;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces e-mails, phone numbers and the given personal names by stable tokens; the same value always gets the same token. */
export function pseudonymize(text: string, names: string[] = []): Pseudonymised {
  const map: Record<string, string> = {}; const rev = new Map<string, string>(); let n = 0; let redactions = 0;
  const tok = (kind: string, value: string) => {
    const key = `${kind}:${value.toLowerCase()}`; let t = rev.get(key);
    if (!t) { t = `[${kind}${++n}]`; rev.set(key, t); map[t] = value; }
    redactions++; return t;
  };
  let out = text.replace(EMAIL, (m) => tok('EMAIL', m)).replace(PHONE, (m) => tok('TEL', m));
  const parts = [...new Set(names.flatMap((x) => x.split(/\s+/)).map((x) => x.trim()).filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length);
  for (const p of parts) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(p)}(?![\\p{L}\\p{N}])`, 'giu'), (m) => tok('NOM', m));
  return { text: out, map, redactions };
}
export function restore(text: string, map: Record<string, string>): string {
  return text.replace(/\[(?:EMAIL|TEL|NOM)\d+\]/g, (t) => map[t] ?? t);
}

// ---- age-filtered tutoring --------------------------------------------------------------------------------------------------
export type AgeBand = 'child' | 'teen' | 'older';
export function ageYears(birthDate: string | null | undefined, now: Date = new Date()): number | null {
  if (!birthDate) return null; const d = new Date(birthDate); if (Number.isNaN(d.getTime())) return null;
  let a = now.getUTCFullYear() - d.getUTCFullYear(); const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) a--; return a;
}
/** Unknown age gets the strictest band. */
export function ageBand(age: number | null): AgeBand { if (age === null || age < 12) return 'child'; return age < 16 ? 'teen' : 'older'; }
export interface TutorPolicy { maxChars: number; blocked: string[] }
export const DEFAULT_BLOCKED_TERMS: Record<AgeBand, string[]> = {
  child: ['sexe', 'sexual', 'porn', 'drogue', 'drug', 'suicide', 'arme', 'weapon', 'violence', 'alcool', 'alcohol', 'cigarette'],
  teen: ['porn', 'suicide', 'weapon', 'arme à feu', 'how to make a bomb', 'fabriquer une bombe'],
  older: ['porn', 'how to make a bomb', 'fabriquer une bombe'],
};
export function tutorPolicy(band: AgeBand, extra: string[] = []): TutorPolicy {
  return { maxChars: band === 'child' ? 600 : band === 'teen' ? 1200 : 2000, blocked: [...DEFAULT_BLOCKED_TERMS[band], ...extra.map((x) => x.toLowerCase())] };
}
export function containsBlocked(text: string, blocked: string[]): string | null {
  const t = text.toLowerCase(); for (const b of blocked) if (t.includes(b)) return b; return null;
}
export const SAFE_REDIRECT = { fr: 'Je ne peux pas aider sur ce sujet. Parle-en à un enseignant ou à un adulte de confiance ; je peux t’aider pour tes cours.', en: 'I can’t help with that topic. Please talk to a teacher or a trusted adult; I can help with your schoolwork.' };
/** Output side: refuse answers that contain blocked terms, and cap their length. */
export function filterTutorOutput(text: string, policy: TutorPolicy, lang: 'fr' | 'en'): { text: string; blocked: boolean } {
  if (containsBlocked(text, policy.blocked)) return { text: SAFE_REDIRECT[lang], blocked: true };
  return { text: text.length > policy.maxChars ? `${text.slice(0, policy.maxChars - 1)}…` : text, blocked: false };
}

// ---- validation of model output (never trusted) -----------------------------------------------------------------------------
export interface QcmItem { prompt: string; choices: string[]; correct: number; points: number }
export function validateQcm(items: unknown, max = 50): { ok: QcmItem[]; rejected: number } {
  const ok: QcmItem[] = []; let rejected = 0;
  if (!Array.isArray(items)) return { ok, rejected: 1 };
  for (const x of items.slice(0, max)) {
    const q = x as any;
    const choices = Array.isArray(q?.choices) ? q.choices.map((c: unknown) => String(c).trim()) : [];
    const valid = typeof q?.prompt === 'string' && q.prompt.trim().length > 0 && q.prompt.length <= 1000 && choices.length >= 2 && choices.length <= 8 && choices.every((c: string) => c.length > 0 && c.length <= 300)
      && new Set(choices.map((c: string) => c.toLowerCase())).size === choices.length && Number.isInteger(q.correct) && q.correct >= 0 && q.correct < choices.length;
    if (valid) ok.push({ prompt: q.prompt.trim(), choices, correct: q.correct, points: Number.isInteger(q.points) && q.points > 0 && q.points <= 100 ? q.points : 1 }); else rejected++;
  }
  return { ok, rejected };
}
/** Extracts the first JSON value from a model answer that may be wrapped in prose or code fences. */
export function parseJsonLoose(s: string): unknown {
  const m = /[\[{]/.exec(s); if (!m) throw new Error('no JSON in model output');
  const open = s[m.index]!, close = open === '[' ? ']' : '}'; const end = s.lastIndexOf(close);
  if (end <= m.index) throw new Error('unterminated JSON in model output');
  return JSON.parse(s.slice(m.index, end + 1));
}
