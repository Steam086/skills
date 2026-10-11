import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function client(root, stubDir) {
  return new Promise((resolve, reject) => {
    // Directly exercise the real bridge protocol; no trust or model provisioning.
    const child = spawn(process.execPath, [path.join(pkg, 'qmd-service-client.mjs'), 'vsearch', '--json', '-c', 'pi-memory', 'example'], {
      cwd: root, env: { ...process.env, PI_MEMORY_PROJECT_ROOT: root, PATH: stubDir + path.delimiter + process.env.PATH },
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Fake-socket client timed out')); }, 10000);
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); resolve({ code, stdout, stderr }); });
  });
}
test('real semanticSearch diagnostics traverse fake Unix socket and real client stderr without changing JSON arrays', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-memory-diagnostic-'));
  const previousRoot = process.env.PI_MEMORY_PROJECT_ROOT;
  process.env.PI_MEMORY_PROJECT_ROOT = root;
  let server;
  try {
    const { semanticSearch } = await import('../qmd-semantic.mjs');
    const dir = path.join(root, '.pi/qmd-state');
    fs.mkdirSync(dir, { recursive: true });
    const stubDir = path.join(root, 'bin'); fs.mkdirSync(stubDir);
    const forbiddenStartup = path.join(root, 'unexpected-startup');
    fs.writeFileSync(path.join(stubDir, 'flock'), '#!/bin/sh\ntouch "' + forbiddenStartup + '"\nexit 99\n', { mode: 0o700 });
    const socket = path.join(dir, 'qmd.sock'), token = 'a'.repeat(64);
    fs.writeFileSync(path.join(dir, 'service.json'), JSON.stringify({ root, socket, token, pid: process.pid }));
    let status = { totalDocuments: 1, hasVectorIndex: false }, vectorCalls = 0;
    const store = { getStatus: async () => status, searchVector: async () => { vectorCalls++; return []; } };
    const requests = [];
    server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', chunk => { raw += chunk; });
      req.on('end', async () => {
        try {
          assert.equal(req.headers.authorization, `Bearer ${token}`);
          assert.equal(req.url, '/qmd');
          const body = JSON.parse(raw);
          requests.push(body.action);
          const warnings = [];
          const result = body.action === 'status' ? { running: true } : await semanticSearch(store, body.query, { ...body.options, onWarning: warning => warnings.push(warning) });
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ result, ...(warnings.length ? { warnings } : {}) }));
        } catch (error) {
          res.writeHead(500); res.end(JSON.stringify({ error: error.message }));
        }
      });
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socket, resolve); });
    for (const current of [{ totalDocuments: 1, hasVectorIndex: false }, { totalDocuments: 0, hasVectorIndex: true }]) {
      status = current;
      const output = await client(root, stubDir);
      assert.equal(output.code, 0, output.stderr);
      assert.deepEqual(JSON.parse(output.stdout), []);
      // pi-memory uses this case-insensitive substring to detect index unreadiness.
      assert.match(output.stderr, /need embeddings/i);
      assert.match(output.stderr, /scripts\/memory-index/);
    }
    assert.equal(vectorCalls, 0);
    status = { totalDocuments: 1, hasVectorIndex: true };
    const ready = await client(root, stubDir);
    assert.equal(ready.code, 0, ready.stderr);
    assert.deepEqual(JSON.parse(ready.stdout), []);
    assert.equal(ready.stderr, '');
    assert.equal(vectorCalls, 1);
    assert.deepEqual(requests, ['status', 'semantic', 'status', 'semantic', 'status', 'semantic']);
    assert.equal(fs.existsSync(forbiddenStartup), false);
  } finally {
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    if (previousRoot === undefined) delete process.env.PI_MEMORY_PROJECT_ROOT;
    else process.env.PI_MEMORY_PROJECT_ROOT = previousRoot;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
