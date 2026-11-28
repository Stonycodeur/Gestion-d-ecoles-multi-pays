'use client';
import ResourcePage from '../../../components/ResourcePage';
import { useLang } from '../../../lib/useLang';
import { useNavigation } from '../../../lib/navigation';

export default function StaffPage() {
  const { l } = useLang(); const { term } = useNavigation(); const tt = term('teachers', l);
  return <ResourcePage titleFr={tt} titleEn={tt} endpoint="/teachers" readRight="staff:read" writeRight="staff:write" defaults={{ max_weekly_hours: 24 }}
    fields={[{ key: 'first_name', fr: 'Prénom', en: 'First name', required: true }, { key: 'last_name', fr: 'Nom', en: 'Last name', required: true }, { key: 'max_weekly_hours', fr: 'Charge hebdomadaire max. (h)', en: 'Max weekly hours', type: 'number', required: true }]}
    cols={[{ key: 'last_name', fr: 'Nom', en: 'Last name' }, { key: 'first_name', fr: 'Prénom', en: 'First name' }, { key: 'max_weekly_hours', fr: 'Charge max. (h/sem.)', en: 'Max hours/week' }]} />;
}
