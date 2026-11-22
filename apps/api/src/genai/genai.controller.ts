import { BadRequestException, Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { GenAiService } from './genai.service';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

@Controller('ai')
export class GenAiController {
  constructor(private readonly svc: GenAiService) {}
  @Get('status') status(@Req() r: CoreRequest) { return this.svc.status(need(r).slug); }
  @Post('assist') assist(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.assist(slug, p, b); }
  @Post('qcm/save') save(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.saveQcm(slug, p, b); }
  @Get('proposals') proposals(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.proposals(slug, p); }
  @Post('proposals/:id/decision') decide(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.decide(slug, p, id, b); }
  @Get('usage') usage(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.usage(slug, p); }
}
