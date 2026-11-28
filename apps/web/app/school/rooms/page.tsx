'use client';
import ResourcePage from '../../../components/ResourcePage';

export default function RoomsPage() {
  return <ResourcePage titleFr="Salles" titleEn="Rooms" endpoint="/rooms" readRight="staff:read" writeRight="staff:write"
    fields={[{ key: 'name', fr: 'Nom', en: 'Name', required: true }, { key: 'capacity', fr: 'Capacité', en: 'Capacity', type: 'number' }]}
    cols={[{ key: 'name', fr: 'Nom', en: 'Name' }, { key: 'capacity', fr: 'Capacité', en: 'Capacity' }]} />;
}
