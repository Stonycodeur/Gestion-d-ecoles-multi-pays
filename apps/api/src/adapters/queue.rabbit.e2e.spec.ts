import { RabbitQueue } from './queue';

/** Against a real RabbitMQ (CI service). Skipped when RABBITMQ_URL_TEST is not set. */
(process.env.RABBITMQ_URL_TEST ? describe : describe.skip)('RabbitQueue against a real RabbitMQ', () => {
  const env = { RABBITMQ_URL: process.env.RABBITMQ_URL_TEST, RABBITMQ_RETRY_MS: '300', RABBITMQ_MAX_ATTEMPTS: '3' } as NodeJS.ProcessEnv;
  const name = (s: string) => `test.${s}.${Date.now()}`;
  const until = async (f: () => boolean | Promise<boolean>, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f()) return; await new Promise((r) => setTimeout(r, 50)); } throw new Error('timeout'); };
  let q: RabbitQueue;
  beforeEach(() => { q = new RabbitQueue(env); });
  afterEach(async () => { await q.close(); });

  it('delivers a published job once', async () => {
    const queue = name('ok'); const got: unknown[] = [];
    await q.consume(queue, async (j) => { got.push(j); });
    await q.publish(queue, { channel: 'sms', to: '+24101' });
    await until(() => got.length === 1);
    await new Promise((r) => setTimeout(r, 400));
    expect(got).toEqual([{ channel: 'sms', to: '+24101' }]);
  });
  it('keeps jobs while no consumer runs, then delivers them (durable)', async () => {
    const queue = name('late'); const got: unknown[] = [];
    await q.publish(queue, { n: 1 }); await q.publish(queue, { n: 2 });
    expect(await q.depth(queue)).toBe(2);
    await q.consume(queue, async (j) => { got.push(j); });
    await until(() => got.length === 2);
  });
  it('retries a failing job and succeeds when the provider recovers', async () => {
    const queue = name('retry'); let calls = 0;
    await q.consume(queue, async () => { calls++; if (calls < 3) throw new Error('provider down'); });
    await q.publish(queue, { n: 1 });
    await until(() => calls === 3);
    await new Promise((r) => setTimeout(r, 500));
    expect(calls).toBe(3);
    expect(await q.depth(`${queue}.dead`)).toBe(0);
  });
  it('parks a job in .dead after the last attempt instead of losing it', async () => {
    const queue = name('dead'); let calls = 0;
    await q.consume(queue, async () => { calls++; throw new Error('always down'); });
    await q.publish(queue, { n: 1 });
    await until(async () => (await q.depth(`${queue}.dead`)) === 1);
    expect(calls).toBe(3);
  });
});
