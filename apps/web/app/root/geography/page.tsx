'use client';
import { useEffect, useState } from 'react';
import Shell from '../../../components/Shell';
import { api } from '../../../lib/api';
import { useLang } from '../../../lib/useLang';

const msgOf = (r: { error?: string }) => { try { const e = JSON.parse(r.error ?? '""'); return typeof e === 'string' ? e : JSON.stringify(e); } catch { return r.error ?? 'error'; } };

/** Browse the world: continents → countries → provinces → cities, and activate any country (creates its reference data). */
export default function GeographyPage() {
  const { fr, t, l } = useLang();
  const [continents, setContinents] = useState<any[]>([]); const [k, setK] = useState(''); const [countries, setCountries] = useState<any[]>([]); const [q, setQ] = useState('');
  const [iso, setIso] = useState(''); const [regions, setRegions] = useState<any[]>([]); const [region, setRegion] = useState<any>(null); const [cities, setCities] = useState<any[]>([]);
  const [model, setModel] = useState('numeric'); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const country = countries.find((c) => c.c === iso);

  useEffect(() => { api('/geo/continents').then((r) => setContinents(r.data ?? [])); }, []);
  useEffect(() => { setCountries([]); if (k) api(`/geo/countries?continent=${k}&q=${encodeURIComponent(q)}`).then((r) => setCountries(r.data ?? [])); }, [k, q]);
  useEffect(() => { setRegions([]); setRegion(null); setCities([]); if (iso) api(`/geo/countries/${iso}/regions`).then((r) => setRegions(r.data ?? [])); }, [iso]);
  useEffect(() => { setCities([]); if (iso && region) api(`/geo/countries/${iso}/cities?region=${region.id}&limit=200`).then((r) => setCities(r.data ?? [])); }, [iso, region]);

  const activate = async () => {
    const r = await api(`/geo/countries/${iso}/activate`, { method: 'POST', online: true, body: { model, locale: fr ? 'fr' : 'en' } });
    if (!r.ok) { setErr(msgOf(r)); return; }
    setErr(''); setMsg(t(`${country.fr} est activé : on peut y créer des écoles.`, `${country.n} is activated: schools can be created there.`));
    api(`/geo/countries?continent=${k}&q=${encodeURIComponent(q)}`).then((x) => setCountries(x.data ?? []));
  };
  const kName = (x: any) => (l === 'fr' ? x.fr : l === 'ar' ? x.ar : x.en);
  return (
    <Shell>
      <h1>{t('Pays et villes du monde', 'Countries and cities of the world')}</h1>
      <p className="muted">{t('Tous les continents, pays, provinces et villes. Un pays se « active » en un clic : son référentiel (système éducatif, notation, calendrier) est alors créé et on peut y ouvrir des écoles.', 'Every continent, country, province and city. A country is activated in one click: its reference data (education system, grading, calendar) is created and schools can be opened there.')}</p>
      {err && <p role="alert">{err}</p>}{msg && <p role="status">{msg}</p>}

      <section aria-labelledby="h-k">
        <h2 id="h-k">{t('1. Continent', '1. Continent')}</h2>
        <ul className="list-pick">{continents.map((c) => <li key={c.code}><button aria-pressed={k === c.code} onClick={() => { setK(c.code); setIso(''); setMsg(''); }}><span>{kName(c)}</span><span>{c.countries}</span></button></li>)}</ul>
      </section>

      {k && (
        <section aria-labelledby="h-c">
          <h2 id="h-c">{t('2. Pays', '2. Country')}</h2>
          <p><label>{t('Rechercher', 'Search')} <input value={q} onChange={(e) => setQ(e.target.value)} /></label></p>
          <ul className="list-pick">{countries.map((c) => <li key={c.c}><button aria-pressed={iso === c.c} onClick={() => { setIso(c.c); setMsg(''); }}><span>{c.em} {l === 'fr' ? c.fr : c.n}</span><span>{c.activated ? '✓' : ''}</span></button></li>)}</ul>
        </section>
      )}

      {country && (
        <section aria-labelledby="h-d">
          <h2 id="h-d">{country.em} {l === 'fr' ? country.fr : country.n}</h2>
          <p>{t('Capitale', 'Capital')} : {country.cap || '—'} · {t('Devise', 'Currency')} : {country.cur || '—'} · {t('Fuseau', 'Time zone')} : {country.tz ?? '—'} · +{country.ph}</p>
          <p>{country.activated ? <span className="badge ok">{t(`Activé · ${country.schools} école(s)`, `Activated · ${country.schools} school(s)`)}</span> : <span className="badge">{t('Non activé', 'Not activated')}</span>}</p>
          {!country.activated && (
            <div className="form-grid">
              <label>{t('Système de notation', 'Grading system')}<select value={model} onChange={(e) => setModel(e.target.value)}>
                <option value="numeric">{t('Chiffré /10, /20 (modèle Gabon)', 'Numeric /10, /20 (Gabon model)')}</option><option value="letters">{t('Lettres A+ à E-', 'Letters A+ to E-')}</option><option value="percent">{t('Pourcentage /100', 'Percentage /100')}</option></select></label>
              <div style={{ alignSelf: 'end' }}><button onClick={activate}>{t('Activer ce pays', 'Activate this country')}</button></div>
            </div>
          )}
          <h3>{t(`3. Provinces et régions (${regions.length})`, `3. Provinces and regions (${regions.length})`)}</h3>
          <ul className="list-pick">{regions.map((r) => <li key={r.id}><button aria-pressed={region?.id === r.id} onClick={() => setRegion(r)}><span>{r.name}</span><span>{r.cities}</span></button></li>)}</ul>
          {region && <><h3>{t(`4. Villes de ${region.name} (${cities.length}${cities.length === 200 ? '+' : ''})`, `4. Cities of ${region.name} (${cities.length}${cities.length === 200 ? '+' : ''})`)}</h3>
            <p>{cities.map((c) => c.name).join(' · ') || '—'}</p></>}
        </section>
      )}
    </Shell>
  );
}
