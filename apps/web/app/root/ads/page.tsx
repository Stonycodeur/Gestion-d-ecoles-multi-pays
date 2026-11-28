'use client';
import ResourcePage from '../../../components/ResourcePage';

const THEMES = [['blue', 'Bleu', 'Blue'], ['violet', 'Violet', 'Violet'], ['orange', 'Orange', 'Orange'], ['teal', 'Turquoise', 'Teal'], ['rose', 'Rose', 'Rose']].map(([value, fr, en]) => ({ value, fr, en }));
/** Highlights shown on the public home page (root super-admin only). */
export default function AdsPage() {
  return <ResourcePage titleFr="Publicités de l’accueil" titleEn="Home page highlights" endpoint="/platform/ads" readRight="tenants:manage" writeRight="tenants:manage" defaults={{ theme: 'blue', position: 0, active: true }}
    intro={<p className="hint">Ces bandeaux défilent sur la page d’accueil publique. Sans bandeau actif, des messages par défaut sont affichés. / These banners scroll on the public home page. With none active, default messages are shown.</p>}
    fields={[{ key: 'title_fr', fr: 'Titre (FR)', en: 'Title (FR)', required: true }, { key: 'title_en', fr: 'Titre (EN)', en: 'Title (EN)', required: true }, { key: 'text_fr', fr: 'Texte (FR, 240 max.)', en: 'Text (FR, 240 max.)' }, { key: 'text_en', fr: 'Texte (EN, 240 max.)', en: 'Text (EN, 240 max.)' },
      { key: 'link_url', fr: 'Lien (/chemin ou https://…)', en: 'Link (/path or https://…)' }, { key: 'link_label_fr', fr: 'Bouton (FR)', en: 'Button (FR)' }, { key: 'link_label_en', fr: 'Bouton (EN)', en: 'Button (EN)' },
      { key: 'theme', fr: 'Couleur', en: 'Colour', type: 'select', options: THEMES, required: true }, { key: 'position', fr: 'Ordre', en: 'Order', type: 'number', step: '1' }, { key: 'active', fr: 'Actif', en: 'Active', type: 'checkbox' },
      { key: 'starts_at', fr: 'Début (date)', en: 'Start (date)', type: 'date' }, { key: 'ends_at', fr: 'Fin (date)', en: 'End (date)', type: 'date' }]}
    cols={[{ key: 'title_fr', fr: 'Titre', en: 'Title' }, { key: 'theme', fr: 'Couleur', en: 'Colour' }, { key: 'position', fr: 'Ordre', en: 'Order' }, { key: 'active', fr: 'Actif', en: 'Active', render: (r) => (r.active ? '✔' : '—') }, { key: 'link_url', fr: 'Lien', en: 'Link' }]} />;
}
