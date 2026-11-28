'use client';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import Icon from './Icon';
import { API_BASE, getSession } from '../lib/api';
import { setLocale, type Locale } from '../lib/i18n';
import { useLang } from '../lib/useLang';

type L2 = { fr: string; en: string };
export interface SchoolInfo { slug: string; name: string; type: 'primary' | 'college' | 'lycee' | 'university'; type_label?: L2; country: string; region: string | null; city: string | null; sections: string[]; vocabulary: Record<string, L2>; site_open: boolean }
const Ctx = createContext<{ school: string; info: SchoolInfo | null }>({ school: '', info: null });
export const useSchoolSite = () => useContext(Ctx);

export const SECTION_LABEL: Record<string, L2> = {
  presentation: { fr: 'Présentation', en: 'About' }, levels: { fr: 'Niveaux', en: 'Levels' }, programs: { fr: 'Formations et filières', en: 'Programmes' }, results: { fr: 'Résultats', en: 'Results' },
  news: { fr: 'Actualités', en: 'News' }, enrol: { fr: 'Inscription', en: 'Enrolment' }, admissions: { fr: 'Admissions', en: 'Admissions' }, tour: { fr: 'Visite virtuelle', en: 'Virtual tour' }, contact: { fr: 'Contact', en: 'Contact' },
};
const MARK: Record<string, string> = { primary: 'school', college: 'book', lycee: 'cap', university: 'cap' };

/** Frame of one school's public site: its own header with the pages that suit its level, a link to the personal space, and a footer. */
export default function SchoolFrame({ children }: { children: ReactNode }) {
  const school = String(useParams().school); const path = usePathname() ?? '';
  const { l, t, fr } = useLang(); const [info, setInfo] = useState<SchoolInfo | null>(null); const [state, setState] = useState<'load' | 'ok' | 'none'>('load'); const [signed, setSigned] = useState(false);
  useEffect(() => {
    setSigned(!!getSession());
    void fetch(`${API_BASE}/directory/schools?slug=${encodeURIComponent(school)}`).then((r) => (r.ok ? r.json() : [])).then((d: SchoolInfo[]) => { if (d[0]) { setInfo(d[0]); setState('ok'); } else setState('none'); }).catch(() => setState('none'));
  }, [school]);
  const lang = (x: Locale) => { setLocale(x); location.reload(); };
  if (state === 'load') return <main id="contenu" aria-busy="true" style={{ minHeight: '60vh', padding: 24 }}><p>{t('Chargement…', 'Loading…')}</p></main>;
  if (state === 'none' || !info) return (
    <main id="contenu" className="school-none"><div className="empty-state"><Icon name="search" /><h1>{t('Établissement introuvable', 'School not found')}</h1>
      <p>{t(`Aucun établissement actif ne correspond au code « ${school} ». Il n’existe pas, n’est pas encore ouvert ou a été désactivé.`, `No active school matches the code “${school}”. It does not exist, is not open yet or has been deactivated.`)}</p>
      <p><Link className="btn-link primary" href="/">{t('Rechercher un autre pays ou une autre école', 'Search another country or school')}</Link></p></div></main>);
  const base = `/ecole/${school}`;
  return (
    <Ctx.Provider value={{ school, info }}>
      <div className={`school-site type-${info.type}`}>
        <header className="school-top">
          <Link href={base} className="school-brand"><span className="school-mark" aria-hidden="true"><Icon name={MARK[info.type]} /></span><span><strong>{info.name}</strong><small>{[info.city, fr ? info.type_label?.fr : info.type_label?.en].filter(Boolean).join(' · ')}</small></span></Link>
          <nav aria-label={t('Pages de l’établissement', 'School pages')} className="school-nav">
            {info.sections.map((s) => { const href = s === 'presentation' ? base : `${base}/${s}`; const on = s === 'presentation' ? path === base : path.startsWith(href); return <Link key={s} href={href} aria-current={on ? 'page' : undefined} className={on ? 'on' : ''}>{fr ? SECTION_LABEL[s]?.fr : SECTION_LABEL[s]?.en}</Link>; })}
          </nav>
          <div className="school-actions">
            <select aria-label={t('Langue', 'Language')} value={l} onChange={(e) => lang(e.target.value as Locale)}><option value="fr">FR</option><option value="en">EN</option><option value="ar">AR</option></select>
            <Link className="btn-link primary" href={signed ? '/' : `/login?school=${encodeURIComponent(school)}`}>{signed ? t('Mon espace', 'My space') : t('Espace personnel', 'Personal space')}</Link>
          </div>
        </header>
        <main id="contenu" tabIndex={-1} className="school-main">{children}</main>
        <footer className="land-foot"><span>{info.name} · {t('propulsé par ÉcoleManager Pro', 'powered by ÉcoleManager Pro')}</span><nav><Link href="/">{t('Autres pays et écoles', 'Other countries and schools')}</Link><Link href="/legal/privacy">{t('Confidentialité', 'Privacy')}</Link><Link href="/legal/terms">{t('Conditions', 'Terms')}</Link></nav></footer>
      </div>
    </Ctx.Provider>
  );
}
