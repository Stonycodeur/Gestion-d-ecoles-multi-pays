// "Who can write to whom" (spec 6.9). Pure rules: attributes are loaded from the school directory by the API.
export type PartyRole = 'head' | 'tenant_super_admin' | 'admin' | 'teacher' | 'education_assistant' | 'accountant' | 'student' | 'guardian';
export interface Party {
  userId: string;
  role: PartyRole;
  classIds?: string[];        // teacher: classes taught; student: [own class]
  childIds?: string[];        // guardian: linked students
  childClassIds?: string[];   // guardian: classes of the linked students
  studentId?: string;         // student: own student id
}
export interface MessagingOptions { allowStudentPeers: boolean }
const DIRECTION: PartyRole[] = ['head', 'tenant_super_admin'];
const inter = (a?: string[], b?: string[]) => !!a && !!b && a.some((x) => b.includes(x));

export function canMessage(from: Party, to: Party, opt: MessagingOptions = { allowStudentPeers: false }): boolean {
  if (from.userId === to.userId) return false;
  if (DIRECTION.includes(from.role) || from.role === 'admin') return true;                       // direction writes to everyone
  switch (from.role) {
    case 'guardian':
      if (to.role === 'student') return !!to.studentId && !!from.childIds?.includes(to.studentId);   // own child
      if (to.role === 'teacher') return inter(from.childClassIds, to.classIds);                      // teachers of own children
      return DIRECTION.includes(to.role);                                                            // direction
    case 'teacher':
      if (to.role === 'student') return inter(from.classIds, to.classIds);                           // own classes
      if (to.role === 'guardian') return inter(from.classIds, to.childClassIds);                     // parents of own students
      return DIRECTION.includes(to.role);
    case 'student':
      if (to.role === 'teacher') return inter(from.classIds, to.classIds);                           // own teachers
      if (to.role === 'student') return opt.allowStudentPeers && inter(from.classIds, to.classIds);  // classmates (option)
      return false;
    case 'education_assistant':
      return ['student', 'guardian', 'teacher', ...DIRECTION].includes(to.role);
    case 'accountant':
      return to.role === 'guardian' || DIRECTION.includes(to.role);                                  // billing questions
    default:
      return false;
  }
}

/** Every other member of a thread must be reachable by the creator. Returns the refused user ids. */
export function refusedRecipients(creator: Party, members: Party[], opt?: MessagingOptions): string[] {
  return members.filter((m) => m.userId !== creator.userId && !canMessage(creator, m, opt)).map((m) => m.userId);
}
