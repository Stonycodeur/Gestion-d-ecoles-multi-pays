import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.principal) throw new BadRequestException('authentication required'); return { slug: r.tenantSlug as string, p: r.principal }; };
const tenant = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

@Controller('marketplace')
export class MarketplaceController {
  constructor(private readonly svc: MarketplaceService) {}
  @Get('modules') catalogue(@Req() r: CoreRequest) { const { slug, p } = tenant(r); return this.svc.catalogue(slug, p); }
  @Get('modules/:name') detail(@Req() r: CoreRequest, @Param('name') n: string) { const { slug, p } = tenant(r); return this.svc.detail(slug, p, n); }
  @Post('modules/:name/install') install(@Req() r: CoreRequest, @Param('name') n: string, @Body() b: any) { const { slug, p } = tenant(r); return this.svc.install(slug, p, n, b); }
  @Post('modules/:name/update') update(@Req() r: CoreRequest, @Param('name') n: string, @Body() b: any) { const { slug, p } = tenant(r); return this.svc.update(slug, p, n, b); }
  @Post('modules/:name/uninstall') uninstall(@Req() r: CoreRequest, @Param('name') n: string) { const { slug, p } = tenant(r); return this.svc.uninstall(slug, p, n); }
  @Post('modules/:name/reviews') review(@Req() r: CoreRequest, @Param('name') n: string, @Body() b: any) { const { slug, p } = tenant(r); return this.svc.review(slug, p, n, b); }
  @Get('installs') installs(@Req() r: CoreRequest) { const { slug, p } = tenant(r); return this.svc.installs(slug, p); }
  @Post('submissions') submit(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = tenant(r); return this.svc.submit(slug, p, b); }
  @Get('submissions') submissions(@Req() r: CoreRequest, @Query('status') s?: string) { return this.svc.submissions(need(r).p, s); }
  @Post('submissions/:id/decision') decide(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { return this.svc.decide(need(r).p, id, b); }
  @Post('modules/:name/withdraw') withdraw(@Req() r: CoreRequest, @Param('name') n: string) { return this.svc.withdraw(need(r).p, n); }
}
