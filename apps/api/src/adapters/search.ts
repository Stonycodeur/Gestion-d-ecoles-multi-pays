import { Logger } from '@nestjs/common';

export interface SearchDoc { id: string; title: string; description?: string | null; tags?: string[] }
/**
 * Full-text search engine for pedagogical resources (spec 4.2: Elasticsearch). PostgreSQL stays the source of truth and applies every
 * access and filter rule; the engine only ranks text matches. `search` returns null when the engine cannot answer, and the caller then
 * falls back to PostgreSQL full-text search, so an outage never breaks the page.
 */
export interface SearchAdapter {
  readonly mode: 'sandbox' | 'live';
  index(school: string, doc: SearchDoc): Promise<void>;
  reindex(school: string, docs: SearchDoc[]): Promise<number>;
  search(school: string, query: string, limit: number): Promise<string[] | null>;
}

/** Sandbox: no engine; PostgreSQL full-text search answers. */
export class PostgresSearch implements SearchAdapter {
  readonly mode = 'sandbox' as const;
  async index() { /* PostgreSQL maintains its own tsvector */ }
  async reindex(_s: string, docs: SearchDoc[]) { return docs.length; }
  async search() { return null; }
}

/** Elasticsearch 8 over REST. One index per school (`em-<school>-resources`), so schools never share an index. ELASTICSEARCH_URL, optional ELASTICSEARCH_API_KEY. */
export class ElasticsearchSearch implements SearchAdapter {
  readonly mode = 'live' as const;
  private readonly log = new Logger('Search');
  private readonly ready = new Set<string>();
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly f: typeof fetch = fetch) {}
  private base() { const u = (this.env.ELASTICSEARCH_URL ?? '').replace(/\/$/, ''); if (!u) throw new Error('ELASTICSEARCH_URL is required'); return u; }
  private headers() { return { 'content-type': 'application/json', ...(this.env.ELASTICSEARCH_API_KEY ? { authorization: `ApiKey ${this.env.ELASTICSEARCH_API_KEY}` } : {}) }; }
  indexName(school: string) { if (!/^[a-z0-9_]{1,63}$/.test(school)) throw new Error('invalid school code'); return `em-${school.replace(/_/g, '-')}-resources`; }
  private async call(method: string, path: string, body?: unknown) {
    return this.f(`${this.base()}${path}`, { method, headers: this.headers(), body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body), signal: AbortSignal.timeout(Number(this.env.ELASTICSEARCH_TIMEOUT_MS ?? 2500)) });
  }
  private async ensure(school: string) {
    const idx = this.indexName(school);
    if (this.ready.has(idx)) return idx;
    const r = await this.call('PUT', `/${idx}`, {
      settings: { analysis: {
        filter: { fr_elision: { type: 'elision', articles_case: true, articles: ['l', 'm', 't', 'qu', 'n', 's', 'j', 'd', 'c', 'jusqu', 'quoiqu', 'lorsqu', 'puisqu'] }, fr_stop: { type: 'stop', stopwords: '_french_' }, fr_stem: { type: 'stemmer', language: 'light_french' } },
        analyzer: { school_fr: { tokenizer: 'standard', filter: ['fr_elision', 'lowercase', 'asciifolding', 'fr_stop', 'fr_stem'] } } } },   // accents are optional when searching
      mappings: { properties: { title: { type: 'text', analyzer: 'school_fr' }, description: { type: 'text', analyzer: 'school_fr' }, tags: { type: 'keyword' } } } });
    if (!r.ok && r.status !== 400) throw new Error(`creating the index failed (${r.status})`);   // 400 = already exists
    if (r.status === 400 && !/resource_already_exists/.test(await r.text())) throw new Error('creating the index failed (400)');
    this.ready.add(idx); return idx;
  }
  async index(school: string, d: SearchDoc) {
    try {
      const idx = await this.ensure(school);
      const r = await this.call('PUT', `/${idx}/_doc/${encodeURIComponent(d.id)}?refresh=wait_for`, { title: d.title, description: d.description ?? '', tags: d.tags ?? [] });
      if (!r.ok) throw new Error(`indexing failed (${r.status})`);
    } catch (e) { this.log.warn(`index skipped: ${(e as Error).message}`); }   // PostgreSQL keeps working; POST /resources/reindex repairs the index
  }
  async reindex(school: string, docs: SearchDoc[]) {
    const idx = await this.ensure(school);
    if (!docs.length) return 0;
    const lines = docs.flatMap((d) => [JSON.stringify({ index: { _index: idx, _id: d.id } }), JSON.stringify({ title: d.title, description: d.description ?? '', tags: d.tags ?? [] })]).join('\n') + '\n';
    const r = await this.call('POST', '/_bulk?refresh=wait_for', lines);
    const out = (await r.json()) as { errors?: boolean };
    if (!r.ok || out.errors) throw new Error('bulk indexing reported errors');
    return docs.length;
  }
  async search(school: string, query: string, limit: number) {
    try {
      const idx = await this.ensure(school);
      const r = await this.call('POST', `/${idx}/_search`, { size: limit, _source: false, query: { multi_match: { query, fields: ['title^3', 'description', 'tags^2'], fuzziness: 'AUTO', operator: 'and' } } });
      if (!r.ok) throw new Error(`search failed (${r.status})`);
      return ((await r.json()) as { hits: { hits: { _id: string }[] } }).hits.hits.map((h) => h._id);
    } catch (e) { this.log.warn(`search unavailable, using PostgreSQL: ${(e as Error).message}`); return null; }
  }
}
