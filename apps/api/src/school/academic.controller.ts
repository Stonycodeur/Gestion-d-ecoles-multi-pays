import { BadRequestException, Body, Controller, Get, Header, Param, Patch, Post, Put, Query, Req, StreamableFile } from '@nestjs/common';
import { AcademicService } from './academic.service';
import { TenantsService } from './tenants.service';
import { PedagogyService } from '../pedagogy/pedagogy.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (req: CoreRequest) => {
  if (!req.tenantSlug || !req.principal) throw new BadRequestException('tenant required');
  return { slug: req.tenantSlug, p: req.principal };
};
const file = (f: { filename: string; contentType: string; data: Buffer }) => new StreamableFile(f.data, { type: f.contentType, disposition: `attachment; filename="${f.filename.replace(/"/g, '')}"` });

@Controller()
export class AcademicController {
  constructor(private readonly svc: AcademicService, private readonly ped: PedagogyService, private readonly tenants: TenantsService) {}
  private async student(r: CoreRequest, id: string, perm: string) {
    const { slug, p } = need(r);
    const st = await this.ped.getStudent(slug, id);
    this.ped.authorize(p, slug, perm, { studentId: st.id, classId: st.class_id ?? undefined });
    return slug;
  }

  // competencies
  @Post('competencies') createCompetency(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createCompetency(slug, p, b); }
  @Get('competencies') @RequirePermission('schedule:read') competencies(@Req() r: CoreRequest, @Query('subject_id') s?: string) { return this.svc.listCompetencies(need(r).slug, s); }
  @Put('competency-assessments') assess(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.assessCompetencies(slug, p, b); }
  @Get('students/:id/competencies')
  async studentCompetencies(@Req() r: CoreRequest, @Param('id') id: string, @Query('period') period: string) { return this.svc.studentCompetencies(await this.student(r, id, 'grades:read'), id, period); }

  // university
  @Post('course-units') createUnit(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createUnit(slug, p, b); }
  @Get('course-units') @RequirePermission('schedule:read') units(@Req() r: CoreRequest) { return this.svc.listUnits(need(r).slug); }
  @Put('unit-results') unitResults(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.enterUnitResults(slug, p, b); }
  @Get('students/:id/transcript')
  async transcript(@Req() r: CoreRequest, @Param('id') id: string, @Query('school_year') y: string, @Query('locale') l?: string) { return this.svc.transcript(await this.student(r, id, 'grades:read'), id, y, l); }
  @Get('students/:id/transcript.pdf') @Header('Content-Type', 'application/pdf')
  async transcriptPdf(@Req() r: CoreRequest, @Param('id') id: string, @Query('school_year') y: string, @Query('locale') l?: string) { return new StreamableFile(await this.svc.transcriptPdf(await this.student(r, id, 'grades:read'), id, y, l)); }

  // timetable month view and PDF
  @Get('timetable/month')
  month(@Req() r: CoreRequest, @Query('month') month: string, @Query('student_id') student_id?: string, @Query('class_id') class_id?: string, @Query('mine') mine?: string) {
    const { slug, p } = need(r); return this.svc.timetableMonth(slug, p, month, { student_id, class_id, mine });
  }
  @Get('timetable.pdf') @Header('Content-Type', 'application/pdf')
  async timetablePdf(@Req() r: CoreRequest, @Query('student_id') student_id?: string, @Query('class_id') class_id?: string, @Query('mine') mine?: string, @Query('locale') l?: string) {
    const { slug, p } = need(r); return new StreamableFile(await this.svc.timetablePdf(slug, p, { student_id, class_id, mine }, l));
  }

  // lesson log
  @Get('lessons') lessons(@Req() r: CoreRequest, @Query('class_id') c?: string, @Query('q') q?: string) { const { slug, p } = need(r); return this.svc.listLessons(slug, p, c, q); }
  @Post('lessons/:id/attachments') attach(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.addAttachment(slug, p, id, b); }
  @Get('lessons/:id/attachments/:att') async attachment(@Req() r: CoreRequest, @Param('id') id: string, @Param('att') att: string) { const { slug, p } = need(r); return file(await this.svc.getAttachment(slug, p, id, att)); }

  // schools (root super-admin)
  @Get('tenants') @RequirePermission('tenants:manage') listTenants() { return this.tenants.list(); }
  @Get('tenants/proposals') @RequirePermission('tenants:manage') proposals(@Query('country_code') c: string, @Query('school_type') t: string) { return this.tenants.proposals(c, t); }
  @Get('tenants/:slug') @RequirePermission('tenants:manage') tenant(@Param('slug') slug: string) { return this.tenants.get(slug); }
  @Post('tenants') @RequirePermission('tenants:manage') createTenant(@Req() r: CoreRequest, @Body() b: any) { return this.tenants.create(r.principal!.id, b); }
  @Patch('tenants/:slug') @RequirePermission('tenants:manage') updateTenant(@Req() r: CoreRequest, @Param('slug') slug: string, @Body() b: any) { return this.tenants.update(r.principal!.id, slug, b); }
}
