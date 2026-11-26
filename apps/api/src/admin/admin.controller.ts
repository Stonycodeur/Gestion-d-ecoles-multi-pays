import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { AccountsAdminService, CREATABLE_ROLES } from './accounts.service';
import { TenantsService } from '../school/tenants.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

/** Root console (platform-wide, no school context). 'tenants:manage' is granted to the root super-admin only. */
@Controller('admin')
export class AdminController {
  constructor(private readonly accounts: AccountsAdminService, private readonly tenants: TenantsService) {}

  @Get('overview') @RequirePermission('tenants:manage')
  overview() { return this.tenants.overview(); }

  @Get('roles') @RequirePermission('tenants:manage')
  roles() { return CREATABLE_ROLES; }

  @Get('accounts') @RequirePermission('tenants:manage')
  list(@Query('school') school?: string) { return this.accounts.list(school || undefined); }

  @Post('accounts') @RequirePermission('tenants:manage')
  create(@Req() r: CoreRequest, @Body() b: any) { return this.accounts.create(r.principal!.id, b); }

  @Post('accounts/:id/reset-password') @RequirePermission('tenants:manage')
  reset(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { return this.accounts.resetPassword(r.principal!.id, id, b); }

  @Patch('accounts/:id') @RequirePermission('tenants:manage')
  setActive(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { return this.accounts.setActive(r.principal!.id, id, b?.active); }
}
