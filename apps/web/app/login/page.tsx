'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, setSession } from '../../lib/api';
import { getLocale, t } from '../../lib/i18n';
import { fetchAuthConfig, passwordLogin, startLogin, verifyMfa, type AuthConfig, type OidcSession } from '../../lib/oidc';
import PasswordField from '../../components/PasswordField';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [pend, setPend] = useState<{ s: OidcSession; factor: string } | null>(null); const [code, setCode] = useState('');
  const [school, setSchool] = useState(''); const [role, setRole] = useState('teacher'); const [err, setErr] = useState('');
  const l = typeof window === 'undefined' ? 'fr' : getLocale();
  const [cfg, setCfg] = useState<AuthConfig | null>(null);
  useEffect(() => { fetchAuthConfig().then(setCfg).catch(() => setCfg({ mode: 'sandbox' })); }, []);   // unreachable config: fall back to the dev form, the API still refuses it in production
  const pwd = cfg?.mode === 'password'; const oidc = cfg?.mode === 'oidc';
  const fr = l === 'fr';
  return (
    <div className="auth">
      <aside className="auth-side">
        <div className="brand" style={{ padding: 0 }}><span className="brand-mark" aria-hidden="true">É</span><span className="brand-name">ÉcoleManager Pro<small style={{ color: '#cbd5e1' }}>STONY-TECHNOLOGIE</small></span></div>
        <div>
          <h2>{fr ? 'Toute votre école, simplement.' : 'Your whole school, made simple.'}</h2>
          <ul>
            <li>{fr ? 'Emploi du temps, notes, bulletins et absences' : 'Timetable, grades, report cards and absences'}</li>
            <li>{fr ? 'Messagerie, notifications et suivi des parents' : 'Messaging, notifications and parent follow-up'}</li>
            <li>{fr ? 'Paiements Mobile Money, carte et reçus' : 'Mobile Money and card payments, receipts'}</li>
            <li>{fr ? 'Multi-pays, bilingue, fonctionne hors ligne' : 'Multi-country, bilingual, works offline'}</li>
          </ul>
        </div>
        <small>© STONY-TECHNOLOGIE</small>
      </aside>
      <main className="auth-main">
        <form className="auth-card" onSubmit={async (e) => {
          e.preventDefault(); setErr('');
          if (pwd && pend) { try { setSession(await verifyMfa(cfg!, pend.s, pend.factor, code)); router.replace('/'); } catch (x) { setErr((x as Error).message); } return; }
          if (pwd) {
            try {
              const { mfaFactor, ...sess } = await passwordLogin(cfg!, email, password);
              if (mfaFactor) { setPend({ s: sess, factor: mfaFactor }); return; }   // second step: the code of the authenticator app
              setSession(sess); router.replace('/');
            } catch (x) { setErr((x as Error).message); }
            return;
          }
          if (!/^[a-z0-9_]{2,40}$/.test(school.trim().toLowerCase())) { setErr('Code invalide / invalid code'); return; }
          try {
            if (oidc) { await startLogin(cfg!, school.trim().toLowerCase(), l); return; }   // redirects to the identity provider (PKCE)
            setSession(await login(school.trim().toLowerCase(), role)); router.replace('/');
          } catch (x) { setErr((x as Error).message); }
        }}>
          <h1>{t('app', l)}</h1>
          <p className="sub">{fr ? 'Connectez-vous pour accéder à votre espace.' : 'Sign in to access your space.'}</p>
          {pwd && !pend && <>
            <label>Email<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <PasswordField label={fr ? 'Mot de passe' : 'Password'} value={password} onChange={setPassword} />
          </>}
          {pwd && pend && (
            <label>{fr ? 'Code de votre application d’authentification' : 'Code from your authenticator app'}
              <input data-autofocus autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
          )}
          {!pwd && <label>{t('school', l)}<input required value={school} onChange={(e) => setSchool(e.target.value)} /></label>}
          {!oidc && !pwd && <label>{t('role', l)}
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {['admin', 'head', 'teacher', 'education_assistant', 'accountant', 'student', 'guardian'].map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>}
          <button type="submit">{t('login', l)}</button>
          {err && <p role="alert" style={{ margin: 0 }}>{err}</p>}
          <p className="auth-foot">{fr ? 'Mot de passe oublié ? Contactez l’administrateur de votre établissement.' : 'Forgot your password? Contact your school administrator.'}</p>
        </form>
      </main>
    </div>
  );
}
