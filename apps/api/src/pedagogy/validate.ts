import { BadRequestException, ConflictException } from '@nestjs/common';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuid = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !UUID.test(v)) throw new BadRequestException(`${name} must be a uuid`);
  return v;
};
export const str = (v: unknown, name: string, max = 500): string => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new BadRequestException(`${name} is required (max ${max} chars)`);
  return v.trim();
};
export const optStr = (v: unknown, name: string, max = 500): string | null => (v === undefined || v === null || v === '' ? null : str(v, name, max));
export const num = (v: unknown, name: string, min: number, max: number): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new BadRequestException(`${name} must be a number in ${min}..${max}`);
  return n;
};
export const date = (v: unknown, name: string): string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw new BadRequestException(`${name} must be YYYY-MM-DD`);
  return v;
};
/** Maps PostgreSQL constraint errors to HTTP errors. */
export function mapDbError(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === '23505') throw new ConflictException('conflict: duplicate or double booking');
  if (code === '23514' || code === '23503' || code === '22P02') throw new BadRequestException('invalid data');
  throw e;
}
