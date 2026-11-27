'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Shell from '../../../components/Shell';
import Modal from '../../../components/Modal';
import Confirm from '../../../components/Confirm';
import Flag from '../../../components/Flag';
import Icon from '../../../components/Icon';
import { api } from '../../../lib/api';
import { msgOf } from '../../../lib/profile';
import { useLang } from '../../../lib/useLang';

interface Country { c: string; n: string; fr: string; k: string; ph: string; cur: string; tz: string | null; cap: string; d: [number, number]; custom?: boolean; activated: boolean; schools: number }
interface Continent { code: string; fr: string; en: string; ar: string; countries: number; custom: boolean }
const PAGE = 25;
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** World geography management (root super-admin): countries with their flags, continents, provinces and cities. Adding something that exists says so. */
export default function GeographyPage() {
  const { t, fr, l } = useLang();
  const [tab, setTab] = useState<'countries' | 'continents'>('countries');
  const [all, setAll] = useState<Country[]>([]); const [conts, setConts] = useState<Continent[]>([]);
  const [q, setQ] = useState(''); const [kf, setKf] = useState(''); const [page, setPage] = useState(0);
  const [form, setForm] = useState<{ mode: 'new' | 'edit'; c?: Country } | null>(null); const [kform, setKform] = useState<{ mode: 'new' | 'edit'; k?: Continent } | null>(null);
  const [places, setPlaces] = useState<Country | null>(null); const [del, setDel] = useState<{ kind: 'country' | 'continent'; id: string; label: string } | null>(null);
  const [act, setAct] = useState<Country | null>(null);
  const [msg, setMsg] = useState(''); const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const [a, k] = await Promise.all([api<Country[]>('/geo/countries'), api<Continent[]>('/geo/continents')]);
    if (a.ok) setAll(a.data ?? []); else setErr(msgOf(a));
    if (k.ok) setConts(k.data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(0); }, [q, kf]);

  const kName = (k: Continent | undefined) => (!k ? '' : l === 'fr' ? k.fr : l === 'ar' ? k.ar : k.en);
  const rows = useMemo(() => all.filter((c) => (!kf || c.k === kf) && (!q || fold(c.n).includes(fold(q)) || fold(c.fr).includes(fold(q)) || c.c.toLowerCase() === fold(q) || c.ph === q.replace('+', ''))), [all, q, kf]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); const shown = rows.slice(page * PAGE, page * PAGE + PAGE);

  const exportCsv = () => {
    const head = ['ISO', 'Nom FR', 'Name EN', 'Continent', 'Indicatif', 'Chiffres', 'Devise', 'Fuseau', 'Statut'];
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = rows.map((c) => [c.c, c.fr, c.n, kName(conts.find((k) => k.code === c.k)), `+${c.ph}`, `${c.d[0]}-${c.d[1]}`, c.cur, c.tz ?? '', c.activated ? 'activé' : 'non activé'].map(esc).join(','));
    const url = URL.createObjectURL(new Blob(['﻿' + [head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'pays.csv'; a.click(); URL.revokeObjectURL(url);
  };
  const trash = async () => {
    if (!del) return;
    const r = await api(del.kind === 'country' ? `/geo/countries/${del.id}` : `/geo/continents/${del.id}`, { method: 'DELETE', online: true });
    setDel(null);
    if (!r.ok) { setErr(r.status === 409 ? t(`« ${del.label} » ne peut pas être supprimé : il contient encore des pays ou des écoles.`, `“${del.label}” cannot be deleted: it still holds countries or schools.`) : msgOf(r)); return; }
    setErr(''); setMsg(t(`« ${del.label} » est à la corbeille. Vous pouvez le restaurer.`, `“${del.label}” is in the trash. You can restore it.`)); await load();
  };

  return (
    <Shell>
      <div className="page-head"><div><h1>{t('Pays, continents et villes', 'Countries, continents and cities')}</h1><small>{t(`${all.length} pays · ${conts.length} continents`, `${all.length} countries · ${conts.length} continents`)}</small></div></div>
      <p className="muted">{t('L’indicatif d’un pays est utilisé pour les téléphones des comptes. Vous pouvez ajouter ce qui manque ; si l’élément existe déjà, un message vous le dit. Ce qui est supprimé va à la corbeille.', 'A country’s dialling code is used for account phone numbers. Add what is missing; if it already exists you are told. Anything deleted goes to the trash.')}</p>
      {err && <p role="alert">{err}</p>}{msg && <p role="status">{msg}</p>}
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'countries'} onClick={() => setTab('countries')}>{t('Pays et drapeaux', 'Countries and flags')}</button>
        <button role="tab" aria-selected={tab === 'continents'} onClick={() => setTab('continents')}>{t('Continents', 'Continents')}</button>
      </div>

      {tab === 'countries' && (
        <section aria-labelledby="h-countries">
          <div className="page-head"><h2 id="h-countries" style={{ margin: 0 }}>{t(`Pays et drapeaux (${rows.length})`, `Countries and flags (${rows.length})`)}</h2>
            <button type="button" className="btn-ico" onClick={() => { setErr(''); setForm({ mode: 'new' }); }}><Icon name="plus" />{t('Nouveau pays', 'New country')}</button></div>
          <div className="toolbar">
            <label className="grow"><span className="sr-only">{t('Rechercher', 'Search')}</span><input type="search" placeholder={t('Rechercher un pays, un code, un indicatif…', 'Search a country, a code, a dialling code…')} value={q} onChange={(e) => setQ(e.target.value)} /></label>
            <label><span className="sr-only">{t('Continent', 'Continent')}</span><select value={kf} onChange={(e) => setKf(e.target.value)}><option value="">{t('Tous les continents', 'All continents')}</option>{conts.map((k) => <option key={k.code} value={k.code}>{kName(k)}</option>)}</select></label>
            <button type="button" className="btn-sec btn-ico" onClick={exportCsv}><Icon name="download" />{t('Exporter (CSV)', 'Export (CSV)')}</button>
          </div>
          {rows.length === 0 ? <div className="empty-state"><Icon name="search" />{t('Aucun pays ne correspond.', 'No country matches.')}</div> : (
            <table>
              <thead><tr><th>{t('Pays', 'Country')}</th><th>{t('Indicatif', 'Dial code')}</th><th>{t('Chiffres', 'Digits')}</th><th>{t('Devise', 'Currency')}</th><th>{t('Statut', 'Status')}</th><th><span className="sr-only">{t('Actions', 'Actions')}</span></th></tr></thead>
              <tbody>{shown.map((c) => (
                <tr key={c.c}>
                  <td><div className="cell-main"><Flag code={c.c} /><div><strong>{fr ? c.fr : c.n}</strong>{c.custom && <> <span className="badge">{t('ajouté', 'added')}</span></>}<small>{c.c} · {kName(conts.find((k) => k.code === c.k))}</small></div></div></td>
                  <td>+{c.ph}</td><td>{c.d[0]}–{c.d[1]}</td><td>{c.cur || '—'}</td>
                  <td>{c.activated ? <span className="badge ok">{t(`Activé · ${c.schools} école(s)`, `Activated · ${c.schools} school(s)`)}</span> : <span className="badge">{t('Non activé', 'Not activated')}</span>}</td>
                  <td><div className="row-actions">
                    <button type="button" className="btn-ico" onClick={() => { setErr(''); setForm({ mode: 'edit', c }); }}><Icon name="edit" />{t('Modifier', 'Edit')}</button>
                    <button type="button" className="btn-ico" onClick={() => setPlaces(c)}><Icon name="pin" />{t('Villes', 'Cities')}</button>
                    {!c.activated && <button type="button" onClick={() => setAct(c)}>{t('Activer', 'Activate')}</button>}
                    <button type="button" className="btn-danger" aria-label={`${t('Mettre à la corbeille', 'Move to trash')} : ${fr ? c.fr : c.n}`} onClick={() => setDel({ kind: 'country', id: c.c, label: fr ? c.fr : c.n })}><Icon name="trash" /></button>
                  </div></td>
                </tr>))}</tbody>
            </table>
          )}
          <div className="pager">
            <button type="button" className="btn-sec" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('Précédent', 'Previous')}</button>
            <span>{t(`Page ${page + 1} sur ${pages}`, `Page ${page + 1} of ${pages}`)}</span>
            <button type="button" className="btn-sec" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>{t('Suivant', 'Next')}</button>
          </div>
        </section>
      )}

      {tab === 'continents' && (
        <section aria-labelledby="h-conts">
          <div className="page-head"><h2 id="h-conts" style={{ margin: 0 }}>{t('Continents', 'Continents')}</h2><button type="button" className="btn-ico" onClick={() => { setErr(''); setKform({ mode: 'new' }); }}><Icon name="plus" />{t('Nouveau continent', 'New continent')}</button></div>
          <table>
            <thead><tr><th>{t('Code', 'Code')}</th><th>Français</th><th>English</th><th>العربية</th><th>{t('Pays', 'Countries')}</th><th><span className="sr-only">{t('Actions', 'Actions')}</span></th></tr></thead>
            <tbody>{conts.map((k) => (
              <tr key={k.code}><td><code>{k.code}</code></td><td>{k.fr}</td><td>{k.en}</td><td lang="ar" dir="rtl">{k.ar}</td><td>{k.countries}</td>
                <td><div className="row-actions">
                  <button type="button" className="btn-ico" onClick={() => { setErr(''); setKform({ mode: 'edit', k }); }}><Icon name="edit" />{t('Modifier', 'Edit')}</button>
                  <button type="button" className="btn-danger" aria-label={`${t('Mettre à la corbeille', 'Move to trash')} : ${k.fr}`} onClick={() => setDel({ kind: 'continent', id: k.code, label: k.fr })}><Icon name="trash" /></button>
                </div></td></tr>))}</tbody>
          </table>
        </section>
      )}

      {form && <CountryForm {...form} conts={conts} all={all} kName={kName} onClose={() => setForm(null)} onSaved={async (m) => { setForm(null); setMsg(m); setErr(''); await load(); }} />}
      {kform && <ContinentForm {...kform} conts={conts} onClose={() => setKform(null)} onSaved={async (m) => { setKform(null); setMsg(m); setErr(''); await load(); }} />}
      {places && <Places country={places} onClose={() => setPlaces(null)} />}
      {del && <Confirm title={t('Mettre à la corbeille ?', 'Move to the trash?')} body={t(`« ${del.label} » sera masqué. Vous pourrez le restaurer depuis la corbeille.`, `“${del.label}” will be hidden. You can restore it from the trash.`)} label={t('Mettre à la corbeille', 'Move to trash')} onConfirm={trash} onClose={() => setDel(null)} />}
      {act && <ActivateDialog c={act} onClose={() => setAct(null)} onDone={async (m) => { setAct(null); setMsg(m); setErr(''); await load(); }} />}
    </Shell>
  );
}

/** The message shown when the server refuses because the thing exists, sits in the trash, or still holds items. */
function useExplain() {
  const { t } = useLang();
  return (r: { status?: number; error?: string }, what: string): string => {
    const m = msgOf(r);
    if (r.status === 409 && m === 'exists') return t(`« ${what} » existe déjà.`, `“${what}” already exists.`);
    if (r.status === 409 && m === 'in_trash') return t(`« ${what} » se trouve dans la corbeille : restaurez-le depuis la corbeille.`, `“${what}” is in the trash: restore it from the trash.`);
    if (r.status === 409 && m === 'has_children') return t(`« ${what} » contient encore des éléments ou des écoles.`, `“${what}” still holds items or schools.`);
    return m;
  };
}

function CountryForm({ mode, c, conts, all, kName, onClose, onSaved }: { mode: 'new' | 'edit'; c?: Country; conts: Continent[]; all: Country[]; kName: (k: Continent | undefined) => string; onClose: () => void; onSaved: (m: string) => void }) {
  const { t } = useLang(); const explain = useExplain();
  const [f, setF] = useState({ code: c?.c ?? '', fr: c?.fr ?? '', n: c?.n ?? '', k: c?.k ?? conts[0]?.code ?? '', ph: c?.ph ?? '', lo: String(c?.d?.[0] ?? 6), hi: String(c?.d?.[1] ?? 12), cur: c?.cur ?? '', tz: c?.tz ?? '', cap: c?.cap ?? '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f, v: string) => setF({ ...f, [k]: v });
  const clash = mode === 'new' ? all.find((x) => x.c === f.code.toUpperCase() || (f.n && fold(x.n) === fold(f.n)) || (f.fr && fold(x.fr) === fold(f.fr))) : undefined;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const body = { n: f.n, fr: f.fr || f.n, k: f.k, ph: f.ph, cur: f.cur || undefined, tz: f.tz || undefined, cap: f.cap, d: [Number(f.lo), Number(f.hi)] };
    const r = mode === 'new' ? await api('/geo/countries', { method: 'POST', online: true, body: { ...body, code: f.code } }) : await api(`/geo/countries/${c!.c}`, { method: 'PATCH', online: true, body });
    setBusy(false);
    if (!r.ok) { setErr(explain(r, f.fr || f.n || f.code)); return; }
    onSaved(mode === 'new' ? t(`Pays « ${f.fr || f.n} » ajouté.`, `Country “${f.fr || f.n}” added.`) : t('Pays modifié.', 'Country updated.'));
  };
  return (
    <Modal title={mode === 'new' ? t('Nouveau pays', 'New country') : t('Modifier le pays', 'Edit country')} onClose={onClose}>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label>{t('Code ISO (2 lettres)', 'ISO code (2 letters)')}<input data-autofocus value={f.code} disabled={mode === 'edit'} maxLength={2} required pattern="[A-Za-z]{2}" onChange={(e) => set('code', e.target.value.toUpperCase())} /></label>
          <label>{t('Continent', 'Continent')}<select value={f.k} onChange={(e) => set('k', e.target.value)}>{conts.map((k) => <option key={k.code} value={k.code}>{kName(k)}</option>)}</select></label>
          <label>{t('Nom en français', 'Name in French')}<input value={f.fr} required onChange={(e) => set('fr', e.target.value)} /></label>
          <label>{t('Nom en anglais', 'Name in English')}<input value={f.n} required onChange={(e) => set('n', e.target.value)} /></label>
          <label>{t('Indicatif téléphonique', 'Dialling code')}<input value={f.ph} required inputMode="numeric" placeholder="241" pattern="\+?[0-9]{1,4}" onChange={(e) => set('ph', e.target.value.replace(/[^0-9+]/g, ''))} /></label>
          <label>{t('Chiffres du numéro (min – max)', 'Number digits (min – max)')}<span className="toolbar"><input style={{ width: '5rem' }} type="number" min={3} max={15} value={f.lo} onChange={(e) => set('lo', e.target.value)} /> – <input style={{ width: '5rem' }} type="number" min={3} max={15} value={f.hi} onChange={(e) => set('hi', e.target.value)} /></span></label>
          <label>{t('Devise (ISO 4217)', 'Currency (ISO 4217)')}<input value={f.cur} maxLength={3} placeholder="XAF" onChange={(e) => set('cur', e.target.value.toUpperCase())} /></label>
          <label>{t('Fuseau horaire', 'Time zone')}<input value={f.tz} placeholder="Africa/Libreville" onChange={(e) => set('tz', e.target.value)} /></label>
          <label>{t('Capitale', 'Capital')}<input value={f.cap} onChange={(e) => set('cap', e.target.value)} /></label>
        </div>
        {clash && <p role="alert">{t(`Ce pays existe déjà : ${clash.fr} (${clash.c}).`, `This country already exists: ${clash.n} (${clash.c}).`)}</p>}
        {err && <p role="alert">{err}</p>}
        <div className="modal-foot"><button type="button" className="btn-sec" onClick={onClose}>{t('Annuler', 'Cancel')}</button><button type="submit" disabled={busy || !!clash}>{t('Enregistrer', 'Save')}</button></div>
      </form>
    </Modal>
  );
}

function ContinentForm({ mode, k, conts, onClose, onSaved }: { mode: 'new' | 'edit'; k?: Continent; conts: Continent[]; onClose: () => void; onSaved: (m: string) => void }) {
  const { t } = useLang(); const explain = useExplain();
  const [f, setF] = useState({ code: k?.code ?? '', fr: k?.fr ?? '', en: k?.en ?? '', ar: k?.custom === false ? k.ar : k?.ar ?? '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const clash = mode === 'new' ? conts.find((x) => x.code === f.code.toUpperCase() || (f.fr && fold(x.fr) === fold(f.fr)) || (f.en && fold(x.en) === fold(f.en))) : undefined;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setBusy(true);
    const r = mode === 'new' ? await api('/geo/continents', { method: 'POST', online: true, body: f }) : await api(`/geo/continents/${k!.code}`, { method: 'PATCH', online: true, body: { fr: f.fr, en: f.en, ar: f.ar } });
    setBusy(false); if (!r.ok) { setErr(explain(r, f.fr || f.code)); return; }
    onSaved(mode === 'new' ? t(`Continent « ${f.fr} » ajouté.`, `Continent “${f.fr}” added.`) : t('Continent modifié.', 'Continent updated.'));
  };
  return (
    <Modal title={mode === 'new' ? t('Nouveau continent', 'New continent') : t('Modifier le continent', 'Edit continent')} onClose={onClose} small>
      <form onSubmit={submit}>
        <label>{t('Code (2 ou 3 lettres)', 'Code (2 or 3 letters)')}<input data-autofocus value={f.code} disabled={mode === 'edit'} required pattern="[A-Za-z]{2,3}" maxLength={3} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></label>
        <label>{t('Nom en français', 'Name in French')}<input value={f.fr} required onChange={(e) => setF({ ...f, fr: e.target.value })} /></label>
        <label>{t('Nom en anglais', 'Name in English')}<input value={f.en} required onChange={(e) => setF({ ...f, en: e.target.value })} /></label>
        <label>{t('Nom en arabe (facultatif)', 'Name in Arabic (optional)')}<input lang="ar" dir="rtl" value={f.ar} onChange={(e) => setF({ ...f, ar: e.target.value })} /></label>
        {clash && <p role="alert">{t(`Ce continent existe déjà : ${clash.fr}.`, `This continent already exists: ${clash.en}.`)}</p>}
        {err && <p role="alert">{err}</p>}
        <div className="modal-foot"><button type="button" className="btn-sec" onClick={onClose}>{t('Annuler', 'Cancel')}</button><button type="submit" disabled={busy || !!clash}>{t('Enregistrer', 'Save')}</button></div>
      </form>
    </Modal>
  );
}

function ActivateDialog({ c, onClose, onDone }: { c: Country; onClose: () => void; onDone: (m: string) => void }) {
  const { t, fr } = useLang(); const [model, setModel] = useState('numeric'); const [err, setErr] = useState('');
  return (
    <Modal title={t(`Activer ${c.fr}`, `Activate ${c.n}`)} onClose={onClose} small>
      <form onSubmit={async (e) => { e.preventDefault(); const r = await api(`/geo/countries/${c.c}/activate`, { method: 'POST', online: true, body: { model, locale: fr ? 'fr' : 'en' } }); if (!r.ok) setErr(msgOf(r)); else onDone(t(`${c.fr} est activé : on peut y créer des écoles.`, `${c.n} is activated: schools can be created there.`)); }}>
        <p>{t('L’activation crée le référentiel du pays (système éducatif, notation, calendrier) à partir d’un modèle ; vous pourrez l’adapter ensuite.', 'Activation creates the country’s reference data (education system, grading, calendar) from a model; you can adapt it afterwards.')}</p>
        <label>{t('Système de notation', 'Grading system')}<select data-autofocus value={model} onChange={(e) => setModel(e.target.value)}>
          <option value="numeric">{t('Chiffré /10, /20 (modèle Gabon)', 'Numeric /10, /20 (Gabon model)')}</option><option value="letters">{t('Lettres A+ à E-', 'Letters A+ to E-')}</option><option value="percent">{t('Pourcentage /100', 'Percentage /100')}</option></select></label>
        {err && <p role="alert">{err}</p>}
        <div className="modal-foot"><button type="button" className="btn-sec" onClick={onClose}>{t('Annuler', 'Cancel')}</button><button type="submit">{t('Activer ce pays', 'Activate this country')}</button></div>
      </form>
    </Modal>
  );
}

interface Region { id: number; name: string; cities: number; custom: boolean }
/** Provinces and cities of one country: add, rename, trash. */
function Places({ country, onClose }: { country: Country; onClose: () => void }) {
  const { t, fr } = useLang(); const explain = useExplain();
  const [regions, setRegions] = useState<Region[]>([]); const [rid, setRid] = useState<number | null>(null); const [cities, setCities] = useState<{ name: string; custom?: boolean }[]>([]);
  const [rname, setRname] = useState(''); const [cname, setCname] = useState(''); const [cq, setCq] = useState(''); const [edit, setEdit] = useState<Region | null>(null); const [ename, setEname] = useState('');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState('');
  const loadR = useCallback(async () => { const r = await api<Region[]>(`/geo/countries/${country.c}/regions`); setRegions(r.data ?? []); }, [country.c]);
  const loadC = useCallback(async () => { if (rid === null) { setCities([]); return; } const r = await api(`/geo/countries/${country.c}/cities?region=${rid}&q=${encodeURIComponent(cq)}&limit=500`); setCities(r.data ?? []); }, [country.c, rid, cq]);
  useEffect(() => { void loadR(); }, [loadR]);
  useEffect(() => { const h = setTimeout(() => void loadC(), 200); return () => clearTimeout(h); }, [loadC]);
  const region = regions.find((r) => r.id === rid);
  const rClash = rname && regions.some((r) => fold(r.name) === fold(rname));
  const cClash = cname && cities.length < 500 && cities.some((c) => fold(c.name) === fold(cname)) && !cq;

  const addRegion = async (e: React.FormEvent) => { e.preventDefault(); const r = await api(`/geo/countries/${country.c}/regions`, { method: 'POST', online: true, body: { name: rname } }); if (!r.ok) { setErr(explain(r, rname)); return; } setErr(''); setMsg(t(`Province « ${rname} » ajoutée.`, `Province “${rname}” added.`)); setRname(''); await loadR(); };
  const addCity = async (e: React.FormEvent) => { e.preventDefault(); if (rid === null) return; const r = await api(`/geo/countries/${country.c}/cities`, { method: 'POST', online: true, body: { region_id: rid, name: cname } }); if (!r.ok) { setErr(explain(r, cname)); return; } setErr(''); setMsg(t(`Ville « ${cname} » ajoutée.`, `City “${cname}” added.`)); setCname(''); await Promise.all([loadC(), loadR()]); };
  const delRegion = async (r: Region) => { const x = await api(`/geo/countries/${country.c}/regions/${r.id}`, { method: 'DELETE', online: true }); if (!x.ok) { setErr(explain(x, r.name)); return; } setErr(''); setMsg(t(`« ${r.name} » est à la corbeille.`, `“${r.name}” is in the trash.`)); if (rid === r.id) setRid(null); await loadR(); };
  const delCity = async (name: string) => { const x = await api(`/geo/countries/${country.c}/cities?region_id=${rid}&name=${encodeURIComponent(name)}`, { method: 'DELETE', online: true }); if (!x.ok) { setErr(explain(x, name)); return; } setErr(''); setMsg(t(`« ${name} » est à la corbeille.`, `“${name}” is in the trash.`)); await Promise.all([loadC(), loadR()]); };
  const rename = async (e: React.FormEvent) => { e.preventDefault(); if (!edit) return; const x = await api(`/geo/countries/${country.c}/regions/${edit.id}`, { method: 'PATCH', online: true, body: { name: ename } }); if (!x.ok) { setErr(explain(x, ename)); return; } setErr(''); setEdit(null); await loadR(); };

  return (
    <Modal title={`${fr ? country.fr : country.n} — ${t('provinces et villes', 'provinces and cities')}`} onClose={onClose}>
      {err && <p role="alert">{err}</p>}{msg && <p role="status">{msg}</p>}
      <h3>{t(`Provinces et régions (${regions.length})`, `Provinces and regions (${regions.length})`)}</h3>
      <form onSubmit={addRegion}><label>{t('Nouvelle province', 'New province')}<input value={rname} onChange={(e) => setRname(e.target.value)} required maxLength={80} /></label><button type="submit" disabled={!!rClash}>{t('Ajouter', 'Add')}</button></form>
      {rClash && <p role="alert">{t(`La province « ${rname} » existe déjà.`, `The province “${rname}” already exists.`)}</p>}
      <ul className="list-pick">{regions.map((r) => (
        <li key={r.id}>
          {edit?.id === r.id ? (
            <form onSubmit={rename}><input aria-label={t('Nouveau nom', 'New name')} data-autofocus value={ename} onChange={(e) => setEname(e.target.value)} required /><button type="submit">OK</button><button type="button" className="btn-sec" onClick={() => setEdit(null)}>{t('Annuler', 'Cancel')}</button></form>
          ) : (
            <div className="toolbar" style={{ flexWrap: 'nowrap' }}>
              <button type="button" aria-pressed={rid === r.id} onClick={() => setRid(r.id)}><span>{r.name}</span><span>{r.cities}</span></button>
              <button type="button" className="btn-sec" aria-label={`${t('Renommer', 'Rename')} ${r.name}`} onClick={() => { setEdit(r); setEname(r.name); }}><Icon name="edit" /></button>
              <button type="button" className="btn-danger" aria-label={`${t('Corbeille', 'Trash')} ${r.name}`} onClick={() => delRegion(r)}><Icon name="trash" /></button>
            </div>)}
        </li>))}</ul>
      {region && (<>
        <h3>{t(`Villes de ${region.name}`, `Cities of ${region.name}`)}</h3>
        <form onSubmit={addCity}><label>{t('Nouvelle ville', 'New city')}<input value={cname} onChange={(e) => setCname(e.target.value)} required maxLength={80} /></label><button type="submit" disabled={!!cClash}>{t('Ajouter', 'Add')}</button></form>
        {cClash && <p role="alert">{t(`La ville « ${cname} » existe déjà dans cette province.`, `The city “${cname}” already exists in this province.`)}</p>}
        <label>{t('Rechercher une ville', 'Search a city')}<input type="search" value={cq} onChange={(e) => setCq(e.target.value)} /></label>
        {cities.length === 0 ? <div className="empty-state"><Icon name="pin" />{t('Aucune ville.', 'No city.')}</div> : (
          <table><tbody>{cities.slice(0, 200).map((c) => <tr key={c.name}><td>{c.name}{c.custom && <> <span className="badge">{t('ajoutée', 'added')}</span></>}</td><td style={{ width: 1 }}><button type="button" className="btn-danger" aria-label={`${t('Corbeille', 'Trash')} ${c.name}`} onClick={() => delCity(c.name)}><Icon name="trash" /></button></td></tr>)}</tbody></table>
        )}
        {cities.length > 200 && <p><small>{t('Les 200 premières villes sont affichées : affinez la recherche.', 'The first 200 cities are shown: refine the search.')}</small></p>}
      </>)}
      <div className="modal-foot"><button type="button" onClick={onClose}>{t('Fermer', 'Close')}</button></div>
    </Modal>
  );
}
