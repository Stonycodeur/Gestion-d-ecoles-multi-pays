import { BadRequestException, Controller, Get, Param, Post, Req, Body } from '@nestjs/common';
import { ModulesService } from './modules.service';
import { RequirePermission } from '../core/auth.guard';
import { AuditService } from '../core/audit.service';
import type { CoreRequest } from '../core/request-context';

@Controller('modules')
export class ModulesController {
  constructor(private readonly svc: ModulesService, private readonly audit: AuditService) {}

  /** Mobile/web discover the active modules of the tenant and show/hide screens accordingly. */
  @Get('active')
  active(@Req() req: CoreRequest) {
    return this.svc.registry.activeFor(this.tenant(req));
  }

  @Get() @RequirePermission('modules:manage')
  catalog() {
    return { modules: this.svc.registry.list().map((m) => ({ name: m.name, version: m.version, description: m.description, permissions: m.permissions })), loadErrors: this.svc.loadErrors };
  }

  @Post(':name/enable') @RequirePermission('modules:manage')
  async enable(@Param('name') name: string, @Body() body: { config?: Record<string, unknown> }, @Req() req: CoreRequest) {
    const t = this.tenant(req);
    if (!this.svc.registry.has(name)) throw new BadRequestException('unknown module');
    this.svc.registry.enable(t, name, body?.config ?? {});
    await this.audit.log({ actorId: req.principal?.id, tenant: t, action: 'module.enable', entity: 'module', entityId: name });
    return { module: name, enabled: true };
  }

  @Post(':name/disable') @RequirePermission('modules:manage')
  async disable(@Param('name') name: string, @Req() req: CoreRequest) {
    const t = this.tenant(req);
    if (!this.svc.registry.has(name)) throw new BadRequestException('unknown module');
    this.svc.registry.disable(t, name);
    await this.audit.log({ actorId: req.principal?.id, tenant: t, action: 'module.disable', entity: 'module', entityId: name });
    return { module: name, enabled: false };
  }

  private tenant(req: CoreRequest): string {
    if (!req.tenantSlug) throw new BadRequestException('tenant required');
    return req.tenantSlug;
  }
}
