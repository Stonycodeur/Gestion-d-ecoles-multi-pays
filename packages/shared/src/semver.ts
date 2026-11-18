export type Triple = [number, number, number];

export function parseVersion(v: string): Triple {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim());
  if (!m) throw new Error(`Invalid version "${v}"`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

const COMPARATOR = /^(>=|<=|>|<|=|\^)?(\d+\.\d+\.\d+)$/;

export function isValidRange(range: string): boolean {
  const parts = range.trim().split(/\s+/).filter(Boolean);
  return parts.length > 0 && parts.every((p) => COMPARATOR.test(p));
}

/** Supports: >=, >, <=, <, =, ^ and space-separated AND. Enough for core_version ranges. */
export function satisfies(version: string, range: string): boolean {
  if (!isValidRange(range)) throw new Error(`Invalid range "${range}"`);
  return range.trim().split(/\s+/).every((part) => {
    const m = COMPARATOR.exec(part)!;
    const op = m[1] ?? '=', target = m[2];
    const c = compareVersions(version, target);
    switch (op) {
      case '>=': return c >= 0;
      case '>': return c > 0;
      case '<=': return c <= 0;
      case '<': return c < 0;
      case '^': {
        const [maj, min] = parseVersion(target);
        const upper = maj > 0 ? `${maj + 1}.0.0` : `0.${min + 1}.0`;
        return c >= 0 && compareVersions(version, upper) < 0;
      }
      default: return c === 0;
    }
  });
}
