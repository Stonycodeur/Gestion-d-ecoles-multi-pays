import { BadRequestException, Injectable } from '@nestjs/common';
import { sharedPool } from '../core/shared-pool';
import { GeoService } from '../geo/geo.service';

export interface Profile { full_name: string | null; phone_country: string | null; phone_number: string | null; language: string | null; avatar: string | null; preferences: Record<string, unknown> }
const EMPTY: Profile = { full_name: null, phone_country: null, phone_number: null, language: null, avatar: null, preferences: {} };
const AVATAR = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;
export const MAX_AVATAR_CHARS = 500_000;

/** Only known display preferences are kept, each checked against its allowed values: the JSON column can never carry anything else. */
export function cleanPreferences(p: unknown): Record<string, unknown> {
  if (p === undefined || p === null) return {};
  if (typeof p !== 'object' || Array.isArray(p)) throw new BadRequestException('preferences must be an object');
  const o = p as Record<string, unknown>; const out: Record<string, unknown> = {};
  const pick = (k: string, allowed: string[]) => { if (o[k] === undefined) return; if (typeof o[k] !== 'string' || !allowed.includes(o[k] as string)) throw new BadRequestException(`preferences.${k} is invalid`); out[k] = o[k]; };
  pick('mode', ['auto', 'light', 'dark']); pick('density', ['compact', 'comfortable', 'airy']); pick('radius', ['sharp', 'normal', 'round']);
  pick('sidebar', ['adaptive', 'icons']); pick('contrast', ['normal', 'high']); pick('motion', ['on', 'reduced']);
  if (o.accent !== undefined) { if (typeof o.accent !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(o.accent)) throw new BadRequestException('preferences.accent must be #rrggbb'); out.accent = o.accent.toLowerCase(); }
  if (o.fontScale !== undefined) { const n = Number(o.fontScale); if (!Number.isFinite(n) || n < 80 || n > 140) throw new BadRequestException('preferences.fontScale must be between 80 and 140'); out.fontScale = Math.round(n); }
  if (o.ringVolume !== undefined) { const n = Number(o.ringVolume); if (!Number.isFinite(n) || n < 0 || n > 1) throw new BadRequestException('preferences.ringVolume must be between 0 and 1'); out.ringVolume = n; }
  return out;
}

/** Personal space of every signed-in account: name, phone, language, photo and display preferences. Always bound to the verified token subject. */
@Injectable()
export class ProfileService {
  private mem = new Map<string, Profile>();
  constructor(private readonly geo: GeoService) {}

  async get(id: string): Promise<Profile> {
    const p = sharedPool(); if (!p) return { ...EMPTY, ...(this.mem.get(id) ?? {}) };
    const r = await p.query('SELECT full_name, phone_country, phone_number, language, avatar, preferences FROM user_profiles WHERE user_id = $1', [id]);
    return r.rows[0] ? { ...EMPTY, ...r.rows[0] } : { ...EMPTY };
  }
  private async write(id: string, patch: Partial<Profile>): Promise<Profile> {
    const p = sharedPool();
    if (!p) { const n = { ...(await this.get(id)), ...patch }; this.mem.set(id, n); return n; }
    const cur = await this.get(id); const n = { ...cur, ...patch };
    await p.query(`INSERT INTO user_profiles(user_id, full_name, phone_country, phone_number, language, avatar, preferences, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (user_id) DO UPDATE SET full_name = EXCLUDED.full_name, phone_country = EXCLUDED.phone_country, phone_number = EXCLUDED.phone_number, language = EXCLUDED.language, avatar = EXCLUDED.avatar, preferences = EXCLUDED.preferences, updated_at = NOW()`,
      [id, n.full_name, n.phone_country, n.phone_number, n.language, n.avatar, JSON.stringify(n.preferences)]);
    return n;
  }

  async save(id: string, b: any): Promise<Profile> {
    const patch: Partial<Profile> = {};
    if (b?.full_name !== undefined) {
      if (b.full_name !== null && b.full_name !== '' && (typeof b.full_name !== 'string' || b.full_name.trim().length > 120)) throw new BadRequestException('full_name is invalid (max 120 characters)');
      patch.full_name = b.full_name ? b.full_name.trim() : null;
    }
    if (b?.language !== undefined) {
      if (b.language !== null && !['fr', 'en', 'ar'].includes(b.language)) throw new BadRequestException('language must be fr, en or ar');
      patch.language = b.language;
    }
    if (b?.phone_number !== undefined || b?.phone_country !== undefined) {
      const digits = String(b.phone_number ?? '').replace(/[\s().-]/g, '');
      if (!digits) { patch.phone_number = null; patch.phone_country = null; }
      else {
        await this.geo.refresh();
        const iso = typeof b.phone_country === 'string' ? b.phone_country.toUpperCase() : '';
        const c = this.geo.countries().find((x) => x.c === iso && x.ph);
        if (!c) throw new BadRequestException('phone_country must be a country with a dialling code');
        if (!/^[0-9]+$/.test(digits)) throw new BadRequestException('phone_number must contain digits only');
        if (digits.length < c.d[0] || digits.length > c.d[1]) throw new BadRequestException(`phone_number must have ${c.d[0]} to ${c.d[1]} digits for ${c.n}`);
        patch.phone_country = c.c; patch.phone_number = digits;
      }
    }
    if (b?.preferences !== undefined) patch.preferences = cleanPreferences(b.preferences);
    return this.write(id, patch);
  }

  async setAvatar(id: string, dataUrl: unknown): Promise<Profile> {
    if (typeof dataUrl !== 'string' || dataUrl.length > MAX_AVATAR_CHARS) throw new BadRequestException('the photo must be a png, jpeg or webp image under about 350 KB');
    const m = AVATAR.exec(dataUrl); if (!m) throw new BadRequestException('the photo must be a base64 png, jpeg or webp data URL');
    const head = Buffer.from(m[2].slice(0, 24), 'base64');
    const ok = (m[1] === 'png' && head.subarray(0, 4).toString('hex') === '89504e47') || (m[1] === 'jpeg' && head.subarray(0, 3).toString('hex') === 'ffd8ff') || (m[1] === 'webp' && head.subarray(0, 4).toString('ascii') === 'RIFF');
    if (!ok) throw new BadRequestException('the file content does not match its image type');
    return this.write(id, { avatar: dataUrl });
  }
  removeAvatar(id: string) { return this.write(id, { avatar: null }); }
}
