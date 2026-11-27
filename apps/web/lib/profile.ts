'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export interface Profile { full_name: string | null; phone_country: string | null; phone_number: string | null; language: string | null; avatar: string | null; preferences: Record<string, unknown> }
export const EMPTY_PROFILE: Profile = { full_name: null, phone_country: null, phone_number: null, language: null, avatar: null, preferences: {} };
const EVT = 'em:profile';
export const announceProfile = (p: Profile) => window.dispatchEvent(new CustomEvent(EVT, { detail: p }));

/** The signed-in person's profile; every screen showing the photo or name stays in step when it changes. */
export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const reload = useCallback(async () => { const r = await api<Profile>('/me/profile'); if (r.ok && r.data) { setProfile({ ...EMPTY_PROFILE, ...r.data }); return r.data; } return null; }, []);
  useEffect(() => {
    void reload();
    const on = (e: Event) => setProfile({ ...EMPTY_PROFILE, ...(e as CustomEvent<Profile>).detail });
    window.addEventListener(EVT, on); return () => window.removeEventListener(EVT, on);
  }, [reload]);
  return { profile, reload };
}
export const initialsOf = (name: string | null | undefined, fallback: string): string => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  return (parts.length ? parts.slice(0, 2).map((x) => x[0]).join('') : fallback).toUpperCase().slice(0, 2);
};
export const msgOf = (r: { error?: string; status?: number }): string => {
  try { const e = JSON.parse(r.error ?? '""'); return typeof e === 'string' ? e : Array.isArray(e) ? e.join(', ') : JSON.stringify(e); } catch { return r.error ?? 'error'; }
};
