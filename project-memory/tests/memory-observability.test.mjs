import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { DEFAULT_CONFIG, loadMemoryConfig, loadMemoryPreferences, saveMemoryConfig, resolveMemoryConfig } from '../lib/memory-config.mjs';
import { createMemoryTelemetry, TELEMETRY_EVENT_FIELDS, TELEMETRY_SCHEMA_VERSION } from '../lib/memory-telemetry.mjs';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const diagnostics = '.pi/memory-state/diagnostics';
function temporary(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-observability-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function write(root, relative, content) {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), content);
}
function files(root) {
  return fs.readdirSync(root, { recursive: true }).filter(file => fs.lstatSync(path.join(root, file)).isFile());
}
function cli(script, args, cwd) {
  return spawnSync(process.execPath, [path.join(pkg, 'scripts', script), ...args], { cwd, encoding: 'utf8' });
}

test('memory-config: loadMemoryPreferences preserves validated off-mode base flags', t => {
  const root = temporary(t);
  assert.deepEqual(loadMemoryPreferences(root), DEFAULT_CONFIG);
  assert.deepEqual(fs.readdirSync(root), []);
  saveMemoryConfig(root, { mode: 'off', readEnabled: false, writeEnabled: true, warmup: true });
  const base = loadMemoryPreferences(root);
  assert.equal(base.writeEnabled, true);
  assert.equal(base.diagnostics.enabled, true);
  assert.equal(loadMemoryConfig(root).writeEnabled, false);
  const manual = resolveMemoryConfig(base, { mode: 'manual' });
  assert.equal(manual.writeEnabled, true);
  assert.equal(manual.readEnabled, false);
  assert.equal(manual.warmup, true);
  write(root, '.pi/memory-config.json', '{"version":1,"extra":true}');
  assert.throws(() => loadMemoryPreferences(root), /unknown/);
});

test('memory-config: default loads and resolves without creating state; objects are independent', t => {
  const root = temporary(t);
  const config = loadMemoryConfig(root);
  assert.deepEqual(config, DEFAULT_CONFIG);
  config.diagnostics.enabled = false;
  assert.equal(loadMemoryConfig(root).diagnostics.enabled, true);
  assert.deepEqual(fs.readdirSync(root), []);
});

test('memory-config: partial atomic saves retain preferences; off disables every effective capability', t => {
  const root = temporary(t);
  saveMemoryConfig(root, { mode: 'code-research', warmup: true, diagnostics: { maxFiles: 2 } });
  const off = saveMemoryConfig(root, { mode: 'off' });
  for (const field of ['readEnabled', 'writeEnabled', 'autoIndex', 'warmup']) assert.equal(off[field], false);
  assert.equal(off.diagnostics.enabled, false);
  assert.deepEqual(loadMemoryConfig(root), off);
  const restored = saveMemoryConfig(root, { mode: 'manual', readEnabled: false });
  assert.equal(restored.warmup, true); assert.equal(restored.writeEnabled, true);
  assert.equal(restored.readEnabled, false); assert.equal(restored.diagnostics.enabled, true);
  assert.equal(restored.diagnostics.maxFiles, 2);
  assert.equal(fs.statSync(path.join(root, '.pi/memory-config.json')).mode & 0o777, 0o600);
  assert.deepEqual(files(root), ['.pi/memory-config.json']);
  assert.equal(resolveMemoryConfig(restored, { diagnostics: { enabled: false } }).diagnostics.maxFiles, 2);
});

test('memory-config: unknown fields, types, versions and out-of-range budgets fail closed before writes', t => {
  const root = temporary(t);
  for (const patch of [null, [], { version: 2 }, { mode: 'auto' }, { readEnabled: 'false' }, { extra: true }, { indexMaxChars: 0 }, { searchMaxChars: 65537 }, { readMaxChars: 1.5 }, { searchLimit: 51 }, { diagnostics: null }, { diagnostics: { extra: 1 } }, { diagnostics: { enabled: 1 } }, { diagnostics: { maxBytes: 4095 } }, { diagnostics: { maxFiles: 11 } }, JSON.parse('{"__proto__":{}}')]) {
    assert.throws(() => saveMemoryConfig(root, patch), /Invalid memory configuration/);
    assert.throws(() => resolveMemoryConfig(DEFAULT_CONFIG, patch), /Invalid memory configuration/);
  }
  assert.deepEqual(fs.readdirSync(root), []);
  for (const content of ['{', '{}', '{"version":2}', '{"version":1,"typo":true}', '[]']) {
    write(root, '.pi/memory-config.json', content);
    assert.throws(() => loadMemoryConfig(root), /Invalid memory configuration/);
    assert.throws(() => saveMemoryConfig(root, { mode: 'manual' }), /Invalid memory configuration/);
    assert.equal(fs.readFileSync(path.join(root, '.pi/memory-config.json'), 'utf8'), content);
  }
  write(root, '.pi/memory-config.json', ' '.repeat(16385));
  assert.throws(() => loadMemoryConfig(root), /oversized/);
});

test('memory-config: symlinked roots, ancestors, config and hardlinks never escape', t => {
  const base = temporary(t), outside = path.join(base, 'outside'); fs.mkdirSync(outside);
  for (const target of ['.pi', '.pi/memory-config.json']) {
    const root = fs.mkdtempSync(path.join(base, 'consumer-'));
    fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
    const destination = target === '.pi' ? outside : path.join(outside, 'config.json');
    if (target !== '.pi') fs.writeFileSync(destination, '{"version":1}');
    fs.symlinkSync(destination, path.join(root, target));
    assert.throws(() => loadMemoryConfig(root), /symlinks/);
    assert.throws(() => saveMemoryConfig(root, {}), /symlinks/);
  }
  fs.symlinkSync(outside, path.join(base, 'root-link'));
  assert.throws(() => loadMemoryConfig(path.join(base, 'root-link')), /symlinks/);
  const root = path.join(base, 'hardlink'); fs.mkdirSync(root); fs.mkdirSync(path.join(root, '.pi'));
  fs.linkSync(path.join(outside, 'config.json'), path.join(root, '.pi/memory-config.json'));
  assert.throws(() => saveMemoryConfig(root, {}), /private regular file/);
  assert.deepEqual(fs.readdirSync(outside), ['config.json']);
  assert.equal(fs.readFileSync(path.join(outside, 'config.json'), 'utf8'), '{"version":1}');
});

test('memory-config: occupied locks are never stolen or removed', t => {
  const root = temporary(t);
  fs.mkdirSync(path.join(root, '.pi/.memory-config.lock'), { recursive: true });
  assert.throws(() => saveMemoryConfig(root, {}), /busy/);
  assert.equal(fs.existsSync(path.join(root, '.pi/.memory-config.lock')), true);
  assert.equal(fs.existsSync(path.join(root, '.pi/memory-config.json')), false);
});

test('memory-telemetry: construction and absent reports are lazy; off/disabled do no I/O even on missing roots', t => {
  const root = temporary(t);
  const telemetry = createMemoryTelemetry(root);
  assert.deepEqual(fs.readdirSync(root), []);
  const report = telemetry.report();
  assert.equal(report.status, 'ok'); assert.equal(report.counts.search, 0);
  assert.equal(report.estimates.search.estimatedTokens.total, null);
  assert.equal(report.retrieval.nonemptyResultRate, null);
  assert.deepEqual(fs.readdirSync(root), []);
  for (const config of [{ mode: 'off' }, { enabled: false }]) {
    const disabled = createMemoryTelemetry(path.join(root, 'missing'), config);
    assert.equal(disabled.hash('sensitive query'), null);
    assert.equal(disabled.record('search', { query: 'sensitive query' }).status, 'disabled');
    assert.equal(disabled.report().status, 'disabled');
  }
  assert.deepEqual(fs.readdirSync(root), []);
  assert.throws(() => createMemoryTelemetry(root, { enabled: false, unknown: 1 }), /Invalid memory configuration/);
});

test('memory-telemetry: hashes are project-salted, persistent and non-plaintext; private permissions', t => {
  const root = temporary(t), second = temporary(t);
  const telemetry = createMemoryTelemetry(root);
  const hashed = telemetry.hash('private/path.ts query Chinese 中文');
  assert.match(hashed, /^[a-f0-9]{64}$/);
  assert.equal(createMemoryTelemetry(root).hash('private/path.ts query Chinese 中文'), hashed);
  assert.notEqual(createMemoryTelemetry(second).hash('private/path.ts query Chinese 中文'), hashed);
  assert.equal(telemetry.record('search', { queryHash: hashed, outcome: 'empty', resultCount: 0 }).status, 'recorded');
  assert.equal(fs.statSync(path.join(root, diagnostics)).mode & 0o777, 0o700);
  for (const file of files(root)) {
    assert.equal(fs.statSync(path.join(root, file)).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(path.join(root, file), 'utf8').includes('private/path.ts'), false);
  }
});

test('memory-telemetry: exact allowlists drop content, reject unsafe allowed values and bound event size', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root);
  assert.deepEqual(Object.keys(TELEMETRY_EVENT_FIELDS), ['search', 'read', 'write', 'injection', 'usage', 'relevance']);
  const secret = 'DO_NOT_PERSIST_SOURCE_BODY';
  assert.equal(telemetry.record('search', { outcome: 'success', resultCount: 1, query: secret, prompt: secret, body: secret, args: { secret }, error: secret, stack: secret, arbitrary: secret }).status, 'recorded');
  const text = fs.readFileSync(path.join(root, diagnostics, 'events.jsonl'), 'utf8');
  assert.equal(text.includes(secret), false);
  assert.deepEqual(JSON.parse(text).data, { outcome: 'success', resultCount: 1 });
  for (const [type, data] of [['search', { queryHash: secret }], ['search', { reason: secret }], ['search', { backend: secret }], ['search', { outputChars: -1 }], ['search', { latencyMs: Infinity }], ['search', { resultIdHashes: Array(51).fill('a'.repeat(64)) }], ['usage', {}], ['usage', { messageIdHash: 'a'.repeat(64), model: 'secret with spaces' }], ['unknown', {}], ['__proto__', {}]]) {
    assert.equal(telemetry.record(type, data).code, 'invalid_event');
  }
  assert.equal(fs.readFileSync(path.join(root, diagnostics, 'events.jsonl'), 'utf8'), text);
  assert.equal(telemetry.hash('x'.repeat(65537)), null);
  assert.equal(telemetry.status().code, 'invalid_hash_input');
  assert.equal(telemetry.record('search', { resultIdHashes: Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(64, '0')) }).status, 'recorded');
  for (const line of fs.readFileSync(path.join(root, diagnostics, 'events.jsonl'), 'utf8').trim().split('\n')) assert.ok(Buffer.byteLength(line + '\n') <= 4096);
});

test('memory-telemetry: usage provenance preserves unknown counts and earlier event compatibility', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root);
  const id = value => telemetry.hash(`message:${value}`);
  assert.equal(telemetry.record('usage', { messageIdHash: id('known'), measurement: 'host-reported', input: 10 }).status, 'recorded');
  assert.equal(telemetry.record('usage', { messageIdHash: id('local-error'), measurement: 'unknown-zero-error', input: null, cost: null }).status, 'recorded');
  assert.equal(telemetry.record('usage', { messageIdHash: id('legacy'), input: 4 }).status, 'recorded');
  assert.equal(telemetry.record('usage', { messageIdHash: id('invalid'), measurement: 'unknown-zero-error', input: 0 }).code, 'invalid_event');
  assert.equal(telemetry.record('usage', { messageIdHash: id('invalid'), measurement: 'unavailable', cost: 0 }).code, 'invalid_event');
  assert.equal(telemetry.record('usage', { messageIdHash: id('invalid'), measurement: 'PRIVATE_ERROR' }).code, 'invalid_event');
  const report = telemetry.report();
  assert.deepEqual(report.actualUsage.byMeasurement, { 'host-reported': 1, 'unknown-zero-error': 1, unspecified: 1 });
  assert.equal(report.actualUsage.byModel[0].input.total, 14);
  assert.equal(report.actualUsage.byModel[0].input.known, 2);
  assert.equal(report.actualUsage.byModel[0].input.unknown, 1);
});
test('memory-telemetry: aggregate estimates and provider actual usage separately, preserve unknowns, deduplicate usage and correlate reads', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root);
  const id = telemetry.hash('message:synthetic-session:1'), search = telemetry.hash('search:1');
  telemetry.record('search', { searchIdHash: search, outcome: 'success', resultCount: 2, outputChars: 200, estimatedTokens: 50, latencyMs: 10 });
  telemetry.record('search', { outcome: 'empty', resultCount: 0, latencyMs: 20 });
  telemetry.record('search', { outcome: 'skipped', reason: 'context-sufficient' });
  telemetry.record('read', { searchIdHash: search, outcome: 'success', outputChars: 100, estimatedTokens: 25 });
  telemetry.record('read', { searchIdHash: search, outcome: 'success' });
  telemetry.record('write', { outcome: 'error', reason: 'io' });
  telemetry.record('injection', { chars: 80, estimatedTokens: 20 });
  telemetry.record('usage', { messageIdHash: id, model: 'test-model', provider: 'test-provider', input: 100, output: 20, cacheRead: 0, cacheWrite: null, cost: 0.01 });
  telemetry.record('usage', { messageIdHash: id, input: 1000000 });
  telemetry.record('usage', { messageIdHash: telemetry.hash('message:2'), model: 'test-model', provider: 'test-provider' });
  const report = telemetry.report();
  assert.equal(report.counts.usage, 3); assert.equal(report.actualUsage.messages, 2); assert.equal(report.actualUsage.duplicateMessages, 1);
  const actual = report.actualUsage.byModel[0];
  assert.deepEqual(actual.input, { total: 100, known: 1, unknown: 1 });
  assert.deepEqual(actual.cacheRead, { total: 0, known: 1, unknown: 1 });
  assert.deepEqual(actual.cacheWrite, { total: null, known: 0, unknown: 2 });
  assert.deepEqual(report.estimates.search.estimatedTokens, { total: 50, known: 1, unknown: 2 });
  assert.equal(report.latency.search.meanMs, 15); assert.equal(report.latency.search.unknown, 1);
  assert.equal(report.outcomes.error, 1); assert.equal(report.outcomes.skipped, 1);
  assert.equal(report.retrieval.nonemptyResultRate, 0.5);
  assert.equal(report.retrieval.followUpReadRate, 1); assert.equal(report.retrieval.linkedReads, 2);
  assert.equal(report.retrieval.recall, null); assert.equal(report.retrieval.recallReason, 'requires-labeled-relevant-records');
  assert.equal(JSON.stringify(report).includes(id), false); assert.equal(JSON.stringify(report).includes(search), false);
});

test('memory-telemetry: rotation caps total logs; retention shrink only removes fixed owned files', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root, { maxBytes: 4096, maxFiles: 3 });
  for (let i = 0; i < 120; i++) assert.equal(telemetry.record('search', { queryHash: 'a'.repeat(64), outcome: 'success', resultCount: 1, outputChars: i }).status, 'recorded');
  let logs = files(root).filter(file => file.endsWith('.jsonl'));
  assert.equal(logs.length, 3);
  for (const file of logs) {
    assert.ok(fs.statSync(path.join(root, file)).size <= 4096);
    assert.equal(fs.statSync(path.join(root, file)).mode & 0o777, 0o600);
    for (const line of fs.readFileSync(path.join(root, file), 'utf8').trim().split('\n')) assert.equal(JSON.parse(line).version, 1);
  }
  assert.ok(telemetry.report().counts.search < 120);
  write(root, `${diagnostics}/unowned.txt`, 'preserve');
  assert.equal(createMemoryTelemetry(root, { maxBytes: 4096, maxFiles: 1 }).record('write', { outcome: 'created' }).status, 'recorded');
  logs = files(root).filter(file => file.endsWith('.jsonl'));
  assert.equal(logs.length, 1);
  assert.equal(fs.readFileSync(path.join(root, diagnostics, 'unowned.txt'), 'utf8'), 'preserve');
  assert.equal(fs.readdirSync(path.join(root, diagnostics)).some(name => name.startsWith('.tmp-') || name === '.lock'), false);
});

test('memory-telemetry: lowering byte budget discards oversized old logs before writing', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root, { maxBytes: 8192, maxFiles: 2 });
  for (let i = 0; i < 45; i++) telemetry.record('search', { queryHash: 'a'.repeat(64), resultCount: 1 });
  assert.ok(fs.statSync(path.join(root, diagnostics, 'events.jsonl')).size > 4096);
  assert.equal(createMemoryTelemetry(root, { maxBytes: 4096, maxFiles: 2 }).record('write', {}).status, 'recorded');
  for (const file of files(root).filter(file => file.endsWith('.jsonl'))) assert.ok(fs.statSync(path.join(root, file)).size <= 4096);
});

test('memory-telemetry: every state symlink and hardlinked log fails nonfatally without outside changes', t => {
  const base = temporary(t), outside = path.join(base, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'sentinel'), 'not modified');
  for (const target of ['.pi', '.pi/memory-state', diagnostics, `${diagnostics}/salt`, `${diagnostics}/events.jsonl`, `${diagnostics}/events.9.jsonl`, `${diagnostics}/.lock`]) {
    const root = fs.mkdtempSync(path.join(base, 'consumer-'));
    fs.mkdirSync(path.dirname(path.join(root, target)), { recursive: true });
    const destination = target.endsWith('salt') || target.endsWith('.jsonl') ? path.join(outside, 'sentinel') : outside;
    fs.symlinkSync(destination, path.join(root, target));
    const telemetry = createMemoryTelemetry(root);
    assert.equal(telemetry.record('search', {}).status, 'error', target);
    assert.equal(telemetry.hash('secret'), null, target);
    assert.equal(telemetry.report().status, 'error', target);
  }
  const root = fs.mkdtempSync(path.join(base, 'hardlink-'));
  fs.mkdirSync(path.join(root, diagnostics), { recursive: true });
  fs.linkSync(path.join(outside, 'sentinel'), path.join(root, diagnostics, 'events.jsonl'));
  assert.equal(createMemoryTelemetry(root).record('write', {}).status, 'error');
  assert.deepEqual(fs.readdirSync(outside), ['sentinel']);
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'not modified');
});

test('memory-telemetry: busy locks are visible and retained, invalid salt is never replaced', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root);
  fs.mkdirSync(path.join(root, diagnostics, '.lock'), { recursive: true });
  assert.equal(telemetry.record('write', {}).code, 'busy');
  assert.equal(telemetry.hash('secret'), null);
  assert.equal(telemetry.report().code, 'busy');
  assert.equal(fs.existsSync(path.join(root, diagnostics, '.lock')), true);
  fs.rmdirSync(path.join(root, diagnostics, '.lock'));
  write(root, `${diagnostics}/salt`, 'invalid');
  assert.equal(telemetry.hash('secret'), null);
  assert.equal(telemetry.status().code, 'state_io');
  assert.equal(fs.readFileSync(path.join(root, diagnostics, 'salt'), 'utf8'), 'invalid');
});

test('memory-telemetry: malformed events are counted, raw values never reach the report', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root);
  write(root, `${diagnostics}/events.jsonl`, 'not-json-secret\n' + JSON.stringify({ version: 1, at: '2026-01-01T00:00:00.000Z', type: 'usage', data: { messageIdHash: 'a'.repeat(64), provider: 'secret with spaces' } }) + '\n' + 'x'.repeat(5000) + '\n');
  const report = telemetry.report();
  assert.equal(report.invalidEvents, 3); assert.equal(report.counts.usage, 0);
  assert.equal(JSON.stringify(report).includes('secret'), false);
});

test('memory-observability CLIs: explicit config, read-only absent report, off and invalid argument handling', t => {
  const root = temporary(t);
  let result = cli('memory-report.mjs', ['--root', root], pkg);
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).status, 'ok');
  assert.deepEqual(fs.readdirSync(root), []);
  result = cli('memory-config.mjs', ['--mode', 'code-research', '--read', 'off', '--diagnostics', 'off'], root);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(loadMemoryConfig(root).mode, 'code-research'); assert.equal(loadMemoryConfig(root).readEnabled, false);
  result = cli('memory-report.mjs', [], root);
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).status, 'disabled');
  assert.deepEqual(files(root), ['.pi/memory-config.json']);
  assert.notEqual(cli('memory-config.mjs', ['--write', 'maybe'], root).status, 0);
  assert.notEqual(cli('memory-config.mjs', ['--typo', 'value'], root).status, 0);
  assert.notEqual(cli('memory-report.mjs', ['--warmup'], root).status, 0);
});

test('memory-telemetry: concurrent processes serialize complete writes and shared salt with visible busy retry', async t => {
  const root = temporary(t);
  const module = pathToFileURL(path.join(pkg, 'lib/memory-telemetry.mjs')).href;
  const source = `import { createMemoryTelemetry } from ${JSON.stringify(module)};
    const telemetry = createMemoryTelemetry(process.argv[1]);
    const wait = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2);
    let hash;
    for (let tries = 0; tries < 2000 && !hash; tries++) { hash = telemetry.hash('shared-sensitive-id'); if (!hash && telemetry.status().code !== 'busy') throw new Error(JSON.stringify(telemetry.status())); if (!hash) wait(); }
    if (!hash) throw new Error('hash timed out');
    for (let i = 0; i < 25; i++) {
      let result;
      for (let tries = 0; tries < 2000; tries++) { result = telemetry.record('write', { recordIdHash: hash, outcome: 'created', revision: 1 }); if (result.status === 'recorded') break; if (result.code !== 'busy') throw new Error(JSON.stringify(result)); wait(); }
      if (result.status !== 'recorded') throw new Error('record timed out');
    }
    console.log(hash);`;
  const runs = await Promise.all(Array.from({ length: 4 }, () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, root], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr)));
  })));
  assert.equal(new Set(runs).size, 1);
  const report = createMemoryTelemetry(root).report();
  assert.equal(report.counts.write, 100); assert.equal(report.invalidEvents, 0);
  assert.equal(fs.existsSync(path.join(root, diagnostics, '.lock')), false);
});

test('memory-observability: failed atomic replacement leaves prior config/log intact and cleans temporary files', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root);
  saveMemoryConfig(root, { mode: 'manual' });
  telemetry.record('write', { outcome: 'created' });
  const configPath = path.join(root, '.pi/memory-config.json');
  const logPath = path.join(root, diagnostics, 'events.jsonl');
  const previousConfig = fs.readFileSync(configPath, 'utf8'), previousLog = fs.readFileSync(logPath, 'utf8');
  const originalRename = fs.renameSync;
  try {
    fs.renameSync = () => { const error = new Error('synthetic sensitive error'); error.code = 'EIO'; throw error; };
    assert.throws(() => saveMemoryConfig(root, { mode: 'off' }), /synthetic/);
    const result = telemetry.record('write', { outcome: 'updated' });
    assert.equal(result.status, 'error'); assert.equal(result.code, 'state_io');
    assert.equal(JSON.stringify(result).includes('sensitive'), false);
  } finally { fs.renameSync = originalRename; }
  assert.equal(fs.readFileSync(configPath, 'utf8'), previousConfig);
  assert.equal(fs.readFileSync(logPath, 'utf8'), previousLog);
  assert.equal(fs.readdirSync(root, { recursive: true }).some(name => name.includes('.tmp-') || name.endsWith('.lock')), false);
});

test('memory-telemetry: report respects configured read bounds without rewriting oversized logs', t => {
  const root = temporary(t);
  write(root, `${diagnostics}/events.jsonl`, 'x'.repeat(4097));
  const telemetry = createMemoryTelemetry(root, { maxBytes: 4096 });
  assert.equal(telemetry.report().status, 'error');
  assert.equal(fs.statSync(path.join(root, diagnostics, 'events.jsonl')).size, 4097);
});

test('memory-config: concurrent process patches preserve all unrelated preferences', async t => {
  const root = temporary(t);
  const module = pathToFileURL(path.join(pkg, 'lib/memory-config.mjs')).href;
  const source = `import { saveMemoryConfig } from ${JSON.stringify(module)};
    for (let tries = 0; tries < 2000; tries++) {
      try { saveMemoryConfig(process.argv[1], JSON.parse(process.argv[2])); process.exit(0); }
      catch (error) { if (error.code !== 'MEMORY_BUSY') throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2); }
    }
    throw new Error('save timed out');`;
  const patches = [{ readEnabled: false }, { writeEnabled: false }, { warmup: true }, { diagnostics: { maxFiles: 2 } }];
  await Promise.all(patches.map(patch => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', source, root, JSON.stringify(patch)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr)));
  })));
  const config = loadMemoryConfig(root);
  assert.equal(config.readEnabled, false); assert.equal(config.writeEnabled, false);
  assert.equal(config.warmup, true); assert.equal(config.diagnostics.maxFiles, 2);
});

test('memory-telemetry: version/session metadata joins explicit complete relevance labels, never infers recall from hits', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root);
  const id = number => number.toString(16).padStart(64, '0');
  const identity = { sessionIdHash: id(1), pluginVersion: '0.1.2', policyVersion: 'code-research-v1' };
  for (const fields of Object.values(TELEMETRY_EVENT_FIELDS)) {
    for (const field of Object.keys(identity)) assert.ok(fields.includes(field));
  }
  assert.equal(telemetry.record('search', { ...identity, searchIdHash: id(2), backend: 'lexical', mode: 'code-research', outcome: 'success', resultCount: 2, resultIdHashes: [id(3), id(4)] }).status, 'recorded');
  telemetry.record('read', { ...identity, searchIdHash: id(2), recordIdHash: id(3), outcome: 'success' });
  assert.equal(telemetry.report().retrieval.recall, null);
  const feedback = { ...identity, searchIdHash: id(2), relevantIdHashes: [id(3), id(5)], labelsComplete: false };
  assert.equal(telemetry.record('relevance', feedback).status, 'recorded');
  assert.equal(telemetry.report().retrieval.recall, null);
  telemetry.record('relevance', { ...feedback, labelsComplete: true, sessionIdHash: id(99) });
  assert.equal(telemetry.report().retrieval.recall, null, 'another session cannot supply labels');
  telemetry.record('relevance', { ...feedback, labelsComplete: true });
  let report = telemetry.report();
  assert.equal(report.retrieval.recall, 0.5);
  assert.equal(report.retrieval.labeledSearches, 1);
  assert.equal(report.retrieval.labeledRelevantRecords, 2);
  assert.equal(report.retrieval.retrievedRelevantRecords, 1);
  assert.equal(report.retrieval.recallReason, 'explicit-complete-relevance-labels');
  assert.deepEqual(report.retrieval.backends, { lexical: 1 });
  assert.deepEqual(report.retrieval.modes, { 'code-research': 1 });
  assert.equal(report.retrieval.followUpReadRate, 1);
  const envelope = JSON.parse(fs.readFileSync(path.join(root, diagnostics, 'events.jsonl'), 'utf8').split('\n')[0]);
  assert.equal(envelope.version, TELEMETRY_SCHEMA_VERSION);
  for (const [key, value] of Object.entries(identity)) assert.equal(envelope.data[key], value);
  telemetry.record('search', { ...identity, searchIdHash: id(2), outcome: 'success', resultCount: 3, resultIdHashes: [id(3)] });
  report = telemetry.report();
  assert.equal(report.retrieval.recall, null, 'conflicting or incomplete result identities invalidate measurement');
  assert.equal(telemetry.record('relevance', { ...feedback, relevantIdHashes: [id(3), id(3)] }).code, 'invalid_event');
  assert.equal(telemetry.record('relevance', { searchIdHash: id(2), relevantIdHashes: [], labelsComplete: true }).code, 'invalid_event');
  assert.equal(telemetry.record('search', { sessionIdHash: 'raw-session-name' }).code, 'invalid_event');
  assert.equal(telemetry.record('search', { pluginVersion: 'raw text with spaces' }).code, 'invalid_event');
});

test('memory-telemetry: labeled zero recall is measured, but empty relevant labels remain unknown', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root);
  const identity = { sessionIdHash: 'a'.repeat(64), searchIdHash: 'b'.repeat(64) };
  telemetry.record('search', { ...identity, resultIdHashes: [], resultCount: 0, outcome: 'empty', backend: 'qmd-query', mode: 'manual' });
  telemetry.record('relevance', { ...identity, relevantIdHashes: [], labelsComplete: true });
  assert.equal(telemetry.report().retrieval.recall, null);
  telemetry.record('relevance', { ...identity, relevantIdHashes: ['c'.repeat(64)], labelsComplete: true });
  assert.equal(telemetry.report().retrieval.recall, 0);
});

test('memory-telemetry: usage dedup and follow-up correlation are session-scoped', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root);
  const first = { sessionIdHash: 'a'.repeat(64) }, second = { sessionIdHash: 'b'.repeat(64) };
  const usage = { messageIdHash: 'c'.repeat(64), input: 12 };
  telemetry.record('usage', { ...first, ...usage }); telemetry.record('usage', { ...first, ...usage });
  telemetry.record('usage', { ...second, ...usage });
  telemetry.record('search', { ...first, searchIdHash: 'd'.repeat(64), outcome: 'success' });
  telemetry.record('read', { ...second, searchIdHash: 'd'.repeat(64), outcome: 'success' });
  const report = telemetry.report();
  assert.equal(report.actualUsage.messages, 2); assert.equal(report.actualUsage.duplicateMessages, 1);
  assert.equal(report.actualUsage.byModel[0].input.total, 24);
  assert.equal(report.retrieval.linkedReads, 0);
});

test('memory-telemetry: self-health counts dropped writes and rotation failures without persisting errors', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root, { maxBytes: 4096, maxFiles: 2 });
  const event = { resultIdHashes: Array.from({ length: 50 }, (_, i) => i.toString(16).padStart(64, '0')) };
  assert.equal(telemetry.record('search', event).status, 'recorded');
  const originalRename = fs.renameSync;
  try {
    fs.renameSync = (source, target) => {
      if (source.endsWith('events.jsonl')) throw new Error('PRIVATE_ROTATION_ERROR');
      return originalRename(source, target);
    };
    const result = telemetry.record('search', event);
    assert.equal(result.status, 'error');
    assert.deepEqual(result.health, { scope: 'instance', droppedWrites: 1, rotationErrors: 1 });
  } finally { fs.renameSync = originalRename; }
  telemetry.record('search', { queryHash: 'PRIVATE_INVALID_QUERY' });
  assert.deepEqual(telemetry.status().health, { scope: 'instance', droppedWrites: 2, rotationErrors: 1 });
  const report = telemetry.report();
  assert.deepEqual(report.diagnosticStatus.health, { scope: 'instance', droppedWrites: 2, rotationErrors: 1 });
  assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
  assert.equal(fs.readFileSync(path.join(root, diagnostics, 'events.jsonl'), 'utf8').includes('PRIVATE'), false);
  const disabled = createMemoryTelemetry(root, { enabled: false });
  disabled.record('search', {});
  assert.deepEqual(disabled.status().health, { scope: 'instance', droppedWrites: 0, rotationErrors: 0 });
});

test('memory-telemetry: requested search modes remain distinct from persistence modes and actual backends', t => {
  const root = temporary(t), telemetry = createMemoryTelemetry(root);
  for (const requestedMode of ['semantic', 'deep']) {
    assert.equal(telemetry.record('search', { mode: 'manual', requestedMode, backend: 'none', outcome: 'error', reason: 'unavailable' }).status, 'recorded');
  }
  assert.equal(telemetry.record('search', { mode: 'code-research', requestedMode: 'keyword', backend: 'lexical', outcome: 'success' }).status, 'recorded');
  assert.equal(telemetry.record('search', { requestedMode: 'SECRET_QUERY' }).status, 'error');
  const report = telemetry.report();
  assert.deepEqual(report.retrieval.requestedModes, { semantic: 1, deep: 1, keyword: 1 });
  assert.deepEqual(report.retrieval.modes, { manual: 2, 'code-research': 1 });
  assert.deepEqual(report.retrieval.backends, { none: 2, lexical: 1 });
  assert.doesNotMatch(fs.readFileSync(path.join(root, diagnostics, 'events.jsonl'), 'utf8'), /SECRET_QUERY/);
});
