// Project-only persistent QMD SDK host. Unix socket, no TCP port, no LLM server.
import env from './memory-env.cjs';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { openSemanticStore, semanticSearch } from './qmd-semantic.mjs';
import { extractSnippet } from './node_modules/@tobilu/qmd/dist/index.js';
import { formatQueryForEmbedding, setDefaultLlamaCpp } from './node_modules/@tobilu/qmd/dist/llm.js';

process.chdir(env.root);
process.umask(0o077);
const stateDir = path.join(env.root, '.pi/qmd-state');
const socket = path.join(stateDir, 'qmd.sock');
const metadata = path.join(stateDir, 'service.json');
const token = randomBytes(32).toString('hex');
const minutes = Number(process.env.PI_MEMORY_MODEL_IDLE_MINUTES || 30);
let idleMs = minutes * 60000;
if (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440) throw new Error('Retention must be 1–1440 minutes');
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
execFileSync(process.execPath, [path.join(env.packageRoot, 'check-memory-config.mjs'), '--require-trust', '--models=embed'], { cwd: env.root, env: process.env, stdio: 'pipe' });
const store = await openSemanticStore();
// QMD 2.8.3's public createStore() does not expose retention options. This
// pinned-version adapter delegates lifetime to the idle timer below instead
// of the SDK's 5-minute model unload timer. No upstream file is modified.
if (!('inactivityTimeoutMs' in store.internal.llm)) throw new Error('QMD retention API changed; review the pinned adapter');
store.internal.llm.inactivityTimeoutMs = 0;
// QMD's token chunker uses the global singleton even with an SDK-owned LLM.
// Official setter: share one instance instead of duplicating embedding VRAM.
setDefaultLlamaCpp(store.internal.llm);
let lastUsedAt = Date.now();
let timer, queue = Promise.resolve(), active = 0, closing = false;
const startedAt = Date.now();
const writeMetadata = () => {
  const temporary = metadata + `.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ pid: process.pid, root: env.root, socket, token, idleMs, startedAt, lastUsedAt }) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, metadata); // Concurrent CLI clients must never read partially-written JSON.
};
function touch() {
  lastUsedAt = Date.now();
  clearTimeout(timer);
  writeMetadata();
  timer = setTimeout(() => {
    if (active) touch(); else shutdown('idle expiry').catch(console.error);
  }, idleMs);
}
async function status() {
  const llm = store.internal.llm;
  return { running: true, pid: process.pid, root: env.root, transport: 'project Unix socket',
    idleMinutes: idleMs / 60000, idleRemainingSeconds: Math.max(0, (lastUsedAt + idleMs - Date.now()) / 1000),
    active, models: { embed: !!llm.embedModel, generate: !!llm.generateModel, rerank: !!llm.rerankModel },
    gpuLayers: { embed: llm.embedModel?.gpuLayers, generate: llm.generateModel?.gpuLayers, rerank: llm.rerankModel?.gpuLayers },
    contexts: { embed: llm.embedContexts.length, rerank: llm.rerankContexts.length },
    device: llm.llama ? await llm.getDeviceInfo({ allowBuild: false }) : null,
    index: await store.getStatus(),
  };
}
async function perform(body, warnings) {
  const { action, query, options = {} } = body;
  env.configure();
  const roles = action === 'deep' ? 'embed,rerank,generate' : ['warm', 'semantic', 'embed'].includes(action) ? 'embed' : '';
  execFileSync(process.execPath, [path.join(env.packageRoot, 'check-memory-config.mjs'), '--require-trust', `--models=${roles}`], { cwd: env.root, env: process.env, stdio: 'pipe' });
  if (action === 'retention') {
    const configured = Number(options.minutes);
    if (!Number.isFinite(configured) || configured < 1 || configured > 1440) throw new Error('Retention must be 1–1440 minutes');
    idleMs = configured * 60000;
    return { idleMinutes: idleMs / 60000 };
  }
  if (action === 'warm') {
    const probe = await store.internal.llm.embed(formatQueryForEmbedding('project memory retrieval'));
    if (!probe?.embedding.length) throw new Error('Embedding warmup inference failed');
    const info = await status();
    if (info.device?.gpu !== 'cuda' || info.gpuLayers.embed < 1) throw new Error('Expected actual CUDA embedding offload');
    return info;
  }
  if (action === 'semantic') return semanticSearch(store, query, { ...options, onWarning: message => warnings.push(message) });
  if (action === 'deep') {
    const results = await store.search({ query, collection: 'pi-memory', limit: options.limit,
      minScore: options.minScore, candidateLimit: options.candidateLimit, rerank: options.rerank,
      explain: options.explain, intent: options.intent });
    // Match the upstream CLI JSON contract consumed by pi-memory. SDK results
    // use body/bestChunk, whereas pi-memory expects snippet/content/chunk.
    return results.map(r => {
      const snippet = extractSnippet(r.body, query, 300, r.bestChunkPos, undefined, options.intent);
      return { docid: '#' + r.docid, score: Math.round(r.score * 100) / 100,
        file: options.fullPath ? path.join(env.values.PI_MEMORY_DIR, r.file.replace('qmd://pi-memory/', '')) : r.file,
        line: snippet.line, title: r.title, context: r.context,
        ...(options.full ? { body: r.body, content: r.body } : { snippet: snippet.snippet }),
        ...(options.explain && r.explain ? { explain: r.explain } : {}) };
    });
  }
  if (action === 'update') return store.update({ collections: ['pi-memory'] });
  if (action === 'embed') return store.embed({ force: !!options.force,
    maxDocsPerBatch: options.maxDocsPerBatch, maxBatchBytes: options.maxBatchBytes });
  throw new Error('Unsupported project QMD action');
}
function send(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}
const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Bearer ${token}` || req.headers.origin) return send(res, 403, { error: 'Unauthorized' });
  if (req.method !== 'POST' || req.url !== '/qmd') return send(res, 404, { error: 'Not found' });
  if (closing) return send(res, 503, { error: 'Project QMD service is stopping' });
  let raw = '';
  req.on('data', chunk => { raw += chunk; if (raw.length > 65536) req.destroy(); });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(raw); } catch { return send(res, 400, { error: 'Invalid JSON' }); }
    if (!body || typeof body.action !== 'string') return send(res, 400, { error: 'Missing QMD action' });
    const countsAsUse = body.action !== 'status' && body.action !== 'stop';
    if (countsAsUse) touch(); // A queued GPU request also prevents idle expiry.
    queue = queue.catch(() => {}).then(async () => {
      if (countsAsUse) active++;
      try {
        const start = performance.now();
        const warnings = [];
        const result = body.action === 'status' ? await status() : body.action === 'stop' ? { stopping: true } : await perform(body, warnings);
        send(res, 200, { result, elapsedMs: performance.now() - start, ...(warnings.length ? { warnings } : {}) });
      } catch (error) {
        send(res, 500, { error: error.message });
      } finally {
        if (countsAsUse) active--;
        if (body.action === 'stop') setImmediate(() => shutdown('explicit stop').catch(console.error));
        else if (countsAsUse) touch();
      }
    });
  });
});
async function shutdown(reason) {
  if (closing) return;
  closing = true;
  clearTimeout(timer);
  await new Promise(resolve => server.close(resolve));
  await queue.catch(() => {});
  setDefaultLlamaCpp(null);
  await store.close();
  for (const filename of [socket, metadata]) {
    try { fs.unlinkSync(filename); } catch (error) { if (error.code !== 'ENOENT') console.error(error); }
  }
  console.log(`Project QMD stopped: ${reason}`);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM').catch(console.error));
process.on('SIGINT', () => shutdown('SIGINT').catch(console.error));
if (fs.existsSync(socket)) fs.unlinkSync(socket); // Launch is protected by a lifetime flock.
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
fs.chmodSync(socket, 0o600);
touch();
console.log(`Project QMD SDK ready: pid=${process.pid}, idle=${idleMs / 60000} min, no TCP listener`);
