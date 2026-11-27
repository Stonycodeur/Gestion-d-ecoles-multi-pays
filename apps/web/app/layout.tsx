import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'ÉcoleManager Pro', template: '%s · ÉcoleManager Pro' },
  description: 'Gestion d’écoles multi-pays',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1d4ed8' };

/** Applies the saved display preferences before the first paint, so there is no flash of the wrong theme. */
const PREFS_SCRIPT = `try{var p=JSON.parse(localStorage.getItem('em_prefs')||'null');if(p){var r=document.documentElement;if(p.mode==='light'||p.mode==='dark')r.setAttribute('data-theme',p.mode);if(/^#[0-9a-f]{6}$/i.test(p.accent)){r.style.setProperty('--primary',p.accent);var c=[1,3,5].map(function(i){var v=parseInt(p.accent.slice(i,i+2),16)/255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4)}),l=0.2126*c[0]+0.7152*c[1]+0.0722*c[2];r.style.setProperty('--on-primary',1.05/(l+0.05)>=(l+0.05)/0.05?'#ffffff':'#0b1220')}if(p.fontScale)r.style.setProperty('--fs',String(p.fontScale));['density','radius','contrast','motion'].forEach(function(k){if(p[k])r.dataset[k]=p[k]});if(p.sidebar)r.dataset.side=p.sidebar}var lc=localStorage.getItem('em_locale');if(lc==='ar'){document.documentElement.dir='rtl';document.documentElement.lang='ar'}else if(lc==='en'){document.documentElement.lang='en'}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="fr" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: PREFS_SCRIPT }} /></head><body>{children}</body></html>);
}
