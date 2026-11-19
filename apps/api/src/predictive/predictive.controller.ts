import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { PredictiveService } from './predictive.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

@Controller('predictive')
export class PredictiveController {
  constructor(private readonly svc: PredictiveService) {}
  @Post('run') run(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.run(slug, p, b?.class_id); }
  @Get('dashboard') dashboard(@Req() r: CoreRequest, @Query('class_id') c?: string) { const { slug, p } = need(r); return this.svc.dashboard(slug, p, c); }
  @Get('students/:id') student(@Req() r: CoreRequest, @Param('id') id: string, @Query('lang') l?: string) { const { slug, p } = need(r); return this.svc.student(slug, p, id, l === 'en' ? 'en' : 'fr'); }
  @Post('predictions/:id/feedback') feedback(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.feedback(slug, p, id, b); }
  @Get('bias') @RequirePermission('predictive:read') bias(@Req() r: CoreRequest) { return this.svc.bias(need(r).slug); }
}
