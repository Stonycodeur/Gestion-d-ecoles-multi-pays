import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import { resolveTenant } from '@ecolemanager/shared';
import type { CoreRequest } from './request-context';

/** Resolves tenant from subdomain (or X-Tenant when ALLOW_TENANT_HEADER=true, for the mobile school code). The auth guard re-checks it against the token. */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  use(req: CoreRequest, _res: Response, next: NextFunction) {
    const r = resolveTenant({
      host: req.headers.host, baseDomain: process.env.BASE_DOMAIN,
      headerTenant: req.header('x-tenant') ?? undefined, allowHeader: process.env.ALLOW_TENANT_HEADER === 'true',
    });
    if ('slug' in r) req.tenantSlug = r.slug;
    else if (r.error !== 'tenant not resolved') throw new ForbiddenException(r.error);
    next();
  }
}
