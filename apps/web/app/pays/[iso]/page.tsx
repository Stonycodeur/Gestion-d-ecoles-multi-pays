'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import Flag from '../../../components/Flag';
import Icon from '../../../components/Icon';
import { API_BASE } from '../../../lib/api';
import { useLang } from '../../../lib/useLang';

interface C { c: string; n: string; fr: string; schools: number }
interface S { slug: string; name: string; type: string; type_label?: { fr: string; en: string }; city: string | null; region: string | null }
const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** A country: its schools, or a plain message when none is open there yet. */
export default function CountryPage() {
  const iso = String(useParams().iso).toUpperCase(); const { t, fr } = useLang();
  const [country, setCountry] = useState<C | null | undefined>(undefined); const [schools, setSchools] = useState<S[] | null>(null);
  const [q, setQ] = useState(''); const [type, setType] = useState('');
  useEffect(() => {
    void fetch(`${API_BASE}/directory/countries?q=${encodeURIComponent(iso)}`).then((r) => (r.ok ? r.json() : [])).then((d: C[]) => setCountry(d.find((x) => x.c === iso) ?? null)).catch(() => setCountry(null));
    void fetch(`${API_BASE}/directory/schools?country=${encodeURIComponent(iso)}`).then((r) => (r.ok ? r.json() : [])).then(setSchools).catch(() => setSchools([]));
  }, [iso]);
  const shown = useMemo(() => (schools ?? []).filter((s) => (!type || s.type === type) && (!q || fold(`${s.name} ${s.city ?? ''} ${s.region ?? ''}`).includes(fold(q)))), [schools, q, type]);
  const types = useMemo(() => [...new Set((schools ?? []).map((s) => s.type))], [schools]);
  const name = country ? (fr ? country.fr : country.n) : iso;
  return (
    <main id="contenu" tabIndex={-1} className="school-none" style={{ maxWidth: 900 }}>
      <p><Link href="/">← {t('Accueil', 'Home')}</Link></p>
      {country === undefined || schools === null ? <p aria-busy="true">{t('Chargement…', 'Loading…')}</p>
        : country === null ? <div className="empty-state"><Icon name="search" /><h1>{t('Pays inconnu', 'Unknown country')}</h1><p>{t(`Le code « ${iso} » ne correspond à aucun pays du référentiel.`, `The code “${iso}” does not match any country in the reference list.`)}</p><p><Link className="btn-link primary" href="/">{t('Rechercher un autre pays', 'Search another country')}</Link></p></div>
        : <>
          <h1 style={{ display: 'flex', alignItems: 'center', gap: 12 }}><Flag code={iso} /> {name}</h1>
          {schools.length === 0
            ? <div className="empty-state"><Icon name="school" /><p>{t(`Aucun établissement n’est encore disponible dans ce pays (${name}). Revenez bientôt ou cherchez un autre pays.`, `No school is available in this country yet (${name}). Come back soon or search another country.`)}</p><p><Link className="btn-link primary" href="/">{t('Rechercher un autre pays ou une école', 'Search another country or a school')}</Link></p></div>
            : <>
              <div className="toolbar">
                <input type="search" aria-label={t('Rechercher une école', 'Search a school')} placeholder={t('Nom, ville ou région…', 'Name, city or region…')} value={q} onChange={(e) => setQ(e.target.value)} />
                {types.length > 1 && <select aria-label={t('Type d’établissement', 'School type')} value={type} onChange={(e) => setType(e.target.value)}><option value="">{t('Tous les types', 'All types')}</option>{types.map((x) => <option key={x} value={x}>{fr ? schools.find((s) => s.type === x)?.type_label?.fr : schools.find((s) => s.type === x)?.type_label?.en}</option>)}</select>}
              </div>
              {shown.length === 0 ? <p>{t('Aucune école ne correspond à votre recherche.', 'No school matches your search.')}</p>
                : <ul className="plain school-list">{shown.map((s) => <li key={s.slug}><Link href={`/ecole/${s.slug}`}><strong>{s.name}</strong><small>{[fr ? s.type_label?.fr : s.type_label?.en, s.city, s.region].filter(Boolean).join(' · ')}</small></Link></li>)}</ul>}
            </>}
        </>}
    </main>
  );
}
