'use client';
import { useEffect, useState } from 'react';
import Shell from '../../../components/Shell';
import { getSession } from '../../../lib/api';
import { decodeClaims } from '../../../lib/pkce';
import { changePassword, fetchAuthConfig } from '../../../lib/oidc';
import { useLang } from '../../../lib/useLang';

const strong = (p: string) => p.length >= 10 && /[a-z]/.test(p) && /[A-Z]/.test(p) && /[0-9]/.test(p);

export default function MyAccount() {
  const { t } = useLang();
  const [email, setEmail] = useState(''); const [roles, setRoles] = useState<string[]>([]); const [school, setSchool] = useState('');
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState(''); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  useEffect(() => {
    const s = getSession(); if (!s) return;
    const c = decodeClaims(s.token); setEmail(typeof c.email === 'string' ? c.email : ''); setRoles(Array.isArray(c.roles) ? (c.roles as string[]) : []); setSchool(s.school === 'root' ? '' : s.school);
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('');
    if (!strong(next)) { setErr(t('Le nouveau mot de passe doit avoir 10 caractères ou plus, avec une minuscule, une majuscule et un chiffre.', 'The new password needs 10+ characters with a lower case, an upper case and a digit.')); return; }
    if (next !== again) { setErr(t('Les deux saisies ne sont pas identiques.', 'The two entries differ.')); return; }
    try { await changePassword(await fetchAuthConfig(), email, cur, next); setMsg(t('Mot de passe modifié. Utilisez-le à la prochaine connexion.', 'Password changed. Use it next time you sign in.')); setCur(''); setNext(''); setAgain(''); }
    catch (x) { setErr((x as Error).message); }
  };
  return (
    <Shell>
      <h1>{t('Mon compte', 'My account')}</h1>
      <section aria-labelledby="h-id">
        <h2 id="h-id">{t('Identité', 'Identity')}</h2>
        <p><strong>{email || '—'}</strong><br /><small className="muted">{roles.join(', ') || '—'}{school ? ` · ${school}` : ''}</small></p>
      </section>
      <section aria-labelledby="h-pw">
        <h2 id="h-pw">{t('Changer mon mot de passe', 'Change my password')}</h2>
        <form onSubmit={submit} className="form-grid" style={{ maxWidth: 520, gridTemplateColumns: '1fr' }}>
          <label>{t('Mot de passe actuel', 'Current password')}<input type="password" required autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
          <label>{t('Nouveau mot de passe', 'New password')}<input type="password" required autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
          <label>{t('Confirmer le nouveau mot de passe', 'Confirm the new password')}<input type="password" required autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
          <div><button type="submit" disabled={!email}>{t('Enregistrer', 'Save')}</button></div>
        </form>
        {err && <p role="alert">{err}</p>}{msg && <p role="status">{msg}</p>}
      </section>
    </Shell>
  );
}
