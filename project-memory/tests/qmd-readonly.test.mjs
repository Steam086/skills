import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { promisify } from 'node:util';
import { spawnSync, execFile } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { readQmdIndex } from '../lib/qmd-readonly.mjs';
import { qmdFixture } from './qmd-fixture.mjs';
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function snapshot(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try { return { bytes: fs.readFileSync(filename), schema: db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(),
    documents: db.prepare('SELECT * FROM documents').all(), config: db.prepare('SELECT * FROM store_config ORDER BY key').all(), content: db.prepare('SELECT * FROM content').all() }; }
  finally { db.close(); }
}
for (const kind of ['current', 'missing-marker', 'wrong-marker', 'legacy-fts', 'old-version', 'legacy-vectors']) {
  test(`qmd-readonly: ${kind} fixture never mutates database bytes/schema/data`, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qmd-readonly-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const filename = qmdFixture(root, kind), before = snapshot(filename), names = fs.readdirSync(path.dirname(filename));
    fs.chmodSync(filename, 0o400);
    if (kind === 'current') {
      for (const query of ['scheduler', '中文']) {
        const results = await readQmdIndex(filename, { query, limit: 1 });
        assert.equal(results.length, 1); assert.equal(results[0].file, 'qmd://pi-memory/topics/scheduler-cancellation.md');
        assert.deepEqual(Object.keys(results[0]), ['file', 'score']); assert.doesNotMatch(JSON.stringify(results), /BODY_MUST|body|snippet/);
      }
      assert.deepEqual(await readQmdIndex(filename, { checkOnly: true }), []);
    } else {
      await assert.rejects(readQmdIndex(filename, { query: 'scheduler' }), { code: 'QMD_INDEX_NOT_CURRENT' });
      await assert.rejects(readQmdIndex(filename, { checkOnly: true }), { code: 'QMD_INDEX_NOT_CURRENT' });
    }
    assert.deepEqual(snapshot(filename), before); assert.deepEqual(fs.readdirSync(path.dirname(filename)), names);
  });
}
test('qmd-readonly: missing/symlinked indexes are not created or followed', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qmd-readonly-path-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(readQmdIndex(path.join(root, 'missing.sqlite'), { query: 'x' })); assert.deepEqual(fs.readdirSync(root), []);
  const filename = qmdFixture(root); fs.symlinkSync(filename, path.join(root, 'linked.sqlite'));
  await assert.rejects(readQmdIndex(path.join(root, 'linked.sqlite'), { query: 'x' }));
});
test('qmd-service-client: existing-service-only refuses a cold service without files or startup', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qmd-resident-')); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = qmdFixture(root), before = snapshot(filename);
  for (const action of ['vsearch', 'query']) {
    const result = spawnSync(process.execPath, [path.join(pkg, 'qmd-service-client.mjs'), action, 'scheduler', '--json', '--existing-service-only'],
      { cwd: root, env: { ...process.env, PI_MEMORY_PROJECT_ROOT: root }, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1); assert.match(result.stderr, /service is not running/);
    assert.equal(fs.existsSync(path.join(root, '.pi')), false); assert.deepEqual(snapshot(filename), before);
  }
});

test('qmd-service-client: resident-only dispatch checks schema and sends no startup/status request', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qmd-resident-live-'));
  const filename = qmdFixture(root), dir = path.join(root, '.pi/qmd-state'); fs.mkdirSync(dir, { recursive: true });
  const socket = path.join(dir, 'qmd.sock'), token = 'b'.repeat(64), requests = [];
  fs.writeFileSync(path.join(dir, 'service.json'), JSON.stringify({ root, socket, token, pid: process.pid }));
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; });
    req.on('end', () => { requests.push(JSON.parse(raw).action); res.end(JSON.stringify({ result: [] })); });
  });
  await new Promise(resolve => server.listen(socket, resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const run = () => promisify(execFile)(process.execPath, [path.join(pkg, 'qmd-service-client.mjs'), 'vsearch', 'scheduler', '--json', '--existing-service-only'],
    { cwd: root, env: { ...process.env, PI_MEMORY_PROJECT_ROOT: root }, timeout: 10000 });
  const before = snapshot(filename);
  assert.deepEqual(JSON.parse((await run()).stdout), []); assert.deepEqual(requests, ['semantic']); assert.deepEqual(snapshot(filename), before);
  const db = new DatabaseSync(filename); db.exec("DELETE FROM store_config WHERE key='fts_cjk_normalized_version'"); db.close();
  const stale = snapshot(filename);
  await assert.rejects(run(), /requires explicit maintenance/);
  assert.deepEqual(requests, ['semantic']); assert.deepEqual(snapshot(filename), stale);
});
