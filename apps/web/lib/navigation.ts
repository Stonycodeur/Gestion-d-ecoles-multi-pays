'use client';
import { useEffect, useState } from 'react';
import { api, getContext, getSession } from './api';
import type { Locale } from './i18n';

type L2 = { fr: string; en: string };
export interface NavItemView { href: string; icon: string; label: L2; desc: L2 }
export interface NavGroupView { key: string; title: L2; items: NavItemView[] }
export interface NavView {
  school: { slug: string; name: string; type: string; country: string; city: string | null } | null;
  profile: { type: string; label: L2; vocabulary: Record<string, L2> } | null;
  groups: NavGroupView[]; widgets: string[]; rights: string[]; modules: string[]; hidden: string[]; shown: string[];
}
export const EMPTY_NAV: NavView = { school: null, profile: null, groups: [], widgets: [], rights: [], modules: [], hidden: [], shown: [] };
const key = () => `em_nav:${getContext() || getSession()?.school || 'none'}`;
const pending = new Map<string, Promise<NavView | null>>();

/** What this person may open in this school (pages by right, module and level) and the school's own words. Cached for offline use. */
export function useNavigation() {
  const [nav, setNav] = useState<NavView>(EMPTY_NAV); const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!getSession()) { setLoaded(true); return; }
    const k = key();
    try { const c = localStorage.getItem(k); if (c) setNav(JSON.parse(c) as NavView); } catch { /* no cache yet */ }
    let live = true;
    let p = pending.get(k);
    if (!p) { p = api<NavView>('/me/navigation').then((r) => (r.ok && r.data ? r.data : null)); pending.set(k, p); setTimeout(() => pending.delete(k), 5000); }
    void p.then((d) => { if (!live) return; if (d) { setNav(d); try { localStorage.setItem(k, JSON.stringify(d)); } catch { /* quota */ } } setLoaded(true); });
    return () => { live = false; };
  }, []);
  const has = (perm: string) => nav.rights.includes(perm);
  const term = (name: string, l: Locale | string): string => { const v = nav.profile?.vocabulary[name]; return v ? (l === 'fr' ? v.fr : v.en) : name; };
  return { nav, loaded, has, term };
}
