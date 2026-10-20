import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-memory-cuda-'));
  try {
    const code = path.join(root, 'package'), libs = path.join(root, 'system-cuda');
    fs.mkdirSync(path.join(code, 'scripts'), { recursive: true });
    fs.mkdirSync(libs);
    fs.copyFileSync(path.join(pkg, 'scripts/memory-cuda.mjs'), path.join(code, 'scripts/memory-cuda.mjs'));
    fs.copyFileSync(path.join(pkg, 'memory-env.cjs'), path.join(code, 'memory-env.cjs'));
    for (const name of ['libcudart.so.12.4.99', 'libcublas.so.12.4.2.65', 'libcublasLt.so.12.4.2.65']) {
      fs.writeFileSync(path.join(libs, name), 'synthetic library; never loaded\n');
    }
    const configure = () => spawnSync(process.execPath, [path.join(code, 'scripts/memory-cuda.mjs'), '--lib-dir', libs], { encoding: 'utf8' });
    fn({ root, code, libs, configure });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('local CUDA SONAME setup is idempotent and clean-shell consumers inherit its loader path', () => fixture(({ root, code, libs, configure }) => {
  const configured = configure();
  assert.equal(configured.status, 0, configured.stderr);
  const runtime = path.join(code, 'runtime/cuda');
  assert.deepEqual(fs.readdirSync(runtime).sort(), ['libcublas.so.12', 'libcublasLt.so.12', 'libcudart.so.12']);
  assert.equal(fs.realpathSync(path.join(runtime, 'libcudart.so.12')), path.join(libs, 'libcudart.so.12.4.99'));
  assert.equal(configure().status, 0);
  const consumer = path.join(root, 'consumer'); fs.mkdirSync(consumer);
  const env = { ...process.env, PI_MEMORY_PROJECT_ROOT: consumer };
  delete env.LD_LIBRARY_PATH;
  const launched = spawnSync(process.execPath, [path.join(code, 'memory-env.cjs')], { cwd: consumer, env, encoding: 'utf8' });
  assert.equal(launched.status, 0, launched.stderr);
  const values = JSON.parse(launched.stdout);
  assert.equal(values.LD_LIBRARY_PATH, runtime);
  assert.equal(values.PI_MEMORY_DIR, path.join(consumer, '.pi/memory'));
  const inherited = spawnSync(process.execPath, [path.join(code, 'memory-env.cjs')], { cwd: consumer, env: { ...env, LD_LIBRARY_PATH: '/vendor/lib' }, encoding: 'utf8' });
  assert.equal(inherited.status, 0, inherited.stderr);
  assert.equal(JSON.parse(inherited.stdout).LD_LIBRARY_PATH, runtime + path.delimiter + '/vendor/lib');
  assert.deepEqual(fs.readdirSync(consumer), [], 'Configuring code libraries must not initialize or trust a project');
}));
test('CUDA helper rejects conflicting runtime links before creating any other links', () => fixture(({ root, code, configure }) => {
  const runtime = path.join(code, 'runtime/cuda'); fs.mkdirSync(runtime, { recursive: true });
  const other = path.join(root, 'other-library'); fs.writeFileSync(other, 'keep');
  fs.symlinkSync(other, path.join(runtime, 'libcublas.so.12'));
  const result = configure();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /differs; review manually/);
  assert.deepEqual(fs.readdirSync(runtime), ['libcublas.so.12']);
  assert.equal(fs.readFileSync(other, 'utf8'), 'keep');
}));
test('CUDA helper refuses symlinked runtime directories and incomplete explicit libraries', () => fixture(({ root, code, libs, configure }) => {
  fs.rmSync(path.join(libs, 'libcublasLt.so.12.4.2.65'));
  const incomplete = configure();
  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /No complete CUDA/);
  assert.equal(fs.existsSync(path.join(code, 'runtime')), false);
  fs.writeFileSync(path.join(libs, 'libcublasLt.so.12.4.2.65'), 'fixture');
  const outside = path.join(root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(code, 'runtime'));
  const symlinked = configure();
  assert.notEqual(symlinked.status, 0);
  assert.match(symlinked.stderr, /real runtime directory/);
  assert.deepEqual(fs.readdirSync(outside), []);
}));
