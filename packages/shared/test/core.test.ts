import { test } from 'node:test';
import assert from 'node:assert/strict';
import { satisfies, compareVersions, ModuleRegistry, validateManifest, resolveTenant, can } from '../src/index.ts';
import type { Principal, ModuleManifest } from '../src/index.ts';

test('semver ranges', () => {
  assert.equal(satisfies('2.1.0', '>=2.0.0'), true);
  assert.equal(satisfies('1.9.9', '>=2.0.0'), false);
  assert.equal(satisfies('1.4.0', '^1.2.0'), true);
  assert.equal(satisfies('2.0.0', '^1.2.0'), false);
  assert.equal(satisfies('0.1.5', '^0.1.0'), true);
  assert.equal(satisfies('0.2.0', '^0.1.0'), false);
  assert.equal(satisfies('1.5.0', '>=1.0.0 <2.0.0'), true);
  assert.equal(compareVersions('1.10.0', '1.9.0'), 1);
  assert.throws(() => satisfies('1.0.0', 'banana'));
});

const mk = (over: Partial<ModuleManifest> = {}): ModuleManifest => ({ name: 'module-demo', version: '1.0.0', core_version: '>=0.1.0', description: 'd', permissions: ['demo:read'], hooks: { onStudentCreated: 'h' }, ...over });

test('manifest validation rejects bad manifests', () => {
  assert.deepEqual(validateManifest(mk()), []);
  assert.ok(validateManifest(mk({ name: 'oaa' })).length);
  assert.ok(validateManifest(mk({ permissions: ['bad'] })).length);
  assert.ok(validateManifest(mk({ core_version: 'x' })).length);
  assert.ok(validateManifest({ ...mk(), hooks: { onNothing: 'h' } }).length);
  assert.ok(validateManifest(null).length);
});

test('registry: compat check, missing handler, activation per tenant, hook isolation', async () => {
  const reg = new ModuleRegistry('1.0.0');
  assert.throws(() => reg.register(mk({ core_version: '>=2.0.0' }), { h: () => 1 }), /requires core/);
  assert.throws(() => reg.register(mk(), {}), /missing handler/);
  reg.register(mk(), { h: () => 'A' });
  reg.register(mk({ name: 'module-bad', hooks: { onStudentCreated: 'x' } }), { x: () => { throw new Error('boom'); } });
  reg.enable('t1', 'module-demo'); reg.enable('t1', 'module-bad');
  const r = await reg.emit('t1', 'onStudentCreated', {});
  assert.equal(r.find((x) => x.module === 'module-demo')?.value, 'A');
  assert.equal(r.find((x) => x.module === 'module-bad')?.ok, false);       // failure isolated
  assert.equal((await reg.emit('t2', 'onStudentCreated', {})).length, 0);   // other tenant: nothing enabled
  assert.deepEqual(reg.activeFor('t1').map((m) => m.name).sort(), ['module-bad', 'module-demo']);
  reg.disable('t1', 'module-bad');
  assert.deepEqual(reg.activeFor('t1').map((m) => m.name), ['module-demo']);
  assert.throws(() => reg.enable('t1', 'module-unknown'));
});

test('tenant resolution', () => {
  const base = { baseDomain: 'ecolemanager.app' };
  assert.deepEqual(resolveTenant({ ...base, host: 'lycee_a.ecolemanager.app' }), { slug: 'lycee_a', source: 'subdomain' });
  assert.deepEqual(resolveTenant({ ...base, host: 'lycee-a.ecolemanager.app:443' }), { slug: 'lycee_a', source: 'subdomain' });
  assert.deepEqual(resolveTenant({ ...base, host: 'autre.ecolemanager.app', tokenTenant: 'lycee_a' }), { error: 'tenant mismatch between token and subdomain' });
  assert.deepEqual(resolveTenant({ tokenTenant: 'lycee_a' }), { slug: 'lycee_a', source: 'token' });
  assert.deepEqual(resolveTenant({ headerTenant: 'lycee_a' }), { error: 'tenant not resolved' });           // header refused by default
  assert.deepEqual(resolveTenant({ headerTenant: 'lycee_a', allowHeader: true }), { slug: 'lycee_a', source: 'header' });
  assert.ok('error' in resolveTenant({ tokenTenant: 'a;drop table' }));
});

const teacher: Principal = { id: 'u1', roles: ['teacher'], tenantId: 'T1', classIds: ['c1'] };
const guardian: Principal = { id: 'u2', roles: ['guardian'], tenantId: 'T1', childIds: ['s1'] };
const student: Principal = { id: 'u3', roles: ['student'], tenantId: 'T1', studentId: 's1' };

test('RBAC+ABAC: tenant isolation and root bypass is flagged for audit', () => {
  assert.equal(can(teacher, 'grades:write', { tenantId: 'T2', classId: 'c1' }).allowed, false);
  const root = can({ id: 'r', roles: ['root_super_admin'], isRoot: true }, 'anything:do', { tenantId: 'T2' });
  assert.equal(root.allowed, true); assert.equal(root.auditRootBypass, true);
  assert.equal(can({ id: 'x', roles: ['root_super_admin'] }, 'grades:read').allowed, false); // role without is_root flag is not root
});

test('RBAC+ABAC: teacher scoped to own classes; student/guardian to own/linked student', () => {
  assert.equal(can(teacher, 'grades:write', { tenantId: 'T1', classId: 'c1' }).allowed, true);
  assert.equal(can(teacher, 'grades:write', { tenantId: 'T1', classId: 'c2' }).allowed, false);
  assert.equal(can(teacher, 'students:write', { tenantId: 'T1' }).allowed, false);
  assert.equal(can(student, 'grades:read', { tenantId: 'T1', studentId: 's1' }).allowed, true);
  assert.equal(can(student, 'grades:read', { tenantId: 'T1', studentId: 's9' }).allowed, false);
  assert.equal(can(student, 'grades:write', { tenantId: 'T1', studentId: 's1' }).allowed, false);
  assert.equal(can(guardian, 'oaa:read', { tenantId: 'T1', studentId: 's1' }).allowed, true);
  assert.equal(can(guardian, 'oaa:read', { tenantId: 'T1', studentId: 's2' }).allowed, false);
  assert.equal(can({ id: 'v', roles: ['visitor'] }, 'grades:read').allowed, false);
});

test('GPS: guardian needs link AND consent; students cannot read GPS', () => {
  assert.equal(can(guardian, 'gps:read', { tenantId: 'T1', studentId: 's1', consentGranted: true }).allowed, true);
  assert.equal(can(guardian, 'gps:read', { tenantId: 'T1', studentId: 's1', consentGranted: false }).allowed, false);
  assert.equal(can(guardian, 'gps:read', { tenantId: 'T1', studentId: 's2', consentGranted: true }).allowed, false);
  assert.equal(can(student, 'gps:read', { tenantId: 'T1', studentId: 's1', consentGranted: true }).allowed, false);
});

test('only SA-E/admin manage modules; teacher cannot; head validates schedule', () => {
  assert.equal(can({ id: 'a', roles: ['admin'], tenantId: 'T1' }, 'modules:manage', { tenantId: 'T1' }).allowed, true);
  assert.equal(can(teacher, 'modules:manage', { tenantId: 'T1' }).allowed, false);
  assert.equal(can({ id: 'h', roles: ['head'], tenantId: 'T1' }, 'schedule:validate', { tenantId: 'T1' }).allowed, true);
});

test('pedagogy ABAC additions: teacher reads students/writes lessons only for own classes; family reads attendance of own/linked child', () => {
  assert.equal(can(teacher, 'students:read', { tenantId: 'T1', classId: 'c1' }).allowed, true);
  assert.equal(can(teacher, 'students:read', { tenantId: 'T1', classId: 'c2' }).allowed, false);
  assert.equal(can(teacher, 'lessons:write', { tenantId: 'T1', classId: 'c2' }).allowed, false);
  assert.equal(can(guardian, 'absences:read', { tenantId: 'T1', studentId: 's1' }).allowed, true);
  assert.equal(can(guardian, 'absences:read', { tenantId: 'T1', studentId: 's2' }).allowed, false);
  assert.equal(can(student, 'absences:read', { tenantId: 'T1', studentId: 's1' }).allowed, true);
  assert.equal(can(student, 'absences:read', { tenantId: 'T1', studentId: 's2' }).allowed, false);
});

test('only the head (direction) validates the timetable, not admins or school super-admins', () => {
  assert.equal(can({ id: 'a', roles: ['admin'], tenantId: 'T1' }, 'schedule:validate', { tenantId: 'T1' }).allowed, false);
  assert.equal(can({ id: 's', roles: ['tenant_super_admin'], tenantId: 'T1' }, 'schedule:validate', { tenantId: 'T1' }).allowed, false);
  assert.equal(can({ id: 'a', roles: ['admin'], tenantId: 'T1' }, 'schedule:write', { tenantId: 'T1' }).allowed, true);
});

import { effectivePermissions, setRoleOverrides, allPermissions } from '../src/index.ts';
test('role permission overrides: grant and revoke on top of the defaults, never touching root', () => {
  const teacher: Principal = { id: 't', roles: ['teacher'], tenantId: 's' };
  try {
    assert.equal(can(teacher, 'billing:read', { tenantId: 's' }).allowed, false);
    setRoleOverrides({ teacher: { grant: ['billing:read'], revoke: ['news:read'] } });
    assert.equal(can(teacher, 'billing:read', { tenantId: 's' }).allowed, true);
    assert.equal(can(teacher, 'news:read', { tenantId: 's' }).allowed, false);
    setRoleOverrides({ root_super_admin: { grant: [], revoke: ['x'] } });
    assert.deepEqual(effectivePermissions('root_super_admin'), ['*']);
  } finally { setRoleOverrides({}); }
  assert.ok(allPermissions().includes('grades:write'));
  assert.ok(!allPermissions().includes('tenants:manage'));
});

import { visibleNav, profileOf, TOGGLEABLE_PAGES } from '../src/index.ts';
const hrefs = (g: ReturnType<typeof visibleNav>) => g.flatMap((x) => x.items.map((i) => i.href));
test('navigation shows only what the role may open, per module and per level', () => {
  const all = ['module-oaa', 'module-payment', 'module-gamification', 'module-orientation', 'module-ia-predictive', 'module-gps'];
  const student = hrefs(visibleNav({ roles: ['student'], schoolType: 'lycee', modules: all }));
  assert.ok(student.includes('/grades')); assert.ok(student.includes('/payments')); assert.ok(!student.includes('/school/users')); assert.ok(!student.includes('/school/students')); assert.ok(!student.includes('/administration'));
  const accountant = hrefs(visibleNav({ roles: ['accountant'], schoolType: 'lycee', modules: all }));
  assert.deepEqual(accountant.filter((h) => h.startsWith('/school')), []); assert.ok(accountant.includes('/payments')); assert.ok(!accountant.includes('/grades'));
  const admin = hrefs(visibleNav({ roles: ['admin'], schoolType: 'lycee', modules: all }));
  assert.ok(admin.includes('/school/users') && admin.includes('/school/settings') && admin.includes('/school/students'));
  assert.ok(!hrefs(visibleNav({ roles: ['admin'], schoolType: 'lycee', modules: [] })).includes('/payments'), 'module off: page hidden');
});
test('each school level has its own pages and vocabulary', () => {
  const all = ['module-oaa', 'module-gps', 'module-gamification', 'module-ia-predictive', 'module-orientation'];
  const prim = hrefs(visibleNav({ roles: ['admin'], schoolType: 'primary', modules: all }));
  const uni = hrefs(visibleNav({ roles: ['admin'], schoolType: 'university', modules: all }));
  assert.ok(!prim.includes('/risk') && !prim.includes('/orientation')); assert.ok(uni.includes('/risk') && uni.includes('/orientation') && uni.includes('/academic')); assert.ok(!uni.includes('/gps') && !uni.includes('/play'));
  assert.equal(profileOf('university').vocabulary.student.fr, 'Étudiant'); assert.equal(profileOf('lycee').vocabulary.head.fr, 'Proviseur'); assert.equal(profileOf('primary').vocabulary.head.fr, 'Directeur');
  assert.equal(visibleNav({ roles: ['admin'], schoolType: 'university', modules: all }).flatMap((g) => g.items).find((i) => i.href === '/school/classes')!.label.fr, 'Promotions et groupes');
});
test('a school can hide a page or bring back one hidden by its level', () => {
  const m = ['module-gps', 'module-gamification'];
  assert.ok(!hrefs(visibleNav({ roles: ['admin'], schoolType: 'lycee', modules: m, hidden: ['/news'] })).includes('/news'));
  assert.ok(hrefs(visibleNav({ roles: ['admin'], schoolType: 'university', modules: m, shown: ['/gps'] })).includes('/gps'));
  assert.ok(TOGGLEABLE_PAGES.includes('/news') && !TOGGLEABLE_PAGES.includes('/notifications'));
});

import { principalHas } from '../src/index.ts';
test('personal rights: a grant opens one right, a withdrawal closes one, tenants:manage can never be given', () => {
  const stu: Principal = { id: 's', roles: ['student'], tenantId: 'a' };
  assert.equal(can(stu, 'staff:read', { tenantId: 'a' }).allowed, false);
  assert.equal(can({ ...stu, extraGrant: ['staff:read'] }, 'staff:read', { tenantId: 'a' }).allowed, true);
  assert.equal(can({ ...stu, extraGrant: ['staff:read'] }, 'staff:read', { tenantId: 'b' }).allowed, false);   // never across schools
  assert.equal(can({ ...stu, extraGrant: ['tenants:manage'] }, 'tenants:manage', { tenantId: 'a' }).allowed, false);
  const tea: Principal = { id: 't', roles: ['teacher'], tenantId: 'a' };
  assert.equal(can(tea, 'staff:read', { tenantId: 'a' }).allowed, true);
  assert.equal(can({ ...tea, extraRevoke: ['staff:read'] }, 'staff:read', { tenantId: 'a' }).allowed, false);
  assert.equal(principalHas({ ...stu, extraGrant: ['staff:read'] }, 'staff:read'), true);
  assert.equal(principalHas({ ...tea, extraRevoke: ['staff:read'] }, 'staff:read'), false);
  assert.equal(principalHas({ ...stu, extraGrant: ['tenants:manage'] }, 'tenants:manage'), false);
  const nav = visibleNav({ roles: ['student'], schoolType: 'lycee', modules: [], has: (p) => p === 'staff:read' || p === 'schedule:read' });
  assert.ok(nav.flatMap((g) => g.items).some((i) => i.href === '/school/staff'));
});
