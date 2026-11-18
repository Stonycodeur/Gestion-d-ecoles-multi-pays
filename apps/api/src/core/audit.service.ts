import { Injectable } from '@nestjs/common';
import { Pool } from 'pg';

export interface AuditEntry { actorId?: string; tenant?: string; action: string; entity?: string; entityId?: string; details?: Record<string, unknown>; ip?: string }

/** Append-only audit (DB trigger forbids UPDATE/DELETE). Falls back to memory when DATABASE_URL is unset (sandbox/tests). */
@Injectable()
export class AuditService {
  private pool?: Pool;
  readonly memory: AuditEntry[] = [];
  constructor() {
    if (process.env.DATABASE_URL) this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  async log(e: AuditEntry): Promise<void> {
    if (!this.pool) { this.memory.push(e); if (this.memory.length > 1000) this.memory.shift(); return; }
    await this.pool.query(
      'INSERT INTO audit_logs(actor_id, tenant_id, action, entity, entity_id, details, ip) VALUES ($1, NULL, $2, $3, $4, $5, $6)',
      [e.actorId ?? null, e.action, e.entity ?? null, e.entityId ?? null, JSON.stringify({ tenant: e.tenant, ...(e.details ?? {}) }), e.ip ?? null],
    );
  }
}
