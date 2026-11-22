import { Worker } from 'node:worker_threads';

/**
 * Isolated execution of third-party handler code (spec 6.19). Layers: separate worker thread with V8 heap limits, a fresh vm context with NO globals
 * (no require/process/fetch/timers), string/wasm code generation disabled, CPU timeout, hard kill timer, output size cap. Input and output cross the boundary as JSON
 * strings and are parsed INSIDE the context, so no object from the host realm is reachable. This is defence in depth, not a hostile-code guarantee:
 * for fully untrusted code, run the worker in a container/microVM (documented in docs/INTEGRATIONS.md).
 */
const WORKER = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
try {
  const ctx = vm.createContext(Object.create(null), { codeGeneration: { strings: false, wasm: false } });
  ctx.__payload = workerData.payload; ctx.__config = workerData.config;
  const code = '(function(payload, config){' + workerData.source + '\\n})(JSON.parse(__payload), JSON.parse(__config))';
  const out = vm.runInContext('JSON.stringify((function(){ const r = ' + code + '; return r === undefined ? null : r; })())', ctx, { timeout: workerData.timeoutMs });
  parentPort.postMessage({ ok: true, value: out });
} catch (e) { parentPort.postMessage({ ok: false, error: String((e && e.message) || e) }); }
`;
const MAX_OUT = 100_000;

export function runSandboxed(source: string, payload: unknown, config: Record<string, unknown>, opts: { timeoutMs?: number; memoryMb?: number } = {}): Promise<unknown> {
  const timeoutMs = opts.timeoutMs ?? 1000;
  return new Promise((resolve, reject) => {
    const w = new Worker(WORKER, {
      eval: true, workerData: { source, payload: JSON.stringify(payload ?? null), config: JSON.stringify(config ?? {}), timeoutMs },
      resourceLimits: { maxOldGenerationSizeMb: opts.memoryMb ?? 32, maxYoungGenerationSizeMb: 8, codeRangeSizeMb: 16, stackSizeMb: 2 },
      env: {}, stdout: false, stderr: false,
    });
    const kill = setTimeout(() => { void w.terminate(); reject(new Error('sandbox: handler exceeded the time limit')); }, timeoutMs + 500);
    w.once('message', (m: { ok: boolean; value?: string; error?: string }) => {
      clearTimeout(kill); void w.terminate();
      if (!m.ok) return reject(new Error(`sandbox: ${m.error}`));
      if ((m.value ?? '').length > MAX_OUT) return reject(new Error('sandbox: result too large'));
      try { resolve(JSON.parse(m.value ?? 'null')); } catch { reject(new Error('sandbox: invalid result')); }
    });
    w.once('error', (e) => { clearTimeout(kill); reject(new Error(`sandbox: ${e.message}`)); });
    w.once('exit', (code) => { clearTimeout(kill); if (code !== 0) reject(new Error('sandbox: terminated')); });
  });
}
