'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '../../../components/Shell';
import Confirm from '../../../components/Confirm';
import PasswordField from '../../../components/PasswordField';
import { api } from '../../../lib/api';
import { useLang } from '../../../lib/useLang';

const ROLE_LABEL: Record<string, [string, string]> = {
  root_super_admin: ['Super-Admin racine', 'Root super-admin'], tenant_super_admin: ['Super-Admin d’établissement', 'School super-admin'], admin: ['Admin', 'Admin'],
  head: ['Directeur / Proviseur / Doyen', 'Head / Principal / Dean'], teacher: ['Professeur', 'Teacher'], education_assistant: ['Assistant d’éducation', 'Education assistant'],
  accountant: ['Comptable / Intendance', 'Accountant / Bursar'], student: ['Élève / Étudiant', 'Student'], guardian: ['Parent / Tuteur', 'Parent / Guardian'], inspector: ['Inspecteur (accès limité)', 'Inspector (limited access)'],
};
const msgOf = (r: { error?: string }) => { try { const e = JSON.parse(r.error ?? '""'); return typeof e === 'string' ? e : Array.isArray(e) ? e.join(', ') : JSON.stringify(e); } catch { return r.error ?? 'error'; } };

export default function AccountsPage() {
  const { fr, t, l } = useLang();
  const [schools, setSchools] = useState<any[]>([]); const [roles, setRoles] = useState<string[]>([]); const [rows, setRows] = useState<any[]>([]);
  const [filter, setFilter] = useState(''); const [err, setErr] = useState(''); const [secret, setSecret] = useState<{ who: string; pw: string } | null>(null); const [copied, setCopied] = useState(false);
  const [del, setDel] = useState<any>(null);
  const [f, setF] = useState({ email: '', role: 'tenant_super_admin', school_slug: '', password: '' });

  const load = useCallback(async (school: string) => {
    const r = await api(`/admin/accounts${school ? `?school=${school}` : ''}`);
    if (r.ok) { setRows(r.data); setErr(''); } else setErr(msgOf(r));
  }, []);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('school') ?? '';
    setFilter(q); setF((x) => ({ ...x, school_slug: q }));
    api('/tenants').then((r) => setSchools(r.data ?? [])); api('/admin/roles').then((r) => setRoles(r.data ?? []));
    void load(q);
  }, [load]);

  const show = (who: string, pw?: string) => { if (pw) { setSecret({ who, pw }); setCopied(false); } };
  const create = async () => {
    const r = await api('/admin/accounts', { method: 'POST', online: true, body: { ...f, password: f.password || undefined } });
    if (!r.ok) { setErr(msgOf(r)); return; }
    setErr(''); show(r.data.email, r.data.temporary_password); setF({ ...f, email: '', password: '' }); await load(filter);
  };
  const reset = async (a: any) => { const r = await api(`/admin/accounts/${a.id}/reset-password`, { method: 'POST', online: true, body: {} }); if (r.ok) { setErr(''); show(a.email, r.data.temporary_password); } else setErr(msgOf(r)); };
  const toggle = async (a: any) => { const r = await api(`/admin/accounts/${a.id}`, { method: 'PATCH', online: true, body: { active: !a.active } }); setErr(r.ok ? '' : msgOf(r)); await load(filter); };
  const copy = async () => { try { await navigator.clipboard.writeText(secret!.pw); setCopied(true); } catch { /* clipboard unavailable: the password is selectable */ } };

  return (
    <Shell>
      <h1>{t('Comptes et accès', 'Accounts and access')}</h1>
      <p className="muted">{t('Créez les Super-Admins d’école et tous les autres comptes. Le mot de passe temporaire s’affiche une seule fois ; la personne le change ensuite dans « Mon compte ».', 'Create school Super-Admins and every other account. The temporary password is shown once; the person then changes it in “My account”.')}</p>
      {err && <p role="alert">{err}</p>}
      {secret && (
        <div className="secret" role="status">
          <span>{t('Mot de passe temporaire de', 'Temporary password for')} <strong>{secret.who}</strong> :</span> <code>{secret.pw}</code>
          <button onClick={copy}>{copied ? t('Copié ✓', 'Copied ✓') : t('Copier', 'Copy')}</button>
          <button onClick={() => setSecret(null)}>{t('J’ai noté, fermer', 'Noted, close')}</button>
        </div>
      )}

      <section aria-labelledby="h-create">
        <h2 id="h-create">{t('Créer un compte', 'Create an account')}</h2>
        <div className="form-grid">
          <label>Email<input type="email" value={f.email} autoComplete="off" onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label>{t('Rôle', 'Role')}<select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]?.[fr ? 0 : 1] ?? r}</option>)}</select></label>
          <label>{t('École', 'School')}<select value={f.school_slug} onChange={(e) => setF({ ...f, school_slug: e.target.value })}><option value="">{t('Choisir…', 'Choose…')}</option>{schools.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></label>
          <PasswordField label={t('Mot de passe (facultatif)', 'Password (optional)')} value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" required={false} placeholder={t('Laisser vide pour en générer un', 'Leave empty to generate one')} />
        </div>
        <button onClick={create} disabled={!f.email || !f.school_slug}>{t('Créer le compte', 'Create account')}</button>
      </section>

      <h2>{t('Comptes existants', 'Existing accounts')}</h2>
      <p><label>{t('Filtrer par école', 'Filter by school')} <select value={filter} onChange={(e) => { setFilter(e.target.value); void load(e.target.value); }}><option value="">{t('Toutes', 'All')}</option>{schools.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}</select></label></p>
      {rows.length === 0 ? <p className="empty">{t('Aucun compte à afficher.', 'No account to show.')}</p> : (
        <table>
          <thead><tr><th>Email</th><th>{t('Rôle', 'Role')}</th><th>{t('École', 'School')}</th><th>{t('État', 'Status')}</th><th>{t('Dernière connexion', 'Last sign-in')}</th><th>{t('Actions', 'Actions')}</th></tr></thead>
          <tbody>{rows.map((a, i) => (
            <tr key={`${a.id}-${i}`}>
              <td>{a.email}</td><td>{ROLE_LABEL[a.role]?.[fr ? 0 : 1] ?? a.role ?? '—'}</td><td>{a.school_name ?? t('Plateforme', 'Platform')}</td>
              <td><span className={`badge ${a.active ? 'ok' : 'off'}`}>{a.active ? t('Actif', 'Active') : t('Suspendu', 'Suspended')}</span></td>
              <td>{a.last_sign_in_at ? new Date(a.last_sign_in_at).toLocaleString(l) : '—'}</td>
              <td>{a.is_root ? <span className="badge">{t('Immuable', 'Immutable')}</span> : <div className="actions"><button onClick={() => reset(a)}>{t('Nouveau mot de passe', 'New password')}</button><button onClick={() => toggle(a)}>{a.active ? t('Suspendre', 'Suspend') : t('Réactiver', 'Reactivate')}</button><button className="btn-danger" onClick={() => setDel(a)}>{t('Corbeille', 'Trash')}</button></div>}</td>
            </tr>))}</tbody>
        </table>
      )}
      {del && <Confirm title={t('Mettre le compte à la corbeille ?', 'Move the account to the trash?')} body={t(`${del.email} sera désactivé et masqué. Vous pourrez le restaurer depuis la corbeille.`, `${del.email} will be disabled and hidden. You can restore it from the trash.`)} label={t('Mettre à la corbeille', 'Move to trash')}
        onClose={() => setDel(null)} onConfirm={async () => { const r = await api(`/admin/accounts/${del.id}`, { method: 'DELETE', online: true }); setErr(r.ok ? '' : msgOf(r)); setDel(null); await load(filter); }} />}
    </Shell>
  );
}
