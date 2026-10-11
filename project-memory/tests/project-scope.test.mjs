import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.PI_MEMORY_TEST_HOST || path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), '@earendil-works/pi-coding-agent/dist/index.js');
function run(cwd, file, args = [], extra = {}) {
  return spawnSync(process.execPath, [path.join(pkg, file), ...args], {
    cwd, encoding: 'utf8', env: { ...process.env, PI_MEMORY_PROJECT_ROOT: cwd, ...extra }, timeout: 30000,
  });
}
function withProjects(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'project-memory-test-'));
  const a = path.join(base, 'a'), b = path.join(base, 'b');
  fs.mkdirSync(a); fs.mkdirSync(b);
  try { fn(a, b); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}
test('package code is shared, all mutable paths are consumer-local', () => withProjects((a, b) => {
  for (const root of [a, b]) {
    const result = run(root, 'memory-env.cjs');
    assert.equal(result.status, 0, result.stderr);
    const env = JSON.parse(result.stdout);
    assert.equal(env.packageRoot, pkg);
    for (const key of ['PI_MEMORY_DIR', 'QMD_CONFIG_DIR', 'INDEX_PATH', 'XDG_CACHE_HOME']) assert.ok(env[key].startsWith(root + path.sep), key);
    assert.equal(env.PI_MEMORY_MODEL_IDLE_MINUTES, '30');
    assert.ok(env.PATH.startsWith(path.join(pkg, 'bin')));
    assert.equal(run(root, 'scripts/memory-setup.mjs').status, 0);
    assert.equal(run(root, 'scripts/memory-setup.mjs').status, 0);
    const config = run(root, 'check-memory-config.mjs', ['--show']);
    assert.equal(config.status, 0, config.stderr);
    assert.equal(JSON.parse(config.stdout).trusted, false);
    const missing = run(root, 'check-memory-config.mjs', ['--models=embed']);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /missing cached embed/);
    const blocked = spawnSync(path.join(pkg, 'bin/qmd'), ['service', 'start', '--warm'], { cwd: root, encoding: 'utf8', env: { ...process.env, PI_MEMORY_PROJECT_ROOT: root } });
    assert.equal(blocked.status, 3, blocked.stderr);
    assert.equal(fs.existsSync(path.join(root, '.pi/qmd-state/service.json')), false);
    assert.equal(fs.existsSync(path.join(root, '.pi/qmd-state/service.log')), false);
    const status = spawnSync(path.join(pkg, 'bin/qmd'), ['service', 'status'], { cwd: root, encoding: 'utf8', env: { ...process.env, PI_MEMORY_PROJECT_ROOT: root } });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).running, false);
    const stop = spawnSync(path.join(pkg, 'bin/qmd'), ['service', 'stop'], { cwd: root, encoding: 'utf8', env: { ...process.env, PI_MEMORY_PROJECT_ROOT: root } });
    assert.equal(stop.status, 0, stop.stderr);
    const hour = run(root, 'memory-env.cjs', [], { PI_MEMORY_MODEL_IDLE_MINUTES: '60' });
    assert.equal(JSON.parse(hour.stdout).PI_MEMORY_MODEL_IDLE_MINUTES, '60');
    const keyword = spawnSync(path.join(pkg, 'bin/qmd'), ['search', 'example', '--json', '-c', 'pi-memory'], { cwd: root, encoding: 'utf8', env: { ...process.env, PI_MEMORY_PROJECT_ROOT: root } });
    assert.equal(keyword.status, 0, keyword.stderr);
    assert.deepEqual(JSON.parse(keyword.stdout), []);
    assert.ok(fs.existsSync(path.join(root, '.qmd/index.sqlite')));
    const override = spawnSync(path.join(pkg, 'bin/qmd'), ['search', 'example', '--index', path.join(pkg, 'wrong.sqlite')], { cwd: root, encoding: 'utf8', env: { ...process.env, PI_MEMORY_PROJECT_ROOT: root } });
    assert.equal(override.status, 2);
    assert.equal(fs.existsSync(path.join(pkg, 'wrong.sqlite')), false);
  }
  assert.equal(fs.existsSync(path.join(pkg, '.pi')), false);
}));
test('setup rejects differing config and symlinked state without overwrite', () => withProjects((a, b) => {
  fs.mkdirSync(path.join(a, '.qmd'));
  fs.writeFileSync(path.join(a, '.qmd/index.yml'), 'collections: {}\n');
  const result = run(a, 'scripts/memory-setup.mjs');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /differs/);
  assert.equal(fs.readFileSync(path.join(a, '.qmd/index.yml'), 'utf8'), 'collections: {}\n');
  assert.equal(fs.existsSync(path.join(a, '.pi')), false);
  fs.symlinkSync(b, path.join(a, '.pi'));
  assert.match(run(a, 'memory-env.cjs').stderr, /must not use symlinks/);
  assert.deepEqual(fs.readdirSync(b), []);
  const wrongRoot = run(pkg, 'memory-env.cjs');
  assert.notEqual(wrongRoot.status, 0);
  assert.match(wrongRoot.stderr, /consumer project/);
}));
test('actual Pi SDK explicitly loads package and memory_write stays in projects A/B', () => withProjects((a, b) => {
  assert.ok(fs.existsSync(host), 'Install the Pi host or set PI_MEMORY_TEST_HOST to its dist/index.js');
  for (const [root, marker] of [[a, 'PROJECT_A_ONLY'], [b, 'PROJECT_B_ONLY']]) {
    assert.equal(run(root, 'scripts/memory-setup.mjs').status, 0);
    const result = run(root, 'tests/sdk-probe.mjs', [], { PI_MEMORY_TEST_HOST: host, PI_MEMORY_TEST_PACKAGE: pkg, PI_MEMORY_TEST_MARKER: marker });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).memoryWrite, true);
    assert.equal(fs.existsSync(path.join(root, '.pi/qmd-state/service.json')), false);
    assert.equal(fs.existsSync(path.join(root, '.pi/qmd-state/trusted.json')), false);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(a, '.pi/memory/MEMORY.md'), 'utf8'), /PROJECT_B_ONLY/);
  assert.doesNotMatch(fs.readFileSync(path.join(b, '.pi/memory/MEMORY.md'), 'utf8'), /PROJECT_A_ONLY/);
}));
