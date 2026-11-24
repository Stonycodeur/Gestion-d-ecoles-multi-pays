import { Logger } from '@nestjs/common';
import * as amqp from 'amqplib';

export type Job = Record<string, unknown>;
export type JobHandler = (job: any) => Promise<void>;

/**
 * Asynchronous job queue for outbound work that must not slow down or fail the business action (SMS, e-mail).
 * `inline` runs the handler immediately in the same process (default, nothing to install); `rabbitmq` stores the job durably,
 * retries a failing job and parks it in `<queue>.dead` after the last attempt, so a provider outage loses nothing.
 */
export interface JobQueue {
  readonly mode: 'inline' | 'rabbitmq';
  consume(queue: string, handler: JobHandler): Promise<void>;
  publish(queue: string, job: Job): Promise<void>;
  close(): Promise<void>;
}

export class InlineQueue implements JobQueue {
  readonly mode = 'inline' as const;
  private readonly log = new Logger('Queue');
  private readonly handlers = new Map<string, JobHandler>();
  async consume(queue: string, handler: JobHandler) { this.handlers.set(queue, handler); }
  async publish(queue: string, job: Job) {
    const h = this.handlers.get(queue);
    if (!h) { this.log.warn(`no consumer for ${queue}, job dropped`); return; }
    try { await h(job); } catch (e) { this.log.warn(`${queue} job failed: ${(e as Error).message}`); }
  }
  async close() { this.handlers.clear(); }
}

type Conn = Awaited<ReturnType<typeof amqp.connect>>;

/** RabbitMQ (live). RABBITMQ_URL, RABBITMQ_RETRY_MS (delay before a retry, 10000), RABBITMQ_MAX_ATTEMPTS (3). */
export class RabbitQueue implements JobQueue {
  readonly mode = 'rabbitmq' as const;
  private readonly log = new Logger('Queue');
  private conn?: Conn;
  private ch?: amqp.ConfirmChannel;
  private connecting?: Promise<amqp.ConfirmChannel>;
  private readonly handlers = new Map<string, JobHandler>();
  private closing = false;
  private timer?: NodeJS.Timeout;
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly connect: (url: string) => Promise<Conn> = (u) => amqp.connect(u)) {}
  private get retryMs() { return Number(this.env.RABBITMQ_RETRY_MS ?? 10000); }
  private get maxAttempts() { return Math.max(1, Number(this.env.RABBITMQ_MAX_ATTEMPTS ?? 3)); }

  private channel(): Promise<amqp.ConfirmChannel> {
    if (this.ch) return Promise.resolve(this.ch);
    this.connecting ??= (async () => {
      const url = this.env.RABBITMQ_URL;
      if (!url) throw new Error('RABBITMQ_URL is required');
      const conn = await this.connect(url);
      const ch = await conn.createConfirmChannel();
      const lost = () => { if (this.conn === conn) { this.conn = undefined; this.ch = undefined; this.connecting = undefined; this.scheduleResubscribe(); } };
      conn.on('close', lost); conn.on('error', (e: Error) => this.log.warn(`connection error: ${e.message}`));
      this.conn = conn; this.ch = ch; return ch;
    })().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async declare(ch: amqp.ConfirmChannel, queue: string) {
    await ch.assertQueue(`${queue}.dead`, { durable: true });
    await ch.assertQueue(`${queue}.retry`, { durable: true, arguments: { 'x-message-ttl': this.retryMs, 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': queue } });
    await ch.assertQueue(queue, { durable: true, arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': `${queue}.retry` } });
  }
  private scheduleResubscribe() {
    if (this.closing || this.timer || !this.handlers.size) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.subscribeAll().catch((e) => { this.log.warn(`reconnect failed: ${(e as Error).message}`); this.scheduleResubscribe(); }); }, 5000);
    this.timer.unref?.();
  }
  private async subscribeAll() { for (const [q, h] of this.handlers) await this.subscribe(q, h); }
  private async subscribe(queue: string, handler: JobHandler) {
    const ch = await this.channel();
    await this.declare(ch, queue);
    await ch.prefetch(10);
    await ch.consume(queue, async (m) => {
      if (!m) return;
      try { await handler(JSON.parse(m.content.toString())); ch.ack(m); }
      catch (e) {
        const deaths = ((m.properties.headers?.['x-death'] as { queue: string; count: number }[] | undefined) ?? []).find((d) => d.queue === queue)?.count ?? 0;
        if (deaths + 1 >= this.maxAttempts) {   // last attempt failed: park it for an operator, never lose it
          this.log.error(`${queue} job parked in ${queue}.dead: ${(e as Error).message}`);
          ch.sendToQueue(`${queue}.dead`, m.content, { persistent: true, headers: { error: String((e as Error).message).slice(0, 500) } });
          ch.ack(m);
        } else ch.nack(m, false, false);   // dead-letters into <queue>.retry, which returns it after the delay
      }
    });
  }
  async consume(queue: string, handler: JobHandler) {
    this.handlers.set(queue, handler);
    try { await this.subscribe(queue, handler); } catch (e) { this.log.warn(`consumer for ${queue} not started yet: ${(e as Error).message}`); this.scheduleResubscribe(); }
  }
  async publish(queue: string, job: Job) {
    const ch = await this.channel();
    await this.declare(ch, queue);
    await new Promise<void>((ok, ko) => ch.sendToQueue(queue, Buffer.from(JSON.stringify(job)), { persistent: true, contentType: 'application/json' }, (err) => (err ? ko(err) : ok())));
  }
  /** Messages waiting in `<queue>` (or a suffix such as `.dead`). Used by tests and the operator health check. */
  async depth(queueName: string): Promise<number> { const ch = await this.channel(); return (await ch.checkQueue(queueName)).messageCount; }
  async close() {
    this.closing = true; if (this.timer) clearTimeout(this.timer);
    try { await this.ch?.close(); await this.conn?.close(); } catch { /* already closed */ }
    this.ch = undefined; this.conn = undefined;
  }
}
