import { ElasticsearchSearch } from '../adapters/search';

/** Against a real Elasticsearch 8 (CI service). Skipped when ES_URL_TEST is not set. */
(process.env.ES_URL_TEST ? describe : describe.skip)('ElasticsearchSearch against a real Elasticsearch', () => {
  const s = new ElasticsearchSearch({ ELASTICSEARCH_URL: process.env.ES_URL_TEST } as NodeJS.ProcessEnv);
  const school = `es_test_${Date.now()}`;
  it('indexes, ranks with French stemming and isolates schools', async () => {
    await s.index(school, { id: 'a', title: 'Les fractions décimales', description: 'Cours de mathématiques', tags: ['maths'] });
    await s.index(school, { id: 'b', title: 'Histoire du Gabon', description: 'Chronologie', tags: ['histoire'] });
    expect(await s.search(school, 'fraction', 10)).toEqual(['a']);
    expect(await s.search(school, 'gabon', 10)).toEqual(['b']);
    expect(await s.search(`${school}_other`, 'fraction', 10)).toEqual([]);
  });
  it('bulk reindex is idempotent', async () => {
    const docs = [{ id: 'a', title: 'Les fractions décimales' }, { id: 'c', title: 'Géométrie plane' }];
    expect(await s.reindex(school, docs)).toBe(2);
    expect(await s.reindex(school, docs)).toBe(2);
    expect(await s.search(school, 'geometrie', 10)).toEqual(['c']);   // accents are optional
  });
});
