// Gamification (spec 8): XP, levels, badges, challenges, leaderboards, gamified exams with anti-cheat, OAA feed.
export interface LevelDef { code: string; min_xp: number; label_fr: string; label_en: string }
export const DEFAULT_LEVELS: LevelDef[] = [
  { code: 'novice', min_xp: 0, label_fr: 'Novice', label_en: 'Novice' },
  { code: 'apprenti', min_xp: 100, label_fr: 'Apprenant', label_en: 'Learner' },
  { code: 'expert', min_xp: 500, label_fr: 'Expert', label_en: 'Expert' },
  { code: 'maitre', min_xp: 1500, label_fr: 'Maître', label_en: 'Master' },
];

export function levelFor(xp: number, levels: LevelDef[] = DEFAULT_LEVELS) {
  const sorted = [...levels].sort((a, b) => a.min_xp - b.min_xp);
  let idx = 0;
  for (let i = 0; i < sorted.length; i++) if (xp >= sorted[i].min_xp) idx = i;
  const next = sorted[idx + 1];
  const cur = sorted[idx];
  return { level: cur, next: next ?? null, progressPct: next ? Math.floor(((xp - cur.min_xp) / (next.min_xp - cur.min_xp)) * 100) : 100, xpToNext: next ? next.min_xp - xp : 0 };
}

export type XpSource = 'homework' | 'quiz' | 'participation' | 'challenge' | 'game' | 'boss' | 'exam';
export interface XpRules { homework: number; participation: number; quizBase: number; quizPerfectBonus: number; challenge: number; game: number; boss: number; examBase: number }
export const DEFAULT_XP_RULES: XpRules = { homework: 10, participation: 5, quizBase: 10, quizPerfectBonus: 15, challenge: 30, game: 8, boss: 50, examBase: 20 };

/** XP for one activity. Score-based sources scale with the score (0-100). */
export function xpFor(source: XpSource, score100: number | null, r: XpRules = DEFAULT_XP_RULES): number {
  const s = score100 === null ? 0 : Math.min(100, Math.max(0, score100));
  switch (source) {
    case 'homework': return r.homework;
    case 'participation': return r.participation;
    case 'challenge': return r.challenge;
    case 'boss': return s >= 60 ? r.boss : Math.round(r.boss * s / 200);
    case 'game': return Math.round(r.game * (0.5 + s / 200));
    case 'quiz': return Math.round(r.quizBase * (s / 100)) + (s === 100 ? r.quizPerfectBonus : 0);
    case 'exam': return Math.round(r.examBase * (s / 100));
  }
}

// ---- badges --------------------------------------------------------------------------------------------------------
export interface BadgeDef { code: string; name_fr: string; name_en: string; rule: { metric: 'perfect_quizzes' | 'attendance_streak_days' | 'quiz_count_avg' | 'total_xp' | 'bosses_defeated'; threshold: number; minAvg?: number } }
export const DEFAULT_BADGES: BadgeDef[] = [
  { code: 'sans_faute', name_fr: 'Sans faute', name_en: 'Flawless', rule: { metric: 'perfect_quizzes', threshold: 1 } },
  { code: 'assidu', name_fr: 'Assidu', name_en: 'Dedicated', rule: { metric: 'attendance_streak_days', threshold: 20 } },
  { code: 'champion_quiz', name_fr: 'Champion du quiz', name_en: 'Quiz champion', rule: { metric: 'quiz_count_avg', threshold: 10, minAvg: 80 } },
  { code: 'chasseur_boss', name_fr: 'Chasseur de boss', name_en: 'Boss hunter', rule: { metric: 'bosses_defeated', threshold: 1 } },
  { code: 'mille_xp', name_fr: 'Mille XP', name_en: 'Thousand XP', rule: { metric: 'total_xp', threshold: 1000 } },
];
export interface StudentStats { perfectQuizzes: number; attendanceStreakDays: number; quizCount: number; quizAvg: number; totalXp: number; bossesDefeated: number }

export function evaluateBadges(stats: StudentStats, earned: string[], defs: BadgeDef[] = DEFAULT_BADGES): BadgeDef[] {
  return defs.filter((d) => {
    if (earned.includes(d.code)) return false;
    const r = d.rule;
    switch (r.metric) {
      case 'perfect_quizzes': return stats.perfectQuizzes >= r.threshold;
      case 'attendance_streak_days': return stats.attendanceStreakDays >= r.threshold;
      case 'quiz_count_avg': return stats.quizCount >= r.threshold && stats.quizAvg >= (r.minAvg ?? 0);
      case 'total_xp': return stats.totalXp >= r.threshold;
      case 'bosses_defeated': return stats.bossesDefeated >= r.threshold;
    }
  });
}

// ---- games per cycle (8.2) --------------------------------------------------------------------------------------
export type GameType = 'memory' | 'image_quiz' | 'puzzle' | 'word_race' | 'timed_quiz' | 'kahoot' | 'role_play' | 'escape_game' | 'simulation' | 'debate' | 'strategy' | 'advanced_mcq' | 'case_study' | 'pro_simulation' | 'academic_role_play';
export const GAME_TYPES_BY_LEVEL: Record<'primary' | 'college' | 'lycee' | 'university', GameType[]> = {
  primary: ['memory', 'image_quiz', 'puzzle', 'word_race'],
  college: ['timed_quiz', 'kahoot', 'role_play', 'escape_game'],
  lycee: ['simulation', 'debate', 'strategy', 'advanced_mcq'],
  university: ['case_study', 'pro_simulation', 'academic_role_play'],
};

// ---- gamified exams (8.3) with anti-cheat -------------------------------------------------------------------------
export type ExamMode = 'qcm' | 'escape_game' | 'team_quiz' | 'boss';
export interface Question { id: string; prompt: string; choices: string[]; correct: number; points: number }

/** Deterministic seeded shuffle (mulberry32) so each attempt gets its own order that the server can reproduce. */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) { h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  let a = (h ^ (h >>> 16)) >>> 0;
  const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

/** Questions as served to the student: shuffled order and choices, correct answers removed. Each choice keeps its original index. */
export function presentQuestions(qs: Question[], seed: string) {
  return seededShuffle(qs, seed).map((q) => ({ id: q.id, prompt: q.prompt, points: q.points,
    choices: seededShuffle(q.choices.map((text, orig) => ({ text, orig })), `${seed}:${q.id}`) }));
}

export interface TimingCheck { ok: boolean; flags: string[] }
/** Anti-cheat: refuses submissions after the time limit (plus a small network grace) and flags implausibly fast answering. */
export function checkTiming(startedAtMs: number, submittedAtMs: number, limitSec: number | null, questionCount: number, graceSec = 5, minSecPerQuestion = 1): TimingCheck {
  const flags: string[] = [];
  const elapsed = (submittedAtMs - startedAtMs) / 1000;
  if (elapsed < 0) return { ok: false, flags: ['clock'] };
  if (limitSec !== null && elapsed > limitSec + graceSec) return { ok: false, flags: ['timeout'] };
  if (questionCount > 0 && elapsed < questionCount * minSecPerQuestion) flags.push('too_fast');
  return { ok: true, flags };
}

export interface ExamResult { score100: number; earned: number; total: number; correctCount: number; escaped?: boolean; bossDefeated?: boolean; perfect: boolean }
/** answers: question id -> chosen ORIGINAL choice index (arrays of attempts for escape games). Unanswered counts as wrong. */
export function scoreExam(mode: ExamMode, qs: Question[], answers: Record<string, number | number[]>, opts: { maxAttempts?: number; bossThreshold?: number } = {}): ExamResult {
  const total = qs.reduce((a, q) => a + q.points, 0);
  if (!total) throw new RangeError('Exam has no points');
  let earned = 0, correctCount = 0, allSolved = true;
  for (const q of qs) {
    const given = answers[q.id];
    let ok = false;
    if (mode === 'escape_game') {
      const attempts = (Array.isArray(given) ? given : given === undefined ? [] : [given]).slice(0, opts.maxAttempts ?? 3);
      ok = attempts.includes(q.correct);          // a riddle is solved if one of the allowed attempts is right
    } else ok = (Array.isArray(given) ? given[0] : given) === q.correct;
    if (ok) { earned += q.points; correctCount++; } else allSolved = false;
  }
  const score100 = Math.round((earned / total) * 100);
  return { score100, earned, total, correctCount, perfect: earned === total,
    ...(mode === 'escape_game' ? { escaped: allSolved } : {}), ...(mode === 'boss' ? { bossDefeated: score100 >= (opts.bossThreshold ?? 60) } : {}) };
}

// ---- challenges, teams, leaderboards ------------------------------------------------------------------------------
export interface ChallengeDef { code: string; kind: 'individual' | 'group'; metric: 'xp' | 'quizzes' | 'homework'; target: number }
export function challengeProgress(c: ChallengeDef, total: number) {
  return { done: total >= c.target, pct: Math.min(100, Math.floor((total / c.target) * 100)) };
}

/** Competition ranking by points, ties share the rank (1, 2, 2, 4). */
export function leaderboard<T extends { id: string; points: number }>(rows: T[], limit = 50): (T & { rank: number })[] {
  const sorted = [...rows].sort((a, b) => b.points - a.points || (a.id < b.id ? -1 : 1));
  const out: (T & { rank: number })[] = [];
  sorted.forEach((r, i) => out.push({ ...r, rank: i > 0 && sorted[i - 1].points === r.points ? out[i - 1].rank : i + 1 }));
  return out.slice(0, limit);
}
export const teamPoints = (members: number[]): number => (members.length ? Math.round(members.reduce((a, b) => a + b, 0) / members.length) : 0);

// ---- feed to the OAA (8.4) ------------------------------------------------------------------------------------------
export interface GameResult { kind: 'quiz' | 'game' | 'group_challenge' | 'individual_challenge' | 'exam' | 'boss'; score100: number }
const mean = (a: number[]) => (a.length ? Math.round((a.reduce((x, y) => x + y, 0) / a.length) * 100) / 100 : null);
/** Table 8.4: individual games and challenges -> adaptability; group challenges -> social contribution; subject quizzes -> academic. */
export function oaaFeedFromGamification(results: GameResult[]) {
  const pick = (kinds: GameResult['kind'][]) => mean(results.filter((r) => kinds.includes(r.kind)).map((r) => r.score100));
  return { quizAvg: pick(['quiz', 'exam']), individualGameAvg: pick(['game', 'individual_challenge', 'boss']), groupChallengeAvg: pick(['group_challenge']) };
}
