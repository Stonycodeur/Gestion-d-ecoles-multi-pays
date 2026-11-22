import { createHash } from 'node:crypto';

/** Phase 6b (spec 6.18): ministry connectors are DATA in the country reference; this file only knows how to minimise, serialise and track a transmission. */
export type MinistryFormat = 'csv' | 'json' | 'xml';
export interface ConnectorConfig {
  code: string; label_fr?: string; label_en?: string; mode: 'api' | 'file'; formats: MinistryFormat[]; datasets: string[];
  sandbox?: boolean; endpoint?: string; fields?: Record<string, string[]>;   // per-dataset field whitelist (overrides the defaults)
}
/** Data minimisation: default whitelists by dataset family (prefix). Aggregates carry no personal data. */
const DEFAULT_FIELDS: { prefix: string; fields: string[] }[] = [
  { prefix: 'resultats_', fields: ['last_name', 'first_name', 'birth_date', 'school_year', 'passed', 'mention'] },
  { prefix: 'effectifs', fields: ['level_code', 'gender', 'count'] },
  { prefix: 'statistiques_rentree', fields: ['level_code', 'class_count', 'student_count'] },
];
export function datasetFields(c: ConnectorConfig, dataset: string): string[] {
  const own = c.fields?.[dataset]; if (own?.length) return own;
  const d = DEFAULT_FIELDS.find((x) => dataset.startsWith(x.prefix));
  if (!d) throw new Error(`no field whitelist for dataset ${dataset}`);
  return d.fields;
}
export function validateConnector(c: ConnectorConfig): string[] {
  const e: string[] = [];
  if (!c || typeof c.code !== 'string' || !/^[a-z0-9_]{2,40}$/.test(c.code)) e.push('code must match [a-z0-9_]{2,40}');
  if (c.mode !== 'api' && c.mode !== 'file') e.push('mode must be api or file');
  if (!Array.isArray(c.formats) || !c.formats.length || c.formats.some((f) => !['csv', 'json', 'xml'].includes(f))) e.push('formats must be a non-empty subset of csv, json, xml');
  if (!Array.isArray(c.datasets) || !c.datasets.length) e.push('datasets required');
  return e;
}
/** Keeps only whitelisted fields; anything else (names of guardians, addresses, payment data…) never leaves the school. */
export function minimise(rows: Record<string, unknown>[], fields: string[]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(fields.map((f) => [f, r[f] ?? null])));
}
const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;   // spreadsheet formula injection
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const xmlEsc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]!);
const tag = (n: string) => n.replace(/[^A-Za-z0-9_]/g, '_');
/** Deterministic serialisation (no timestamp inside) so that the checksum identifies the content. */
export function serialize(format: MinistryFormat, dataset: string, rows: Record<string, unknown>[], fields: string[]): string {
  if (format === 'json') return JSON.stringify({ dataset, count: rows.length, rows: minimise(rows, fields) });
  const m = minimise(rows, fields);
  if (format === 'csv') return [fields.join(','), ...m.map((r) => fields.map((f) => csvCell(r[f])).join(','))].join('\n') + '\n';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<dataset name="${xmlEsc(dataset)}" count="${rows.length}">\n${m.map((r) => `  <row>${fields.map((f) => `<${tag(f)}>${xmlEsc(r[f] === null || r[f] === undefined ? '' : String(r[f]))}</${tag(f)}>`).join('')}</row>`).join('\n')}\n</dataset>\n`;
}
export const checksum = (payload: string): string => createHash('sha256').update(payload).digest('hex');

export type TransmissionStatus = 'prepared' | 'validated' | 'rejected' | 'sent' | 'failed' | 'cancelled';
const NEXT: Record<TransmissionStatus, TransmissionStatus[]> = {
  prepared: ['validated', 'rejected', 'cancelled'], validated: ['sent', 'failed', 'cancelled'], failed: ['sent', 'failed', 'cancelled'], sent: [], rejected: [], cancelled: [],
};
export const canMove = (from: TransmissionStatus, to: TransmissionStatus): boolean => NEXT[from]?.includes(to) ?? false;
export const MAX_ATTEMPTS = 5;
/** Exponential back-off: 1, 2, 4, 8 … minutes, capped at 6 h. */
export const retryDelaySec = (attempt: number): number => Math.min(60 * 2 ** Math.max(0, attempt - 1), 6 * 3600);
export function isDue(t: { status: TransmissionStatus; attempts: number; next_retry_at: string | null; scheduled_for: string | null }, now: number = Date.now()): boolean {
  if (t.attempts >= MAX_ATTEMPTS) return false;
  if (t.status === 'validated') return !t.scheduled_for || Date.parse(t.scheduled_for) <= now;
  if (t.status === 'failed') return !!t.next_retry_at && Date.parse(t.next_retry_at) <= now;
  return false;
}
