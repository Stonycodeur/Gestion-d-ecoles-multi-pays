import { BadRequestException, ForbiddenException, HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { can, publicStat, successRate, validateApplication, type Principal } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { mapDbError, optStr, str, uuid } from '../pedagogy/validate';
import { ModulesService } from '../modules/modules.service';
import { NotificationService } from '../comms/notification.service';
import { AuditService } from '../core/audit.service';
import { PedagogyService } from '../pedagogy/pedagogy.service';

export const VISITOR_MODULE = 'module-visitor';
const SITE_KEYS = ['history', 'values', 'facilities', 'faculty', 'programs', 'contact_info', 'tour360'];
type Tenant = { id: string; slug: string; country: string; schoolType: string };

/** Public (unauthenticated) space: showcase, online enrolment, public news, contact form, statistics. Every public route is gated by the module flag and rate limited. */
@Injectable()
export class VisitorService {
  private hits = new Map<string, number[]>();
  constructor(private readonly db: TenantDb, private readonly modules: ModulesService, private readonly notif: NotificationService, private readonly audit: AuditService, private readonly pedagogy: PedagogyService) {}
  private tx<T>(slug: string, fn: (q: Q, t: Tenant) => Promise<T>): Promise<T> { return this.db.run(slug, fn).catch((e) => mapDbError(e)); }
  private authorize(p: Principal, slug: string, perm: string) { const d = can(p, perm, { tenantId: slug }); if (!d.allowed) throw new ForbiddenException(d.reason); }
  private open(slug: string) { if (!this.modules.registry.isEnabled(slug, VISITOR_MODULE)) throw new NotFoundException('public space is not available'); }
  private throttle(key: string) {
    const limit = Number(process.env.PUBLIC_FORM_LIMIT ?? 10), now = Date.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < 3600_000);
    if (recent.length >= limit) throw new HttpException('too many requests, try again later', 429);
    recent.push(now); this.hits.set(key, recent);
  }

  // ---- public ----------------------------------------------------------------------------------------------------------
  async site(slug: string) {
    this.open(slug);
    return this.tx(slug, async (q, t) => {
      const rows = await q('SELECT key, value FROM site_content');
      const country = (await q('SELECT name_fr, name_en, default_locale, languages FROM public.countries WHERE code = $1', [t.country]))[0];
      const school = (await q('SELECT name FROM public.tenants WHERE slug = $1', [slug]))[0];
      return { school: school?.name ?? slug, school_type: t.schoolType, country, content: Object.fromEntries(rows.map((r: any) => [r.key, r.value])) };
    });
  }
  async publicNews(slug: string) { this.open(slug); return this.tx(slug, (q) => q('SELECT id, title, body, published_at FROM news WHERE is_public ORDER BY published_at DESC LIMIT 50')); }
  async publicEvents(slug: string) {
    this.open(slug);
    return this.tx(slug, async (q) => { const cols = await q("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'events'"); const has = (c: string) => cols.some((x: any) => x.column_name === c);
      if (!has('is_public')) return []; return q('SELECT * FROM events WHERE is_public ORDER BY 1 LIMIT 50'); });
  }
  async levels(slug: string): Promise<string[]> {
    return this.tx(slug, async (q, t) => {
      const r = (await q('SELECT levels FROM public.education_systems WHERE country_code = $1 AND school_type = $2', [t.country, t.schoolType]))[0];
      return (r?.levels ?? []) as string[];
    });
  }
  async apply(slug: string, ip: string, b: any) {
    this.open(slug); this.throttle(`${slug}|apply|${ip}`);
    const levels = await this.levels(slug);
    const v = validateApplication(b ?? {}, levels);
    if (!v.ok) { if (v.spam) return { received: true }; throw new BadRequestException({ message: 'invalid application', errors: v.errors }); }   // honeypot: silently accepted, nothing stored
    const row = await this.tx(slug, async (q) => (await q(`INSERT INTO visitor_applications(first_name, last_name, birth_date, level_code, guardian_name, guardian_email, guardian_phone, message)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [v.data.first_name, v.data.last_name, v.data.birth_date, v.data.level_code, v.data.guardian_name, v.data.guardian_email, v.data.guardian_phone, v.data.message]))[0]);
    await this.notif.notifyAll(slug, 'application.received', { text: `${v.data.first_name} ${v.data.last_name} (${v.data.level_code})` }, { application_id: row.id }, ['tenant_super_admin', 'admin', 'head']);
    return { received: true, reference: row.id };
  }
  async contact(slug: string, ip: string, b: any) {
    this.open(slug); this.throttle(`${slug}|contact|${ip}`);
    if (typeof b?.website === 'string' && b.website) return { received: true };
    const email = str(b?.email, 'email', 200); if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new BadRequestException('email is invalid');
    await this.tx(slug, (q) => q('INSERT INTO contact_messages(name, email, subject, body) VALUES ($1,$2,$3,$4)', [str(b.name, 'name', 120), email, str(b.subject, 'subject', 200), str(b.body, 'body', 5000)]));
    return { received: true };
  }
  /** Aggregates only; a figure computed on a cohort smaller than the configured minimum is withheld (null) to protect minors. */
  async stats(slug: string) {
    this.open(slug);
    const min = Number(this.modules.registry.config(slug, VISITOR_MODULE).min_cohort_public_stats ?? 10);
    return this.tx(slug, async (q) => {
      const enrolled = Number((await q("SELECT COUNT(*)::int AS n FROM students WHERE status IN ('enrolled','active')"))[0].n);
      const exams = await q('SELECT exam_code, school_year, COUNT(*)::int AS candidates, SUM(CASE WHEN passed THEN 1 ELSE 0 END)::int AS passed FROM exam_outcomes GROUP BY exam_code, school_year ORDER BY school_year DESC, exam_code');
      return { enrolled: publicStat(enrolled, 1, enrolled), min_cohort: min,
        success: exams.map((e: any) => ({ exam_code: e.exam_code, school_year: e.school_year, success_rate_pct: publicStat(successRate(e.passed, e.candidates) ?? 0, min, e.candidates) === null ? null : successRate(e.passed, e.candidates), candidates: e.candidates >= min ? e.candidates : null })) };
    });
  }

  // ---- staff -----------------------------------------------------------------------------------------------------------
  async putSite(slug: string, p: Principal, key: string, value: unknown) {
    this.authorize(p, slug, 'site:write');
    if (!SITE_KEYS.includes(key)) throw new BadRequestException(`key must be one of ${SITE_KEYS.join(', ')}`);
    if (value === undefined || JSON.stringify(value).length > 50000) throw new BadRequestException('value is required (max 50 KB)');
    if (key === 'tour360' && !(value && typeof value === 'object' && Array.isArray((value as any).scenes))) throw new BadRequestException('tour360 needs {scenes:[{id,title,image_url,hotspots?}]}');
    const row = await this.tx(slug, async (q) => (await q(`INSERT INTO site_content(key, value, updated_by) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW() RETURNING key, value`, [key, JSON.stringify(value), p.id]))[0]);
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'site.update', entity: 'site_content', entityId: key });
    return row;
  }
  async applications(slug: string, p: Principal, status?: string) {
    this.authorize(p, slug, 'applications:manage');
    return this.tx(slug, (q) => q('SELECT * FROM visitor_applications WHERE ($1::text IS NULL OR status = $1) ORDER BY created_at DESC', [status ?? null]));
  }
  /** Accepting creates the student through the regular enrolment path (initial OAA score, enrolment invoice). Rejecting needs no side effect. */
  async decide(slug: string, p: Principal, id: string, b: any) {
    this.authorize(p, slug, 'applications:manage');
    const app = await this.tx(slug, async (q) => (await q('SELECT * FROM visitor_applications WHERE id = $1 FOR UPDATE', [uuid(id, 'id')]))[0]);
    if (!app) throw new NotFoundException('application not found');
    if (app.status !== 'pending') throw new BadRequestException('application already decided');
    if (b?.accept !== true) {
      const r = await this.tx(slug, async (q) => (await q("UPDATE visitor_applications SET status = 'rejected', decided_by = $2, decided_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *", [app.id, p.id]))[0]);
      await this.audit.log({ actorId: p.id, tenant: slug, action: 'application.reject', entity: 'application', entityId: id });
      return { application: r, student: null };
    }
    const created = await this.pedagogy.createStudent(slug, p.id, {
      first_name: app.first_name, last_name: app.last_name, birth_date: app.birth_date ? String(app.birth_date).slice(0, 10) : undefined, class_id: b.class_id,
      guardians: [{ full_name: app.guardian_name, relation: 'guardian', email: app.guardian_email ?? undefined, phone: app.guardian_phone ?? undefined }],
    });
    const r = await this.tx(slug, async (q) => (await q("UPDATE visitor_applications SET status = 'accepted', student_id = $2, decided_by = $3, decided_at = NOW() WHERE id = $1 RETURNING *", [app.id, created.student.id, p.id]))[0]);
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'application.accept', entity: 'application', entityId: id });
    return { application: r, student: created.student };
  }
  async contactMessages(slug: string, p: Principal) { this.authorize(p, slug, 'applications:manage'); return this.tx(slug, (q) => q('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 200')); }
  async handleContact(slug: string, p: Principal, id: string) { this.authorize(p, slug, 'applications:manage'); return this.tx(slug, async (q) => (await q('UPDATE contact_messages SET handled = TRUE WHERE id = $1 RETURNING *', [uuid(id, 'id')]))[0] ?? (() => { throw new NotFoundException('message not found'); })()); }
  optional(v: unknown) { return optStr(v, 'value', 100); }
}
