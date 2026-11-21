import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { VisitorService } from './visitor.service';
import { Public } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };
const ip = (r: CoreRequest) => r.ip ?? r.socket?.remoteAddress ?? 'unknown';

/** Public space: the school is in the path (visitors have no token, no subdomain guarantee). */
@Controller('public/:school')
export class PublicController {
  constructor(private readonly svc: VisitorService) {}
  @Public() @Get('site') site(@Param('school') s: string) { return this.svc.site(s); }
  @Public() @Get('news') news(@Param('school') s: string) { return this.svc.publicNews(s); }
  @Public() @Get('events') events(@Param('school') s: string) { return this.svc.publicEvents(s); }
  @Public() @Get('stats') stats(@Param('school') s: string) { return this.svc.stats(s); }
  @Public() @Get('levels') levels(@Param('school') s: string) { return this.svc.levels(s); }
  @Public() @Post('apply') apply(@Param('school') s: string, @Req() r: CoreRequest, @Body() b: any) { return this.svc.apply(s, ip(r), b); }
  @Public() @Post('contact') contact(@Param('school') s: string, @Req() r: CoreRequest, @Body() b: any) { return this.svc.contact(s, ip(r), b); }
}

@Controller('visitor')
export class VisitorAdminController {
  constructor(private readonly svc: VisitorService) {}
  @Put('site/:key') site(@Req() r: CoreRequest, @Param('key') k: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.putSite(slug, p, k, b?.value); }
  @Get('applications') apps(@Req() r: CoreRequest, @Query('status') s?: string) { const { slug, p } = need(r); return this.svc.applications(slug, p, s); }
  @Post('applications/:id/decision') decide(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.decide(slug, p, id, b); }
  @Get('contact') contact(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.contactMessages(slug, p); }
  @Post('contact/:id/handled') handled(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.handleContact(slug, p, id); }
}
