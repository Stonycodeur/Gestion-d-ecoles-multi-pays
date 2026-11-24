import { ElasticsearchSearch, PostgresSearch } from './search';

type Call = { method: string; url: string; body?: string };
function fake(handler: (c: Call) => { status?: number; json?: unknown; text?: string }) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const c = { method: init.method ?? 'GET', url, body: init.body as string | undefined }; calls.push(c);
    const r = handler(c);
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}
const env = { ELASTICSEARCH_URL: 'http://es:9200/', ELASTICSEARCH_API_KEY: 'k' } as NodeJS.ProcessEnv;

describe('search adapters', () => {
  it('sandbox returns null so PostgreSQL answers', async () => {
    const s = new PostgresSearch();
    expect(await s.search()).toBeNull();
    expect(await s.reindex('ga_x', [{ id: '1', title: 't' }])).toBe(1);
  });
  it('creates the per-school index once, then indexes and searches with ranking weights', async () => {
    const { f, calls } = fake((c) => (c.url.endsWith('/_search') ? { json: { hits: { hits: [{ _id: 'b' }, { _id: 'a' }] } } } : {}));
    const s = new ElasticsearchSearch(env, f);
    await s.index('ga_lycee', { id: 'a', title: 'Les fractions', tags: ['maths'] });
    const ids = await s.search('ga_lycee', 'fraction', 10);
    expect(ids).toEqual(['b', 'a']);
    expect(calls.filter((c) => c.method === 'PUT' && c.url === 'http://es:9200/em-ga-lycee-resources')).toHaveLength(1);
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/_doc/a'))).toBe(true);
    const body = JSON.parse(calls.find((c) => c.url.endsWith('/_search'))!.body!);
    expect(body.query.multi_match.fields).toContain('title^3');
    expect(body.size).toBe(10);
  });
  it('treats an existing index (400) as ready but fails on other 400s', async () => {
    const ok = new ElasticsearchSearch(env, fake(() => ({ status: 400, text: 'resource_already_exists_exception' })).f);
    await expect(ok.reindex('ga_x', [])).resolves.toBe(0);
    const bad = new ElasticsearchSearch(env, fake(() => ({ status: 400, text: 'mapper_parsing_exception' })).f);
    await expect(bad.reindex('ga_x', [])).rejects.toThrow();
  });
  it('falls back (null) when the engine is down, and never throws on index', async () => {
    const down = new ElasticsearchSearch(env, (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch);
    expect(await down.search('ga_x', 'a', 5)).toBeNull();
    await expect(down.index('ga_x', { id: '1', title: 't' })).resolves.toBeUndefined();
  });
  it('bulk reindex sends one NDJSON request and reports errors', async () => {
    const { f, calls } = fake((c) => (c.url.includes('/_bulk') ? { json: { errors: false } } : {}));
    const s = new ElasticsearchSearch(env, f);
    expect(await s.reindex('ga_x', [{ id: '1', title: 'a' }, { id: '2', title: 'b' }])).toBe(2);
    const bulk = calls.find((c) => c.url.includes('/_bulk'))!;
    expect(bulk.body!.trim().split('\n')).toHaveLength(4);
    const failing = new ElasticsearchSearch(env, fake((c) => (c.url.includes('/_bulk') ? { json: { errors: true } } : {})).f);
    await expect(failing.reindex('ga_x', [{ id: '1', title: 'a' }])).rejects.toThrow();
  });
  it('rejects unsafe school codes and a missing URL', async () => {
    const s = new ElasticsearchSearch(env, fake(() => ({})).f);
    expect(() => s.indexName('../x')).toThrow();
    expect(await new ElasticsearchSearch({} as NodeJS.ProcessEnv, fake(() => ({})).f).search('ga_x', 'a', 1)).toBeNull();
  });
});
