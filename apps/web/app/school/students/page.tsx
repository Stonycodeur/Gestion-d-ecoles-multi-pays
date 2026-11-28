'use client';
import ResourcePage from '../../../components/ResourcePage';
import { useLang } from '../../../lib/useLang';
import { useNavigation } from '../../../lib/navigation';

const STATUS = [['enrolled', 'Inscrit', 'Enrolled'], ['active', 'Actif', 'Active'], ['transferred', 'Transféré', 'Transferred'], ['graduated', 'Diplômé', 'Graduated']].map(([value, fr, en]) => ({ value, fr, en }));
export default function StudentsPage() {
  const { l } = useLang(); const { term } = useNavigation(); const s = term('students', l); const fr = l === 'fr';
  return <ResourcePage titleFr={s} titleEn={s} endpoint="/students" readRight="students:read" writeRight="students:write" canDelete={false} lookups={{ classes: '/classes' }}
    lookupOptions={(k, lk) => (k === 'class_id' ? (lk.classes ?? []).map((c) => ({ value: c.id, fr: c.name, en: c.name })) : [])}
    fields={[{ key: 'first_name', fr: 'Prénom', en: 'First name', required: true }, { key: 'last_name', fr: 'Nom', en: 'Last name', required: true }, { key: 'birth_date', fr: 'Date de naissance', en: 'Date of birth', type: 'date' },
      { key: 'class_id', fr: 'Classe', en: 'Class', type: 'select' }, { key: 'gender', fr: 'Genre', en: 'Gender', type: 'select', options: [{ value: 'F', fr: 'Féminin', en: 'Female' }, { value: 'M', fr: 'Masculin', en: 'Male' }, { value: 'X', fr: 'Autre', en: 'Other' }] },
      { key: 'status', fr: 'Statut', en: 'Status', type: 'select', options: STATUS, editOnly: true }]}
    cols={[{ key: 'last_name', fr: 'Nom', en: 'Last name' }, { key: 'first_name', fr: 'Prénom', en: 'First name' }, { key: 'class_id', fr: 'Classe', en: 'Class', render: (r, lk) => (lk.classes ?? []).find((c) => c.id === r.class_id)?.name ?? '—' },
      { key: 'status', fr: 'Statut', en: 'Status', render: (r) => { const x = STATUS.find((z) => z.value === r.status); return x ? (fr ? x.fr : x.en) : (r.status ?? '—'); } }]} />;
}
