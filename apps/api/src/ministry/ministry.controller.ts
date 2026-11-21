import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query, Req, Res } from '@nestjs/common';
import { MinistryService } from './ministry.service';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };
const MIME = { csv: 'text/csv; charset=utf-8', json: 'application/json', xml: 'application/xml' } as const;

@Controller('ministry')
export class MinistryController {
  constructor(private readonly svc: MinistryService) {}
  @Get('connectors') connectors(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.connectors(slug, p); }
  @Get('transmissions') list(@Req() r: CoreRequest, @Query('status') s?: string) { const { slug, p } = need(r); return this.svc.list(slug, p, s); }
  @Post('transmissions') prepare(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.prepare(slug, p, b); }
  @Get('transmissions/:id') get(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.get(slug, p, id); }
  @Get('transmissions/:id/preview') async preview(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); const t: any = await this.svc.get(slug, p, id, true); return { checksum: t.checksum, format: t.format, rows_count: t.rows_count, payload: t.payload }; }
  @Get('transmissions/:id/file') @Header('Cache-Control', 'no-store')
  async file(@Req() r: CoreRequest, @Param('id') id: string, @Res() res: any) { const { slug, p } = need(r); const t = await this.svc.file(slug, p, id); res.set({ 'Content-Type': MIME[t.format], 'X-Checksum-SHA256': t.checksum, 'Content-Disposition': `attachment; filename="${t.dataset}_${t.school_year}.${t.format}"` }).send(t.payload); }
  @Post('transmissions/:id/validate') validate(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.validate(slug, p, id, b); }
  @Post('transmissions/:id/send') send(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.send(slug, p, id); }
  @Post('transmissions/:id/mark-sent') mark(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.markSent(slug, p, id, b); }
  @Post('transmissions/:id/cancel') cancel(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.cancel(slug, p, id); }
  @Post('run-due') runDue(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.runDue(slug, p); }

  @Get('inspectors') inspectors(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.inspectors(slug, p); }
  @Post('inspectors') createInspector(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createInspector(slug, p, b); }
  @Post('inspectors/:id/revoke') revoke(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.revokeInspector(slug, p, id); }
}
