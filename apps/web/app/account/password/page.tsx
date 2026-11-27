'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

/** Old address of the password screen: the personal space now has a Security page. */
export default function PasswordMoved() {
  const router = useRouter();
  useEffect(() => { router.replace('/account/security'); }, [router]);
  return <main style={{ padding: 24 }}><p><Link href="/account/security">Sécurité / Security</Link></p></main>;
}
