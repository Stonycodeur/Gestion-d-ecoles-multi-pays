'use client';
import { useState } from 'react';

/** Real flag image of a country (ISO 3166-1 alpha-2). Falls back to the two letters when offline or when the code has no flag (a country added by hand). */
export default function Flag({ code, name = '' }: { code: string; name?: string }) {
  const [bad, setBad] = useState(false);
  const c = code.toLowerCase();
  if (bad || !/^[a-z]{2}$/.test(c)) return <span className="flag-fallback" aria-hidden="true">{code.toUpperCase().slice(0, 2)}</span>;
  return <img className="flag" src={`https://flagcdn.com/w40/${c}.png`} srcSet={`https://flagcdn.com/w80/${c}.png 2x`} width={30} height={21} alt={name ? `Drapeau : ${name}` : ''} loading="lazy" decoding="async" onError={() => setBad(true)} />;
}
