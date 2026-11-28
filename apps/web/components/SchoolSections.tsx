'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import XrViewer from './XrViewer';
import Icon from './Icon';
import { SECTION_LABEL, useSchoolSite } from './SchoolFrame';
import { pub } from '../lib/public';
import { useLang } from '../lib/useLang';

const TEXTS: [string, string, string][] = [['history', 'Histoire', 'History'], ['values', 'Valeurs', 'Values'], ['facilities', 'Infrastructures', 'Facilities'], ['faculty', 'Corps enseignant', 'Faculty']];

/** One page of a school's public site. What it shows depends on the school's level; a page the school has not opened says so plainly. */
export function SectionView({ id, home = false }: { id: string; home?: boolean }) {
  const { school, info } = useSchoolSite(); const { t, fr } = useLang();
  const [site, setSite] = useState<any>(null); const [state, setState] = useState<'load' | 'ok' | 'closed'>('load');
  useEffect(() => { if (!info) return; if (!info.site_open) { setState('closed'); return; } void pub(school, '/site').then((r) => { if (r.ok) { setSite(r.data); setState('ok'); } else setState('closed'); }); }, [school, info]);
  if (!info) return null;
  const v = (k: string) => (fr ? info.vocabulary[k]?.fr : info.vocabulary[k]?.en) ?? k;
  if (!info.sections.includes(id)) return <div className="school-block"><div className="empty-state"><Icon name="search" /><h1>{t('Cette page n’existe pas pour cet établissement', 'This page does not exist for this school')}</h1><p><Link className="btn-link" href={`/ecole/${school}`}>{t('Retour à l’accueil de l’école', 'Back to the school home')}</Link></p></div></div>;
  const label = fr ? SECTION_LABEL[id]?.fr : SECTION_LABEL[id]?.en;
  const closed = (
    <div className="empty-state"><Icon name="lock" /><p>{t('Cet établissement n’a pas encore ouvert cette page. Vous pouvez le contacter directement ou revenir plus tard.', 'This school has not opened this page yet. You can contact it directly or come back later.')}</p></div>);
  return (
    <>
      {home && (
        <section className="school-hero" aria-labelledby="sh-h">
          <p className="eyebrow">{fr ? info.type_label?.fr : info.type_label?.en}{info.city ? ` · ${info.city}` : ''}{info.region ? ` · ${info.region}` : ''}</p>
          <h1 id="sh-h">{info.name}</h1>
          <p className="lead">{t(`Bienvenue sur le site de l’établissement. ${v('students')}, ${v('guardian').toLowerCase()}s et ${v('teachers').toLowerCase()} retrouvent ici l’information et leur espace personnel.`, `Welcome to the school site. ${v('students')}, ${v('guardian').toLowerCase()}s and ${v('teachers').toLowerCase()} find information and their personal space here.`)}</p>
          <div className="land-cta">
            {info.sections.includes('enrol') && <Link className="btn-link primary" href={`/ecole/${school}/enrol`}>{t('S’inscrire', 'Enrol')}</Link>}
            {info.sections.includes('admissions') && <Link className="btn-link primary" href={`/ecole/${school}/admissions`}>{t('Candidater', 'Apply')}</Link>}
            <Link className="btn-link" href={`/login?school=${encodeURIComponent(school)}`}>{t('Accéder à mon espace', 'Go to my space')}</Link>
          </div>
        </section>)}
      <div className="school-block">
        {!home && <h1>{label}</h1>}
        {state === 'load' && <p>{t('Chargement…', 'Loading…')}</p>}
        {state === 'closed' && id !== 'contact' && closed}
        {state === 'ok' && id === 'presentation' && <Presentation site={site} />}
        {state === 'ok' && id === 'programs' && <Programs site={site} />}
        {state === 'ok' && id === 'levels' && <Levels school={school} />}
        {state === 'ok' && id === 'results' && <Results school={school} />}
        {state === 'ok' && id === 'news' && <News school={school} />}
        {state === 'ok' && (id === 'enrol' || id === 'admissions') && <Apply school={school} adult={info.type === 'university'} />}
        {state === 'ok' && id === 'tour' && <Tour school={school} site={site} />}
        {(state === 'ok' || (state === 'closed' && id === 'contact')) && id === 'contact' && <Contact school={school} site={site} open={state === 'ok'} />}
      </div>
    </>
  );
}

function Presentation({ site }: { site: any }) {
  const { t, fr } = useLang(); const any = TEXTS.some(([k]) => site?.content?.[k]?.text);
  if (!any) return <div className="empty-state"><Icon name="news" /><p>{t('L’établissement n’a pas encore publié sa présentation.', 'The school has not published its presentation yet.')}</p></div>;
  return <>{TEXTS.map(([k, a, b]) => site.content?.[k]?.text && <section key={k}><h2>{fr ? a : b}</h2><p className="prose">{site.content[k].text}</p></section>)}</>;
}
function Programs({ site }: { site: any }) {
  const { t } = useLang(); const txt = site?.content?.programs?.text;
  return txt ? <p className="prose">{txt}</p> : <div className="empty-state"><Icon name="cap" /><p>{t('Les formations ne sont pas encore publiées.', 'Programmes are not published yet.')}</p></div>;
}
function Levels({ school }: { school: string }) {
  const { t } = useLang(); const [lv, setLv] = useState<string[] | null>(null);
  useEffect(() => { void pub<string[]>(school, '/levels').then((r) => setLv(r.data ?? [])); }, [school]);
  if (!lv) return <p>{t('Chargement…', 'Loading…')}</p>;
  return lv.length ? <ul className="chips" style={{ listStyle: 'none', padding: 0 }}>{lv.map((x) => <li className="chip" key={x}>{x}</li>)}</ul> : <p>{t('Aucun niveau publié.', 'No level published.')}</p>;
}
function Results({ school }: { school: string }) {
  const { t } = useLang(); const [s, setS] = useState<any>(undefined);
  useEffect(() => { void pub(school, '/stats').then((r) => setS(r.ok ? r.data : null)); }, [school]);
  if (s === undefined) return <p>{t('Chargement…', 'Loading…')}</p>;
  if (!s) return <div className="empty-state"><Icon name="grades" /><p>{t('Les résultats ne sont pas encore publiés.', 'Results are not published yet.')}</p></div>;
  return <><div className="tiles"><div className="tile"><Icon name="users" /><strong>{s.enrolled}</strong><span>{t('Effectif', 'Enrolled')}</span></div></div>
    <ul className="plain">{s.success.map((x: any) => <li key={x.exam_code + x.school_year}><span>{x.exam_code} {x.school_year}</span><strong>{x.success_rate_pct === null ? t('non publié (effectif trop faible)', 'not published (group too small)') : `${x.success_rate_pct} %`}</strong></li>)}</ul></>;
}
function News({ school }: { school: string }) {
  const { t, fr } = useLang(); const [n, setN] = useState<any[] | null>(null);
  useEffect(() => { void pub<any[]>(school, '/news').then((r) => setN(r.data ?? [])); }, [school]);
  if (!n) return <p>{t('Chargement…', 'Loading…')}</p>;
  return n.length ? <ul className="news-list">{n.map((x) => <li key={x.id}><h2>{x.title}</h2><small>{new Date(x.published_at).toLocaleDateString(fr ? 'fr-FR' : 'en-GB', { dateStyle: 'long' })}</small><p className="prose">{x.body}</p></li>)}</ul> : <div className="empty-state"><Icon name="news" /><p>{t('Aucune actualité pour le moment.', 'No news at the moment.')}</p></div>;
}
function Tour({ school, site }: { school: string; site: any }) {
  const { t } = useLang(); const [panos, setPanos] = useState<any[]>([]); const [i, setI] = useState(0); const [scene, setScene] = useState(0);
  useEffect(() => { void pub<any[]>(school, '/tour').then((r) => { if (r.ok) setPanos(r.data ?? []); }); }, [school]);
  const tour = site?.content?.tour360?.scenes ?? []; const cur = tour[scene];
  if (panos.length) return <><XrViewer asset={{ ...panos[i], kind: 'panorama_360' }} /><p className="toolbar">{panos.map((a: any, k: number) => <button key={a.id} type="button" className="btn-sec" onClick={() => setI(k)} aria-pressed={k === i}>{a.title}</button>)}</p></>;
  if (cur) return <><div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 12 }}><img src={cur.image_url} alt={cur.title} style={{ height: 320, maxWidth: 'none' }} /></div><p className="toolbar">{tour.map((s: any, k: number) => <button key={s.id} type="button" className="btn-sec" onClick={() => setScene(k)} aria-pressed={k === scene}>{s.title}</button>)}</p></>;
  return <div className="empty-state"><Icon name="cube" /><p>{t('La visite virtuelle n’est pas encore disponible.', 'The virtual tour is not available yet.')}</p></div>;
}

function Apply({ school, adult }: { school: string; adult: boolean }) {
  const { t } = useLang(); const [lv, setLv] = useState<string[]>([]); const [msg, setMsg] = useState(''); const [ok, setOk] = useState(false);
  const [f, setF] = useState<any>({ first_name: '', last_name: '', birth_date: '', level_code: '', guardian_name: '', guardian_email: '', guardian_phone: '', message: '', consent: false, website: '' });
  useEffect(() => { void pub<string[]>(school, '/levels').then((r) => setLv(r.data ?? [])); }, [school]);
  const set = (k: string, val: unknown) => setF({ ...f, [k]: val });
  const send = async (e: React.FormEvent) => { e.preventDefault(); setMsg(''); const r = await pub(school, '/apply', { method: 'POST', body: { ...f, birth_date: f.birth_date || undefined } }); if (r.ok) setOk(true); else setMsg(`${t('Erreur', 'Error')} : ${r.error}`); };
  if (ok) return <div className="empty-state"><Icon name="check" /><p>{t('Votre demande est bien envoyée. L’établissement vous contactera.', 'Your request was sent. The school will contact you.')}</p></div>;
  return (
    <form onSubmit={send} className="school-form">
      <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999 }} value={f.website} onChange={(e) => set('website', e.target.value)} />
      <div className="form-grid">
        <label>{t('Prénom', 'First name')}<input required value={f.first_name} onChange={(e) => set('first_name', e.target.value)} /></label>
        <label>{t('Nom', 'Last name')}<input required value={f.last_name} onChange={(e) => set('last_name', e.target.value)} /></label>
        <label>{t('Date de naissance', 'Date of birth')}<input type="date" value={f.birth_date} onChange={(e) => set('birth_date', e.target.value)} /></label>
        <label>{adult ? t('Formation ou niveau demandé', 'Programme or level requested') : t('Niveau demandé', 'Level requested')}<select required value={f.level_code} onChange={(e) => set('level_code', e.target.value)}><option value="">—</option>{lv.map((x) => <option key={x}>{x}</option>)}</select></label>
        <label>{adult ? t('Personne à contacter', 'Contact person') : t('Responsable légal', 'Legal guardian')}<input required value={f.guardian_name} onChange={(e) => set('guardian_name', e.target.value)} /></label>
        <label>{t('E-mail', 'Email')}<input type="email" value={f.guardian_email} onChange={(e) => set('guardian_email', e.target.value)} /></label>
        <label>{t('Téléphone', 'Phone')}<input type="tel" value={f.guardian_phone} onChange={(e) => set('guardian_phone', e.target.value)} /></label>
      </div>
      <label>{t('Message', 'Message')}<textarea value={f.message} onChange={(e) => set('message', e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={f.consent} onChange={(e) => set('consent', e.target.checked)} /> {t('J’accepte le traitement de ces données personnelles', 'I accept the processing of this personal data')} (<Link href="/legal/privacy">{t('politique de confidentialité', 'privacy policy')}</Link>)</label>
      {msg && <p role="alert">{msg}</p>}
      <button type="submit">{adult ? t('Envoyer ma candidature', 'Send my application') : t('Envoyer la demande', 'Send the request')}</button>
    </form>
  );
}

function Contact({ school, site, open }: { school: string; site: any; open: boolean }) {
  const { t } = useLang(); const [f, setF] = useState<any>({ name: '', email: '', subject: '', body: '', website: '' }); const [msg, setMsg] = useState(''); const [ok, setOk] = useState(false);
  const info = site?.content?.contact_info?.text;
  const send = async (e: React.FormEvent) => { e.preventDefault(); setMsg(''); const r = await pub(school, '/contact', { method: 'POST', body: f }); if (r.ok) setOk(true); else setMsg(`${t('Erreur', 'Error')} : ${r.error}`); };
  return (
    <>
      {info && <p className="prose">{info}</p>}
      {!open ? <div className="empty-state"><Icon name="lock" /><p>{t('Le formulaire de contact n’est pas encore ouvert par cet établissement.', 'This school has not opened its contact form yet.')}</p></div>
        : ok ? <div className="empty-state"><Icon name="check" /><p>{t('Message envoyé. L’établissement vous répondra.', 'Message sent. The school will reply.')}</p></div> : (
          <form onSubmit={send} className="school-form">
            <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: -9999 }} value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
            <div className="form-grid"><label>{t('Nom', 'Name')}<input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label><label>E-mail<input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label></div>
            <label>{t('Objet', 'Subject')}<input required value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
            <label>{t('Message', 'Message')}<textarea required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
            {msg && <p role="alert">{msg}</p>}<button type="submit">{t('Envoyer', 'Send')}</button>
          </form>)}
    </>
  );
}
