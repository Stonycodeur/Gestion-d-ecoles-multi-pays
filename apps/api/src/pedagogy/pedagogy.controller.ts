import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Req, StreamableFile } from '@nestjs/common';
import { PedagogyService } from './pedagogy.service';
import { RequirePermission } from '../core/auth.guard';
import type { CoreRequest } from '../core/request-context';

const need = (req: CoreRequest) => {
  if (!req.tenantSlug || !req.principal) throw new BadRequestException('tenant required');
  return { slug: req.tenantSlug, p: req.principal };
};

@Controller()
export class PedagogyController {
  constructor(private readonly svc: PedagogyService) {}

  // reference data ----------------------------------------------------------------------------------------------
  @Post('classes') @RequirePermission('students:write') createClass(@Req() r: CoreRequest, @Body() b: any) { return this.svc.createClass(need(r).slug, b); }
  @Get('classes') @RequirePermission('schedule:read') classes(@Req() r: CoreRequest) { return this.svc.listClasses(need(r).slug); }
  @Post('subjects') @RequirePermission('students:write') createSubject(@Req() r: CoreRequest, @Body() b: any) { return this.svc.createSubject(need(r).slug, b); }
  @Get('subjects') @RequirePermission('schedule:read') subjects(@Req() r: CoreRequest) { return this.svc.listSubjects(need(r).slug); }
  @Post('teachers') @RequirePermission('staff:write') createTeacher(@Req() r: CoreRequest, @Body() b: any) { return this.svc.createTeacher(need(r).slug, b); }
  @Post('rooms') @RequirePermission('staff:write') createRoom(@Req() r: CoreRequest, @Body() b: any) { return this.svc.createRoom(need(r).slug, b); }
  @Get('teachers') @RequirePermission('staff:read') teachers(@Req() r: CoreRequest) { return this.svc.listTeachers(need(r).slug); }
  @Get('rooms') @RequirePermission('staff:read') rooms(@Req() r: CoreRequest) { return this.svc.listRooms(need(r).slug); }
  @Get('class-subjects') @RequirePermission('students:read') classSubjects(@Req() r: CoreRequest, @Query('class_id') c?: string) { return this.svc.listClassSubjects(need(r).slug, c); }
  @Patch('classes/:id') @RequirePermission('students:write') editClass(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.updateClass(slug, p.id, id, b); }
  @Delete('classes/:id') @RequirePermission('students:write') delClass(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.deleteClass(slug, p.id, id); }
  @Patch('subjects/:id') @RequirePermission('students:write') editSubject(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.updateSubject(slug, p.id, id, b); }
  @Delete('subjects/:id') @RequirePermission('students:write') delSubject(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.deleteSubject(slug, p.id, id); }
  @Patch('teachers/:id') @RequirePermission('staff:write') editTeacher(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.updateTeacher(slug, p.id, id, b); }
  @Delete('teachers/:id') @RequirePermission('staff:write') delTeacher(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.deleteTeacher(slug, p.id, id); }
  @Patch('rooms/:id') @RequirePermission('staff:write') editRoom(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.updateRoom(slug, p.id, id, b); }
  @Delete('rooms/:id') @RequirePermission('staff:write') delRoom(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.deleteRoom(slug, p.id, id); }
  @Delete('class-subjects/:id') @RequirePermission('schedule:write') delClassSubject(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.deleteClassSubject(slug, p.id, id); }
  @Patch('students/:id') @RequirePermission('students:write') editStudent(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { const { slug, p } = need(r); return this.svc.updateStudent(slug, p.id, id, b); }
  @Post('class-subjects') @RequirePermission('schedule:write') assign(@Req() r: CoreRequest, @Body() b: any) { return this.svc.assignSubject(need(r).slug, b); }

  // students -----------------------------------------------------------------------------------------------------
  @Post('students') @RequirePermission('students:write')
  createStudent(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.createStudent(slug, p.id, b); }

  @Get('students')
  listStudents(@Req() r: CoreRequest, @Query('class_id') classId?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    const { slug, p } = need(r);
    this.svc.authorize(p, slug, 'students:read', { classId });   // teachers: only their classes
    return this.svc.listStudents(slug, classId, limit, offset);
  }

  // timetable ----------------------------------------------------------------------------------------------------
  @Post('schedules/generate') @RequirePermission('schedule:write')
  generate(@Req() r: CoreRequest, @Body() b: any) { const { slug, p } = need(r); return this.svc.generateSchedule(slug, p.id, b); }
  @Get('schedules/:id') @RequirePermission('schedule:read')
  schedule(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.getSchedule(slug, id, p); }
  @Post('schedules/:id/slots') @RequirePermission('schedule:write')
  addSlot(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) { return this.svc.addSlot(need(r).slug, id, b); }
  @Patch('schedules/:id/slots/:slotId') @RequirePermission('schedule:write')
  moveSlot(@Req() r: CoreRequest, @Param('id') id: string, @Param('slotId') slotId: string, @Body() b: any) { return this.svc.moveSlot(need(r).slug, id, slotId, b); }
  @Post('schedules/:id/validate') @RequirePermission('schedule:validate')
  validate(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.setScheduleStatus(slug, id, p.id, 'validated'); }
  @Post('schedules/:id/publish') @RequirePermission('schedule:validate')
  publish(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.setScheduleStatus(slug, id, p.id, 'published'); }
  @Get('schedules/:id/ical') @RequirePermission('schedule:read') @Header('Content-Type', 'text/calendar; charset=utf-8')
  ical(@Req() r: CoreRequest, @Param('id') id: string, @Query() q: { first_monday: string; until: string; timezone?: string }) { return this.svc.ical(need(r).slug, id, q); }

  // evaluations, grades, report cards ----------------------------------------------------------------------------
  @Post('evaluations')
  createEvaluation(@Req() r: CoreRequest, @Body() b: any) {
    const { slug, p } = need(r);
    this.svc.authorize(p, slug, 'grades:write', { classId: b?.class_id });
    return this.svc.createEvaluation(slug, b);
  }
  @Post('evaluations/:id/grades')
  async submitGrades(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) {
    const { slug, p } = need(r);
    this.svc.authorize(p, slug, 'grades:write', { classId: await this.svc.classOfEvaluation(slug, id) });
    return this.svc.submitGrades(slug, id, p.id, b);
  }
  private async authStudent(r: CoreRequest, studentId: string, perm: string) {
    const { slug, p } = need(r);
    const st = await this.svc.getStudent(slug, studentId);
    this.svc.authorize(p, slug, perm, { studentId: st.id, classId: st.class_id ?? undefined });
    return slug;
  }
  @Get('students/:id/report')
  async report(@Req() r: CoreRequest, @Param('id') id: string, @Query('period') period: string, @Query('locale') locale?: string) {
    return this.svc.report(await this.authStudent(r, id, 'grades:read'), id, period, locale);
  }
  @Get('students/:id/report.pdf') @Header('Content-Type', 'application/pdf')
  async reportPdf(@Req() r: CoreRequest, @Param('id') id: string, @Query('period') period: string, @Query('locale') locale?: string) {
    return new StreamableFile(await this.svc.reportPdf(await this.authStudent(r, id, 'grades:read'), id, period, locale));
  }
  @Post('students/:id/report/archive') @RequirePermission('grades:write')
  async archive(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: { period: string; school_year: string }) {
    const { p } = need(r);
    return this.svc.archiveReport(need(r).slug, id, b.period, b.school_year, p.id);
  }

  // absences -----------------------------------------------------------------------------------------------------
  @Post('absences')
  async recordAbsence(@Req() r: CoreRequest, @Body() b: any) {
    const slug = await this.authStudent(r, b?.student_id, 'absences:write');
    return this.svc.recordAbsence(slug, need(r).p.id, b);
  }
  @Post('absences/:id/justify')
  async justify(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: any) {
    const { slug } = need(r);
    await this.authStudent(r, await this.svc.studentOfAbsence(slug, id), 'absences:justify');
    return this.svc.justify(slug, id, need(r).p.id, b);
  }
  @Post('justifications/:id/decide') @RequirePermission('absences:validate')
  decide(@Req() r: CoreRequest, @Param('id') id: string, @Body() b: { decision: string }) { const { slug, p } = need(r); return this.svc.decideJustification(slug, id, p.id, b?.decision); }
  @Get('students/:id/attendance')
  async attendance(@Req() r: CoreRequest, @Param('id') id: string) { return this.svc.attendance(await this.authStudent(r, id, 'absences:read'), id); }

  // lessons ------------------------------------------------------------------------------------------------------
  @Post('lessons')
  createLesson(@Req() r: CoreRequest, @Body() b: any) {
    const { slug, p } = need(r);
    this.svc.authorize(p, slug, 'lessons:write', { classId: b?.class_id });
    return this.svc.createLesson(slug, p.id, b);
  }
  // GET /lessons lives in AcademicController: it scopes students and guardians to their own classes.
  @Post('lessons/:id/visa') @RequirePermission('lessons:visa')
  visa(@Req() r: CoreRequest, @Param('id') id: string) { const { slug, p } = need(r); return this.svc.visaLesson(slug, id, p.id); }
}
