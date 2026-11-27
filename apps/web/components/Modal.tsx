'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import Icon from './Icon';
import { useLang } from '../lib/useLang';

/** Accessible dialog: focus moves in, Escape and the close button leave, Tab stays inside, focus returns to the opener. */
export default function Modal({ title, onClose, children, small }: { title: string; onClose: () => void; children: ReactNode; small?: boolean }) {
  const { t } = useLang(); const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;   // the caller's handler may change on every render: the effect must not restart
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null; const box = ref.current!;
    const focusables = () => Array.from(box.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'));
    (box.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[1] ?? focusables()[0])?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const f = focusables(); if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    };
    document.addEventListener('keydown', key); document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = ''; prev?.focus?.(); };
  }, []);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeRef.current(); }}>
      <div className={`modal${small ? ' sm' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head"><h2>{title}</h2><button type="button" className="modal-x" aria-label={t('Fermer', 'Close')} onClick={onClose}><Icon name="x" /></button></div>
        {children}
      </div>
    </div>
  );
}
