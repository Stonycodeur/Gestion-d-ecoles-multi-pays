export type RoleCode = 'inspector' | 'root_super_admin' | 'tenant_super_admin' | 'admin' | 'head' | 'teacher'
  | 'education_assistant' | 'accountant' | 'student' | 'guardian' | 'visitor';

const ALL_TENANT = ['students:read', 'students:write', 'staff:read', 'staff:write', 'schedule:read', 'schedule:write',
  'lessons:read', 'grades:read', 'absences:read', 'oaa:read', 'oaa:configure', 'modules:manage', 'grading:configure', 'audit:read',
  'billing:read', 'billing:write', 'ministry:prepare', 'marketplace:install', 'ai:use', 'ai:configure', 'locker:read', 'predictive:read',
  'news:write', 'news:read', 'directory:manage', 'contracts:write', 'inspectors:manage', 'messages:all', 'locker:write', 'notify:send', 'oaa:write', 'games:create', 'games:read'];

/** role -> permission codes. Data, mirrored from docs/PERMISSIONS.md; refined by ABAC in can(). */
export const ROLE_PERMISSIONS: Record<RoleCode, string[]> = {
  root_super_admin: ['*'],
  tenant_super_admin: [...ALL_TENANT, 'admins:create', 'ministry:send'],
  admin: ALL_TENANT.filter((p) => p !== 'ministry:send'),
  head: ['students:read', 'news:read', 'students:write', 'staff:read', 'staff:write', 'schedule:read', 'schedule:validate', 'lessons:read', 'lessons:visa',
    'grades:read', 'grades:write', 'absences:read', 'absences:write', 'absences:validate', 'oaa:read', 'ministry:send', 'billing:read',
    'ai:use', 'locker:read', 'locker:write', 'predictive:read', 'messages:all', 'news:write', 'notify:send', 'oaa:write', 'oaa:configure', 'games:create', 'games:read'],
  teacher: ['students:read', 'news:read', 'schedule:read', 'lessons:read', 'lessons:write', 'grades:read', 'grades:write', 'absences:read', 'absences:write', 'oaa:read',
    'ai:use', 'predictive:read', 'messages:scoped', 'games:create', 'games:read', 'oaa:write'],
  education_assistant: ['students:read', 'news:read', 'schedule:read', 'lessons:read', 'absences:read', 'absences:write', 'absences:validate', 'messages:scoped'],
  accountant: ['billing:read', 'news:read', 'billing:write', 'messages:scoped'],
  student: ['absences:read', 'news:read', 'schedule:read', 'lessons:read', 'grades:read', 'oaa:read', 'billing:pay', 'absences:justify', 'messages:scoped', 'games:play', 'games:read', 'gps:consent', 'locker:read', 'ai:tutor'],
  guardian: ['absences:read', 'news:read', 'schedule:read', 'lessons:read', 'grades:read', 'oaa:read', 'billing:pay', 'absences:justify', 'messages:scoped', 'gps:read', 'gps:consent', 'locker:read', 'games:read'],
  visitor: ['public:read'],
  inspector: ['lessons:read'],
};

export interface Principal {
  id: string;
  roles: RoleCode[];
  tenantId?: string | null;
  isRoot?: boolean;
  classIds?: string[];     // teacher: classes taught
  childIds?: string[];     // guardian: linked students
  studentId?: string;      // student: own student id
  inspectorUntil?: string; // inspector: end of the time-limited access (ISO date)
}
export interface Resource {
  tenantId?: string; classId?: string; studentId?: string;
  consentGranted?: boolean; // GPS consent for the student
}
export interface Decision { allowed: boolean; reason: string; auditRootBypass?: boolean }

const TEACHER_SCOPED = new Set(['students:read', 'lessons:write', 'grades:read', 'grades:write', 'absences:read', 'absences:write', 'oaa:read', 'oaa:write', 'games:read', 'games:create', 'predictive:read']);
const OWN_ONLY_STUDENT = new Set(['absences:read', 'grades:read', 'oaa:read', 'absences:justify', 'locker:read', 'gps:consent', 'billing:pay', 'schedule:read', 'lessons:read', 'games:read']);
const CHILD_ONLY_GUARDIAN = new Set(['absences:read', 'grades:read', 'oaa:read', 'absences:justify', 'locker:read', 'gps:read', 'gps:consent', 'billing:pay', 'schedule:read', 'lessons:read', 'games:read']);

function roleHas(role: RoleCode, perm: string): boolean {
  const list = ROLE_PERMISSIONS[role] ?? [];
  return list.includes('*') || list.includes(perm);
}

/** RBAC (role grants permission) + ABAC (tenant, class, parent-child link, consent). */
export function can(p: Principal, permission: string, r: Resource = {}, now: number = Date.now()): Decision {
  if (!p.roles.length) return { allowed: false, reason: 'no role' };
  if (p.isRoot && p.roles.includes('root_super_admin')) return { allowed: true, reason: 'root', auditRootBypass: true };
  if (r.tenantId && p.tenantId !== r.tenantId) return { allowed: false, reason: 'cross-tenant access denied' };
  const granting = p.roles.filter((role) => role !== 'root_super_admin' && roleHas(role, permission));
  if (!granting.length) return { allowed: false, reason: 'permission not granted to role' };

  // The most permissive granting role that passes its ABAC rule wins.
  for (const role of granting) {
    if (role === 'inspector' && !(p.inspectorUntil && Date.parse(p.inspectorUntil) > now)) continue; // time-limited access
    if (role === 'teacher' && TEACHER_SCOPED.has(permission) && !(r.classId && p.classIds?.includes(r.classId))) continue;
    if (role === 'student' && OWN_ONLY_STUDENT.has(permission) && r.studentId && r.studentId !== p.studentId) continue;
    if (role === 'guardian' && CHILD_ONLY_GUARDIAN.has(permission) && !(r.studentId && p.childIds?.includes(r.studentId))) continue;
    if (permission === 'gps:read' && r.consentGranted !== true) continue;
    return { allowed: true, reason: `granted by ${role}` };
  }
  return { allowed: false, reason: 'attribute rule failed (scope or consent)' };
}
