import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { resolveTenant } from '@ecolemanager/shared';
import { AuthService } from './auth.service';
import { AuditService } from './audit.service';
import { can } from '@ecolemanager/shared';
import { MinistryService } from '../ministry/ministry.service';
import { PermissionsService } from './permissions.service';
import { SchoolUsersService } from '../school/school-users.service';
import type { CoreRequest } from './request-context';

export const PUBLIC = 'isPublic';
export const Public = () => SetMetadata(PUBLIC, true);
export const PERMISSION = 'requiredPermission';
export const RequirePermission = (p: string) => SetMetadata(PERMISSION, p);

/** Global guard: authenticates, binds the tenant (token vs subdomain must agree), then enforces @RequirePermission via RBAC+ABAC. */
@Injectable()
export class CoreGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService, private readonly audit: AuditService, private readonly ministry: MinistryService, private readonly perms: PermissionsService, private readonly schoolUsers: SchoolUsersService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<CoreRequest>();
    const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!m) throw new UnauthorizedException('missing bearer token');
    const { principal, tenantSlug } = await this.auth.verify(m[1]);

    if (!principal.isRoot) {
      const r = resolveTenant({ host: req.headers.host, baseDomain: process.env.BASE_DOMAIN, tokenTenant: tenantSlug });
      if ('error' in r) throw new ForbiddenException(r.error);
      if (req.tenantSlug && req.tenantSlug !== r.slug) throw new ForbiddenException('tenant mismatch');
      req.tenantSlug = r.slug;
    }
    if (principal.isRoot) {
      // The root super-admin has no school of its own: it works inside any school by naming it in X-Tenant. Mutations are audited.
      const h = req.header('x-tenant');
      if (h && /^[a-z0-9_]{2,40}$/.test(h)) {
        req.tenantSlug = h;
        if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') await this.audit.log({ actorId: principal.id, tenant: h, action: 'root.tenant_context', details: { method: req.method, path: req.path } });
      }
    }
    await this.perms.refresh();   // role and personal rights edited by an administrator apply within seconds
    let principal2 = principal;
    if (!principal.isRoot) {
      this.perms.applyTo(principal, req.tenantSlug);
      const fl = this.perms.flagsOf(principal.id, req.tenantSlug);
      if (fl?.locked) throw new ForbiddenException('account locked: contact your school administrator');
      if (fl?.must_change_password && !/^\/(me|profile|auth)(\/|$)/.test(req.path)) throw new ForbiddenException('password_change_required');
    }
    const as = req.header('x-view-as');
    if (as && req.tenantSlug) {
      // Read-only "view as": an administrator looks through the eyes of a lower-ranked person of the same school. Every such call is audited; nothing can be changed.
      if (!/^[0-9a-f-]{36}$/i.test(as)) throw new ForbiddenException('invalid view-as target');
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new ForbiddenException('view-as is read-only');
      if (!can(principal, 'users:manage', { tenantId: req.tenantSlug }).allowed) throw new ForbiddenException('view-as needs the right to manage users');
      principal2 = await this.schoolUsers.viewAsPrincipal(req.tenantSlug, principal, as);
      this.perms.applyTo(principal2, req.tenantSlug);
      await this.audit.log({ actorId: principal.id, tenant: req.tenantSlug, action: 'user.view_as', entity: 'user', entityId: as, details: { path: req.path } });
    }
    if (principal2 !== principal) { principal.roles = principal2.roles; principal.classIds = principal2.classIds; principal.childIds = principal2.childIds; principal.studentId = principal2.studentId; principal.extraGrant = principal2.extraGrant; principal.extraRevoke = principal2.extraRevoke; principal.impersonatedBy = principal2.impersonatedBy; principal.id = principal2.id; principal.isRoot = false; }
    if (!principal.isRoot && principal.roles.includes('inspector') && req.tenantSlug) {
      // time-limited inspector access: checked against the directory on every call, so revocation is immediate
      const until = await this.ministry.inspectorUntil(req.tenantSlug, principal.id);
      if (!until || until.getTime() <= Date.now()) throw new ForbiddenException('inspector access expired or revoked');
      principal.inspectorUntil = until.toISOString();
    }
    req.principal = principal;

    const perm = this.reflector.getAllAndOverride<string | undefined>(PERMISSION, [ctx.getHandler(), ctx.getClass()]);
    if (!perm) return true;
    const d = can(principal, perm, { tenantId: req.tenantSlug });
    if (d.auditRootBypass) await this.audit.log({ actorId: principal.impersonatedBy ?? principal.id, tenant: req.tenantSlug, action: 'root.bypass', details: { permission: perm, path: req.path } });
    if (!d.allowed) {
      await this.audit.log({ actorId: principal.impersonatedBy ?? principal.id, tenant: req.tenantSlug, action: 'access.denied', details: { permission: perm, reason: d.reason } });
      throw new ForbiddenException(d.reason);
    }
    return true;
  }
}
