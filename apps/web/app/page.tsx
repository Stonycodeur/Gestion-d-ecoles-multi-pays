'use client';
import { useEffect, useState } from 'react';
import Landing from '../components/Landing';
import Dashboard from '../components/Dashboard';
import { getSession } from '../lib/api';

/** `/` is the public world home for visitors, and the personal space for signed-in people. */
export default function Home() {
  const [mode, setMode] = useState<'wait' | 'public' | 'space'>('wait');
  useEffect(() => { setMode(getSession() ? 'space' : 'public'); }, []);
  if (mode === 'wait') return <main id="contenu" aria-busy="true" style={{ minHeight: '100vh' }} />;
  return mode === 'space' ? <Dashboard /> : <Landing />;
}
