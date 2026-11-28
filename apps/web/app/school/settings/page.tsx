'use client';
import { useEffect, useState } from 'react';
import Shell from '../../../components/Shell';
import { api } from '../../../lib/api';
import { useLang } from '../../../lib/useLang';
import { useNavigation } from '../../../lib/navigation';

interface PageRow { href: string; label: { fr: string; en: string }; module: string | null; level_hidden: boolean }
interface Prof { school: { name: string; type: string }; profile: { label: { fr: string; en: string }; vocabulary: Record<string, { fr: string; en: string }> }; hidden: string[]; shown: string[]; defaults: Record<string, { fr: string; en: string }>; pages: PageRow[] }
interface Mod { name: string; description?: string }

/** Settings of this school only: its words, the pages it shows, the modules it uses. Another school's settings are never touched. */
export default function SchoolSettingsPage() {
  const { t, fr } = useLang(); const { has, loaded } = useNavigation();
  const [p, setP] = useState<Prof | null>(null); const [voc, setVoc] = useState<Record<string, { fr: string; en: string }>>({}); const [hidden, setHidden] = useState<string[]>([]); const [shown, setShown] = useState<string[]>([]);
  const [mods, setMods] = useState<Mod[]>([]); const [active, setActive] = useState<string[]>([]); const [note, setNote] = useState('');
  const loadMods = async () => { const [c, a] = await Promise.all([api('/modules'), api('/modules/active')]); if (c.ok) setMods(c.data.modules); if (a.ok) setActive((a.data as any[]).map((x) => (typeof x === 'string' ? x : x.name))); };
  const load = async () => { const r = await api<Prof>('/school/profile'); if (r.ok && r.data) { setP(r.data); setHidden(r.data.hidden); setShown(r.data.shown); setVoc(Object.fromEntries(Object.entries(r.data.profile.vocabulary).map(([k, v]) => [k, { fr: v.fr, en: v.en }]))); } };
  useEffect(() => { void load(); void loadMods(); }, []);
  if (loaded && !has('school:configure')) return <Shell><h1>{t('Paramètres de l’école', 'School settings')}</h1><div className="empty-state"><p>{t('Vous n’avez pas accès à cette page.', 'You do not have access to this page.')}</p></div></Shell>;
  if (!p) return <Shell><h1>{t('Paramètres de l’école', 'School settings')}</h1><p aria-busy="true">{t('Chargement…', 'Loading…')}</p></Shell>;
  const visible = (pg: PageRow) => (pg.level_hidden ? shown.includes(pg.href) : !hidden.includes(pg.href));
  const toggle = (pg: PageRow) => { if (pg.level_hidden) setShown(visible(pg) ? shown.filter((x) => x !== pg.href) : [...shown, pg.href]); else setHidden(visible(pg) ? [...hidden, pg.href] : hidden.filter((x) => x !== pg.href)); };
  const save = async () => {
    const vocabulary: Record<string, { fr: string; en: string }> = {}; for (const [k, v] of Object.entries(voc)) if (v.fr !== p.defaults[k]?.fr || v.en !== p.defaults[k]?.en) vocabulary[k] = v;
    const r = await api('/school/profile', { method: 'PUT', body: { hidden, shown, vocabulary } });
    setNote(r.ok ? t('Paramètres enregistrés. Ils s’appliquent à cette école uniquement.', 'Settings saved. They apply to this school only.') : `${t('Erreur', 'Error')} : ${r.error}`);
    if (r.ok) { try { Object.keys(localStorage).filter((k) => k.startsWith('em_nav:')).forEach((k) => localStorage.removeItem(k)); } catch { /* none */ } await load(); }
  };
  const setModule = async (m: string, on: boolean) => { const r = await api(`/modules/${m}/${on ? 'enable' : 'disable'}`, { method: 'POST', body: {} }); setNote(r.ok ? (on ? t('Module activé.', 'Module enabled.') : t('Module désactivé.', 'Module disabled.')) : `${t('Erreur', 'Error')} : ${r.error}`); await loadMods(); };
  return (
    <Shell>
      <h1>{t('Paramètres de l’école', 'School settings')}</h1>
      <p>{p.school.name} · {fr ? p.profile.label.fr : p.profile.label.en}</p>
      {note && <p role="status">{note}</p>}
      <section aria-labelledby="s-voc"><h2 id="s-voc">{t('Vocabulaire', 'Vocabulary')}</h2>
        <p className="hint">{t('Les mots affichés aux utilisateurs de cette école (ex. « Élève » ou « Étudiant »).', 'The words shown to this school’s users (e.g. “Pupil” or “Student”).')}</p>
        <div className="form-grid school-form">{Object.entries(voc).map(([k, v]) => <fieldset key={k}><legend>{k}</legend>
          <label>FR<input value={v.fr} maxLength={40} onChange={(e) => setVoc({ ...voc, [k]: { ...v, fr: e.target.value } })} /></label><label>EN<input value={v.en} maxLength={40} onChange={(e) => setVoc({ ...voc, [k]: { ...v, en: e.target.value } })} /></label></fieldset>)}</div></section>
      <section aria-labelledby="s-pages"><h2 id="s-pages">{t('Pages visibles', 'Visible pages')}</h2>
        <p className="hint">{t('Les pages proposées par défaut dépendent du niveau de l’école. Décochez pour masquer une page à tous ; cochez pour en ouvrir une qui est masquée par défaut. Les droits de chacun restent appliqués.', 'Default pages depend on the school level. Untick to hide a page for everyone; tick to open one hidden by default. Everyone’s rights still apply.')}</p>
        <ul className="plain">{p.pages.map((pg) => <li key={pg.href}><label className="check"><input type="checkbox" checked={visible(pg)} onChange={() => toggle(pg)} /> {fr ? pg.label.fr : pg.label.en}{pg.level_hidden && <small> — {t('masquée par défaut pour ce niveau', 'hidden by default for this level')}</small>}</label></li>)}</ul></section>
      <div><button type="button" onClick={save}>{t('Enregistrer vocabulaire et pages', 'Save vocabulary and pages')}</button></div>
      {has('modules:manage') && <section aria-labelledby="s-mod"><h2 id="s-mod">{t('Modules', 'Modules')}</h2>
        <ul className="plain">{mods.map((m) => { const on = active.includes(m.name); return <li key={m.name}><label className="check"><input type="checkbox" checked={on} onChange={() => setModule(m.name, !on)} /> <strong>{m.name}</strong>{m.description ? ` — ${m.description}` : ''}</label></li>; })}</ul></section>}
    </Shell>
  );
}
