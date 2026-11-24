import { InlineQueue, RabbitQueue } from './queue';

describe('InlineQueue', () => {
  it('runs the handler immediately and swallows its failure', async () => {
    const seen: unknown[] = []; const qu = new InlineQueue();
    await qu.consume('a', async (j) => { seen.push(j); if (j.boom) throw new Error('x'); });
    await qu.publish('a', { n: 1 }); await qu.publish('a', { boom: true });
    expect(seen).toHaveLength(2);
    await expect(qu.publish('none', {})).resolves.toBeUndefined();
  });
});

describe('RabbitQueue (configuration)', () => {
  it('needs RABBITMQ_URL', async () => {
    const qu = new RabbitQueue({} as NodeJS.ProcessEnv, async () => { throw new Error('never'); });
    await expect(qu.publish('a', {})).rejects.toThrow('RABBITMQ_URL');
  });
  it('a consumer that cannot connect does not throw at startup', async () => {
    const qu = new RabbitQueue({ RABBITMQ_URL: 'amqp://x' } as NodeJS.ProcessEnv, async () => { throw new Error('ECONNREFUSED'); });
    await expect(qu.consume('a', async () => undefined)).resolves.toBeUndefined();
    await qu.close();
  });
});
