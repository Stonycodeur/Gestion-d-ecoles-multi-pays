import Link from 'next/link';

export interface LegalSection { h: { fr: string; en: string }; p: { fr: string[]; en: string[] } }

/** Public legal page (no login), bilingual. Templates: the school (data controller) must review them with its counsel before publication. */
export default function LegalPage({ title, sections, lang }: { title: { fr: string; en: string }; sections: LegalSection[]; lang: 'fr' | 'en' }) {
  return (
    <main style={{ maxWidth: 800, margin: '0 auto', padding: 16, lineHeight: 1.6 }}>
      <nav aria-label="language"><Link href="?lang=fr" aria-current={lang === 'fr'}>Français</Link> · <Link href="?lang=en" aria-current={lang === 'en'}>English</Link></nav>
      <h1>{title[lang]}</h1>
      <p><em>{lang === 'fr' ? 'Modèle à adapter par l’établissement avec son conseil juridique avant publication. Les passages entre [crochets] sont à compléter.' : 'Template to be reviewed by the school with its legal counsel before publication. Passages in [brackets] must be completed.'}</em></p>
      {sections.map((s) => <section key={s.h.fr}><h2>{s.h[lang]}</h2>{s.p[lang].map((t, i) => <p key={i}>{t}</p>)}</section>)}
    </main>
  );
}
