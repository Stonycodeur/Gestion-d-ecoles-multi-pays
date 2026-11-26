import { GeoService } from './geo.service';

describe('GeoService (bundled world dataset)', () => {
  const geo = new GeoService();
  it('knows the seven continents and all the countries of the world', () => {
    const k = geo.continents();
    expect(k.map((x) => x.code).sort()).toEqual(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA']);
    expect(k.reduce((a, x) => a + x.countries, 0)).toBeGreaterThanOrEqual(240);
    expect(geo.countries('AF').some((c) => c.c === 'GA' && c.fr === 'Gabon')).toBe(true);
    expect(geo.countries('SA').map((c) => c.c)).toEqual(expect.arrayContaining(['BR', 'AR']));
    expect(geo.countries('NA').map((c) => c.c)).toEqual(expect.arrayContaining(['US', 'CA', 'MX']));
  });
  it('searches countries without accents or case', () => {
    expect(geo.countries(undefined, 'cote d').map((c) => c.c)).toContain('CI');
    expect(geo.countries(undefined, 'GABON')[0].c).toBe('GA');
  });
  it('lists the provinces and cities of a country', () => {
    const regs = geo.regions('GA');
    expect(regs.map((r) => r.name)).toEqual(expect.arrayContaining(['Estuaire', 'Haut-Ogooué']));
    const est = regs.find((r) => r.name === 'Estuaire')!;
    expect(geo.cities('GA', est.id).length).toBeGreaterThan(0);
    expect(geo.cities('GA', undefined, 'libreville').length).toBeGreaterThan(0);
    expect(geo.cities('FR', undefined, 'paris', 5).length).toBeGreaterThan(0);
  });
  it('every country has at least one region entry, even when it has no provinces', () => {
    for (const c of geo.countries()) expect(geo.regions(c.c).length).toBeGreaterThan(0);
  });
  it('rejects an unknown country', () => { expect(() => geo.country('ZZ')).toThrow(); });
});
