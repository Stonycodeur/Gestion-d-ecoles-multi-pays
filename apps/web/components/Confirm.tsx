'use client';
import { useState } from 'react';
import Modal from './Modal';
import { useLang } from '../lib/useLang';

/** Confirmation dialog. With `requireText`, the person must type that text first (for irreversible actions). */
export default function Confirm({ title, body, label, danger = true, requireText, onConfirm, onClose }: {
  title: string; body: string; label: string; danger?: boolean; requireText?: string; onConfirm: () => Promise<void> | void; onClose: () => void;
}) {
  const { t } = useLang(); const [typed, setTyped] = useState(''); const [busy, setBusy] = useState(false);
  const ok = !requireText || typed === requireText;
  return (
    <Modal title={title} onClose={onClose} small>
      <form onSubmit={async (e) => { e.preventDefault(); if (!ok) return; setBusy(true); try { await onConfirm(); } finally { setBusy(false); } }}>
        <p>{body}</p>
        {requireText && <label>{t(`Tapez « ${requireText} » pour confirmer`, `Type “${requireText}” to confirm`)}<input data-autofocus value={typed} autoComplete="off" onChange={(e) => setTyped(e.target.value)} /></label>}
        <div className="modal-foot">
          <button type="button" className="btn-sec" onClick={onClose}>{t('Annuler', 'Cancel')}</button>
          <button type="submit" className={danger ? 'btn-danger' : ''} disabled={!ok || busy}>{label}</button>
        </div>
      </form>
    </Modal>
  );
}
