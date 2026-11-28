'use client';
import { useParams } from 'next/navigation';
import { SectionView } from '../../../../components/SchoolSections';

export default function SchoolSection() { return <SectionView id={String(useParams().section)} />; }
