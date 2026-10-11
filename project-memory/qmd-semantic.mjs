// QMD 2.8.3 vsearch also expands with a generation model. Semantic mode
// uses the official SDK's pure searchVector() API, shared by the resident
// project service and this explicitly invoked CLI.
// No upstream code is patched.
import env from './memory-env.cjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { createStore, extractSnippet } from './node_modules/@tobilu/qmd/dist/index.js';

export async function openSemanticStore() {
  return createStore({ dbPath: env.values.INDEX_PATH, configPath: path.join(env.root, '.qmd/index.yml') });
}
export async function semanticSearch(store, query, { limit = 5, minScore = 0.3, full = false, fullPath = false, onWarning = message => console.error(message) } = {}) {
  const status = await store.getStatus();
  if (!status.totalDocuments || !status.hasVectorIndex) {
    onWarning('Need embeddings: run scripts/memory-index before semantic search.');
    return [];
  }
  const results = await store.searchVector(query, { collection: 'pi-memory', limit });
  return results.filter(r => r.score >= minScore).map(r => {
    const snippet = extractSnippet(r.body, query, 300, r.chunkPos);
    const relative = r.filepath.replace('qmd://pi-memory/', '');
    return {
      docid: '#' + r.docid, score: Math.round(r.score * 100) / 100,
      file: fullPath ? path.join(env.values.PI_MEMORY_DIR, relative) : r.filepath,
      line: snippet.line, title: r.title, context: r.context,
      ...(full ? { body: r.body } : { snippet: snippet.snippet }),
    };
  });
}
async function main() {
  execFileSync(process.execPath, [path.join(env.packageRoot, 'check-memory-config.mjs'), '--require-trust', '--models=embed'], { cwd: env.root, env: process.env, stdio: 'pipe' });
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    json: { type: 'boolean' }, format: { type: 'string' }, collection: { type: 'string', short: 'c', multiple: true },
    n: { type: 'string', short: 'n' }, 'min-score': { type: 'string' }, full: { type: 'boolean' },
    'full-path': { type: 'boolean' }, files: { type: 'boolean' }, all: { type: 'boolean' },
  }});
  if (values.collection?.some(c => c !== 'pi-memory')) throw new Error('This semantic adapter only searches pi-memory.');
  const query = positionals.join(' ').trim();
  if (!query) throw new Error('A non-empty semantic query is required.');
  const format = values.json ? 'json' : values.files ? 'files' : values.format || 'cli';
  if (!['json', 'cli', 'files'].includes(format)) throw new Error('Supported semantic formats: cli, json, files.');
  const limit = values.all ? 1000 : Number(values.n || (format === 'cli' ? 5 : 20));
  const minScore = Number(values['min-score'] ?? 0.3);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000 || !Number.isFinite(minScore)) throw new Error('Invalid search limit/min-score.');
  const store = await openSemanticStore();
  try {
    const result = await semanticSearch(store, query, { limit, minScore, full: values.full, fullPath: values['full-path'] });
    if (format === 'json') console.log(JSON.stringify(result, null, 2));
    else if (format === 'files') result.forEach(r => console.log(`${r.docid},${r.score},${r.file}`));
    else if (!result.length) console.log('No results found.');
    else result.forEach(r => console.log(`${r.file}:${r.line} ${r.docid}\nTitle: ${r.title}\nScore: ${Math.round(r.score * 100)}%\n\n${r.body || r.snippet}\n`));
  } finally { await store.close(); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) await main();
