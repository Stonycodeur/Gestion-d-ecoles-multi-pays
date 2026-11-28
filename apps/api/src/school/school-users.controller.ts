import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Req } from '@nestjs/common';
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
  @Delete(':id') @RequirePermission('users:manage') trash(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.trash(slug, p, id); }
}
