'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { login, setSession } from '../../lib/api';
import { getLocale, t } from '../../lib/i18n';

export default function LoginPage() {
  const router = useRouter();
  const [school, setSchool] = useState(''); const [role, setRole] = useState('teacher'); const [err, setErr] = useState('');
  const l = typeof window === 'undefined' ? 'fr' : getLocale();
  return (
    <form style={{ maxWidth: 360, margin: '48px auto', display: 'grid', gap: 12 }} onSubmit={async (e) => {
      e.preventDefault(); setErr('');
      if (!/^[a-z0-9_]{2,40}$/.test(school.trim().toLowerCase())) { setErr('Code invalide / invalid code'); return; }
      try { setSession(await login(school.trim().toLowerCase(), role)); router.replace('/'); } catch (x) { setErr((x as Error).message); }
    }}>
      <h1>{t('app', l)}</h1>
      <label>{t('school', l)}<input required value={school} onChange={(e) => setSchool(e.target.value)} style={{ display: 'block', width: '100%' }} /></label>
      <label>{t('role', l)}
        <select value={role} onChange={(e) => setRole(e.target.value)} style={{ display: 'block', width: '100%' }}>
          {['admin', 'head', 'teacher', 'education_assistant', 'accountant', 'student', 'guardian'].map((r) => <option key={r}>{r}</option>)}
        </select>
      </label>
      <button type="submit">{t('login', l)}</button>
      {err && <p role="alert" style={{ color: 'crimson' }}>{err}</p>}
    </form>
  );
}
