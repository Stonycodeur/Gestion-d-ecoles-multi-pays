import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ModuleRegistry, validateManifest, type HookHandler, type ModuleManifest } from '@ecolemanager/shared';

export const CORE_VERSION = '0.1.0';

/** Loads module packages from MODULES_DIR (default packages/modules). Adding a module = drop a package here + enable it for a tenant. */
@Injectable()
export class ModulesService {
  readonly registry = new ModuleRegistry(CORE_VERSION);
  private readonly log = new Logger('ModulesService');
  readonly loadErrors: string[] = [];

  constructor() {
    const dir = resolve(process.env.MODULES_DIR ?? join(__dirname, '../../../../packages/modules'));
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const base = join(dir, entry.name);
      try {
        const manifest = JSON.parse(readFileSync(join(base, 'manifest.json'), 'utf8')) as ModuleManifest;
        const errs = validateManifest(manifest);
        if (errs.length) throw new Error(errs.join('; '));
        const handlers: Record<string, HookHandler> = manifest.entry ? (require(join(base, manifest.entry)).handlers ?? {}) : {};
        this.registry.register(manifest, handlers);
        this.log.log(`module loaded: ${manifest.name}@${manifest.version}`);
      } catch (e) {
        const msg = `${entry.name}: ${e instanceof Error ? e.message : String(e)}`;
        this.loadErrors.push(msg);
        this.log.warn(`module skipped: ${msg}`);
      }
    }
  }
}
