'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, setSession } from '../../lib/api';
import { getLocale, t } from '../../lib/i18n';
import { fetchAuthConfig, passwordLogin, startLogin, type AuthConfig } from '../../lib/oidc';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [school, setSchool] = useState(''); const [role, setRole] = useState('teacher'); const [err, setErr] = useState('');
  const l = typeof window === 'undefined' ? 'fr' : getLocale();
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  useEffect(() => { fetchAuthConfig().then(setCfg).catch(() => setCfg({ mode: 'sandbox' })); }, []);   // unreachable config: fall back to the dev form, the API still refuses it in production
  const pwd = cfg?.mode === 'password'; const oidc = cfg?.mode === 'oidc';
  return (
    <form style={{ maxWidth: 360, margin: '48px auto', display: 'grid', gap: 12 }} onSubmit={async (e) => {
      e.preventDefault(); setErr('');
      if (pwd) { try { setSession(await passwordLogin(cfg!, email, password)); router.replace('/'); } catch (x) { setErr((x as Error).message); } return; }
      if (!/^[a-z0-9_]{2,40}$/.test(school.trim().toLowerCase())) { setErr('Code invalide / invalid code'); return; }
      try {
        if (oidc) { await startLogin(cfg!, school.trim().toLowerCase(), l); return; }   // redirects to the identity provider (PKCE)
        setSession(await login(school.trim().toLowerCase(), role)); router.replace('/');
      } catch (x) { setErr((x as Error).message); }
    }}>
      <h1>{t('app', l)}</h1>
      {pwd && <>
        <label>Email<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
        <label>{l === 'fr' ? 'Mot de passe' : 'Password'}<input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
      </>}
      {!pwd && <label>{t('school', l)}<input required value={school} onChange={(e) => setSchool(e.target.value)} style={{ display: 'block', width: '100%' }} /></label>}
      {!oidc && !pwd && <label>{t('role', l)}
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ display: 'block', width: '100%' }}>
          {['admin', 'head', 'teacher', 'education_assistant', 'accountant', 'student', 'guardian'].map((r) => <option key={r}>{r}</option>)}
        </select>
      </label>}
      <button type="submit">{t('login', l)}</button>
      {err && <p role="alert" style={{ color: 'crimson' }}>{err}</p>}
    </form>
  );
}
