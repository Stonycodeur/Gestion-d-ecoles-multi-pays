'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Flag from './Flag';
import Icon from './Icon';
import { API_BASE } from '../lib/api';
import { setLocale, type Locale } from '../lib/i18n';
import { useLang } from '../lib/useLang';

interface C { c: string; n: string; fr: string; k: string; schools: number }
interface S { slug: string; name: string; type: string; type_label?: { fr: string; en: string }; country: string; region: string | null; city: string | null }
const get = async <T,>(path: string): Promise<T | null> => { try { const r = await fetch(`${API_BASE}${path}`); return r.ok ? ((await r.json()) as T) : null; } catch { return null; } };
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Public home of the platform: find a country or a school anywhere in the world, then enter its site or sign in. */
export default function Landing() {
  const { l, t, fr } = useLang(); const router = useRouter();
  const [countries, setCountries] = useState<C[]>([]); const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState(''); const [hits, setHits] = useState<S[]>([]); const [open, setOpen] = useState(false); const [sel, setSel] = useState(-1);
  const [more, setMore] = useState(24); const [cf, setCf] = useState('');
  useEffect(() => { void get<C[]>('/directory/countries').then((d) => { setCountries(d ?? []); setLoaded(true); }); }, []);
  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const h = setTimeout(() => void get<S[]>(`/directory/schools?q=${encodeURIComponent(q.trim())}`).then((d) => setHits((d ?? []).slice(0, 6))), 220);
    return () => clearTimeout(h);
  }, [q]);
  const name = (c: C) => (fr ? c.fr : c.n);
  const cmatches = useMemo(() => (q.trim().length < 1 ? [] : countries.filter((c) => fold(c.n).includes(fold(q)) || fold(c.fr).includes(fold(q)) || c.c.toLowerCase() === fold(q)).slice(0, 6)), [countries, q]);
  const options = useMemo(() => [...cmatches.map((c) => ({ href: `/pays/${c.c}`, c })), ...hits.map((s) => ({ href: `/ecole/${s.slug}`, s }))], [cmatches, hits]);
  const go = (href: string) => { setOpen(false); router.push(href); };
  const available = countries.filter((c) => c.schools > 0);
  const gridList = useMemo(() => countries.filter((c) => !cf || fold(c.n).includes(fold(cf)) || fold(c.fr).includes(fold(cf))), [countries, cf]);
  const lang = (x: Locale) => { setLocale(x); location.reload(); };

  return (
    <div className="land">
      <header className="land-top">
        <Link href="/" className="brand" style={{ padding: 0 }}><span className="brand-mark" aria-hidden="true">É</span><span className="brand-name">ÉcoleManager Pro<small>STONY-TECHNOLOGIE</small></span></Link>
        <nav aria-label={t('Navigation principale', 'Main navigation')} className="land-nav">
          <a href="#pays">{t('Pays et écoles', 'Countries and schools')}</a>
          <a href="#avantages">{t('Pour qui ?', 'Who is it for?')}</a>
          <select aria-label={t('Langue', 'Language')} value={l} onChange={(e) => lang(e.target.value as Locale)}><option value="fr">FR</option><option value="en">EN</option><option value="ar">AR</option></select>
          <Link href="/login" className="btn-link primary">{t('Se connecter', 'Sign in')}</Link>
        </nav>
      </header>

      <main id="contenu" tabIndex={-1}>
      <section className="land-hero" aria-labelledby="hero-h">
        <div className="land-copy">
          <p className="eyebrow">{t('Plateforme mondiale de gestion scolaire', 'Worldwide school management platform')}</p>
          <h1 id="hero-h">{t('Trouvez votre école, où que vous soyez dans le monde.', 'Find your school, wherever you are in the world.')}</h1>
          <p className="lead">{t('Primaire, collège, lycée, université : chaque établissement a son site et son espace personnel pour les élèves, les parents et le personnel.', 'Primary, lower and upper secondary, university: every school has its own site and a personal space for students, parents and staff.')}</p>
          <div className="land-search" role="search">
            <Icon name="search" />
            <input role="combobox" aria-expanded={open && options.length > 0} aria-controls="land-opts" aria-autocomplete="list" aria-label={t('Rechercher un pays ou une école', 'Search a country or a school')}
              placeholder={t('Un pays, une ville ou une école…', 'A country, a city or a school…')} value={q} autoComplete="off"
              onChange={(e) => { setQ(e.target.value); setOpen(true); setSel(-1); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setSel((sel + 1) % Math.max(1, options.length)); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((sel - 1 + options.length) % Math.max(1, options.length)); }
                else if (e.key === 'Enter') { e.preventDefault(); if (options[sel]) go(options[sel].href); else if (cmatches[0]) go(`/pays/${cmatches[0].c}`); else if (hits[0]) go(`/ecole/${hits[0].slug}`); }
                else if (e.key === 'Escape') setOpen(false);
              }} />
            {open && q.trim().length > 0 && (
              <ul id="land-opts" role="listbox" className="land-opts">
                {options.map((o, i) => (
                  <li key={o.href} role="option" aria-selected={i === sel}>
                    <button type="button" tabIndex={-1} className={i === sel ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); go(o.href); }}>
                      {'c' in o && o.c ? (<><Flag code={o.c.c} /><span><strong>{name(o.c)}</strong><small>{o.c.schools > 0 ? t(`${o.c.schools} établissement(s)`, `${o.c.schools} school(s)`) : t('Pas encore disponible', 'Not available yet')}</small></span></>)
                        : (<><span className="school-ico" aria-hidden="true"><Icon name="school" /></span><span><strong>{o.s!.name}</strong><small>{[o.s!.city, (fr ? o.s!.type_label?.fr : o.s!.type_label?.en)].filter(Boolean).join(' · ')}</small></span></>)}
                    </button>
                  </li>))}
                {options.length === 0 && <li className="none" role="option" aria-selected="false">{t('Aucun pays ni établissement ne correspond à cette recherche.', 'No country or school matches this search.')}</li>}
              </ul>)}
          </div>
          <div className="land-cta">
            <a className="btn-link primary" href="#pays">{t('Choisir mon pays', 'Choose my country')}</a>
            <Link className="btn-link" href="/login">{t('J’ai déjà un compte', 'I already have an account')}</Link>
          </div>
        </div>
        <Scene schools={available.reduce((n, c) => n + c.schools, 0)} countries={available.length} />
      </section>

      <Ads />

      <section id="pays" className="land-section" aria-labelledby="pays-h">
        <h2 id="pays-h">{t('Où se trouve votre école ?', 'Where is your school?')}</h2>
        {available.length > 0 && <>
          <p className="muted">{t('Pays où des établissements sont déjà en ligne :', 'Countries where schools are already online:')}</p>
          <ul className="country-grid">{available.map((c) => <li key={c.c}><Link href={`/pays/${c.c}`} className="country-card"><Flag code={c.c} /><span><strong>{name(c)}</strong><small>{t(`${c.schools} établissement(s)`, `${c.schools} school(s)`)}</small></span></Link></li>)}</ul></>}
        <h3>{t('Tous les pays', 'All countries')}</h3>
        <label className="grow"><span className="sr-only">{t('Filtrer les pays', 'Filter countries')}</span><input type="search" placeholder={t('Filtrer les pays…', 'Filter countries…')} value={cf} onChange={(e) => { setCf(e.target.value); setMore(24); }} /></label>
        {!loaded ? <p>{t('Chargement…', 'Loading…')}</p> : (
          <ul className="country-grid small">{gridList.slice(0, more).map((c) => <li key={c.c}><Link href={`/pays/${c.c}`} className={`country-card${c.schools ? '' : ' soon'}`}><Flag code={c.c} /><span><strong>{name(c)}</strong><small>{c.schools ? t(`${c.schools} établissement(s)`, `${c.schools} school(s)`) : t('Bientôt', 'Coming soon')}</small></span></Link></li>)}</ul>)}
        {gridList.length > more && <p><button type="button" className="btn-sec" onClick={() => setMore(more + 48)}>{t(`Voir plus (${gridList.length - more})`, `Show more (${gridList.length - more})`)}</button></p>}
        {loaded && gridList.length === 0 && <div className="empty-state">{t('Aucun pays ne correspond.', 'No country matches.')}</div>}
      </section>

      <section id="avantages" className="land-section" aria-labelledby="av-h">
        <h2 id="av-h">{t('Un espace pour chacun', 'A space for everyone')}</h2>
        <ul className="tilt-grid">
          {[
            ['users', t('Élèves et étudiants', 'Students'), t('Emploi du temps, notes, devoirs, jeux éducatifs et score de progression, même sans connexion.', 'Timetable, grades, homework, educational games and a progress score, even offline.')],
            ['user', t('Parents', 'Parents'), t('Suivre les résultats, les absences, payer la scolarité par Mobile Money et échanger avec l’école.', 'Follow results and absences, pay fees by Mobile Money and talk with the school.')],
            ['cap', t('Enseignants', 'Teachers'), t('Cahier de textes, appel, notes, bulletins et messagerie sécurisée, adaptés à chaque niveau.', 'Class log, roll call, grades, report cards and secure messaging, adapted to each level.')],
            ['school', t('Direction', 'School leaders'), t('Gérer l’école avec des droits précis : classes, personnel, comptes, paramètres, rapports.', 'Run the school with precise rights: classes, staff, accounts, settings, reports.')],
          ].map(([ic, h, p]) => <li key={h} className="tilt-card"><span className="card-ico"><Icon name={ic} /></span><strong>{h}</strong><span>{p}</span></li>)}
        </ul>
      </section>

      </main>
      <footer className="land-foot">
        <span>© STONY-TECHNOLOGIE</span>
        <nav aria-label={t('Informations légales', 'Legal')}><Link href="/legal/privacy">{t('Confidentialité', 'Privacy')}</Link><Link href="/legal/terms">{t('Conditions d’utilisation', 'Terms')}</Link><Link href="/login">{t('Se connecter', 'Sign in')}</Link></nav>
      </footer>
    </div>
  );
}

/** Rotating 3D scene: orbiting rings and floating cards that follow the pointer. Static when the user prefers reduced motion (see CSS). */
function Scene({ schools, countries }: { schools: number; countries: number }) {
  const { t } = useLang(); const ref = useRef<HTMLDivElement>(null);
  const move = useCallback((e: React.PointerEvent) => {
    const el = ref.current; if (!el) return; const r = el.getBoundingClientRect();
    el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 24}deg`); el.style.setProperty('--rx', `${-((e.clientY - r.top) / r.height - 0.5) * 18}deg`);
  }, []);
  return (
    <div className="scene" ref={ref} onPointerMove={move} onPointerLeave={() => { ref.current?.style.setProperty('--ry', '0deg'); ref.current?.style.setProperty('--rx', '0deg'); }} aria-hidden="true">
      <div className="orb"><i className="ring r1" /><i className="ring r2" /><i className="ring r3" /><b className="core">É</b></div>
      <div className="float f1"><Icon name="school" /><span>{t('Écoles', 'Schools')}<strong>{schools}</strong></span></div>
      <div className="float f2"><Icon name="globe" /><span>{t('Pays', 'Countries')}<strong>{countries}</strong></span></div>
      <div className="float f3"><Icon name="grades" /><span>{t('Bulletins', 'Report cards')}<strong>PDF</strong></span></div>
      <div className="float f4"><Icon name="card" /><span>Mobile Money<strong>XAF</strong></span></div>
    </div>
  );
}

/** Promotional banners of the platform, with a 3D tilt and slow rotation (pauses on hover or focus, and has buttons for keyboard users). */
function Ads() {
  const { t } = useLang(); const [i, setI] = useState(0); const [pause, setPause] = useState(false);
  const ads = [
    { h: t('Inscrivez votre école', 'Register your school'), p: t('Créez le site et l’espace de votre établissement en quelques minutes, dans votre pays.', 'Create your school’s site and space in minutes, in your country.'), cta: t('Nous contacter', 'Contact us'), href: '/login', c: 'a1', ic: 'school' },
    { h: t('Payez la scolarité depuis votre téléphone', 'Pay school fees from your phone'), p: t('Airtel Money, Moov Money, carte bancaire : reçu immédiat, historique et rappels.', 'Airtel Money, Moov Money, card: instant receipt, history and reminders.'), cta: t('Découvrir', 'Discover'), href: '#avantages', c: 'a2', ic: 'card' },
    { h: t('L’application mobile, même hors connexion', 'The mobile app, even offline'), p: t('Emploi du temps, notes et cahier de textes disponibles partout, synchronisés au retour du réseau.', 'Timetable, grades and class log everywhere, synced when the network returns.'), cta: t('Se connecter', 'Sign in'), href: '/login', c: 'a3', ic: 'sync' },
    { h: t('Suivez vos enfants en toute confiance', 'Follow your children with confidence'), p: t('Absences, résultats, trajet vers l’école avec votre consentement : vous restez informé.', 'Absences, results, journey to school with your consent: you stay informed.'), cta: t('En savoir plus', 'Learn more'), href: '#avantages', c: 'a4', ic: 'pin' },
  ];
  useEffect(() => { if (pause) return; const h = setInterval(() => setI((x) => (x + 1) % ads.length), 5500); return () => clearInterval(h); }, [pause, ads.length]);
  const tilt = (e: React.PointerEvent<HTMLDivElement>) => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty('--ty', `${((e.clientX - r.left) / r.width - 0.5) * 10}deg`); e.currentTarget.style.setProperty('--tx', `${-((e.clientY - r.top) / r.height - 0.5) * 8}deg`); };
  return (
    <section className="ads" aria-roledescription="carousel" aria-label={t('À la une', 'Highlights')} onMouseEnter={() => setPause(true)} onMouseLeave={() => setPause(false)} onFocus={() => setPause(true)} onBlur={() => setPause(false)}>
      <div className="ads-track" aria-live={pause ? 'polite' : 'off'}>
        {ads.map((a, k) => (
          <div key={a.h} className={`ad ${a.c}${k === i ? ' on' : ''}`} role="group" aria-roledescription="slide" aria-label={`${k + 1} / ${ads.length}`} aria-hidden={k !== i} onPointerMove={tilt} onPointerLeave={(e) => { e.currentTarget.style.setProperty('--tx', '0deg'); e.currentTarget.style.setProperty('--ty', '0deg'); }}>
            <div className="ad-body"><h2>{a.h}</h2><p>{a.p}</p>{a.href.startsWith('#') ? <a className="btn-link" href={a.href} tabIndex={k === i ? 0 : -1}>{a.cta}</a> : <Link className="btn-link" href={a.href} tabIndex={k === i ? 0 : -1}>{a.cta}</Link>}</div>
            <div className="ad-art" aria-hidden="true"><span className="cube"><i /><i /><i /><i /><i /><i /></span><span className="ad-ico"><Icon name={a.ic} /></span></div>
          </div>))}
      </div>
      <div className="ads-ctl">
        <button type="button" className="btn-sec" aria-label={t('Précédent', 'Previous')} onClick={() => setI((i - 1 + ads.length) % ads.length)}>‹</button>
        {ads.map((a, k) => <button key={a.h} type="button" className={`dot${k === i ? ' on' : ''}`} aria-label={`${k + 1}`} aria-current={k === i} onClick={() => setI(k)} />)}
        <button type="button" className="btn-sec" aria-label={t('Suivant', 'Next')} onClick={() => setI((i + 1) % ads.length)}>›</button>
      </div>
    </section>
  );
}
