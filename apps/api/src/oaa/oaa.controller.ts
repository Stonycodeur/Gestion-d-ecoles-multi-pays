import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { OaaService } from './oaa.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

@Controller()
export class OaaController {
  constructor(private readonly svc: OaaService) {}
  @Get('students/:id/oaa') student(@Req() r: CoreRequest, @Param('id') id: string, @Query('locale') l?: string) { const { slug, p } = need(r); return this.svc.studentOaa(slug, p, id, l); }
  @Get('classes/:id/oaa') cls(@Req() r: CoreRequest, @Param('id') id: string, @Query('locale') l?: string) { const { slug, p } = need(r); return this.svc.classOaa(slug, p, id, l); }
  @Post('students/:id/oaa/assessments') assess(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.addAssessment(slug, p, id, b); }
  @Get('oaa/config') @RequirePermission('oaa:read') config(@Req() r: CoreRequest) { return this.svc.getConfig(need(r).slug); }
  @Put('oaa/config') @RequirePermission('oaa:configure') setConfig(@Req() r: CoreRequest, @Body() b: any) { return this.svc.setConfig(need(r).slug, b); }
  @Post('oaa/recompute') @RequirePermission('oaa:configure') recompute(@Req() r: CoreRequest, @Body() b: any) { return this.svc.recomputeAll(need(r).slug, b?.class_id); }
  @Get('oaa/penalties') @RequirePermission('oaa:configure') penalties(@Req() r: CoreRequest, @Query('status') s?: string) { return this.svc.listPenalties(need(r).slug, s); }
  @Post('oaa/penalties/:id/decision') @RequirePermission('oaa:configure') decide(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.decidePenalty(slug, p, id, b?.decision); }
}
