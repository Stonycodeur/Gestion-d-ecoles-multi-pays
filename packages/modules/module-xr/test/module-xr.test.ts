import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateManifest } from '../../../shared/src/modules.ts';

test('manifest is valid', () => {
  assert.deepEqual(validateManifest(JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))), []);
});
