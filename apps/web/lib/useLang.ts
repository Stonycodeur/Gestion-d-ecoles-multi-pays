'use client';
import { useEffect, useState } from 'react';
import { getLocale, type Locale } from './i18n';

/** Current UI language (read once on the client). `t(fr, en)` picks the string; Arabic falls back to English for screens not yet translated. */
export function useLang() {
  const [l, setL] = useState<Locale>('fr');
  useEffect(() => { setL(getLocale()); }, []);
  return { l, fr: l === 'fr', t: (fr: string, en: string) => (l === 'fr' ? fr : en) };
}
