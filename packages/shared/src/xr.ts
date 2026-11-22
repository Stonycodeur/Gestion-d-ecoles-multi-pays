/** 3D / AR / 360° assets (spec 6.21): validation of what a school may attach, and the choice of viewer from device capabilities. Pure functions. */
export const XR_KINDS = ['model_3d', 'panorama_360'] as const;
export type XrKind = (typeof XR_KINDS)[number];
export const XR_FORMATS: Record<XrKind, string[]> = { model_3d: ['glb', 'gltf', 'usdz'], panorama_360: ['jpg', 'jpeg', 'png', 'webp'] };
export const XR_MAX_BYTES: Record<XrKind, number> = { model_3d: 25 * 1024 * 1024, panorama_360: 15 * 1024 * 1024 };

export interface XrAssetInput { title?: unknown; kind?: unknown; format?: unknown; url?: unknown; ios_url?: unknown; size_bytes?: unknown; alt_text?: unknown }
const okUrl = (u: unknown) => typeof u === 'string' && u.length <= 500 && (/^https:\/\//i.test(u) || /^\/(?!\/)[\w./-]*$/.test(u));

/** Returns the list of problems (empty = valid). Accessibility: a text alternative is mandatory. USDZ is only accepted as the iOS companion of a glTF model. */
export function validateXrAsset(a: XrAssetInput): string[] {
  const e: string[] = [];
  if (typeof a.title !== 'string' || !a.title.trim() || a.title.length > 200) e.push('title is required (max 200 characters)');
  if (typeof a.alt_text !== 'string' || a.alt_text.trim().length < 5 || a.alt_text.length > 500) e.push('alt_text is required (5 to 500 characters) for accessibility');
  const kind = a.kind as XrKind;
  if (!XR_KINDS.includes(kind)) { e.push(`kind must be one of ${XR_KINDS.join(', ')}`); return e; }
  const fmt = typeof a.format === 'string' ? a.format.toLowerCase() : '';
  if (!XR_FORMATS[kind].includes(fmt)) e.push(`format must be one of ${XR_FORMATS[kind].join(', ')} for ${kind}`);
  if (fmt === 'usdz') e.push('usdz is only accepted as ios_url next to a glb/gltf model');
  if (!okUrl(a.url)) e.push('url must be an https:// address or an absolute path on this server');
  else if (typeof a.url === 'string' && !new RegExp(`\\.${fmt}(\\?.*)?$`, 'i').test(a.url)) e.push('url extension must match format');
  if (a.ios_url !== undefined && a.ios_url !== null && (kind !== 'model_3d' || !okUrl(a.ios_url) || !/\.usdz(\?.*)?$/i.test(String(a.ios_url)))) e.push('ios_url must be a .usdz address and only applies to 3D models');
  const size = Number(a.size_bytes);
  if (!Number.isInteger(size) || size <= 0) e.push('size_bytes must be a positive integer');
  else if (size > XR_MAX_BYTES[kind]) e.push(`asset too heavy: ${Math.round(size / 1048576)} MB, limit ${XR_MAX_BYTES[kind] / 1048576} MB for ${kind} (low-bandwidth schools)`);
  return e;
}

export interface DeviceCaps { webxrAr?: boolean; webxrVr?: boolean; webgl?: boolean; reducedMotion?: boolean }
export type ViewerMode = 'ar' | 'vr' | 'orbit_3d' | 'panorama_drag' | 'image_only';
/** Best viewer the device can run, always ending in a mode that needs nothing but a canvas (or a plain image). */
export function viewerMode(kind: XrKind, c: DeviceCaps): ViewerMode {
  if (kind === 'model_3d') return c.webxrAr ? 'ar' : c.webgl === false ? 'image_only' : 'orbit_3d';
  return c.webxrVr ? 'vr' : c.webgl === false ? 'image_only' : 'panorama_drag';
}
