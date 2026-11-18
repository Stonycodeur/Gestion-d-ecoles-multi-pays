import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { resolveTenant } from '@ecolemanager/shared';
import { AuthService } from './auth.service';
import { AuditService } from './audit.service';
import { can } from '@ecolemanager/shared';
import type { CoreRequest } from './request-context';

export const PUBLIC = 'isPublic';
export const Public = () => SetMetadata(PUBLIC, true);
export const PERMISSION = 'requiredPermission';
export const RequirePermission = (p: string) => SetMetadata(PERMISSION, p);

/** Global guard: authenticates, binds the tenant (token vs subdomain must agree), then enforces @RequirePermission via RBAC+ABAC. */
@Injectable()
export class CoreGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService, private readonly audit: AuditService) {}

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
    req.principal = principal;

    const perm = this.reflector.getAllAndOverride<string | undefined>(PERMISSION, [ctx.getHandler(), ctx.getClass()]);
    if (!perm) return true;
    const d = can(principal, perm, { tenantId: req.tenantSlug });
    if (d.auditRootBypass) await this.audit.log({ actorId: principal.id, tenant: req.tenantSlug, action: 'root.bypass', details: { permission: perm, path: req.path } });
    if (!d.allowed) {
      await this.audit.log({ actorId: principal.id, tenant: req.tenantSlug, action: 'access.denied', details: { permission: perm, reason: d.reason } });
      throw new ForbiddenException(d.reason);
    }
    return true;
  }
}
