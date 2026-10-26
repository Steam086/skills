// QMD 2.8.3 retrieval only. Never call createStore/openDatabase: both initialize
// writable state. Schema/version changes require explicit maintenance, not reads.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

function unavailable() { throw Object.assign(new Error('QMD index requires explicit maintenance'), { code: 'QMD_INDEX_NOT_CURRENT' }); }
function validateSchema(db) {
  if (db.prepare('PRAGMA user_version').get().user_version !== 1) unavailable();
  const columns = {
    content: ['hash', 'doc', 'created_at'],
    documents: ['id', 'collection', 'path', 'title', 'hash', 'created_at', 'modified_at', 'active'],
    store_config: ['key', 'value'],
    store_collections: ['name', 'path', 'pattern', 'ignore_patterns', 'include_by_default', 'update_command', 'context'],
    content_vectors: ['hash', 'seq', 'pos', 'model', 'embed_fingerprint', 'total_chunks', 'embedded_at'],
    llm_cache: ['hash', 'result', 'created_at'],
    documents_fts: ['filepath', 'title', 'body'],
  };
  for (const [table, required] of Object.entries(columns)) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) unavailable();
    const names = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    if (required.some(name => !names.includes(name))) unavailable();
  }
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE name='documents_fts'").get().sql.toLowerCase().replace(/\s+/g, '');
  if (!sql.includes('usingfts5(') || sql.includes('content=') || !sql.includes("tokenize='porterunicode61'")) unavailable();
  if (db.prepare("SELECT value FROM store_config WHERE key='fts_cjk_normalized_version'").get()?.value !== '1') unavailable();
  for (const name of ['documents_ai', 'documents_ad', 'documents_au']) {
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?").get(name)) unavailable();
  }
}

export async function readQmdIndex(filename, { query, limit = 5, checkOnly = false } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50 || (!checkOnly && (typeof query !== 'string' || !query.trim() || query.length > 512))) unavailable();
  const absolute = path.resolve(filename);
  if (fs.realpathSync(absolute) !== absolute) unavailable();
  const original = fs.lstatSync(absolute);
  if (!original.isFile() || original.nlink !== 1) unavailable();
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { const stat = fs.lstatSync(absolute + suffix); if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) unavailable(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const db = new DatabaseSync(absolute, { readOnly: true, allowExtension: false });
  try {
    const opened = fs.lstatSync(absolute);
    if (opened.ino !== original.ino || opened.dev !== original.dev) unavailable();
    validateSchema(db);
    if (checkOnly) return [];
    // Importing these pure search functions does not open a QMD store or load models.
    const { searchFTS } = await import('../node_modules/@tobilu/qmd/dist/store.js');
    return searchFTS(db, query, limit, 'project-memory')
      .filter(row => typeof row.filepath === 'string' && row.filepath.length <= 1024)
      .map(row => ({ file: row.filepath, score: row.score }));
  } finally { db.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { default: environment } = await import('../memory-env.cjs');
    const [mode, query, limit] = process.argv.slice(2);
    if (!['keyword', 'check'].includes(mode)) unavailable();
    const result = await readQmdIndex(environment.values.INDEX_PATH, { query, limit: Number(limit ?? 5), checkOnly: mode === 'check' });
    console.log(JSON.stringify(result));
  } catch {
    console.error('Project QMD: index unavailable or requires explicit maintenance');
    process.exitCode = 1;
  }
}
