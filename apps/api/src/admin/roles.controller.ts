import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { PermissionsService } from '../core/permissions.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

/** Roles and permissions matrix (root super-admin). */
@Controller('roles')
export class RolesController {
  constructor(private readonly perms: PermissionsService) {}
  @Get('matrix') @RequirePermission('tenants:manage') matrix() { return this.perms.matrix(); }
  @Put(':code/permissions') @RequirePermission('tenants:manage') set(@Req() r: CoreRequest, @Param('code') code: string, @Body() b: any) { return this.perms.setRole(r.principal!.id, code, b?.permissions); }
  @Post(':code/reset') @RequirePermission('tenants:manage') reset(@Req() r: CoreRequest, @Param('code') code: string) { return this.perms.reset(r.principal!.id, code); }
}
