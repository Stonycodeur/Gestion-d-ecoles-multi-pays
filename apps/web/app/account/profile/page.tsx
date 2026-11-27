'use client';
import { useEffect, useRef, useState } from 'react';
import Shell from '../../../components/Shell';
import Flag from '../../../components/Flag';
import Icon from '../../../components/Icon';
import { api, getSession } from '../../../lib/api';
import { decodeClaims } from '../../../lib/pkce';
import { announceProfile, initialsOf, msgOf, useProfile, type Profile } from '../../../lib/profile';
import { setLocale, type Locale } from '../../../lib/i18n';
import { useLang } from '../../../lib/useLang';

interface Dial { c: string; n: string; fr: string; ph: string; d: [number, number] }

/** Square JPEG of at most 256 px, read from the chosen picture: small enough to store with the profile, whatever the original size. */
async function shrink(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('PNG, JPEG ou WebP / PNG, JPEG or WebP');
  const bmp = await createImageBitmap(file); const side = Math.min(bmp.width, bmp.height); const out = Math.min(256, side);
  const cv = document.createElement('canvas'); cv.width = out; cv.height = out;
  cv.getContext('2d')!.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
  return cv.toDataURL('image/jpeg', 0.86);
}

export default function ProfilePage() {
  const { t, l, fr } = useLang();
  const { profile, reload } = useProfile();
  const [dial, setDial] = useState<Dial[]>([]); const [email, setEmail] = useState('');
  const [name, setName] = useState(''); const [cc, setCc] = useState('GA'); const [phone, setPhone] = useState(''); const [lang, setLang] = useState('fr');
  const [photo, setPhoto] = useState<string | null>(null); const [err, setErr] = useState(''); const [msg, setMsg] = useState(''); const [perr, setPerr] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const seeded = useRef(false);

  useEffect(() => {
    const s = getSession(); if (s) { const c = decodeClaims(s.token); setEmail(typeof c.email === 'string' ? c.email : ''); }
    void api<Dial[]>('/geo/dial-codes').then((r) => setDial(r.data ?? []));
  }, []);
  useEffect(() => {
    if (!profile || seeded.current) return; seeded.current = true;
    setName(profile.full_name ?? ''); setPhone(profile.phone_number ?? ''); setLang(profile.language ?? l);
    if (profile.phone_country) setCc(profile.phone_country);
  }, [profile, l]);
  const country = dial.find((x) => x.c === cc);

  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(''); setMsg('');
    const r = await api<Profile>('/me/profile', { method: 'PUT', online: true, body: { full_name: name, phone_country: phone ? cc : null, phone_number: phone, language: lang } });
    if (!r.ok) { setErr(msgOf(r)); return; }
    announceProfile({ ...(profile as Profile), ...r.data! }); setMsg(t('Profil enregistré.', 'Profile saved.'));
    if (lang !== l) { setLocale(lang as Locale); window.location.reload(); }
  };
  const pick = async (f?: File) => { if (!f) return; setPerr(''); try { setPhoto(await shrink(f)); } catch (x) { setPerr((x as Error).message); } };
  const savePhoto = async () => {
    if (!photo) return; const r = await api<Profile>('/me/avatar', { method: 'PUT', online: true, body: { data_url: photo } });
    if (!r.ok) { setPerr(msgOf(r)); return; } setPhoto(null); setPerr(''); announceProfile(r.data!); await reload();
  };
  const removePhoto = async () => { const r = await api<Profile>('/me/avatar', { method: 'DELETE', online: true }); if (r.ok) { setPhoto(null); announceProfile(r.data!); await reload(); } else setPerr(msgOf(r)); };
  const shown = photo ?? profile?.avatar ?? null;

  return (
    <Shell>
      <div className="page-head"><h1>{t('Mon profil', 'My profile')}</h1></div>
      <div className="profile-grid">
        <section aria-labelledby="h-photo">
          <h2 id="h-photo">{t('Photo de profil', 'Profile photo')}</h2>
          <div className="photo-row">
            <div className="avatar-lg">{shown ? <img src={shown} alt={t('Votre photo', 'Your photo')} /> : <span aria-hidden="true">{initialsOf(name || profile?.full_name, '··')}</span>}</div>
            <div>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
              <button type="button" className="btn-sec btn-ico" onClick={() => file.current?.click()}><Icon name="camera" />{t('Choisir une photo', 'Choose a photo')}</button>
              <p><small>{t('PNG, JPEG ou WebP. Elle est recadrée en carré et réduite automatiquement.', 'PNG, JPEG or WebP. It is cropped square and shrunk automatically.')}</small></p>
            </div>
          </div>
          <div className="toolbar">
            <button type="button" disabled={!photo} onClick={savePhoto}>{t('Enregistrer la photo', 'Save the photo')}</button>
            <button type="button" className="btn-danger" disabled={!shown} onClick={removePhoto}>{t('Retirer', 'Remove')}</button>
          </div>
          {perr && <p role="alert">{perr}</p>}
        </section>

        <section aria-labelledby="h-info">
          <h2 id="h-info">{t('Mes informations', 'My details')}</h2>
          <form className="stack" onSubmit={save}>
            <label>{t('Nom complet', 'Full name')}<input value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} /></label>
            <label>{t('E-mail (identifiant)', 'Email (sign-in)')}<input value={email} readOnly aria-readonly="true" /></label>
            <fieldset style={{ margin: 0, boxShadow: 'none' }}>
              <legend>{t('Téléphone', 'Phone')}</legend>
              <div className="phone-row">
                <Flag code={cc} />
                <select aria-label={t('Pays et indicatif', 'Country and dialling code')} value={cc} onChange={(e) => setCc(e.target.value)}>
                  {dial.map((d) => <option key={d.c} value={d.c}>{fr ? d.fr : d.n} (+{d.ph})</option>)}
                </select>
                <input aria-label={t('Numéro local', 'Local number')} inputMode="tel" autoComplete="tel-national" value={phone} placeholder={country ? `${country.d[0]}–${country.d[1]} ${t('chiffres', 'digits')}` : ''} onChange={(e) => setPhone(e.target.value.replace(/[^0-9 ]/g, ''))} />
              </div>
              <p><small>{country ? `${fr ? country.fr : country.n} · +${country.ph}` : ''}</small></p>
            </fieldset>
            <label>{t('Langue', 'Language')}
              <select value={lang} onChange={(e) => setLang(e.target.value)}><option value="fr">Français</option><option value="en">English</option><option value="ar">العربية</option></select>
            </label>
            <div><button type="submit">{t('Enregistrer', 'Save')}</button></div>
          </form>
          {err && <p role="alert">{err}</p>}{msg && <p role="status">{msg}</p>}
        </section>
      </div>
    </Shell>
  );
}
