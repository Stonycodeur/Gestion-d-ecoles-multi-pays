// Fails the build on high/critical production-dependency advisories, except the documented, reachability-analysed exceptions
// below (docs/SECURITY.md). Every exception is tied to the NestJS 10 -> 12 upgrade and is printed on each run so it stays visible.
import { readFileSync } from 'node:fs';
const ACCEPTED = new Map([
  ['@nestjs/platform-express', 'fixed only in NestJS 12 (major); multer/body-parser: no multipart route, JSON size and Content-Encoding enforced in core/security.ts'],
  ['@nestjs/swagger', 'fixed only in a major; js-yaml/lodash are used at documentation build time, not on request input'],
  ['body-parser', 'transitive of platform-express; explicit limit set, compressed bodies refused (415)'],
  ['multer', 'no FileInterceptor / multipart endpoint exists (attachments are base64 JSON)'],
  ['js-yaml', 'transitive of @nestjs/swagger, not fed with request data'],
  ['lodash', 'transitive of @nestjs/swagger, not fed with request data'],
]);
const a = JSON.parse(readFileSync(process.argv[2] ?? 'audit.json', 'utf8'));
const blocking = [], accepted = [];
for (const [name, v] of Object.entries(a.vulnerabilities ?? {})) {
  if (v.severity !== 'high' && v.severity !== 'critical') continue;
  (ACCEPTED.has(name) ? accepted : blocking).push(`${v.severity} ${name} (${v.range})`);
}
for (const x of accepted) console.log(`ACCEPTED  ${x}  -> ${ACCEPTED.get(x.split(' ')[1])}`);
for (const x of blocking) console.log(`BLOCKING  ${x}`);
process.exit(blocking.length ? 1 : 0);
