// Fails the build on high/critical production-dependency advisories, except the documented, reachability-analysed exceptions
// below (docs/SECURITY.md); each exception is printed on every run so it stays visible.
import { readFileSync } from 'node:fs';
const ACCEPTED = new Map([]);   // no exception today; add `[package, reachability analysis]` here AND in docs/SECURITY.md if one ever becomes unavoidable

const a = JSON.parse(readFileSync(process.argv[2] ?? 'audit.json', 'utf8'));
const blocking = [], accepted = [];
for (const [name, v] of Object.entries(a.vulnerabilities ?? {})) {
  if (v.severity !== 'high' && v.severity !== 'critical') continue;
  (ACCEPTED.has(name) ? accepted : blocking).push(`${v.severity} ${name} (${v.range})`);
}
for (const x of accepted) console.log(`ACCEPTED  ${x}  -> ${ACCEPTED.get(x.split(' ')[1])}`);
for (const x of blocking) console.log(`BLOCKING  ${x}`);
process.exit(blocking.length ? 1 : 0);
