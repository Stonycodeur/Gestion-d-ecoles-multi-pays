'use client';
import ResourcePage from '../../../components/ResourcePage';
import { useLang } from '../../../lib/useLang';
import { useNavigation } from '../../../lib/navigation';

const CATS = [['academic', 'Académique', 'Academic'], ['physical', 'Physique (EPS)', 'Physical (PE)'], ['creativity', 'Créativité', 'Creativity'], ['research', 'Recherche', 'Research'], ['professional', 'Professionnel', 'Professional'], ['orientation', 'Orientation', 'Orientation']].map(([value, fr, en]) => ({ value, fr, en }));
export default function SubjectsPage() {
  const { l } = useLang(); const { term } = useNavigation(); const s = term('subjects', l);
  return <ResourcePage titleFr={s} titleEn={s} endpoint="/subjects" readRight="schedule:read" writeRight="students:write" defaults={{ coefficient: 1, category: 'academic' }}
    fields={[{ key: 'code', fr: 'Code', en: 'Code', required: true }, { key: 'name', fr: 'Nom', en: 'Name', required: true }, { key: 'coefficient', fr: 'Coefficient', en: 'Coefficient', type: 'number', step: '0.1', required: true }, { key: 'category', fr: 'Catégorie (alimente l’OAA)', en: 'Category (feeds the OAA)', type: 'select', options: CATS, required: true }]}
    cols={[{ key: 'code', fr: 'Code', en: 'Code' }, { key: 'name', fr: 'Nom', en: 'Name' }, { key: 'coefficient', fr: 'Coef.', en: 'Coef.' }, { key: 'category', fr: 'Catégorie', en: 'Category', render: (r) => CATS.find((c) => c.value === r.category)?.[l === 'fr' ? 'fr' : 'en'] ?? r.category }]} />;
}
