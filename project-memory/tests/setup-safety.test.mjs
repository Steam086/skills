import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function temporary(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'project-memory-safety-'));
  try { fn(base); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}
function setup(root) {
  return spawnSync(process.execPath, [path.join(pkg, 'scripts/memory-setup.mjs')], { cwd: root, env: { ...process.env, PI_MEMORY_PROJECT_ROOT: root }, encoding: 'utf8' });
}
test('all shell environment entry points stop before downloads or writes on invalid scope', () => temporary(base => {
  const stubDir = path.join(base, 'bin');
  fs.mkdirSync(stubDir);
  const called = path.join(base, 'called');
  for (const command of ['hf', 'pi']) fs.writeFileSync(path.join(stubDir, command), '#!/bin/sh\nprintf "%s\\n" "$0" >> "$STUB_CALLED"\nexit 99\n', { mode: 0o700 });
  for (const kind of ['pi-symlink', 'cache-symlink', 'invalid-root', 'package-root']) {
    const a = path.join(base, kind), b = path.join(base, kind + '-other');
    fs.mkdirSync(a); fs.mkdirSync(b);
    if (kind === 'pi-symlink') fs.symlinkSync(b, path.join(a, '.pi'));
    if (kind === 'cache-symlink') {
      fs.mkdirSync(path.join(a, '.project-memory'));
      fs.symlinkSync(b, path.join(a, '.project-memory/cache'));
    }
    const root = kind === 'invalid-root' ? path.join(a, 'missing') : kind === 'package-root' ? pkg : a;
    for (const [entry, args] of [['scripts/memory-models', ['embed']], ['scripts/pi-memory', []], ['bin/qmd', ['service', 'status']]]) {
      const result = spawnSync(path.join(pkg, entry), args, { cwd: a, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PI_MEMORY_PROJECT_ROOT: root, PATH: stubDir + path.delimiter + process.env.PATH, STUB_CALLED: called } });
      assert.notEqual(result.status, 0, `${kind}: ${entry}`);
      assert.match(result.stderr, /must not use symlinks|consumer project|ENOENT/);
      assert.deepEqual(fs.readdirSync(b), [], `${kind}: ${entry} wrote into another project`);
      assert.equal(fs.existsSync(called), false, `${kind}: ${entry} invoked a stub`);
    }
    if (kind === 'invalid-root') assert.equal(fs.existsSync(root), false);
  }
  assert.equal(fs.existsSync(path.join(pkg, '.pi')), false);
}));
function git(root, ...args) {
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0' };
  delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE;
  return execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
}
const artifacts = ['.project-memory/MEMORY.md', '.project-memory/recovery/record.json', '.project-memory/diagnostics/events.jsonl', '.project-memory/handoffs/current.json', '.project-memory/cache/qmd/models/model.gguf', '.project-memory/qmd-state/service.json', '.project-memory/qmd-state/service.log', '.project-memory/qmd-state/qmd.sock', '.project-memory/qmd-state/runtime.lock', '.project-memory/.qmd/index.sqlite', '.project-memory/.qmd/index.sqlite-wal', '.project-memory/.qmd/index.sqlite-shm'];
function privateArtifacts(root) {
  for (const relative of artifacts) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), 'synthetic private artifact\n');
  }
}
test('explicit setup preserves existing ignores and prevents ordinary staging of private runtime', () => temporary(root => {
  git(root, 'init', '--quiet');
  fs.writeFileSync(path.join(root, '.gitignore'), '# consumer root rule\nkeep-private\n');
  fs.mkdirSync(path.join(root, '.pi')); fs.mkdirSync(path.join(root, '.project-memory/.qmd'), { recursive: true });
  const piExisting = '# existing Pi rules\n/custom/\n!/memory/\n!/memory-state/\n!/cache/\n!/qmd-state/';
  const qmdExisting = '# existing QMD rules\n/custom/\n!/index.sqlite*\n';
  fs.writeFileSync(path.join(root, '.pi/.gitignore'), piExisting);
  fs.writeFileSync(path.join(root, '.project-memory/.qmd/.gitignore'), qmdExisting);
  const result = setup(root);
  assert.equal(result.status, 0, result.stderr);
  const piIgnore = fs.readFileSync(path.join(root, '.pi/.gitignore'), 'utf8');
  const qmdIgnore = fs.readFileSync(path.join(root, '.project-memory/.qmd/.gitignore'), 'utf8');
  assert.ok(piIgnore.startsWith(piExisting)); assert.ok(qmdIgnore.startsWith(qmdExisting));
  assert.equal(setup(root).status, 0);
  assert.equal(fs.readFileSync(path.join(root, '.pi/.gitignore'), 'utf8'), piIgnore);
  assert.equal(fs.readFileSync(path.join(root, '.project-memory/.qmd/.gitignore'), 'utf8'), qmdIgnore);
  assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), '# consumer root rule\nkeep-private\n');
  privateArtifacts(root);
  for (const relative of artifacts) assert.equal(git(root, 'check-ignore', relative), relative);
  // Staging is confined to this disposable repository, never the delivery repo.
  git(root, 'add', '.');
  const tracked = git(root, 'ls-files').split('\n');
  for (const relative of artifacts) assert.ok(!tracked.includes(relative), relative);
  for (const relative of ['.pi/.gitignore', '.project-memory/.gitignore']) assert.ok(tracked.includes(relative), relative);
}));
test('package ignore rules independently protect accidentally placed runtime state', () => temporary(root => {
  git(root, 'init', '--quiet');
  fs.copyFileSync(path.join(pkg, '.gitignore'), path.join(root, '.gitignore'));
  privateArtifacts(root);
  for (const relative of artifacts) assert.equal(git(root, 'check-ignore', relative), relative);
  git(root, 'add', '.');
  assert.equal(git(root, 'ls-files'), '.gitignore');
}));
test('setup preflights ignore safety before any initialization writes', () => temporary(root => {
  fs.mkdirSync(path.join(root, '.project-memory'));
  fs.mkdirSync(path.join(root, '.project-memory/.gitignore'));
  const result = setup(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private regular file/);
  assert.equal(fs.existsSync(path.join(root, '.project-memory/.qmd')), false);
  assert.deepEqual(fs.readdirSync(path.join(root, '.project-memory')), ['.gitignore']);
}));
