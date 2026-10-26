import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createMemoryService } from '../lib/memory-service.mjs';
import { saveMemoryConfig } from '../lib/memory-config.mjs';
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-memory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const data = result => { assert.equal(result.isError, undefined, JSON.stringify(result)); return JSON.parse(result.content[0].text); };

test('migration validates original QMD bytes while publishing converted config, preserves sources and rejects conflicts', t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, '.qmd'));
  const source = 'collections:\n  pi-memory:\n    path: .pi/memory\n    pattern: "**/*.md"\n';
  fs.writeFileSync(path.join(root, '.qmd/index.yml'), source);
  const run = (...args) => spawnSync(process.execPath, [path.join(packageRoot, 'scripts/memory-migrate.mjs'), '--root', root, ...args], { encoding: 'utf8' });
  assert.equal(run().status, 0);
  assert.equal(fs.existsSync(path.join(root, '.project-memory')), false);
  const applied = run('--apply'); assert.equal(applied.status, 0, applied.stderr);
  const target = path.join(root, '.project-memory/.qmd/index.yml');
  assert.match(fs.readFileSync(target, 'utf8'), /project-memory:/);
  assert.match(fs.readFileSync(target, 'utf8'), /path: \./);
  assert.equal(fs.readFileSync(path.join(root, '.qmd/index.yml'), 'utf8'), source);
  assert.equal(run('--apply').status, 0, 'unchanged migration is idempotent');
  fs.writeFileSync(target, 'conflicting target');
  const conflict = run('--apply'); assert.notEqual(conflict.status, 0); assert.match(conflict.stderr, /Migration conflict/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'conflicting target');
  assert.equal(fs.readFileSync(path.join(root, '.qmd/index.yml'), 'utf8'), source);
});

test('context observes another host creating, revising, deleting and restoring topics and writing legacy notes', async t => {
  const root = fixture(t);
  saveMemoryConfig(root, { autoIndex: false, diagnostics: { enabled: false } });
  const environment = { root, packageRoot };
  const reader = createMemoryService(environment), writer = createMemoryService(environment);
  t.after(() => { reader.shutdown(); writer.shutdown(); });
  assert.match(reader.context(), /Topics: 0/);
  const topic = { id: 'external-topic', title: 'First title', summary: 'Summary', content: 'Body', reason: 'explicit' };
  data(await writer.executeTool('memory_upsert', topic));
  assert.match(reader.context(), /external-topic: First title/);
  data(await writer.executeTool('memory_upsert', { ...topic, title: 'Revised title', expectedRevision: 1 }));
  assert.match(reader.context(), /external-topic: Revised title/);
  const deleted = data(await writer.executeTool('memory_forget', { id: topic.id, expectedRevision: 2 }));
  assert.doesNotMatch(reader.context(), /external-topic/);
  data(await writer.executeTool('memory_restore', { recoveryId: deleted.recoveryId }));
  assert.match(reader.context(), /external-topic: Revised title/);
  data(await writer.executeTool('memory_write', { target: 'long_term', content: 'Legacy fact' }));
  assert.match(reader.context(), /legacy available/);
});
