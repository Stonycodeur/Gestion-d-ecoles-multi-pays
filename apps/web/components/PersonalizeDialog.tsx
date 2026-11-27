'use client';
import { useEffect, useRef, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { ACCENTS, DEFAULT_PREFS, clearRingtone, loadPrefs, loadRingtone, playRing, prefsPayload, saveRingtone, savePrefs, type Prefs } from '../lib/prefs';
import { api } from '../lib/api';
import { setLocale, type Locale } from '../lib/i18n';
import { useLang } from '../lib/useLang';

/** Per-person display settings, applied live. Saved on this device at once and in the personal space (so they follow the person to another device). */
export default function PersonalizeDialog({ onClose }: { onClose: () => void }) {
  const { t, l } = useLang();
  const [p, setP] = useState<Prefs>(() => loadPrefs());
  const [ring, setRing] = useState<string | null>(null); const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { void loadRingtone().then((r) => setRing(r?.name ?? null)); }, []);
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => { const n = { ...p, [k]: v }; setP(n); savePrefs(n); };
  const done = async () => { await api('/me/profile', { method: 'PUT', body: { preferences: prefsPayload(p) } }); onClose(); };
  const reset = () => { setP({ ...DEFAULT_PREFS }); savePrefs({ ...DEFAULT_PREFS }); };
  const seg = <K extends keyof Prefs>(k: K, opts: [Prefs[K], string, string?][]) => (
    <div className="seg" role="group">{opts.map(([v, label, ico]) => (
      <button type="button" key={String(v)} aria-pressed={p[k] === v} onClick={() => set(k, v)}>{ico && <Icon name={ico} />} {label}</button>
    ))}</div>
  );
  const row = (icon: string, label: string, body: React.ReactNode) => (<div className="pref-row"><div className="pref-label"><Icon name={icon} />{label}</div><div>{body}</div></div>);
  return (
    <Modal title={t('Personnaliser', 'Personalize')} onClose={done}>
      <div className="preview-row" aria-hidden="true"><button type="button" tabIndex={-1}>✓ {t('Aperçu', 'Preview')}</button><button type="button" className="btn-sec" tabIndex={-1}>{t('Secondaire', 'Secondary')}</button><span className="badge ok">OK</span><span className="badge">{t('Info', 'Info')}</span></div>
      {row('palette', t('Mode', 'Mode'), seg('mode', [['auto', t('Auto', 'Auto'), 'spark'], ['light', t('Clair', 'Light'), 'sun'], ['dark', t('Sombre', 'Dark')]]))}
      {row('spark', t('Couleur d’accent', 'Accent colour'), (
        <div className="swatches">
          {ACCENTS.map((c) => <button type="button" key={c} className="swatch" style={{ background: c }} aria-label={c} aria-pressed={p.accent === c} onClick={() => set('accent', c)} />)}
          <input type="color" aria-label={t('Couleur personnalisée', 'Custom colour')} value={p.accent} onChange={(e) => set('accent', e.target.value)} />
        </div>
      ))}
      {row('menu', t('Densité', 'Density'), seg('density', [['compact', t('Compacte', 'Compact')], ['comfortable', t('Confortable', 'Comfortable')], ['airy', t('Aérée', 'Airy')]]))}
      {row('settings', t('Arrondis', 'Corners'), seg('radius', [['sharp', t('Droits', 'Sharp')], ['normal', t('Normaux', 'Normal')], ['round', t('Très ronds', 'Very round')]]))}
      {row('edit', t('Taille du texte', 'Text size'), (
        <div className="toolbar"><input type="range" min={85} max={130} step={5} value={p.fontScale} aria-label={t('Taille du texte', 'Text size')} onChange={(e) => set('fontScale', Number(e.target.value))} /><output>{p.fontScale} %</output></div>
      ))}
      {row('menu', t('Menu latéral', 'Side menu'), seg('sidebar', [['adaptive', t('Adaptatif', 'Adaptive')], ['icons', t('Icônes seules', 'Icons only')]]))}
      {row('sun', t('Contraste', 'Contrast'), seg('contrast', [['normal', t('Normal', 'Normal')], ['high', t('Élevé', 'High')]]))}
      {row('sync', t('Animations', 'Animations'), seg('motion', [['on', t('Activées', 'On')], ['reduced', t('Réduites', 'Reduced')]]))}
      {row('bell', t('Sonnerie des notifications', 'Notification ringtone'), (
        <div className="stack">
          <div className="toolbar">
            <input type="range" min={0} max={1} step={0.1} value={p.ringVolume} aria-label={t('Volume', 'Volume')} onChange={(e) => set('ringVolume', Number(e.target.value))} />
            <button type="button" className="btn-sec" onClick={() => void playRing(p.ringVolume)}>{t('Écouter', 'Play')}</button>
          </div>
          <div className="toolbar">
            <input ref={file} type="file" accept="audio/*" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { await saveRingtone(f); setRing(f.name); setErr(''); } catch (x) { setErr((x as Error).message); } e.target.value = ''; }} />
            <button type="button" className="btn-sec" onClick={() => file.current?.click()}>{t('Choisir un son sur mon appareil (7 Mo max.)', 'Choose a sound on my device (7 MB max.)')}</button>
            {ring && <button type="button" className="btn-danger" onClick={async () => { await clearRingtone(); setRing(null); }}>{t('Retirer', 'Remove')}</button>}
          </div>
          <small>{ring ? `${t('Sonnerie', 'Ringtone')} : ${ring}` : t('Son par défaut. Le fichier reste sur cet appareil.', 'Default sound. The file stays on this device.')}</small>
          {err && <p role="alert">{err}</p>}
        </div>
      ))}
      {row('globe', t('Langue', 'Language'), (
        <select aria-label={t('Langue', 'Language')} value={l} onChange={(e) => { setLocale(e.target.value as Locale); window.location.reload(); }}>
          <option value="fr">Français</option><option value="en">English</option><option value="ar">العربية</option>
        </select>
      ))}
      <div className="modal-foot">
        <button type="button" className="btn-sec btn-ico" onClick={reset}><Icon name="restore" />{t('Réinitialiser', 'Reset')}</button>
        <button type="button" onClick={done}>{t('Terminé', 'Done')}</button>
      </div>
    </Modal>
  );
}
