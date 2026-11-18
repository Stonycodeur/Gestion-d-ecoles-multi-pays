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
