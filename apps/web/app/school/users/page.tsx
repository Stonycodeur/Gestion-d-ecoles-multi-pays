'use client';
import { useEffect, useMemo, useState } from 'react';
import Shell from '../../../components/Shell';
import Modal from '../../../components/Modal';
import Confirm from '../../../components/Confirm';
import Icon from '../../../components/Icon';
import { api, setViewAs } from '../../../lib/api';
import { useLang } from '../../../lib/useLang';
import { useNavigation } from '../../../lib/navigation';

interface U { id: string; email: string; role: string; active: boolean; last_sign_in_at: string | null; created_at: string; manageable: boolean; [k: string]: any }
const ROLE: Record<string, [string, string]> = { tenant_super_admin: ['Super-admin de l’école', 'School super-admin'], admin: ['Administrateur', 'Administrator'], head: ['Direction', 'Head'], teacher: ['Enseignant', 'Teacher'], education_assistant: ['Assistant d’éducation', 'Education assistant'], accountant: ['Comptable', 'Accountant'], student: ['Élève / étudiant', 'Student'], guardian: ['Parent / tuteur', 'Parent / guardian'], inspector: ['Inspecteur', 'Inspector'] };
const csvCell = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;

/** Accounts of this school: what the school's administrator may manage, never above their own rank. */
export default function SchoolUsersPage() {
  const { t, fr } = useLang(); const { has, loaded } = useNavigation();
  const [users, setUsers] = useState<U[] | null>(null); const [roles, setRoles] = useState<string[]>([]); const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [q, setQ] = useState(''); const [fr_, setFr] = useState(''); const [fs, setFs] = useState('');
  const [create, setCreate] = useState(false); const [open, setOpen] = useState<U | null>(null); const [del, setDel] = useState<U | null>(null);
  const rl = (r: string) => (ROLE[r] ? ROLE[r][fr ? 0 : 1] : r); const fmt = (d: string | null) => (d ? new Date(d).toLocaleString(fr ? 'fr-FR' : 'en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—');
  const load = async () => { const r = await api('/school/users'); if (r.ok) { setUsers(r.data.users); setRoles(r.data.assignable_roles); setErr(''); } else { setUsers([]); setErr(r.status === 403 ? t('Vous n’avez pas le droit de gérer les utilisateurs.', 'You are not allowed to manage users.') : `${t('Erreur', 'Error')} : ${r.error}`); } };
  useEffect(() => { void load(); }, []);
  const shown = useMemo(() => (users ?? []).filter((u) => (!q || u.email.toLowerCase().includes(q.toLowerCase())) && (!fr_ || u.role === fr_) && (!fs || (fs === 'active') === u.active)), [users, q, fr_, fs]);
  const exportCsv = () => { const head = ['email', 'role', 'status', 'last_sign_in', 'created']; const body = shown.map((u) => [u.email, u.role, u.active ? 'active' : 'inactive', u.last_sign_in_at ?? '', u.created_at]); const blob = new Blob(['﻿' + [head, ...body].map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'utilisateurs.csv'; a.click(); URL.revokeObjectURL(a.href); };
  if (loaded && !has('users:manage')) return <Shell><h1>{t('Utilisateurs', 'Users')}</h1><div className="empty-state"><p>{t('Vous n’avez pas accès à cette page.', 'You do not have access to this page.')}</p></div></Shell>;
  return (
    <Shell>
      <h1>{t('Utilisateurs', 'Users')}</h1>
      <div className="toolbar">
        <input type="search" aria-label={t('Rechercher par e-mail', 'Search by email')} placeholder={t('Rechercher par e-mail…', 'Search by email…')} value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label={t('Rôle', 'Role')} value={fr_} onChange={(e) => setFr(e.target.value)}><option value="">{t('Tous les rôles', 'All roles')}</option>{[...new Set((users ?? []).map((u) => u.role))].map((r) => <option key={r} value={r}>{rl(r)}</option>)}</select>
        <select aria-label={t('Statut', 'Status')} value={fs} onChange={(e) => setFs(e.target.value)}><option value="">{t('Tous les statuts', 'All statuses')}</option><option value="active">{t('Actifs', 'Active')}</option><option value="inactive">{t('Inactifs', 'Inactive')}</option></select>
        <button type="button" className="btn-sec" onClick={exportCsv} disabled={!shown.length}>{t('Exporter (CSV)', 'Export (CSV)')}</button>
        <button type="button" onClick={() => setCreate(true)} disabled={!roles.length}>{t('Nouvel utilisateur', 'New user')}</button>
      </div>
      {err && <p role="alert">{err}</p>}{note && <p role="status">{note}</p>}
      {users === null ? <p aria-busy="true">{t('Chargement…', 'Loading…')}</p> : <div className="table-wrap"><table>
        <thead><tr><th scope="col">E-mail</th><th scope="col">{t('Rôle', 'Role')}</th><th scope="col">{t('Statut', 'Status')}</th><th scope="col">{t('Dernière connexion', 'Last sign-in')}</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{shown.map((u) => <tr key={u.id}><td>{u.email}</td><td>{rl(u.role)}</td><td><span className={`chip ${u.active ? 'ok' : 'off'}`}>{u.active ? t('Actif', 'Active') : t('Inactif', 'Inactive')}</span></td><td>{fmt(u.last_sign_in_at)}</td>
          <td className="row-actions"><button type="button" className="btn-sec" onClick={() => setOpen(u)} aria-label={`${t('Détails de', 'Details of')} ${u.email}`}><Icon name="user" /> {t('Détails', 'Details')}</button></td></tr>)}
          {!shown.length && <tr><td colSpan={5}>{t('Aucun utilisateur.', 'No users.')}</td></tr>}</tbody></table></div>}
      {create && <CreateDialog roles={roles} rl={rl} onClose={() => setCreate(false)} onDone={async (m) => { setCreate(false); setNote(m); await load(); }} />}
      {open && <DetailDialog u={open} rl={rl} fmt={fmt} onClose={() => setOpen(null)} onChanged={async (m) => { if (m) setNote(m); await load(); }} onTrash={() => { setDel(open); setOpen(null); }} />}
      {del && <Confirm title={t('Mettre à la corbeille', 'Move to trash')} body={t(`Le compte ${del.email} ne pourra plus se connecter. Il reste récupérable depuis la corbeille.`, `The account ${del.email} will no longer be able to sign in. It can be restored from the trash.`)} label={t('Mettre à la corbeille', 'Move to trash')}
        onClose={() => setDel(null)} onConfirm={async () => { const r = await api(`/school/users/${del.id}`, { method: 'DELETE' }); setErr(r.ok ? '' : `${t('Erreur', 'Error')} : ${r.error}`); setNote(r.ok ? t('Compte mis à la corbeille.', 'Account moved to the trash.') : ''); setDel(null); await load(); }} />}
    </Shell>
  );
}

function CreateDialog({ roles, rl, onClose, onDone }: { roles: string[]; rl: (r: string) => string; onClose: () => void; onDone: (m: string) => void }) {
  const { t } = useLang(); const [email, setEmail] = useState(''); const [role, setRole] = useState(roles[0] ?? ''); const [password, setPassword] = useState(''); const [err, setErr] = useState('');
  return (
    <Modal title={t('Nouvel utilisateur', 'New user')} onClose={onClose}>
      <form className="school-form" onSubmit={async (e) => { e.preventDefault(); setErr(''); const r = await api('/school/users', { method: 'POST', body: { email, role, password: password || undefined } }); if (!r.ok) { setErr(`${t('Erreur', 'Error')} : ${r.error}`); return; } onDone(r.data?.temporary_password ? `${t('Compte créé. Mot de passe temporaire (à transmettre une seule fois) :', 'Account created. Temporary password (hand it over once):')} ${r.data.temporary_password}` : t('Compte créé.', 'Account created.')); }}>
        <label>E-mail<input type="email" required data-autofocus value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>{t('Rôle', 'Role')}<select value={role} onChange={(e) => setRole(e.target.value)}>{roles.map((r) => <option key={r} value={r}>{rl(r)}</option>)}</select></label>
        <label>{t('Mot de passe (laisser vide pour en générer un temporaire)', 'Password (leave empty to generate a temporary one)')}<input type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {err && <p role="alert">{err}</p>}
        <div className="modal-foot"><button type="button" className="btn-sec" onClick={onClose}>{t('Annuler', 'Cancel')}</button><button type="submit">{t('Créer', 'Create')}</button></div>
      </form>
    </Modal>
  );
}

function DetailDialog({ u, rl, fmt, onClose, onChanged, onTrash }: { u: U; rl: (r: string) => string; fmt: (d: string | null) => string; onClose: () => void; onChanged: (m?: string) => Promise<void>; onTrash: () => void }) {
  const { t } = useLang(); const [d, setD] = useState<U>(u); const [msg, setMsg] = useState(''); const [pw, setPw] = useState(''); const [sub, setSub] = useState<'' | 'rights' | 'history'>('');
  useEffect(() => { void api(`/school/users/${u.id}`).then((r) => { if (r.ok) setD(r.data); }); }, [u.id]);
  const act = async (path: string, body: unknown, ok: string, method = 'POST') => { const r = await api(`/school/users/${u.id}${path}`, { method, body }); if (!r.ok) { setMsg(`${t('Erreur', 'Error')} : ${r.error}`); return; } setMsg(r.data?.temporary_password ? `${ok} ${r.data.temporary_password}` : ok); if (path === '/active') setD({ ...d, active: !!(body as any).active }); if (path === '/lock') setD({ ...d, locked: !!(body as any).locked }); if (path === '/force-password-change') setD({ ...d, must_change_password: !!(body as any).on }); await onChanged(); };
  const row = (k: string, v: React.ReactNode) => <div className="kv"><dt>{k}</dt><dd>{v}</dd></div>;
  return (
    <>
    <Modal title={d.email} onClose={onClose}>
      <dl className="kv-list">
        {row('E-mail', d.email)}{row(t('Rôle', 'Role'), rl(d.role))}{row(t('Statut', 'Status'), d.active ? t('Actif', 'Active') : t('Inactif', 'Inactive'))}
        {d.phone_number !== undefined && row(t('Téléphone', 'Phone'), d.phone_number ? `${d.phone_country ?? ''} ${d.phone_number}`.trim() : '—')}
        {d.mfa !== undefined && row(t('Double authentification', 'Two-factor'), d.mfa ? t('Activée', 'On') : t('Non activée', 'Off'))}
        {d.sessions !== undefined && row(t('Sessions ouvertes', 'Open sessions'), String(d.sessions))}
        {row(t('Dernière connexion', 'Last sign-in'), fmt(d.last_sign_in_at))}{row(t('Créé le', 'Created'), fmt(d.created_at))}
        {d.locked && row(t('Compte', 'Account'), t('Verrouillé', 'Locked'))}{d.must_change_password && row(t('Mot de passe', 'Password'), t('Changement exigé', 'Change required'))}
      </dl>
      {msg && <p role="status">{msg}</p>}
      {d.manageable ? (
        <div className="school-form">
          <div className="toolbar">
            <button type="button" className="btn-sec" onClick={() => act('/active', { active: !d.active }, d.active ? t('Compte désactivé.', 'Account deactivated.') : t('Compte activé.', 'Account activated.'))}>{d.active ? t('Désactiver', 'Deactivate') : t('Activer', 'Activate')}</button>
            <button type="button" className="btn-sec" onClick={() => act('/close-sessions', {}, t('Sessions fermées.', 'Sessions closed.'))}>{t('Fermer les sessions', 'Close sessions')}</button>
            <button type="button" className="btn-sec" onClick={() => act('/lock', { locked: !d.locked }, d.locked ? t('Compte déverrouillé.', 'Account unlocked.') : t('Compte verrouillé, sessions fermées.', 'Account locked, sessions closed.'))}>{d.locked ? t('Déverrouiller', 'Unlock') : t('Verrouiller', 'Lock')}</button>
            <button type="button" className="btn-sec" onClick={() => act('/force-password-change', { on: !d.must_change_password }, d.must_change_password ? t('Exigence annulée.', 'Requirement cancelled.') : t('Cette personne devra changer son mot de passe à sa prochaine action.', 'This person must change their password on their next action.'))}>{d.must_change_password ? t('Annuler le changement forcé', 'Cancel forced change') : t('Forcer le changement de mot de passe', 'Force password change')}</button>
            <button type="button" className="btn-danger" onClick={onTrash}>{t('Corbeille', 'Trash')}</button>
          </div>
          <div className="toolbar">
            <button type="button" className="btn-sec" onClick={() => setSub('rights')}>{t('Droits individuels', 'Personal rights')}</button>
            <button type="button" className="btn-sec" onClick={() => setSub('history')}>{t('Historique des connexions', 'Sign-in history')}</button>
            <button type="button" className="btn-sec" onClick={() => { setViewAs({ id: d.id, label: d.email }); location.assign('/'); }}><Icon name="eye" /> {t('Prendre le contrôle (lecture seule)', 'Take over (read-only)')}</button>
          </div>
          <label>{t('Nouveau mot de passe (vide = mot de passe temporaire généré)', 'New password (empty = generated temporary password)')}<input type="text" autoComplete="off" value={pw} onChange={(e) => setPw(e.target.value)} /></label>
          <div><button type="button" onClick={() => act('/password', { password: pw || undefined }, t('Mot de passe changé. Temporaire :', 'Password changed. Temporary:')).then(() => setPw(''))}>{t('Réinitialiser le mot de passe', 'Reset password')}</button></div>
        </div>) : <p className="hint">{t('Vous ne pouvez pas modifier ce compte (même rang que le vôtre, rang supérieur, ou votre propre compte).', 'You cannot change this account (same or higher rank than yours, or your own account).')}</p>}
    </Modal>
    {sub === 'rights' && <RightsDialog u={d} onClose={() => setSub('')} onSaved={(m) => { setSub(''); setMsg(m); }} />}
    {sub === 'history' && <HistoryDialog u={d} onClose={() => setSub('')} />}
    </>
  );
}

interface RightsData { role: string; role_permissions: string[]; grant: string[]; revoke: string[]; grantable: string[]; all: string[] }
function RightsDialog({ u, onClose, onSaved }: { u: U; onClose: () => void; onSaved: (m: string) => void }) {
  const { t } = useLang(); const [r, setR] = useState<RightsData | null>(null); const [st, setSt] = useState<Record<string, 'default' | 'grant' | 'revoke'>>({}); const [err, setErr] = useState('');
  useEffect(() => { void api<RightsData>(`/school/users/${u.id}/rights`).then((x) => { if (!x.ok || !x.data) { setErr(`${t('Erreur', 'Error')} : ${x.error}`); return; } setR(x.data); const o: Record<string, 'default' | 'grant' | 'revoke'> = {}; x.data.grant.forEach((k) => (o[k] = 'grant')); x.data.revoke.forEach((k) => (o[k] = 'revoke')); setSt(o); }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [u.id]);
  const groups = useMemo(() => { const g: Record<string, string[]> = {}; for (const k of r?.all ?? []) (g[k.split(':')[0]] ??= []).push(k); return g; }, [r]);
  const save = async () => { if (!r) return; const grant = Object.entries(st).filter(([, v]) => v === 'grant').map(([k]) => k); const revoke = Object.entries(st).filter(([, v]) => v === 'revoke').map(([k]) => k); const x = await api(`/school/users/${u.id}/rights`, { method: 'PUT', body: { grant, revoke }, online: true }); if (x.ok) onSaved(t('Droits individuels enregistrés.', 'Personal rights saved.')); else setErr(`${t('Erreur', 'Error')} : ${x.error}`); };
  return (
    <Modal title={`${t('Droits individuels', 'Personal rights')} — ${u.email}`} onClose={onClose}>
      <p className="hint">{t('Le rôle donne des droits de base. Ici, vous accordez ou retirez un droit à cette personne seulement, dans cette école. Vous ne pouvez accorder que les droits que vous détenez vous-même.', 'The role gives base rights. Here you give or withdraw a right for this person only, in this school. You can only give rights you hold yourself.')}</p>
      {err && <p role="alert">{err}</p>}
      {!r ? <p aria-busy="true">{t('Chargement…', 'Loading…')}</p> : <div className="rights-grid">{Object.entries(groups).map(([g, keys]) => <div key={g}><div className="grp">{g}</div>{keys.map((k) => {
        const inRole = r.role_permissions.includes(k); const v = st[k] ?? 'default'; const can = r.grantable.includes(k);
        return <div key={k} className={`right-row${v !== 'default' ? ' changed' : ''}`}><span>{k}</span>
          <select aria-label={k} value={v} onChange={(e) => setSt({ ...st, [k]: e.target.value as 'default' | 'grant' | 'revoke' })}>
            <option value="default">{inRole ? t('Selon le rôle : oui', 'By role: yes') : t('Selon le rôle : non', 'By role: no')}</option>
            {inRole ? <option value="revoke">{t('Retirer', 'Withdraw')}</option> : <option value="grant" disabled={!can}>{can ? t('Accorder', 'Give') : t('Accorder (vous ne le détenez pas)', 'Give (you do not hold it)')}</option>}
          </select></div>; })}</div>)}</div>}
      <div className="modal-foot"><button type="button" className="btn-sec" onClick={onClose}>{t('Annuler', 'Cancel')}</button><button type="button" onClick={save} disabled={!r}>{t('Enregistrer', 'Save')}</button></div>
    </Modal>
  );
}

function HistoryDialog({ u, onClose }: { u: U; onClose: () => void }) {
  const { t, fr } = useLang(); const [h, setH] = useState<{ at: string; ip: string | null; action: string; provider: string | null }[] | null>(null); const [err, setErr] = useState('');
  useEffect(() => { void api(`/school/users/${u.id}/history`).then((x) => { if (x.ok) setH(x.data); else { setH([]); setErr(`${t('Erreur', 'Error')} : ${x.error}`); } }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [u.id]);
  const label = (a: string) => ({ login: t('Connexion', 'Sign-in'), logout: t('Déconnexion', 'Sign-out'), user_recovery_requested: t('Récupération demandée', 'Recovery requested'), user_modified: t('Compte modifié', 'Account modified') } as Record<string, string>)[a] ?? a;
  return (
    <Modal title={`${t('Historique des connexions', 'Sign-in history')} — ${u.email}`} onClose={onClose}>
      {err && <p role="alert">{err}</p>}
      {h === null ? <p aria-busy="true">{t('Chargement…', 'Loading…')}</p> : h.length === 0 ? <p>{t('Aucun événement enregistré par le fournisseur d’identité.', 'No event recorded by the identity provider.')}</p> : <div className="table-wrap"><table><thead><tr><th scope="col">{t('Date', 'Date')}</th><th scope="col">{t('Événement', 'Event')}</th><th scope="col">IP</th></tr></thead>
        <tbody>{h.map((e, i) => <tr key={i}><td>{new Date(e.at).toLocaleString(fr ? 'fr-FR' : 'en-GB', { dateStyle: 'short', timeStyle: 'medium' })}</td><td>{label(e.action)}</td><td>{e.ip ?? '—'}</td></tr>)}</tbody></table></div>}
    </Modal>
  );
}
