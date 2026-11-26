'use client';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLang } from '../lib/useLang';

export interface GeoValue { continent: string; country: string; region: string; regionId: string; city: string }
export interface GeoCountryInfo { c: string; n: string; fr: string; cur: string; tz: string | null; activated: boolean; schools: number; em: string }
export const EMPTY_GEO: GeoValue = { continent: '', country: '', region: '', regionId: '', city: '' };

/** Continent → country → province → city, from the world dataset served by the API. Country and city are searchable; the city can also be typed. */
export default function GeoPicker({ value, onChange, onCountry }: { value: GeoValue; onChange: (v: GeoValue) => void; onCountry?: (c: GeoCountryInfo | null) => void }) {
  const { l, t } = useLang();
  const [continents, setContinents] = useState<any[]>([]); const [countries, setCountries] = useState<GeoCountryInfo[]>([]);
  const [regions, setRegions] = useState<any[]>([]); const [cities, setCities] = useState<any[]>([]);
  useEffect(() => { api('/geo/continents').then((r) => setContinents(r.data ?? [])); }, []);
  useEffect(() => { setCountries([]); if (value.continent) api(`/geo/countries?continent=${value.continent}`).then((r) => setCountries(r.data ?? [])); }, [value.continent]);
  useEffect(() => { onCountry?.(countries.find((c) => c.c === value.country) ?? null); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [countries, value.country]);
  useEffect(() => { setRegions([]); if (value.country) api(`/geo/countries/${value.country}/regions`).then((r) => setRegions(r.data ?? [])); }, [value.country]);
  useEffect(() => {
    if (!value.country) { setCities([]); return; }
    const h = setTimeout(() => { api(`/geo/countries/${value.country}/cities?region=${value.regionId}&q=${encodeURIComponent(value.city)}&limit=30`).then((r) => setCities(r.data ?? [])); }, 250);
    return () => clearTimeout(h);
  }, [value.country, value.regionId, value.city]);
  const onlyCountryLevel = regions.length === 1 && regions[0].id === 0;
  const name = (k: any) => (l === 'fr' ? k.fr : l === 'ar' ? k.ar ?? k.en : k.en);
  return (
    <div className="geo-grid">
      <label>{t('Continent', 'Continent')}
        <select value={value.continent} onChange={(e) => onChange({ ...EMPTY_GEO, continent: e.target.value })}>
          <option value="">{t('Choisir…', 'Choose…')}</option>
          {continents.map((k) => <option key={k.code} value={k.code}>{name(k)} ({k.countries})</option>)}
        </select>
      </label>
      <label>{t('Pays', 'Country')}
        <select value={value.country} disabled={!value.continent} onChange={(e) => onChange({ ...value, country: e.target.value, region: '', regionId: '', city: '' })}>
          <option value="">{t('Choisir…', 'Choose…')}</option>
          {countries.map((c) => <option key={c.c} value={c.c}>{c.em} {l === 'fr' ? c.fr : c.n}{c.activated ? ' ✓' : ''}</option>)}
        </select>
      </label>
      {!onlyCountryLevel && (
        <label>{t('Province / région', 'Province / region')}
          <select value={value.regionId} disabled={!value.country} onChange={(e) => { const r = regions.find((x) => String(x.id) === e.target.value); onChange({ ...value, regionId: e.target.value, region: r?.name ?? '', city: '' }); }}>
            <option value="">{t('Toutes / choisir…', 'All / choose…')}</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{r.name}{r.cities ? ` (${r.cities})` : ''}</option>)}
          </select>
        </label>
      )}
      <label>{t('Ville', 'City')}
        <input list="geo-cities" value={value.city} disabled={!value.country} placeholder={t('Tapez pour chercher…', 'Type to search…')} autoComplete="off" onChange={(e) => onChange({ ...value, city: e.target.value })} />
        <datalist id="geo-cities">{cities.map((c, i) => <option key={`${c.name}-${i}`} value={c.name}>{c.region}</option>)}</datalist>
      </label>
    </div>
  );
}
