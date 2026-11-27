'use client';
import { useEffect, useState } from 'react';
import Modal from './Modal';
import Icon from './Icon';
import { replayQueue } from '../lib/api';
import { pendingOps } from '../lib/offline-queue';
import { useLang } from '../lib/useLang';

const cacheKeys = () => { try { return Object.keys(localStorage).filter((k) => k.startsWith('em_cache:')); } catch { return []; } };

/** Offline work: what waits to be sent, what is kept on this device, send now, clear the cache. */
export default function SyncDialog({ onClose, onChange }: { onClose: () => void; onChange: () => void }) {
  const { t } = useLang();
  const [pending, setPending] = useState(0); const [cached, setCached] = useState(0); const [busy, setBusy] = useState(false); const [msg, setMsg] = useState('');
  const refresh = () => { setPending(pendingOps().length); setCached(cacheKeys().length); onChange(); };
  useEffect(() => { setPending(pendingOps().length); setCached(cacheKeys().length); }, []);
  const sync = async () => {
    setBusy(true); setMsg('');
    try { await replayQueue(); setMsg(navigator.onLine ? t('Synchronisation terminée.', 'Synchronisation complete.') : t('Hors ligne : les saisies partiront au retour du réseau.', 'Offline: entries will be sent when the network is back.')); } finally { setBusy(false); refresh(); }
  };
  const clear = () => { for (const k of cacheKeys()) localStorage.removeItem(k); setMsg(t('Cache vidé. Les pages se rechargeront depuis le réseau.', 'Cache cleared. Pages will load from the network.')); refresh(); };
  return (
    <Modal title={t('Synchronisation', 'Synchronisation')} onClose={onClose} small>
      <p className="note">{t('Les saisies faites hors connexion sont enregistrées sur cet appareil puis envoyées automatiquement au retour du réseau, sans doublon possible.', 'Entries made offline are saved on this device and sent automatically when the network returns, without any duplicates.')}</p>
      <div className="empty-state" aria-live="polite"><Icon name={pending ? 'sync' : 'check'} /><strong>{pending ? t(`${pending} saisie(s) en attente`, `${pending} entr${pending > 1 ? 'ies' : 'y'} waiting`) : t('Rien à synchroniser', 'Nothing to synchronise')}</strong></div>
      <p><small>{t(`${cached} page(s) en cache sur cet appareil`, `${cached} page(s) cached on this device`)}</small></p>
      {msg && <p role="status">{msg}</p>}
      <div className="modal-foot">
        <button type="button" className="btn-sec btn-ico" onClick={clear}><Icon name="trash" />{t('Vider le cache', 'Clear cache')}</button>
        <button type="button" className="btn-ico" disabled={busy} onClick={sync}><Icon name="sync" />{t('Synchroniser maintenant', 'Synchronise now')}</button>
      </div>
    </Modal>
  );
}
