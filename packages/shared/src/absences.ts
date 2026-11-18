export interface AbsenceRec { kind: 'absence' | 'late'; status: 'unjustified' | 'pending' | 'justified' | 'rejected' }
export interface AttendanceStats { absences: number; unjustified: number; justified: number; pending: number; lates: number }

export function attendanceStats(recs: AbsenceRec[]): AttendanceStats {
  const s: AttendanceStats = { absences: 0, unjustified: 0, justified: 0, pending: 0, lates: 0 };
  for (const r of recs) {
    if (r.kind === 'late') { s.lates++; continue; }
    s.absences++;
    if (r.status === 'justified') s.justified++;
    else if (r.status === 'pending') s.pending++;
    else s.unjustified++; // unjustified and rejected both count against the student
  }
  return s;
}

export interface AbsenceConfig { warnUnjustified: number; criticalUnjustified: number; perUnjustified: number; perLate: number; maxSocialPenalty: number }
export const DEFAULT_ABSENCE_CONFIG: AbsenceConfig = { warnUnjustified: 3, criticalUnjustified: 5, perUnjustified: 5, perLate: 1, maxSocialPenalty: 30 };

export function absenceAlert(s: AttendanceStats, c: AbsenceConfig = DEFAULT_ABSENCE_CONFIG): 'ok' | 'warning' | 'critical' {
  if (s.unjustified >= c.criticalUnjustified) return 'critical';
  if (s.unjustified >= c.warnUnjustified) return 'warning';
  return 'ok';
}

/** Social-contribution axis of the OAA (spec 6.8): 100 minus a capped penalty. Justified absences do not count. */
export function socialAxisFromAttendance(s: AttendanceStats, c: AbsenceConfig = DEFAULT_ABSENCE_CONFIG): number {
  const penalty = Math.min(c.maxSocialPenalty, s.unjustified * c.perUnjustified + s.lates * c.perLate);
  return Math.max(0, 100 - penalty);
}
