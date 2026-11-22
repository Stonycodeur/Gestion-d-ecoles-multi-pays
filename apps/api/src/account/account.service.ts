import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { can, type Principal } from '@ecolemanager/shared';
import { TenantDb, type Q } from '../pedagogy/tenant-db.service';
import { mapDbError, uuid } from '../pedagogy/validate';
import { AuditService } from '../core/audit.service';
import { NotificationService } from '../comms/notification.service';

/** Account deletion, required by both stores and by the data-protection framework. Personal data is erased or anonymised; educational records are kept without identity
 *  (statutory retention of results), which is stated to the user. The identity-provider user must also be disabled (see docs/INTEGRATIONS.md). */
@Injectable()
export class AccountService {
  constructor(private readonly db: TenantDb, private readonly audit: AuditService, private readonly notif: NotificationService) {}
  private tx<T>(slug: string, fn: (q: Q) => Promise<T>): Promise<T> { return this.db.run(slug, (q) => fn(q)).catch((e) => mapDbError(e)); }

  /** Self-service deletion of an adult account (guardian, teacher, staff). Students are erased by the administration at a guardian's request. */
  async deleteSelf(slug: string, p: Principal, b: any) {
    if (p.isRoot) throw new ForbiddenException('the root super-admin account is immutable');
    if (p.roles.includes('student')) throw new ForbiddenException('student accounts are erased by the administration at the request of a guardian');
    if (b?.confirm !== 'DELETE') throw new BadRequestException('confirm must be "DELETE"');
    await this.tx(slug, async (q) => {
      await q('DELETE FROM device_tokens WHERE user_id = $1', [p.id]); await q('DELETE FROM push_outbox WHERE user_id = $1', [p.id]); await q('DELETE FROM notifications WHERE user_id = $1', [p.id]);
      await q('DELETE FROM gps_consents WHERE guardian_user_id = $1', [p.id]);
      await q("UPDATE guardians SET full_name = 'Compte supprimé', phone = NULL, email = NULL, user_id = NULL WHERE user_id = $1", [p.id]);
      await q("UPDATE teachers SET first_name = 'Compte', last_name = 'supprimé', user_id = NULL WHERE user_id = $1", [p.id]);
      await q("UPDATE directory SET role = 'deleted', display_name = 'Compte supprimé', email = NULL, phone = NULL, class_ids = '{}', child_ids = '{}', student_id = NULL WHERE user_id = $1", [p.id]);
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'account.delete', entity: 'user', entityId: p.id });
    return { deleted: true, kept: 'Les résultats pédagogiques et la facturation sont conservés sans identité, selon les durées légales.' };
  }

  /** A guardian asks the administration to erase a child's account: recorded and notified, never automatic. */
  async requestErasure(slug: string, p: Principal, studentId: string) {
    const id = uuid(studentId, 'studentId');
    if (!p.childIds?.includes(id)) throw new ForbiddenException('not your child');
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'account.erasure_requested', entity: 'student', entityId: id });
    const n = await this.notif.notifyAll(slug, 'account.erasure', { text: 'Un parent demande la suppression du compte d’un élève.' }, { student_id: id }, ['admin', 'tenant_super_admin', 'head']);
    return { requested: true, notified: n };
  }

  /** Administration executes the erasure of a student. */
  async eraseStudent(slug: string, p: Principal, studentId: string) {
    const d = can(p, 'students:erase', { tenantId: slug }); if (!d.allowed) throw new ForbiddenException(d.reason);
    const id = uuid(studentId, 'studentId');
    await this.tx(slug, async (q) => {
      const s = (await q('SELECT user_id FROM students WHERE id = $1', [id]))[0]; if (!s) throw new NotFoundException('student not found');
      for (const t of ['gps_positions', 'gps_events', 'gps_state', 'gps_geofences', 'gps_consents']) await q(`DELETE FROM ${t} WHERE student_id = $1`, [id]);
      await q('DELETE FROM locker_documents WHERE student_id = $1', [id]);
      await q('DELETE FROM ai_predictions WHERE student_id = $1', [id]);
      await q("UPDATE guardians SET full_name = 'Contact supprimé', phone = NULL, email = NULL WHERE student_id = $1", [id]);
      await q("UPDATE directory SET child_ids = array_remove(child_ids, $1::uuid) WHERE $1::uuid = ANY(child_ids)", [id]);
      if (s.user_id) {
        for (const t of ['device_tokens', 'push_outbox', 'notifications']) await q(`DELETE FROM ${t} WHERE user_id = $1`, [s.user_id]);
        await q("UPDATE directory SET role = 'deleted', display_name = 'Compte supprimé', email = NULL, phone = NULL, class_ids = '{}', student_id = NULL WHERE user_id = $1", [s.user_id]);
      }
      await q("UPDATE students SET first_name = 'Élève', last_name = 'supprimé', birth_date = NULL, gender = NULL, user_id = NULL WHERE id = $1", [id]);
    });
    await this.audit.log({ actorId: p.id, tenant: slug, action: 'student.erased', entity: 'student', entityId: id });
    return { erased: true };
  }
}
