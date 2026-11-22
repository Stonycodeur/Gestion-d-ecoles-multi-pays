'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { finishLogin } from '../../../lib/oidc';
import { setSession } from '../../../lib/api';

export default function Callback() {
  const router = useRouter(); const [err, setErr] = useState('');
  useEffect(() => {
    finishLogin(window.location.search).then((s) => { setSession(s); window.history.replaceState({}, '', '/auth/callback'); router.replace('/'); }).catch((e: Error) => setErr(e.message));
  }, [router]);
  return err ? <p role="alert" style={{ color: 'crimson', padding: 24 }}>{err} — <a href="/login">retry / réessayer</a></p> : <p role="status" style={{ padding: 24 }}>…</p>;
}
