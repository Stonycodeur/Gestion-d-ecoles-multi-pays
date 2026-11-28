'use client';
import ResourcePage from '../../../components/ResourcePage';
import { useLang } from '../../../lib/useLang';
import { useNavigation } from '../../../lib/navigation';

export default function ClassesPage() {
  const { l } = useLang(); const { term } = useNavigation(); const cls = term('classes', l); const year = (() => { const y = new Date().getFullYear(), m = new Date().getMonth(); const a = m >= 7 ? y : y - 1; return `${a}-${a + 1}`; })();
  return <ResourcePage titleFr={cls} titleEn={cls} endpoint="/classes" readRight="students:read" writeRight="students:write" defaults={{ school_year: year }}
    fields={[{ key: 'name', fr: 'Nom', en: 'Name', required: true }, { key: 'level_code', fr: 'Niveau (code)', en: 'Level (code)', required: true }, { key: 'section', fr: 'Section / série', en: 'Section / track' }, { key: 'school_year', fr: 'Année scolaire', en: 'School year', required: true }]}
    cols={[{ key: 'name', fr: 'Nom', en: 'Name' }, { key: 'level_code', fr: 'Niveau', en: 'Level' }, { key: 'section', fr: 'Section', en: 'Section' }, { key: 'school_year', fr: 'Année', en: 'Year' }]} />;
}
