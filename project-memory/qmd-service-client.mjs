// CLI bridge used by the shared project's QMD subprocesses.
import env from './memory-env.cjs';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const dir = path.join(env.memoryDirectory, 'qmd-state');
const stateFile = path.join(dir, 'service.json');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function state() { try { const value = JSON.parse(fs.readFileSync(stateFile, 'utf8')); if (value.root === env.root && value.socket === path.join(dir, 'qmd.sock') && Number.isInteger(value.pid) && value.pid > 0 && /^[a-f0-9]{64}$/.test(value.token)) return value; } catch {} }
function call(action, options = {}, query) {
  const info = state();
  if (!info) return Promise.reject(new Error('Project QMD service is not running'));
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: info.socket, path: '/qmd', method: 'POST', agent: false,
      headers: { Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json' } }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try { const data = JSON.parse(raw); if (res.statusCode !== 200) reject(new Error(data.error || raw)); else resolve(data); }
        catch (error) { reject(error); }
      });
    });
    req.setTimeout(Number(process.env.PI_MEMORY_QMD_SEARCH_TIMEOUT_MS || 120000), () => req.destroy(new Error('Project QMD request timed out')));
    req.on('error', reject);
    req.end(JSON.stringify({ action, options, query }));
  });
}
async function ensureService() {
  try { await call('status'); return; } catch {}
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const log = fs.openSync(path.join(dir, 'service.log'), 'a', 0o600);
  const child = spawn('flock', ['-w', '10', '-F', path.join(dir, 'service-start.lock'), process.execPath,
    path.join(env.packageRoot, 'qmd-service-daemon.mjs')], { cwd: env.root, env: process.env, detached: true, stdio: ['ignore', log, log] });
  child.on('error', () => {});
  child.unref();
  fs.closeSync(log);
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try { await call('status'); return; } catch {}
  }
  throw new Error('Cannot start project QMD SDK service; inspect .project-memory/qmd-state/service.log');
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'service') {
    const [operation = 'status', ...flags] = args;
    if (operation === 'status') {
      try { console.log(JSON.stringify((await call('status')).result, null, 2)); }
      catch { console.log(JSON.stringify({ running: false, root: env.root }, null, 2)); }
    } else if (operation === 'stop') {
      const pid = state()?.pid;
      try { await call('stop'); } catch {}
      const alive = () => { try { if (!pid) return false; process.kill(pid, 0); return true; } catch { return false; } };
      for (let i = 0; i < 240 && (state() || alive()); i++) await sleep(50);
      if (state() || alive()) throw new Error('Service shutdown did not finish; inspect its log.');
      console.log('Project QMD service stopped; GPU models released.');
    } else if (operation === 'start') {
      await ensureService();
      await call('retention', { minutes: Number(process.env.PI_MEMORY_MODEL_IDLE_MINUTES || 30) });
      const result = flags.includes('--warm') ? await call('warm') : await call('status');
      console.log(JSON.stringify(result.result, null, 2));
    } else throw new Error('Usage: qmd service [start [--warm]|status|stop]');
  } else {
    const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
      'existing-service-only': { type: 'boolean' },
      json: { type: 'boolean' }, format: { type: 'string' }, collection: { type: 'string', short: 'c', multiple: true },
      n: { type: 'string', short: 'n' }, 'min-score': { type: 'string' }, full: { type: 'boolean' },
      'full-path': { type: 'boolean' }, files: { type: 'boolean' }, all: { type: 'boolean' },
      'candidate-limit': { type: 'string', short: 'C' }, 'no-rerank': { type: 'boolean' }, explain: { type: 'boolean' }, intent: { type: 'string' },
      force: { type: 'boolean', short: 'f' }, 'max-docs-per-batch': { type: 'string' }, 'max-batch-mb': { type: 'string' },
    }});
    if (values.collection?.some(c => c !== 'project-memory')) throw new Error('Only this project-memory collection is allowed.');
    const format = values.json ? 'json' : values.files ? 'files' : values.format || 'cli';
    if (!['cli', 'json', 'files'].includes(format)) throw new Error('Supported bridge formats: cli, json, files. Use the native CLI for other formats.');
    const options = {
      limit: values.all ? 1000 : Number(values.n || (format === 'cli' ? 5 : 20)),
      minScore: Number(values['min-score'] ?? (command === 'vsearch' || command === 'vector-search' ? 0.3 : 0)),
      full: values.full, fullPath: values['full-path'], candidateLimit: Number(values['candidate-limit'] || 40),
      rerank: !values['no-rerank'], explain: values.explain, intent: values.intent, force: values.force,
      maxDocsPerBatch: values['max-docs-per-batch'] ? Number(values['max-docs-per-batch']) : undefined,
      maxBatchBytes: values['max-batch-mb'] ? Number(values['max-batch-mb']) * 1024 * 1024 : undefined,
    };
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 1000 || !Number.isFinite(options.minScore)) throw new Error('Invalid search limit/min-score');
    const action = ({ vsearch: 'semantic', 'vector-search': 'semantic', query: 'deep', 'deep-search': 'deep', update: 'update', embed: 'embed' })[command];
    if (!action) throw new Error('Unsupported project QMD command: ' + command);
    const query = positionals.join(' ').trim();
    if ((action === 'semantic' || action === 'deep') && !query) throw new Error('A non-empty query is required');
    if (values['existing-service-only']) {
      if (!['semantic', 'deep'].includes(action)) throw new Error('Existing-service-only is a retrieval option');
      const { readQmdIndex } = await import('./lib/qmd-readonly.mjs');
      await readQmdIndex(env.values.INDEX_PATH, { checkOnly: true });
      // No status/start probe: a missing or dead resident fails without initialization.
    } else await ensureService();
    const response = await call(action, options, query);
    for (const warning of response.warnings || []) console.error(warning);
    if (action === 'semantic' || action === 'deep') {
      const result = response.result;
      if (format === 'json') console.log(JSON.stringify(result, null, 2));
      else if (format === 'files') result.forEach(r => console.log(`${r.docid},${r.score},${r.file}`));
      else if (!result.length) console.log('No results found.');
      else result.forEach(r => console.log(`${r.file}:${r.line || 1} ${r.docid}\nTitle: ${r.title}\nScore: ${Math.round(r.score * 100)}%\n\n${r.body || r.snippet}\n`));
    } else console.log(JSON.stringify({ ...response.result, engineElapsedMs: response.elapsedMs }, null, 2));
  }
}
await main().catch(error => {
  // Put the actual service error first, not a Node stack/source excerpt that
  // hides the cause when Pi truncates startup notifications.
  console.error(`Project QMD: ${error.message || String(error)}`);
  process.exitCode = 1;
});
