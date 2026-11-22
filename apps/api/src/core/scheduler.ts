import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Principal } from '@ecolemanager/shared';
import { ModulesService } from '../modules/modules.service';
import { GpsService } from '../gps/gps.service';
import { PaymentsService } from '../payments/payments.service';
import { CommsService } from '../comms/comms.service';
import { MinistryService } from '../ministry/ministry.service';
import { WebhooksService } from '../publicapi/webhooks.service';

export const SCHEDULER_LOCK = 7_001_001;
const SYSTEM: Principal = { id: '00000000-0000-4000-8000-000000000001', roles: ['tenant_super_admin'] };

export interface RunSummary { skipped?: boolean; tenants: number; jobs: Record<string, number>; errors: { tenant: string; job: string; message: string }[] }

/**
 * Recurring jobs: GPS retention purge, locker retention purge, payment reminders, ministry transmissions due, webhook retries.
 * Every replica ticks, but a PostgreSQL advisory lock lets only one run a given tick. Each job is idempotent (exact-offset reminders, DELETE of expired rows, back-off checks),
 * so a missed or doubled tick is harmless. Enabled with SCHEDULER=on (default in production); SCHEDULER_INTERVAL_MIN (default 15).
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Scheduler');
  private timer?: NodeJS.Timeout;
  constructor(private readonly modules: ModulesService, private readonly gps: GpsService, private readonly pay: PaymentsService, private readonly comms: CommsService,
    private readonly ministry: MinistryService, private readonly hooks: WebhooksService) {}

  onModuleInit() {
    const on = (process.env.SCHEDULER ?? (process.env.NODE_ENV === 'production' ? 'on' : 'off')) === 'on';
    if (!on || !this.modules.pool) return;
    const every = Math.max(1, Number(process.env.SCHEDULER_INTERVAL_MIN ?? 15)) * 60_000;
    this.timer = setInterval(() => { void this.runOnce().catch((e) => this.log.error((e as Error).message)); }, every);
    this.timer.unref();
    this.log.log(`scheduler on, every ${every / 60000} min`);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async runOnce(): Promise<RunSummary> {
    const pool = this.modules.pool; const out: RunSummary = { tenants: 0, jobs: {}, errors: [] };
    if (!pool) return { ...out, skipped: true };
    const c = await pool.connect();
    try {
      if (!(await c.query('SELECT pg_try_advisory_lock($1) AS ok', [SCHEDULER_LOCK])).rows[0].ok) return { ...out, skipped: true };
      const slugs: string[] = (await c.query('SELECT slug FROM tenants ORDER BY slug')).rows.map((r) => r.slug);
      out.tenants = slugs.length;
      for (const slug of slugs) {
        const p = { ...SYSTEM, tenantId: slug }; const on = (m: string) => this.modules.registry.isEnabled(slug, m);
        const job = async (name: string, f: () => Promise<unknown>) => {
          try { await f(); out.jobs[name] = (out.jobs[name] ?? 0) + 1; } catch (e) { out.errors.push({ tenant: slug, job: name, message: (e as Error).message }); }
        };
        await job('locker_purge', () => this.comms.lockerPurge(slug));
        if (on('module-gps')) await job('gps_purge', () => this.gps.purge(slug, p));
        if (on('module-payment')) await job('payment_reminders', () => this.pay.runReminders(slug, p, {}));
        if (on('module-ministry')) await job('ministry_due', () => this.ministry.runDue(slug, null));
        if (on('module-public-api')) await job('webhook_retry', () => this.hooks.retryFailed(slug));
      }
      if (out.errors.length) this.log.warn(`${out.errors.length} job error(s): ${JSON.stringify(out.errors.slice(0, 5))}`);
      return out;
    } finally {
      await c.query('SELECT pg_advisory_unlock($1)', [SCHEDULER_LOCK]).catch(() => undefined); c.release();
    }
  }
}
