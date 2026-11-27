import { Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { TrashService } from './trash.service';
import { TenantsService } from '../school/tenants.service';
import { AccountsAdminService } from './accounts.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

/** Trash and restoration (root super-admin): schools, accounts and geography. */
@Controller()
export class TrashController {
  constructor(private readonly trash: TrashService, private readonly tenants: TenantsService, private readonly accounts: AccountsAdminService) {}

  @Get('trash') @RequirePermission('tenants:manage') list(@Query('kind') kind?: string) { return this.trash.list(kind); }
  @Post('trash/:kind/:id/restore') @RequirePermission('tenants:manage') restore(@Req() r: CoreRequest, @Param('kind') k: string, @Param('id') id: string) { return this.trash.restore(r.principal!.id, k, id); }
  @Delete('trash/:kind/:id') @RequirePermission('tenants:manage') purge(@Req() r: CoreRequest, @Param('kind') k: string, @Param('id') id: string, @Query('confirm') c?: string) { return this.trash.purge(r.principal!.id, k, id, c); }
  @Delete('trash') @RequirePermission('tenants:manage') empty(@Req() r: CoreRequest) { return this.trash.empty(r.principal!.id); }

  // moving something to the trash
  @Delete('tenants/:slug') @RequirePermission('tenants:manage') trashSchool(@Req() r: CoreRequest, @Param('slug') slug: string) { return this.tenants.trash(r.principal!.id, slug); }
  @Delete('admin/accounts/:id') @RequirePermission('tenants:manage') trashAccount(@Req() r: CoreRequest, @Param('id') id: string) { return this.accounts.trash(r.principal!.id, id); }
}
