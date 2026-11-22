import { BadRequestException, Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { OrientationService } from './orientation.service';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

@Controller('orientation')
export class OrientationController {
  constructor(private readonly svc: OrientationService) {}
  @Get('paths') paths(@Req() r: CoreRequest, @Query('kind') kind?: string) { const { slug, p } = need(r); return this.svc.listPaths(slug, p, kind); }
  @Post('paths') createPath(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createPath(slug, p, b); }
  @Get('internships') internships(@Req() r: CoreRequest, @Query('status') s?: string) { const { slug, p } = need(r); return this.svc.listInternships(slug, p, s); }
  @Post('internships') request(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.requestInternship(slug, p, b); }
  @Post('internships/:id/transition') transition(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.transition(slug, p, id, b); }
  @Post('internships/:id/report') report(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.submitReport(slug, p, id, b); }
  @Get('exam/fiche/:studentId') fiche(@Req() r: CoreRequest, @Param('studentId') id: string, @Query('school_year') y?: string) { const { slug, p } = need(r); return this.svc.fiche(slug, p, id, y); }
  @Put('exam/marks') marks(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.saveExamMarks(slug, p, b); }
  @Post('exam/outcome') outcome(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.recordOutcome(slug, p, b); }
}
