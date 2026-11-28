import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';
import { SchoolUsersService } from './school-users.service';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

/** Accounts of the school the caller manages (needs the `users:manage` right). */
@Controller('school/users')
export class SchoolUsersController {
  constructor(private readonly svc: SchoolUsersService) {}
  @Get() @RequirePermission('users:manage') list(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.list(slug, p); }
  @Post() @RequirePermission('users:manage') create(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.create(slug, p, b); }
  @Get(':id') @RequirePermission('users:manage') detail(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.detail(slug, p, id); }
  @Post(':id/active') @RequirePermission('users:manage') active(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.setActive(slug, p, id, b?.active); }
  @Post(':id/password') @RequirePermission('users:manage') password(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.resetPassword(slug, p, id, b); }
  @Post(':id/close-sessions') @RequirePermission('users:manage') close(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.closeSessions(slug, p, id); }
  @Get(':id/rights') @RequirePermission('users:manage') rights(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.rights(slug, p, id); }
  @Put(':id/rights') @RequirePermission('users:manage') setRights(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.setRights(slug, p, id, b); }
  @Post(':id/lock') @RequirePermission('users:manage') lock(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.setLocked(slug, p, id, b?.locked, b?.reason); }
  @Post(':id/force-password-change') @RequirePermission('users:manage') force(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.forcePasswordChange(slug, p, id, b?.on); }
  @Get(':id/history') @RequirePermission('users:manage') history(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.history(slug, p, id); }
  @Delete(':id') @RequirePermission('users:manage') trash(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.trash(slug, p, id); }
}

/** The signed-in person tells the API they changed their password (lifts a forced change once the identity provider confirms it). */
@Controller('me')
export class MePasswordController {
  constructor(private readonly svc: SchoolUsersService) {}
  @Post('password-changed') changed(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.passwordChanged(slug, p); }
}
