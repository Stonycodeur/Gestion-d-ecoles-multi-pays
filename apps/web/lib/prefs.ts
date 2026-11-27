/** Personal display preferences (theme, accent, density…). Applied from this device at once, and saved in the personal space so they follow the person. */
export interface Prefs {
  mode: 'auto' | 'light' | 'dark'; accent: string; density: 'compact' | 'comfortable' | 'airy'; radius: 'sharp' | 'normal' | 'round';
  fontScale: number; sidebar: 'adaptive' | 'icons'; contrast: 'normal' | 'high'; motion: 'on' | 'reduced'; ringVolume: number;
}
export const DEFAULT_PREFS: Prefs = { mode: 'auto', accent: '#1d4ed8', density: 'comfortable', radius: 'normal', fontScale: 100, sidebar: 'adaptive', contrast: 'normal', motion: 'on', ringVolume: 0.8 };
/** Accent colours that keep white text readable (contrast >= 4.5:1). Any other colour is allowed: the text colour then adapts. */
export const ACCENTS = ['#1d4ed8', '#0f766e', '#7c3aed', '#be185d', '#b91c1c', '#c2410c', '#a16207', '#15803d', '#0e7490', '#475569'];
const KEY = 'em_prefs';

export const loadPrefs = (): Prefs => {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Prefs>) }; } catch { return { ...DEFAULT_PREFS }; }
};
const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
/** Text colour that reads best on the accent: white or near-black, whichever contrasts more. */
export const onAccent = (hex: string): string => { const l = lum(hex); return 1.05 / (l + 0.05) >= (l + 0.05) / 0.05 ? '#ffffff' : '#0b1220'; };

export function applyPrefs(p: Prefs): void {
  const r = document.documentElement;
  if (p.mode === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', p.mode);
  r.style.setProperty('--primary', p.accent); r.style.setProperty('--on-primary', onAccent(p.accent));
  r.style.setProperty('--fs', String(p.fontScale));
  r.dataset.density = p.density; r.dataset.radius = p.radius; r.dataset.side = p.sidebar; r.dataset.contrast = p.contrast; r.dataset.motion = p.motion;
  const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.setAttribute('content', p.accent);
}
export function savePrefs(p: Prefs): void { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } applyPrefs(p); }
/** Preferences saved on the account win over this device's copy (the person changed them elsewhere). */
export function mergeRemote(remote: Record<string, unknown> | undefined): Prefs {
  const p = { ...loadPrefs(), ...(remote ?? {}) } as Prefs; savePrefs(p); return p;
}
export const prefsPayload = (p: Prefs) => ({ mode: p.mode, accent: p.accent, density: p.density, radius: p.radius, fontScale: p.fontScale, sidebar: p.sidebar, contrast: p.contrast, motion: p.motion, ringVolume: p.ringVolume });

/** Notification ringtone: an audio file chosen on this device (up to 7 MB), kept in IndexedDB because it is too big for localStorage. It never leaves the device. */
const DB = 'em_media';
const open = (): Promise<IDBDatabase> => new Promise((ok, ko) => { const r = indexedDB.open(DB, 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
export async function saveRingtone(file: File): Promise<void> {
  if (file.size > 7 * 1024 * 1024) throw new Error('7 Mo max / 7 MB max');
  if (!file.type.startsWith('audio/')) throw new Error('Fichier audio requis / audio file required');
  const db = await open(); await new Promise<void>((ok, ko) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put({ blob: file, name: file.name }, 'ringtone'); t.oncomplete = () => ok(); t.onerror = () => ko(t.error); });
}
export async function loadRingtone(): Promise<{ blob: Blob; name: string } | null> {
  try { const db = await open(); return await new Promise((ok) => { const r = db.transaction('kv').objectStore('kv').get('ringtone'); r.onsuccess = () => ok((r.result as { blob: Blob; name: string }) ?? null); r.onerror = () => ok(null); }); } catch { return null; }
}
export async function clearRingtone(): Promise<void> {
  try { const db = await open(); await new Promise<void>((ok) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete('ringtone'); t.oncomplete = () => ok(); t.onerror = () => ok(); }); } catch { /* nothing to clear */ }
}
/** Plays the chosen ringtone, or a short built-in beep when none was chosen. */
export async function playRing(volume: number): Promise<void> {
  try {
    const r = await loadRingtone();
    if (r) { const a = new Audio(URL.createObjectURL(r.blob)); a.volume = Math.min(1, Math.max(0, volume)); await a.play(); return; }
    const ctx = new AudioContext(); const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = 'sine'; o.frequency.value = 880; g.gain.value = Math.min(1, Math.max(0, volume)) * 0.2; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.18);
  } catch { /* autoplay blocked until the first interaction */ }
}
