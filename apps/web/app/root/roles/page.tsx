'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Shell from '../../../components/Shell';
import Confirm from '../../../components/Confirm';
import Icon from '../../../components/Icon';
import { api } from '../../../lib/api';
import { msgOf } from '../../../lib/profile';
import { useLang } from '../../../lib/useLang';

interface Role { code: string; label_fr: string; label_en: string; scope: string; editable: boolean; permissions: string[]; changed: boolean }
interface Matrix { roles: Role[]; permissions: { code: string; group: string }[] }

/** Roles and permissions: which role may do what. Changes apply platform-wide; the root and visitor roles are fixed. */
export default function RolesPage() {
  const { t, fr } = useLang();
  const [m, setM] = useState<Matrix | null>(null); const [code, setCode] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set()); const [q, setQ] = useState('');
  const [msg, setMsg] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [reset, setReset] = useState(false);

  const load = useCallback(async (keep?: string) => {
    const r = await api<Matrix>('/roles/matrix');
    if (!r.ok || !r.data) { setErr(msgOf(r)); return; }
    setM(r.data);
    const pick = r.data.roles.find((x) => x.code === (keep ?? code)) ?? r.data.roles.find((x) => x.editable) ?? r.data.roles[0];
    setCode(pick.code); setDraft(new Set(pick.permissions));
  }, [code]);
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const role = m?.roles.find((r) => r.code === code);
  const groups = useMemo(() => {
    const g = new Map<string, string[]>();
    for (const p of m?.permissions ?? []) if (!q || p.code.includes(q.toLowerCase())) g.set(p.group, [...(g.get(p.group) ?? []), p.code]);
    return [...g.entries()];
  }, [m, q]);
  const dirty = !!role && (draft.size !== role.permissions.length || role.permissions.some((p) => !draft.has(p)));
  const label = (r: Role) => (fr ? r.label_fr : r.label_en);
  const toggle = (p: string) => { const n = new Set(draft); if (n.has(p)) n.delete(p); else n.add(p); setDraft(n); setMsg(''); };
  const toggleGroup = (ps: string[], on: boolean) => { const n = new Set(draft); for (const p of ps) { if (on) n.add(p); else n.delete(p); } setDraft(n); setMsg(''); };
  const pickRole = (c: string) => { const r = m!.roles.find((x) => x.code === c)!; setCode(c); setDraft(new Set(r.permissions)); setMsg(''); setErr(''); };

  const save = async () => {
    if (!role) return; setBusy(true); setErr('');
    const r = await api(`/roles/${role.code}/permissions`, { method: 'PUT', online: true, body: { permissions: [...draft] } });
    setBusy(false);
    if (!r.ok) { setErr(msgOf(r)); return; }
    setMsg(t('Permissions enregistrées. Elles s’appliquent à tous les comptes de ce rôle.', 'Permissions saved. They apply to every account with this role.')); await load(role.code);
  };
  const doReset = async () => {
    if (!role) return; const r = await api(`/roles/${role.code}/reset`, { method: 'POST', online: true });
    setReset(false); if (!r.ok) { setErr(msgOf(r)); return; }
    setMsg(t('Permissions d’origine rétablies.', 'Default permissions restored.')); await load(role.code);
  };

  return (
    <Shell>
      <div className="page-head"><div><h1>{t('Rôles et permissions', 'Roles and permissions')}</h1><small>{t('Ce que chaque rôle peut faire dans la plateforme', 'What each role may do on the platform')}</small></div></div>
      <p className="muted">{t('Choisissez un rôle, cochez ce qu’il peut faire, puis enregistrez. Le Super-Admin racine (immuable) et le Visiteur ne sont pas modifiables. Les changements valent pour toutes les écoles.', 'Pick a role, tick what it may do, then save. The root Super-Admin (immutable) and the Visitor are not editable. Changes apply to all schools.')}</p>
      {err && <p role="alert">{err}</p>}{msg && <p role="status">{msg}</p>}
      {!m ? <p>{t('Chargement…', 'Loading…')}</p> : (
        <div className="matrix-layout">
          <nav aria-label={t('Rôles', 'Roles')}>
            <ul className="list-pick">{m.roles.map((r) => (
              <li key={r.code}><button type="button" aria-pressed={r.code === code} onClick={() => pickRole(r.code)}>
                <span>{label(r)}{r.changed && <> <span className="badge">{t('modifié', 'changed')}</span></>}</span>
                <span>{r.editable ? r.permissions.length : <Icon name="lock" />}</span></button></li>))}</ul>
          </nav>
          {role && (
            <section aria-labelledby="h-role">
              <div className="page-head"><h2 id="h-role" style={{ margin: 0 }}>{label(role)}</h2>
                {role.editable && <div className="row-actions">
                  <button type="button" className="btn-sec" disabled={!role.changed} onClick={() => setReset(true)}><Icon name="restore" /> {t('Rétablir les valeurs d’origine', 'Restore defaults')}</button>
                  <button type="button" disabled={!dirty || busy} onClick={save}>{t('Enregistrer', 'Save')}</button></div>}</div>
              {!role.editable && <p role="note"><Icon name="lock" /> {t('Ce rôle est fixe et ne peut pas être modifié.', 'This role is fixed and cannot be changed.')}</p>}
              <label className="grow"><span className="sr-only">{t('Filtrer', 'Filter')}</span><input type="search" placeholder={t('Filtrer les permissions…', 'Filter permissions…')} value={q} onChange={(e) => setQ(e.target.value)} /></label>
              {groups.map(([g, ps]) => {
                const on = ps.filter((p) => draft.has(p)).length;
                return (
                  <fieldset key={g} className="perm-group">
                    <legend>{g} <small>({on}/{ps.length})</small></legend>
                    {role.editable && <div className="row-actions"><button type="button" className="btn-sec" onClick={() => toggleGroup(ps, true)}>{t('Tout cocher', 'Select all')}</button><button type="button" className="btn-sec" onClick={() => toggleGroup(ps, false)}>{t('Tout décocher', 'Clear all')}</button></div>}
                    <div className="perm-grid">{ps.map((p) => (
                      <label key={p} className="check"><input type="checkbox" checked={draft.has(p)} disabled={!role.editable} onChange={() => toggle(p)} /> <code>{p}</code></label>))}</div>
                  </fieldset>);
              })}
              {groups.length === 0 && <div className="empty-state"><Icon name="search" />{t('Aucune permission ne correspond.', 'No permission matches.')}</div>}
            </section>)}
        </div>)}
      {reset && role && <Confirm title={t('Rétablir les valeurs d’origine ?', 'Restore defaults?')} body={t(`Les permissions du rôle « ${label(role)} » reviendront à leur réglage d’origine.`, `The “${label(role)}” role’s permissions go back to their defaults.`)} label={t('Rétablir', 'Restore')} danger={false} onConfirm={doReset} onClose={() => setReset(false)} />}
    </Shell>
  );
}
