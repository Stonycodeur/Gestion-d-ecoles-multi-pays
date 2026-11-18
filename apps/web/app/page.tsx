'use client';
import { useEffect, useState } from 'react';
import Shell from '../components/Shell';
import { api } from '../lib/api';

export default function Home() {
  const [mods, setMods] = useState<{ name: string; version: string; mobile_screens: string[] }[]>([]);
  useEffect(() => { api('/modules/active').then((r) => setMods(r.data ?? [])); }, []);
  return (
    <Shell>
      <h1>ÉcoleManager Pro</h1>
      <ul>{mods.length ? mods.map((m) => <li key={m.name}>{m.name} {m.version}</li>) : <li>—</li>}</ul>
    </Shell>
  );
}
