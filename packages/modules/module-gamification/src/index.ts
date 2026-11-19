import { xpFor, levelFor, DEFAULT_XP_RULES, DEFAULT_LEVELS } from '../../../shared/src/gamification.ts';
import type { XpRules } from '../../../shared/src/gamification.ts';
import type { HookHandler } from '../../../shared/src/modules.ts';

/** Hooks only COMPUTE; the core persists the result (XP events are idempotent per student/source/ref). */
export const handlers: Record<string, HookHandler> = {
  awardExamXp: (p: { studentId: string; examId: string; score100: number }, { config }) => {
    const rules = { ...DEFAULT_XP_RULES, ...((config.xp_rules as Partial<XpRules>) ?? {}) };
    return { studentId: p.studentId, source: 'exam', ref: p.examId, xp: xpFor('exam', p.score100, rules) };
  },
  noteGradeActivity: (p: { studentIds?: string[] }) => ({ students: p.studentIds?.length ?? 0, levels: DEFAULT_LEVELS.length, sample: levelFor(0).level.code }),
};
