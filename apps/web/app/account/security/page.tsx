'use client';
import { useCallback, useEffect, useState } from 'react';
import Shell from '../../../components/Shell';
import Modal from '../../../components/Modal';
import PasswordField, { passwordScore } from '../../../components/PasswordField';
import { getSession, setSession } from '../../../lib/api';
import { decodeClaims } from '../../../lib/pkce';
import { changePassword, fetchAuthConfig, mfaEnroll, mfaFactors, mfaRemove, verifyMfa, type AuthConfig, type MfaFactor } from '../../../lib/oidc';
import { useLang } from '../../../lib/useLang';

export default function SecurityPage() {
  const { t } = useLang();
  const [cfg, setCfg] = useState<AuthConfig | null>(null); const [email, setEmail] = useState(''); const [factor, setFactor] = useState<MfaFactor | null>(null);
  const [dlg, setDlg] = useState<'' | 'pw' | 'mfa' | 'off'>('');
  const [cur, setCur] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState('');
  const [enr, setEnr] = useState<{ id: string; qr: string; secret: string } | null>(null); const [code, setCode] = useState('');
  const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const hosted = cfg?.mode === 'password';

  const refresh = useCallback(async (c: AuthConfig) => {
    const s = getSession(); if (!s || c.mode !== 'password') return;
    setFactor((await mfaFactors(c, s.token)).find((f) => f.status === 'verified') ?? null);
  }, []);
  useEffect(() => {
    const s = getSession(); if (s) { const c = decodeClaims(s.token); setEmail(typeof c.email === 'string' ? c.email : ''); }
    fetchAuthConfig().then((c) => { setCfg(c); void refresh(c); }).catch(() => setCfg({ mode: 'sandbox' }));
  }, [refresh]);
  const close = () => { setDlg(''); setErr(''); setCur(''); setNext(''); setAgain(''); setCode(''); setEnr(null); };

  const submitPw = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('');
    if (passwordScore(next) < 4) { setErr(t('Le nouveau mot de passe doit avoir 10 caractères ou plus, avec une minuscule, une majuscule et un chiffre.', 'The new password needs 10+ characters with a lower case, an upper case and a digit.')); return; }
    if (next !== again) { setErr(t('Les deux saisies ne sont pas identiques.', 'The two entries differ.')); return; }
    setBusy(true);
    try { await changePassword(cfg!, email, cur, next, getSession()!.token); close(); setMsg(t('Mot de passe modifié. Utilisez-le à la prochaine connexion.', 'Password changed. Use it next time you sign in.')); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const startMfa = async () => {
    setErr(''); setMsg(''); setBusy(true);
    try { setEnr(await mfaEnroll(cfg!, getSession()!.token)); setDlg('mfa'); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const confirmMfa = async (e: React.FormEvent) => {
    e.preventDefault(); if (!enr) return; setErr(''); setBusy(true);
    try { const s = getSession()!; setSession(await verifyMfa(cfg!, s, enr.id, code), { purgeCache: false }); close(); await refresh(cfg!); setMsg(t('Double authentification activée. Un code vous sera demandé à chaque connexion.', 'Two-step verification is on. A code will be asked at every sign-in.')); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  const disableMfa = async (e: React.FormEvent) => {
    e.preventDefault(); if (!factor) return; setErr(''); setBusy(true);
    try { const s = getSession()!; const up = await verifyMfa(cfg!, s, factor.id, code); setSession(up, { purgeCache: false }); await mfaRemove(cfg!, up.token, factor.id); close(); await refresh(cfg!); setMsg(t('Double authentification désactivée.', 'Two-step verification is off.')); }
    catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };

  return (
    <Shell>
      <div className="page-head"><div><h1>{t('Sécurité', 'Security')}</h1><small>{email}</small></div></div>
      {msg && <p role="status">{msg}</p>}
      {cfg && !hosted && <p className="note warn">{t('Votre mot de passe et la double authentification se gèrent chez votre fournisseur d’identité.', 'Your password and two-step verification are managed at your identity provider.')}</p>}
      <section aria-labelledby="h-pw">
        <h2 id="h-pw">{t('Changer le mot de passe', 'Change password')}</h2>
        <p className="muted">{t('Choisissez un mot de passe long et unique. Vous pouvez l’afficher en cliquant sur l’œil pendant la saisie.', 'Pick a long, unique password. Click the eye to see what you type.')}</p>
        <button type="button" disabled={!hosted} onClick={() => { setErr(''); setDlg('pw'); }}>{t('Changer le mot de passe', 'Change password')}</button>
      </section>
      <section aria-labelledby="h-mfa">
        <h2 id="h-mfa">{t('Double authentification', 'Two-step verification')}</h2>
        <p>{t('Double authentification (TOTP) :', 'Two-step verification (TOTP):')} <strong>{factor ? t('activée', 'on') : t('désactivée', 'off')}</strong></p>
        <p className="muted">{t('Un code à 6 chiffres, généré par une application (Google Authenticator, Microsoft Authenticator, Aegis, FreeOTP…), est demandé en plus du mot de passe.', 'A 6-digit code from an app (Google Authenticator, Microsoft Authenticator, Aegis, FreeOTP…) is asked on top of the password.')}</p>
        {factor
          ? <button type="button" className="btn-danger" disabled={!hosted} onClick={() => { setErr(''); setDlg('off'); }}>{t('Désactiver la double authentification', 'Turn off two-step verification')}</button>
          : <button type="button" disabled={!hosted || busy} onClick={startMfa}>{t('Activer la double authentification', 'Turn on two-step verification')}</button>}
        {err && !dlg && <p role="alert">{err}</p>}
      </section>

      {dlg === 'pw' && (
        <Modal title={t('Changer le mot de passe', 'Change password')} onClose={close} small>
          <form onSubmit={submitPw}>
            <PasswordField label={t('Mot de passe actuel', 'Current password')} value={cur} onChange={setCur} />
            <PasswordField label={t('Nouveau mot de passe', 'New password')} value={next} onChange={setNext} autoComplete="new-password" meter />
            <PasswordField label={t('Confirmer le nouveau mot de passe', 'Confirm the new password')} value={again} onChange={setAgain} autoComplete="new-password" />
            {err && <p role="alert">{err}</p>}
            <div className="modal-foot"><button type="button" className="btn-sec" onClick={close}>{t('Annuler', 'Cancel')}</button><button type="submit" disabled={busy}>{t('Enregistrer', 'Save')}</button></div>
          </form>
        </Modal>
      )}
      {dlg === 'mfa' && enr && (
        <Modal title={t('Activer la double authentification', 'Turn on two-step verification')} onClose={close} small>
          <form onSubmit={confirmMfa}>
            <p className="note">{t('Scannez ce QR code avec votre application d’authentification, puis saisissez le code à 6 chiffres qu’elle affiche.', 'Scan this QR code with your authenticator app, then enter the 6-digit code it shows.')}</p>
            <div className="qr-box">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={enr.qr} alt={t('QR code à scanner', 'QR code to scan')} /></div>
            <details><summary>{t('Impossible de scanner ? Saisir la clé à la main', 'Cannot scan? Enter the key by hand')}</summary><p><code>{enr.secret}</code></p></details>
            <label>{t('Code à 6 chiffres', '6-digit code')}<input data-autofocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} /></label>
            {err && <p role="alert">{err}</p>}
            <div className="modal-foot"><button type="button" className="btn-sec" onClick={close}>{t('Annuler', 'Cancel')}</button><button type="submit" disabled={busy}>{t('Enregistrer', 'Save')}</button></div>
          </form>
        </Modal>
      )}
      {dlg === 'off' && (
        <Modal title={t('Désactiver la double authentification', 'Turn off two-step verification')} onClose={close} small>
          <form onSubmit={disableMfa}>
            <p>{t('Saisissez un code actuel de votre application pour confirmer.', 'Enter a current code from your app to confirm.')}</p>
            <label>{t('Code à 6 chiffres', '6-digit code')}<input data-autofocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} /></label>
            {err && <p role="alert">{err}</p>}
            <div className="modal-foot"><button type="button" className="btn-sec" onClick={close}>{t('Annuler', 'Cancel')}</button><button type="submit" className="btn-danger" disabled={busy}>{t('Désactiver', 'Turn off')}</button></div>
          </form>
        </Modal>
      )}
    </Shell>
  );
}
