import type { Slot } from './timetable.ts';

export function isoWeekday(date: string): number { return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; }

export interface ExistingSub { onDate: string; day: number; period: number; substituteId: string }

/** Why a teacher cannot cover `slot` on `onDate` (empty list = ok). Spec 6.5: replacement of a teacher. */
export function substitutionProblems(published: Slot[], slot: Slot, onDate: string, substituteId: string, existing: ExistingSub[]): string[] {
  const out: string[] = [];
  if (isoWeekday(onDate) !== slot.day) out.push('date does not fall on the weekday of the slot');
  if (substituteId === slot.teacherId) out.push('substitute is the regular teacher');
  if (published.some((s) => s.teacherId === substituteId && s.day === slot.day && s.period === slot.period)) out.push('substitute teaches another class at that time');
  if (existing.some((e) => e.onDate === onDate && e.day === slot.day && e.period === slot.period && e.substituteId === substituteId)) out.push('substitute already covers another class at that time');
  return out;
}

export interface Workload { assigned: number; max: number; remaining: number; overload: boolean; contractHours: number | null; belowContract: boolean }
export function teacherWorkload(assigned: number, max: number, contractHours: number | null = null): Workload {
  return { assigned, max, remaining: Math.max(0, max - assigned), overload: assigned > max, contractHours, belowContract: contractHours !== null && assigned < contractHours };
}
