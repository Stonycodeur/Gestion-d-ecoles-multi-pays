import type { ReactNode } from 'react';
export const metadata = { title: 'ÉcoleManager Pro', description: 'Gestion d’écoles multi-pays', manifest: '/manifest.webmanifest' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return (<html lang="fr"><body style={{ fontFamily: 'system-ui', margin: 0 }}>{children}</body></html>);
}
