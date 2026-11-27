'use client';
import { useId, useState } from 'react';
import Icon from './Icon';
import { useLang } from '../lib/useLang';

/** Password input with an eye button to see what is typed. Optionally shows a strength meter (10+ characters, lower case, upper case, digit). */
export const passwordScore = (p: string) => [p.length >= 10, /[a-z]/.test(p), /[A-Z]/.test(p), /[0-9]/.test(p)].filter(Boolean).length;
export default function PasswordField({ label, value, onChange, autoComplete = 'current-password', required = true, meter = false, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; autoComplete?: string; required?: boolean; meter?: boolean; placeholder?: string;
}) {
  const { t } = useLang(); const [shown, setShown] = useState(false); const id = useId();
  const score = passwordScore(value);
  return (
    <label>{label}
      <span className="pw">
        <input id={id} type={shown ? 'text' : 'password'} required={required} autoComplete={autoComplete} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        <button type="button" aria-pressed={shown} aria-label={shown ? t('Masquer le mot de passe', 'Hide password') : t('Afficher le mot de passe', 'Show password')} title={shown ? t('Masquer', 'Hide') : t('Afficher', 'Show')} onClick={() => setShown(!shown)}>
          <Icon name={shown ? 'eyeoff' : 'eye'} />
        </button>
      </span>
      {meter && value && (<>
        <span className="pw-meter" aria-hidden="true">{[0, 1, 2, 3].map((i) => <i key={i} className={i < score ? 'on' : ''} />)}</span>
        <span className="pw-hint">{score === 4 ? t('Mot de passe solide.', 'Strong password.') : t('10 caractères minimum, avec minuscule, majuscule et chiffre.', 'At least 10 characters with a lower case, an upper case and a digit.')}</span>
      </>)}
    </label>
  );
}
