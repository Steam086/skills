// Explicit test-fixture construction only; runtime retrieval never opens this writer.
import fs from 'node:fs';
import path from 'node:path';
import { createStore, normalizeCjkForFTS } from '../node_modules/@tobilu/qmd/dist/store.js';

export function qmdFixture(root, kind = 'current') {
  const directory = path.join(root, '.qmd');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'index.yml'), 'fixture config; trust validation is stubbed by SDK tests');
  const filename = path.join(directory, 'index.sqlite');
  const store = createStore(filename), db = store.db;
  try {
    db.prepare('INSERT INTO store_collections(name,path) VALUES (?,?)').run('pi-memory', path.join(root, '.pi/memory'));
    const body = 'scheduler cancellation 中文 BODY_MUST_NOT_LEAVE_HELPER';
    db.prepare('INSERT INTO content(hash,doc,created_at) VALUES (?,?,?)').run('a'.repeat(64), body, '2026-01-01');
    db.prepare('INSERT INTO documents(collection,path,title,hash,created_at,modified_at) VALUES (?,?,?,?,?,?)')
      .run('pi-memory', 'topics/scheduler-cancellation.md', 'Scheduler', 'a'.repeat(64), '2026-01-01', '2026-01-01');
    db.prepare('UPDATE documents_fts SET body=?').run(normalizeCjkForFTS(body));
    if (kind === 'missing-marker') db.exec("DELETE FROM store_config WHERE key='fts_cjk_normalized_version'");
    if (kind === 'wrong-marker') db.exec("UPDATE store_config SET value='0' WHERE key='fts_cjk_normalized_version'");
    if (kind === 'legacy-fts') {
      db.exec('DROP TABLE documents_fts');
      db.exec("CREATE VIRTUAL TABLE documents_fts USING fts5(name,body,content='documents')");
    }
    if (kind === 'old-version') db.exec('PRAGMA user_version=0');
    if (kind === 'legacy-vectors') db.exec('DROP INDEX idx_content_vectors_model_fingerprint; ALTER TABLE content_vectors DROP COLUMN total_chunks');
  } finally { store.close(); }
  return filename;
}
