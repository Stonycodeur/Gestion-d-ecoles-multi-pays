import { BadRequestException, Body, Controller, Delete, Param, Post, Req } from '@nestjs/common';
import { AccountService } from './account.service';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

@Controller('account')
export class AccountController {
  constructor(private readonly svc: AccountService) {}
  @Delete() deleteSelf(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.deleteSelf(slug, p, b); }
  @Post('erasure-request/:studentId') request(@Req() r: CoreRequest, @Param('studentId') id: string) { const { slug, p } = need(r); return this.svc.requestErasure(slug, p, id); }
  @Post('erase-student/:studentId') erase(@Req() r: CoreRequest, @Param('studentId') id: string) { const { slug, p } = need(r); return this.svc.eraseStudent(slug, p, id); }
}
