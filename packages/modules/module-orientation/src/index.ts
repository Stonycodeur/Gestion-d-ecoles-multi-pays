import type { HookHandler } from '../../../shared/src/modules.ts';
import { computeExamFiche, type ExamFicheConfig, type PctMark } from '../../../shared/src/orientation.ts';

/** Computes the exam-fiche projection; the core persists nothing here (the fiche is derived on demand from grades and exam marks). */
export const handlers: Record<string, HookHandler> = {
  projectFiche: (p: { config: ExamFicheConfig; continuous: PctMark[]; exam: PctMark[] }) => ({ fiche: computeExamFiche(p.config, p.continuous ?? [], p.exam ?? []) }),
};
