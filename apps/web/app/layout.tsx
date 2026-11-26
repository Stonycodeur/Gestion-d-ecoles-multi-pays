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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="fr" suppressHydrationWarning><body>{children}</body></html>);
}
