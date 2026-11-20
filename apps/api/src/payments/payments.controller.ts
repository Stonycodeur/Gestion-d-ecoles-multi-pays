import { BadRequestException, Body, Controller, Get, Headers, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PaymentsService } from './payments.service';
import { Public } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (r: CoreRequest) => { if (!r.tenantSlug || !r.principal) throw new BadRequestException('tenant required'); return { slug: r.tenantSlug, p: r.principal }; };

@Controller()
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}
  @Get('payments/config') config(@Req() r: CoreRequest) { return this.svc.config(need(r).slug); }
  @Post('fee-plans') createPlan(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createFeePlan(slug, p, b); }
  @Get('fee-plans') plans(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.listFeePlans(slug, p); }
  @Post('invoices') issue(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.issueInvoice(slug, p, b); }
  @Get('invoices') list(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.listInvoices(slug, p); }
  @Get('students/:id/invoices') forStudent(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.studentInvoices(slug, p, id); }
  @Get('invoices/:id') one(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.getInvoice(slug, p, id); }
  @Post('invoices/:id/cancel') cancel(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.cancelInvoice(slug, p, id); }
  @Get('invoices/:id/cash-qr') qr(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.cashQr(slug, p, id); }
  @Post('invoices/:id/pay') pay(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any, @Headers('idempotency-key') key?: string) { const { slug, p } = need(r); return this.svc.pay(slug, p, id, b, key); }
  @Post('payments/manual') manual(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.recordManual(slug, p, b); }
  @Post('payments/:id/sandbox-confirm') sandbox(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.sandboxConfirm(slug, p, id, b); }
  @Get('payments/:id/receipt') async receipt(@Req() r: CoreRequest, @Param('id') id: string, @Res() res: Response, @Query('locale') l?: string) {
    const { slug, p } = need(r); const pdf = await this.svc.receipt(slug, p, id, l);
    res.setHeader('content-type', 'application/pdf'); res.send(pdf);
  }
  /** Public endpoint called by the providers; authenticity = signature over the raw body. The school is in the path (providers cannot send our headers). */
  @Public() @Post('payments/webhooks/:provider/:school')
  webhook(@Req() req: any, @Param('provider') provider: string, @Param('school') school: string, @Headers() headers: Record<string, string>) {
    const raw: string = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    return this.svc.handleWebhook(school, provider, raw, headers);
  }
  @Post('billing/reminders/run') reminders(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.runReminders(slug, p, b); }
  @Post('billing/reconcile') reconcile(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.reconcileStatement(slug, p, b); }
  @Get('billing/stats') stats(@Req() r: CoreRequest) { const { slug, p } = need(r); return this.svc.stats(slug, p); }
}
