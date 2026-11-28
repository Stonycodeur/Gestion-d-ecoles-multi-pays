'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import GeoPicker, { EMPTY_GEO, type GeoCountryInfo, type GeoValue } from '../../components/GeoPicker';
import Confirm from '../../components/Confirm';
import { api, setContext } from '../../lib/api';
import { useLang } from '../../lib/useLang';

const TYPES: [string, string, string][] = [['primary', 'Primaire', 'Primary'], ['college', 'Collège', 'Lower secondary'], ['lycee', 'Lycée', 'Upper secondary'], ['university', 'Université / Supérieur', 'University']];
const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
const msgOf = (r: { error?: string }) => { try { const e = JSON.parse(r.error ?? '""'); return typeof e === 'string' ? e : Array.isArray(e) ? e.join(', ') : JSON.stringify(e); } catch { return r.error ?? 'error'; } };

export default function RootConsole() {
  const { fr, t, l } = useLang();
  const [ov, setOv] = useState<any>(null); const [schools, setSchools] = useState<any[]>([]); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const [denied, setDenied] = useState(false);
  const [f, setF] = useState({ name: '', slug: '', school_type: 'lycee', scale: '', model: 'numeric', locale: 'fr' }); const [slugTouched, setSlugTouched] = useState(false);
  const [geo, setGeo] = useState<GeoValue>(EMPTY_GEO); const [country, setCountry] = useState<GeoCountryInfo | null>(null); const [prop, setProp] = useState<any>(null);
  const [created, setCreated] = useState(''); const [del, setDel] = useState<any>(null);

  const load = useCallback(async () => {
    const o = await api('/admin/overview'); if (!o.ok) { setDenied(true); return; }
    setOv(o.data); const s = await api('/tenants'); setSchools(s.data ?? []);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    setProp(null); if (!country?.activated) return;
    api(`/tenants/proposals?country_code=${country.c}&school_type=${f.school_type}`).then((r) => setProp(r.ok ? r.data : null));
  }, [country, f.school_type]);

  const create = async () => {
    setErr(''); setMsg(''); setCreated('');
    if (!country) { setErr(t('Choisissez le pays de l’école.', 'Choose the school’s country.')); return; }
    if (!country.activated) {
      const a = await api(`/geo/countries/${country.c}/activate`, { method: 'POST', online: true, body: { model: f.model, locale: f.locale } });
      if (!a.ok) { setErr(msgOf(a)); return; }
    }
    const r = await api('/tenants', { method: 'POST', online: true, body: { slug: f.slug, name: f.name, school_type: f.school_type, country_code: country.c, region: geo.region, city: geo.city, grading_scale_code: f.scale || undefined, with_default_modules: true } });
    if (!r.ok) { setErr(msgOf(r)); return; }
    setMsg(t(`École « ${f.name} » créée avec son espace de données isolé.`, `School “${f.name}” created with its own isolated data space.`)); setCreated(f.slug);
    setF({ ...f, name: '', slug: '', scale: '' }); setSlugTouched(false); setGeo(EMPTY_GEO); setCountry(null); await load();
  };
  const toggle = async (s: any) => { const r = await api(`/tenants/${s.slug}`, { method: 'PATCH', online: true, body: { active: !s.active } }); setErr(r.ok ? '' : msgOf(r)); await load(); };
  const open = (slug: string) => { setContext(slug); window.location.assign('/'); };

  if (denied) return <Shell><h1>{t('Console racine', 'Root console')}</h1><p role="alert">{t('Accès réservé au Super-Admin racine.', 'Reserved to the root super-admin.')}</p></Shell>;
  return (
    <Shell>
      <div className="hero"><h1>{t('Console racine', 'Root console')}</h1><p>{t('Pilotez toute la plateforme : créez des écoles dans n’importe quel pays, gérez les accès et agissez dans chaque établissement sans limite.', 'Run the whole platform: create schools in any country, manage access and act inside every school without limits.')}</p></div>

      <div className="stats" aria-label={t('Chiffres clés', 'Key figures')}>
        <div className="stat"><strong>{ov?.schools ?? '—'}</strong><span>{t('Écoles', 'Schools')}</span></div>
        <div className="stat"><strong>{ov?.active_schools ?? '—'}</strong><span>{t('Écoles actives', 'Active schools')}</span></div>
        <div className="stat"><strong>{ov?.countries ?? '—'}</strong><span>{t('Pays activés', 'Activated countries')}</span></div>
        <div className="stat"><strong>{ov?.accounts ?? '—'}</strong><span>{t('Comptes', 'Accounts')}</span></div>
        <div className="stat"><strong>{ov?.world?.countries ?? '—'}</strong><span>{t('Pays du monde disponibles', 'World countries available')}</span></div>
      </div>

      <h2 style={{ marginTop: 0 }}>{t('Établissements', 'Schools')}</h2>
      {schools.length === 0 ? <p className="empty">{t('Aucune école pour le moment : créez la première ci-dessous.', 'No school yet: create the first one below.')}</p> : (
        <table>
          <thead><tr><th>{t('École', 'School')}</th><th>{t('Type', 'Type')}</th><th>{t('Pays', 'Country')}</th><th>{t('Province', 'Province')}</th><th>{t('Ville', 'City')}</th><th>{t('Statut', 'Status')}</th><th>{t('Actions', 'Actions')}</th></tr></thead>
          <tbody>{schools.map((s) => (
            <tr key={s.id}>
              <td><strong>{s.name}</strong><br /><small>{s.slug}</small></td>
              <td>{TYPES.find((x) => x[0] === s.school_type)?.[fr ? 1 : 2] ?? s.school_type}</td>
              <td>{s.country_code}</td><td>{s.region ?? '—'}</td><td>{s.city ?? '—'}</td>
              <td><span className={`badge ${s.active ? 'ok' : 'off'}`}>{s.active ? t('Active', 'Active') : t('Désactivée', 'Inactive')}</span></td>
              <td><div className="actions">
                <button onClick={() => open(s.slug)}>{t('Ouvrir', 'Open')}</button>
                <Link className="btn-link" href={`/root/accounts?school=${s.slug}`}>{t('Comptes', 'Accounts')}</Link>
                <button onClick={() => toggle(s)}>{s.active ? t('Désactiver', 'Deactivate') : t('Activer', 'Activate')}</button>
                <button className="btn-danger" onClick={() => setDel(s)}>{t('Corbeille', 'Trash')}</button>
              </div></td>
            </tr>))}</tbody>
        </table>
      )}

      <section aria-labelledby="h-new">
        <h2 id="h-new">{t('Créer un établissement', 'Create a school')}</h2>
        {msg && <p role="status">{msg} {created && <Link href={`/root/accounts?school=${created}`}>{t('Créer son Super-Admin →', 'Create its Super-Admin →')}</Link>}</p>}
        {err && <p role="alert">{err}</p>}
        <div className="form-grid">
          <label>{t('Nom de l’établissement', 'School name')}<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) })} /></label>
          <label>{t('Identifiant (sous-domaine)', 'Identifier (subdomain)')}<input value={f.slug} onChange={(e) => { setSlugTouched(true); setF({ ...f, slug: slugify(e.target.value) }); }} /></label>
          <label>{t('Type', 'Type')}<select value={f.school_type} onChange={(e) => setF({ ...f, school_type: e.target.value, scale: '' })}>{TYPES.map((x) => <option key={x[0]} value={x[0]}>{fr ? x[1] : x[2]}</option>)}</select></label>
        </div>
        <GeoPicker value={geo} onChange={setGeo} onCountry={setCountry} />
        {country && !country.activated && (
          <fieldset>
            <legend>{t(`Activer ${country.fr} sur la plateforme`, `Activate ${country.n} on the platform`)}</legend>
            <p>{t('Ce pays n’a pas encore de référentiel. Il sera créé automatiquement (système éducatif, échelles de notation, calendrier) ; tout reste modifiable ensuite.', 'This country has no reference data yet. It will be created automatically (education system, grading scales, calendar); everything stays editable afterwards.')}</p>
            <div className="form-grid">
              <label>{t('Système de notation', 'Grading system')}<select value={f.model} onChange={(e) => setF({ ...f, model: e.target.value })}>
                <option value="numeric">{t('Chiffré : /10 primaire, /20 ensuite (modèle Gabon)', 'Numeric: /10 primary, /20 after (Gabon model)')}</option>
                <option value="letters">{t('Lettres A+ à E-', 'Letters A+ to E-')}</option>
                <option value="percent">{t('Pourcentage /100', 'Percentage /100')}</option></select></label>
              <label>{t('Langue par défaut', 'Default language')}<select value={f.locale} onChange={(e) => setF({ ...f, locale: e.target.value })}><option value="fr">Français</option><option value="en">English</option><option value="ar">العربية</option></select></label>
            </div>
          </fieldset>
        )}
        {country?.activated && prop && (
          <div className="form-grid" style={{ marginTop: 12 }}>
            <label>{t('Échelle de notation', 'Grading scale')}<select value={f.scale} onChange={(e) => setF({ ...f, scale: e.target.value })}>
              <option value="">{t('Défaut du pays', 'Country default')} ({prop.default_scale})</option>{prop.scales.map((s: any) => <option key={s.code} value={s.code}>{s.code}</option>)}</select></label>
          </div>
        )}
        <p style={{ marginTop: 14 }}><button onClick={create} disabled={!f.name || f.slug.length < 2 || !country}>{t('Créer l’établissement', 'Create the school')}</button></p>
        <small className="muted">{t('Une base isolée (83 tables) est créée pour l’école, protégée par la sécurité par ligne.', 'An isolated database space (83 tables) is created for the school, protected by row-level security.')}</small>
      </section>

      <h2>{t('Journal d’audit récent', 'Recent audit trail')}</h2>
      {ov?.audit?.length ? (
        <table>
          <thead><tr><th>{t('Date', 'Date')}</th><th>{t('Acteur', 'Actor')}</th><th>{t('Action', 'Action')}</th><th>{t('Détails', 'Details')}</th></tr></thead>
          <tbody>{ov.audit.map((a: any) => <tr key={a.id}><td>{new Date(a.at).toLocaleString(l)}</td><td>{a.actor_email ?? '—'}</td><td><code>{a.action}</code></td><td><small>{a.details ? JSON.stringify(a.details).slice(0, 110) : ''}</small></td></tr>)}</tbody>
        </table>
      ) : <p className="empty">{t('Aucune action enregistrée.', 'No recorded action.')}</p>}
      {del && <Confirm title={t('Mettre l’école à la corbeille ?', 'Move the school to the trash?')} body={t(`« ${del.name} » sera désactivée et masquée ; ses données restent intactes jusqu’à la suppression définitive. Vous pouvez la restaurer depuis la corbeille.`, `“${del.name}” will be deactivated and hidden; its data stays intact until permanent deletion. You can restore it from the trash.`)} label={t('Mettre à la corbeille', 'Move to trash')}
        onClose={() => setDel(null)} onConfirm={async () => { const r = await api(`/tenants/${del.slug}`, { method: 'DELETE', online: true }); setErr(r.ok ? '' : msgOf(r)); setDel(null); await load(); }} />}
    </Shell>
  );
}
