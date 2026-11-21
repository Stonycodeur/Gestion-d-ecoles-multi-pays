import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Query, Req, Res } from '@nestjs/common';
import { PublicApiService } from './publicapi.service';
import { Public } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

/** Third-party facing endpoints: authenticated by OAuth2 access token, not by the school's user login. */
@Controller()
export class PublicApiController {
  constructor(private readonly svc: PublicApiService) {}
  @Public() @Post('oauth/token') token(@Req() r: CoreRequest, @Body() b: any) { return this.svc.token(r.ip ?? 'unknown', b); }
  @Public() @Get('public-api/docs') docs() { return this.svc.docs(); }
  @Public() @Get('v1/me') async me(@Headers('authorization') a: string | undefined, @Res({ passthrough: true }) res: any) { return this.svc.me(await this.svc.authenticate(a, res)); }
  @Public() @Get('v1/students') async students(@Headers('authorization') a: string | undefined, @Res({ passthrough: true }) res: any, @Query('limit') l?: string, @Query('offset') o?: string) { return this.svc.students(await this.svc.authenticate(a, res), l, o); }
  @Public() @Get('v1/classes') async classes(@Headers('authorization') a: string | undefined, @Res({ passthrough: true }) res: any) { return this.svc.classes(await this.svc.authenticate(a, res)); }
  @Public() @Get('v1/news') async news(@Headers('authorization') a: string | undefined, @Res({ passthrough: true }) res: any, @Query('limit') l?: string) { return this.svc.news(await this.svc.authenticate(a, res), l); }
  @Public() @Get('v1/grades') async grades(@Headers('authorization') a: string | undefined, @Res({ passthrough: true }) res: any, @Query('student_id') s?: string) { return this.svc.grades(await this.svc.authenticate(a, res), s); }
  @Public() @Post('v1/graphql') async graphql(@Headers('authorization') a: string | undefined, @Res({ passthrough: true }) res: any, @Body() b: any) { return this.svc.graphql(await this.svc.authenticate(a, res), b); }
}

/** School administration of API clients and outgoing webhooks. */
@Controller('api-admin')
export class ApiAdminController {
  constructor(private readonly svc: PublicApiService) {}
  @Get('clients') clients(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.clients(slug, p); }
  @Post('clients') create(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createClient(slug, p, b); }
  @Post('clients/:id/revoke') revoke(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.revokeClient(slug, p, id); }
  @Get('webhooks') hooks(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.webhooksList(slug, p); }
  @Post('webhooks') createHook(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createWebhook(slug, p, b); }
  @Delete('webhooks/:id') delHook(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.deleteWebhook(slug, p, id); }
  @Post('webhooks/:id/test') test(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.testWebhook(slug, p, id); }
  @Get('deliveries') deliveries(@Req() r: CoreRequest, @Query('status') s?: string) { const { slug, p } = need(r); return this.svc.deliveries(slug, p, s); }
  @Post('deliveries/retry') retry(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.retry(slug, p); }
}
