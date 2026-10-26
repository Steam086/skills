// Deterministic integration through the installed Pi loader; never a real provider/GPU request.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { syncBuiltinESMExports } from 'node:module';
const host = await import(pathToFileURL(process.env.PI_MEMORY_TEST_HOST));
const pkg = process.env.PI_MEMORY_TEST_PACKAGE, cwd = process.cwd();
const scenario = process.env.PI_MEMORY_TEST_SCENARIO ?? 'scope';
const { saveMemoryConfig } = await import(pathToFileURL(path.join(pkg, 'lib/memory-config.mjs')));
const { createMemoryTelemetry } = await import(pathToFileURL(path.join(pkg, 'lib/memory-telemetry.mjs')));
const calls = [];
const realExecFile = childProcess.execFile;
const heldSearches = [];
let holdSearch = false, ignoreKill = false, revoked = false, revokedStoreAccess = 0;
for (const name of ['openSync', 'readdirSync']) {
  const original = fs[name];
  fs[name] = (...args) => { if (revoked && String(args[0]).includes('/.project-memory/topics')) revokedStoreAccess++; return original(...args); };
}
let backendResults = [], backendError = false, backendWarning = '', pending = false, maxActive = 0, active = 0;
childProcess.execFile = (file, args, options, callback) => {
  calls.push({ file, args, timeout: options.timeout, maxBuffer: options.maxBuffer });
  if (scenario === 'qmd-readonly' && args[0]?.endsWith('/qmd-readonly.mjs')) return realExecFile(file, args, options, callback);
  const child = new EventEmitter();
  let completed = false;
  active++; maxActive = Math.max(maxActive, active);
  const finish = (error, stdout = '', stderr = '') => { if (completed) return; completed = true; active--; callback(error, stdout, stderr); };
  child.kill = () => { if (!ignoreKill) finish(Object.assign(new Error('killed secret'), { signal: 'SIGTERM' })); return true; };
  const isSearch = file.endsWith('/bin/qmd') && ['search', 'vsearch', 'query'].includes(args[0]) || args[0]?.endsWith('/qmd-readonly.mjs') && args[1] === 'keyword';
  if (holdSearch && isSearch) { heldSearches.push(finish); return child; }
  options.signal?.addEventListener('abort', child.kill, { once: true });
  queueMicrotask(() => {
    if (!pending) finish(backendError ? new Error('backend SECRET_STACK') : null, isSearch ? JSON.stringify(backendResults) : '{}', backendWarning);
  });
  return child;
};
syncBuiltinESMExports();
if (scenario === 'off') saveMemoryConfig(cwd, { mode: 'off', readEnabled: false, writeEnabled: true, diagnostics: { enabled: true } });
else if (scenario === 'budgets') saveMemoryConfig(cwd, { indexMaxChars: 128, searchMaxChars: 512, readMaxChars: 512, searchLimit: 2, autoIndex: false, diagnostics: { enabled: false } });
else if (scenario === 'warmup') saveMemoryConfig(cwd, { warmup: true, diagnostics: { enabled: false } });
else if (!['scope', 'lazy'].includes(scenario)) saveMemoryConfig(cwd, { autoIndex: scenario === 'qmd', diagnostics: { enabled: scenario === 'telemetry' } });
const loader = new host.DefaultResourceLoader({
  cwd, agentDir: path.join(cwd, 'agent'), settingsManager: host.SettingsManager.inMemory({ packages: [], extensions: [] }),
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  additionalExtensionPaths: [pkg], additionalSkillPaths: [path.join(pkg, 'SKILL.md')],
});
await loader.reload();
const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, []); assert.deepEqual(loaded.warnings ?? [], []); assert.equal(loaded.extensions.length, 1);
const extension = loaded.extensions[0], tools = extension.tools;
const ctx = { cwd, hasUI: false, sessionManager: host.SessionManager.inMemory(cwd) };
const tool = (name, params = {}, signal) => tools.get(name).definition.execute('test', params, signal, undefined, ctx);
const data = result => JSON.parse(result.content[0].text);
async function ok(name, params, signal) { const result = await tool(name, params, signal); assert.ok(!result.isError, JSON.stringify(result)); return data(result); }
async function error(name, params, code) { const result = await tool(name, params); assert.equal(result.isError, true); assert.equal(data(result).error, code); }
async function emit(name, event = {}) { for (const handler of extension.handlers.get(name) ?? []) await handler({ type: name, ...event }, ctx); }
async function command(name, args) { await extension.commands.get(name).handler(args, ctx); }
function files() { return fs.readdirSync(cwd, { recursive: true }).filter(f => fs.lstatSync(path.join(cwd, f)).isFile()).map(f => [f, fs.readFileSync(path.join(cwd, f), 'utf8')]); }
const before = async (prompt = 'Explain source') => { const event = { messageType: 'user', prompt, systemPrompt: 'BASE', systemPromptOptions: { sections: { other: 'preserve' } } }; await emit('before_agent_start', event); return event.systemPromptOptions.sections; };
const upsert = { id: 'scheduler-cancellation', title: 'Scheduler cancellation', summary: 'Ownership and cancellation', content: '# Detail\nPRIVATE_BODY_123\n\n## Cleanup\nRelease ownership.', reason: 'explicit' };
function source() { fs.writeFileSync(path.join(cwd, 'source.cc'), 'void cancel() {}\n'); }
assert.equal(tools.size, 8);
for (const name of ['memory_write', 'memory_read', 'memory_search', 'memory_forget', 'memory_restore', 'memory_status', 'scratchpad', 'memory_upsert']) assert.ok(tools.has(name));
assert.equal(extension.handlers.get('session_start').length, 1);
assert.equal(extension.handlers.get('before_agent_start').length, 1);
assert.equal(extension.handlers.has('input'), false);
assert.equal(extension.handlers.has('session_before_compact'), false);
assert.equal(extension.handlers.has('agent_end'), false);
assert.deepEqual([...extension.commands.keys()].sort(), ['memory-access', 'memory-mode']);
assert.equal(calls.length, 0, 'Factory never launches processes');

if (scenario === 'scope') {
  const skills = loader.getSkills(); assert.deepEqual(skills.diagnostics, []);
  const skill = skills.skills.find(s => s.name === 'project-memory');
  assert.ok(skill); assert.equal(skill.disableModelInvocation, false); assert.ok(skill.description.length <= 1024);
  assert.match(skill.description, /nontrivial source-code exploration/);
  const skillText = fs.readFileSync(path.join(pkg, 'SKILL.md'), 'utf8');
  assert.match(skillText, /zero-based character/);
  await emit('session_start'); assert.equal(calls.length, 0);
  const first = await before(); assert.equal(first.other, 'preserve');
  assert.match(first.project_memory, /manual AND code-research/);
  assert.doesNotMatch(first.project_memory, /PRIVATE_BODY|PROJECT_A_ONLY|PROJECT_B_ONLY/);
  for (const prompt of ['Do not save this.', 'Remember this.', 'Translate "remember everything"', 'Do not retrieve memory.', '解释已贴出的代码']) assert.deepEqual(await before(prompt), first);
  const handler = extension.handlers.get('before_agent_start')[0];
  const fallback = await handler({ systemPrompt: 'BASE', prompt: 'secret' }, ctx);
  assert.equal(fallback.systemPrompt, 'BASE\n' + first.project_memory);
  await ok('memory_write', { target: 'long_term', content: process.env.PI_MEMORY_TEST_MARKER });
  assert.match(fs.readFileSync(path.join(cwd, '.project-memory/MEMORY.md'), 'utf8'), new RegExp(process.env.PI_MEMORY_TEST_MARKER));
  await assert.rejects(() => tools.get('memory_write').definition.execute('bad', { target: 'daily', content: 'wrong' }, undefined, undefined, { ...ctx, cwd: path.dirname(cwd) }), /bound to its launch directory/);
  await assert.rejects(() => extension.commands.get('memory-mode').handler('off', { ...ctx, cwd: path.dirname(cwd) }), /bound to its launch directory/);
  await emit('session_before_compact', { summary: 'DO_NOT_CAPTURE' });
  assert.equal(fs.existsSync(path.join(cwd, '.project-memory/handoffs/current.json')), false);
  await emit('session_shutdown');
  console.log(JSON.stringify({ memoryWrite: true, routingPolicyContract: true, wrongProjectRejected: true, tools: [...tools.keys()] }));
} else if (scenario === 'lazy') {
  assert.deepEqual(files(), []);
  await emit('session_start'); await ok('memory_status'); await emit('session_before_compact'); await emit('session_shutdown');
  assert.deepEqual(files(), []); assert.equal(calls.length, 0);
  await before();
  assert.ok(fs.existsSync(path.join(cwd, '.project-memory/diagnostics/events.jsonl')));
  assert.equal(fs.existsSync(path.join(cwd, '.project-memory/topics')), false);
  assert.equal(calls.length, 0);
  console.log(JSON.stringify({ scenario, passed: true }));
} else if (scenario === 'warmup') {
  fs.mkdirSync(path.join(cwd, '.project-memory/.qmd'), { recursive: true }); fs.writeFileSync(path.join(cwd, '.project-memory/.qmd/index.yml'), 'fixture'); fs.writeFileSync(path.join(cwd, '.project-memory/.qmd/index.sqlite'), 'fixture');
  await emit('session_start');
  assert.deepEqual(calls.map(c => c.args), [[path.join(pkg, 'check-memory-config.mjs'), '--require-trust'], ['service', 'start', '--warm']]);
  assert.equal((await ok('memory_status')).maintenance, 'ready');
  console.log(JSON.stringify({ scenario, passed: true }));
} else if (scenario === 'off') {
  const initial = files();
  await emit('session_start'); await emit('session_before_compact', { summary: 'SECRET' }); await emit('session_shutdown');
  assert.deepEqual(await before('save EVERYTHING'), { other: 'preserve' });
  for (const [name, params] of [['memory_upsert', upsert], ['memory_write', { target: 'daily', content: 'x' }], ['memory_read', { target: 'long_term' }], ['memory_search', { query: 'x' }], ['memory_forget', { match: 'x' }], ['memory_restore', { recoveryId: 'x' }], ['scratchpad', { action: 'list' }], ['scratchpad', { action: 'add', text: 'x' }]]) await error(name, params, 'OFF');
  assert.equal((await ok('memory_status')).mode, 'off');
  assert.deepEqual(files(), initial); assert.equal(calls.length, 0);
  await command('memory-mode', 'manual');
  let status = await ok('memory_status'); assert.equal(status.readEnabled, false); assert.equal(status.writeEnabled, true);
  await command('memory-access', 'read on'); await command('memory-access', 'write off');
  await command('memory-mode', 'off'); await command('memory-mode', 'code-research');
  status = await ok('memory_status'); assert.equal(status.readEnabled, true); assert.equal(status.writeEnabled, false);
  await error('memory_upsert', upsert, 'WRITE_DISABLED');
  await ok('memory_read', { target: 'long_term' });
  console.log(JSON.stringify({ scenario, passed: true }));
} else if (scenario === 'crud') {
  source();
  await emit('session_start'); const initial = files(); await before(); assert.deepEqual(files(), initial);
  await error('memory_upsert', { ...upsert, reason: 'analysis', verified: true, anchors: [{ path: 'source.cc' }] }, 'NOT_PERMITTED');
  await ok('memory_upsert', upsert);
  assert.equal((await ok('memory_upsert', upsert)).status, 'unchanged');
  await error('memory_upsert', { ...upsert, content: 'replacement' }, 'REVISION_CONFLICT');
  await command('memory-mode', 'code-research');
  for (const extra of [{ verified: false, anchors: [{ path: 'source.cc' }] }, { verified: true, anchors: [] }]) await error('memory_upsert', { ...upsert, ...extra, reason: 'analysis' }, 'NOT_PERMITTED');
  const verified = { ...upsert, expectedRevision: 1, verified: true, anchors: [{ path: 'source.cc', symbol: 'cancel' }], reason: 'analysis' };
  assert.equal((await ok('memory_upsert', verified)).revision, 2);
  const sections = await before('do not change authority'); assert.match(sections.project_memory, /scheduler-cancellation/); assert.doesNotMatch(sections.project_memory, /PRIVATE_BODY/);
  assert.equal((await ok('memory_read', { id: upsert.id })).freshness.status, 'fresh');
  assert.equal((await ok('memory_read', { id: upsert.id, section: 'Cleanup' })).content, '## Cleanup\nRelease ownership.');
  const range = await ok('memory_read', { id: upsert.id, offset: 2, limit: 5 }); assert.equal(range.content, upsert.content.slice(2, 7)); assert.equal(range.nextOffset, 7);
  fs.appendFileSync(path.join(cwd, 'source.cc'), '// changed');
  const stale = await ok('memory_read', { id: upsert.id });
  assert.equal(stale.freshness.status, 'stale'); assert.deepEqual(stale.anchors, [{ path: 'source.cc', symbol: 'cancel' }]);
  assert.equal(stale.sourceCount, 1); assert.equal(stale.anchorsOmitted, 0); assert.equal(stale.sourceView, 'sources');
  const found = await ok('memory_search', { query: 'cancellation' }); assert.equal(found.backend, 'lexical'); assert.equal(found.results[0].revision, 2); assert.equal(found.results[0].freshness.status, 'stale');
  assert.equal((await ok('memory_search', { query: 'absent-unique-token-333' })).results.length, 0);
  const semantic = await tool('memory_search', { query: 'cancellation', mode: 'semantic' }); assert.equal(semantic.isError, true); assert.equal(data(semantic).unavailable, true); assert.equal(data(semantic).backend, 'none');
  await command('memory-access', 'read off');
  await error('memory_read', { id: upsert.id }, 'READ_DISABLED'); await error('memory_read', { id: upsert.id, view: 'sources' }, 'READ_DISABLED'); await error('scratchpad', { action: 'list' }, 'READ_DISABLED');
  await ok('scratchpad', { action: 'add', text: 'explicit task' });
  await command('memory-access', 'write off'); await error('scratchpad', { action: 'done', text: 'task' }, 'WRITE_DISABLED');
  await command('memory-access', 'read on'); await ok('scratchpad', { action: 'list' });
  await command('memory-access', 'write on');
  await error('memory_forget', { id: upsert.id, expectedRevision: 1 }, 'REVISION_CONFLICT');
  const removed = await ok('memory_forget', { id: upsert.id, expectedRevision: 2 });
  await error('memory_read', { id: upsert.id }, 'NOT_FOUND');
  const restored = await ok('memory_restore', { recoveryId: removed.recoveryId }); assert.ok(restored.revision > 2);
  await error('memory_restore', { recoveryId: removed.recoveryId }, 'NOT_FOUND');
  assert.equal((await ok('memory_read', { target: 'topics' })).records.length, 1);
  assert.equal(calls.length, 0); assert.equal(fs.existsSync(path.join(cwd, '.project-memory/diagnostics')), false);
  console.log(JSON.stringify({ scenario, passed: true }));
} else if (scenario.startsWith('revoke-')) {
  await ok('memory_upsert', upsert);
  fs.mkdirSync(path.join(cwd, '.project-memory/.qmd'), { recursive: true });
  fs.writeFileSync(path.join(cwd, '.project-memory/.qmd/index.yml'), 'fixture'); fs.writeFileSync(path.join(cwd, '.project-memory/.qmd/index.sqlite'), 'fixture');
  holdSearch = true; ignoreKill = true;
  const waiting = tool('memory_search', { query: 'scheduler' });
  for (let i = 0; i < 50 && !heldSearches.length; i++) await new Promise(r => setTimeout(r, 2));
  assert.equal(heldSearches.length, 1);
  if (scenario.includes('read')) await command('memory-access', 'read off');
  else if (scenario.includes('shutdown')) await emit('session_shutdown');
  else await command('memory-mode', 'off');
  if (scenario.includes('cycle')) await command('memory-mode', 'manual');
  revoked = true;
  heldSearches[0](scenario.includes('error') ? Object.assign(new Error('SIGTERM ordinary Error'), { signal: 'SIGTERM' }) : null,
    JSON.stringify([{ file: 'qmd://project-memory/topics/scheduler-cancellation.md' }]));
  const result = await waiting;
  assert.equal(data(result).error, 'CANCELLED'); assert.equal(result.isError, true);
  assert.equal(revokedStoreAccess, 0); revoked = false;
  console.log(JSON.stringify({ scenario, passed: true }));
} else if (scenario === 'legacy-stamps') {
  const file = path.join(cwd, '.project-memory/MEMORY.md'); fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '<!-- 2026-01-01 12:00:00 [old] -->\nKeep historical fact.');
  await ok('memory_write', { target: 'long_term', content: 'Remove new fact.' });
  await ok('memory_write', { target: 'long_term', content: 'Keep later fact.' });
  await ok('memory_forget', { match: 'Remove new fact.' });
  let kept = (await ok('memory_read', { target: 'long_term' })).content;
  assert.match(kept, /Keep historical fact/); assert.match(kept, /Keep later fact/); assert.doesNotMatch(kept, /Remove new fact/);
  await ok('memory_write', { target: 'long_term', mode: 'overwrite', content: 'Keep replacement.' });
  assert.match(fs.readFileSync(file, 'utf8'), /^<!-- last updated: \d{4}-.* \[[^\]]+\] -->/);
  await ok('memory_write', { target: 'long_term', content: 'Remove following fact.' });
  await ok('memory_forget', { match: 'Remove following fact.' });
  assert.match((await ok('memory_read', { target: 'long_term' })).content, /Keep replacement/);
  await ok('memory_write', { target: 'daily', content: 'Keep daily.' });
  await ok('memory_write', { target: 'daily', content: 'Remove daily.' });
  await ok('memory_forget', { target: 'daily', match: 'Remove daily.' });
  assert.match((await ok('memory_read', { target: 'daily' })).content, /Keep daily/);
  console.log(JSON.stringify({ scenario, passed: true }));
} else if (scenario === 'legacy') {
  const initial = files();
  for (const params of [{ target: 'daily' }, { target: 'list' }, { target: 'scratchpad' }, { target: 'long_term' }]) await ok('memory_read', params);
  assert.deepEqual(files(), initial);
  const large = 'SECRET_OLD_'.repeat(6000);
  fs.mkdirSync(path.join(cwd, '.project-memory'), { recursive: true }); fs.writeFileSync(path.join(cwd, '.project-memory/MEMORY.md'), large);
  const read = await tool('memory_read', { target: 'long_term', offset: 3, limit: 24000 }); assert.ok(read.content[0].text.length <= 6000); assert.equal(data(read).truncated, true); assert.equal(data(read).content, large.slice(3, data(read).nextOffset));
  const receipt = await tool('memory_write', { target: 'long_term', content: '\nAPPEND_MARKER' }); assert.ok(receipt.content[0].text.length < 200); assert.doesNotMatch(JSON.stringify(receipt), /SECRET_OLD/);
  await Promise.all(Array.from({ length: 10 }, (_, i) => ok('memory_write', { target: 'daily', content: `parallel-${i}` })));
  const daily = await ok('memory_read', { target: 'daily' }); for (let i = 0; i < 10; i++) assert.ok(daily.content.includes(`parallel-${i}`));
  const beforeSearch = files();
  const legacyMiss = await ok('memory_search', { query: 'parallel-0' });
  assert.equal(legacyMiss.backend, 'lexical'); assert.equal(legacyMiss.coverage, 'topics-only'); assert.deepEqual(legacyMiss.results, []);
  assert.equal(legacyMiss.legacy.searched, false); assert.deepEqual(legacyMiss.legacy.availableTargets, ['long_term', 'daily']);
  assert.match(legacyMiss.legacy.read, /memory_read.*target=list.*target=daily.*date/);
  assert.deepEqual(files(), beforeSearch); assert.equal(calls.length, 0);
  await ok('memory_write', { target: 'long_term', mode: 'overwrite', content: 'Keep this.\n\nRemove this.' });
  const removed = await ok('memory_forget', { match: 'Remove this' }); assert.ok(removed.recoveryId); assert.doesNotMatch((await ok('memory_read', { target: 'long_term' })).content, /Remove/);
  await ok('memory_write', { target: 'long_term', content: 'Later content.' });
  await ok('memory_restore', { recoveryId: removed.recoveryId }); assert.equal((await ok('memory_restore', { recoveryId: removed.recoveryId })).status, 'unchanged');
  assert.match((await ok('memory_read', { target: 'long_term' })).content, /Later content/);
  await ok('scratchpad', { action: 'add', text: 'check this' }); await ok('scratchpad', { action: 'done', text: 'check' }); await ok('scratchpad', { action: 'undo', text: 'check' }); await ok('scratchpad', { action: 'done', text: 'check' }); await ok('scratchpad', { action: 'clear_done' });
  await error('memory_read', { target: 'daily', date: '../../outside' }, 'INVALID_INPUT');
  const file = path.join(cwd, '.project-memory/MEMORY.md'); fs.unlinkSync(file); fs.symlinkSync(path.join(cwd, '.project-memory/config.json'), file);
  await error('memory_read', { target: 'long_term' }, 'UNSAFE_PATH'); await error('memory_write', { target: 'long_term', content: 'bad' }, 'UNSAFE_PATH');
  fs.unlinkSync(file);
  fs.writeFileSync(path.join(cwd, '.project-memory/legacy.lock'), 'busy'); await error('memory_write', { target: 'long_term', content: 'bad' }, 'MEMORY_BUSY');
  assert.equal(calls.length, 0);
  console.log(JSON.stringify({ scenario, passed: true }));
} else if (scenario === 'navigation') {
  const anchors = [];
  for (let i = 0; i < 32; i++) {
    const relative = `${'a'.repeat(100)}/${'b'.repeat(100)}/${'c'.repeat(100)}/source-${i}.cc`;
    fs.mkdirSync(path.dirname(path.join(cwd, relative)), { recursive: true });
    fs.writeFileSync(path.join(cwd, relative), 'SOURCE_BODY_NOT_METADATA');
    anchors.push({ path: relative, symbol: `symbol_${i}_${'s'.repeat(100)}` });
  }
  await ok('memory_upsert', { ...upsert, anchors, verified: true });
  fs.appendFileSync(path.join(cwd, anchors[0].path), 'changed');
  const beforeRead = files();
  const body = await tool('memory_read', { id: upsert.id });
  assert.ok(body.content[0].text.length <= 6000); assert.equal(data(body).freshness.status, 'stale');
  assert.ok(data(body).anchors.length > 0); assert.ok(data(body).anchors.length <= 2);
  assert.deepEqual(data(body).anchors[0], anchors[0]); assert.equal(data(body).anchorsOmitted, 32 - data(body).anchors.length);
  assert.equal(data(body).sourceView, 'sources');
  let offset = 0, metadata = '', pages = 0;
  for (;;) {
    const result = await tool('memory_read', { id: upsert.id, view: 'sources', offset, limit: 24000 });
    assert.ok(!result.isError); assert.ok(result.content[0].text.length <= 6000); pages++;
    const value = data(result); assert.equal(value.sourceCount, 32); metadata += value.content;
    if (!value.truncated) break;
    assert.ok(value.nextOffset > offset); offset = value.nextOffset;
  }
  assert.ok(pages > 1);
  const sources = JSON.parse(metadata); assert.equal(sources.length, 32);
  assert.deepEqual(sources.map(({ path, symbol }) => ({ path, symbol })), anchors);
  for (const source of sources) assert.match(source.hash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(metadata, /SOURCE_BODY_NOT_METADATA|PRIVATE_BODY/);
  assert.deepEqual(files(), beforeRead); assert.equal(calls.length, 0);
  await command('memory-access', 'read off'); await error('memory_read', { id: upsert.id, view: 'sources' }, 'READ_DISABLED');
  await command('memory-mode', 'off'); await error('memory_read', { id: upsert.id, view: 'sources' }, 'OFF');
  console.log(JSON.stringify({ scenario, passed: true }));
} else if (scenario === 'budgets') {
  for (let i = 0; i < 30; i++) await ok('memory_upsert', { ...upsert, id: `topic-${i}`, title: `Topic ${i}`, content: `# Big\nPRIVATE_BODY_${i}\n` + '\\"😀'.repeat(4000) });
  const first = await before('PROMPT_MUST_NOT_APPEAR'); const indexStart = first.project_memory.lastIndexOf('Topics:');
  assert.ok(indexStart > 0); assert.ok(first.project_memory.slice(indexStart).length <= 128); assert.doesNotMatch(first.project_memory, /PRIVATE_BODY|PROMPT_MUST_NOT_APPEAR/);
  assert.deepEqual(await before('different prompt'), first);
  const found = await tool('memory_search', { query: 'Topic', limit: 50 }); assert.ok(found.content[0].text.length <= 512); assert.ok(data(found).results.length <= 2);
  let offset = 0, rebuilt = '';
  for (;;) {
    const result = await tool('memory_read', { id: 'topic-0', offset, limit: 24000 }); assert.ok(!result.isError); assert.ok(result.content[0].text.length <= 512);
    const page = data(result); rebuilt += page.content; if (!page.truncated) break; assert.ok(page.nextOffset > offset); offset = page.nextOffset;
  }
  assert.equal(rebuilt, '# Big\nPRIVATE_BODY_0\n' + '\\"😀'.repeat(4000));
  const listing = await tool('memory_read', { target: 'topics', limit: 100 }); assert.ok(listing.content[0].text.length <= 512); assert.ok(data(listing).nextCursor);
  fs.mkdirSync(path.join(cwd, '.project-memory/daily'), { recursive: true });
  for (let i = 0; i < 56; i++) fs.writeFileSync(path.join(cwd, `.project-memory/daily/2026-${i < 28 ? '01' : '02'}-${String(i % 28 + 1).padStart(2, '0')}.md`), 'LEGACY_SECRET');
  const daily = await tool('memory_read', { target: 'list', limit: 100 }); assert.ok(daily.content[0].text.length <= 512); assert.equal(data(daily).truncated, true); assert.ok(data(daily).nextOffset > 0);
  const snapshot = files(); await emit('session_before_compact', { summary: 'never persist transcript' }); assert.deepEqual(files(), snapshot);
  assert.equal(calls.length, 0);
  console.log(JSON.stringify({ scenario, passed: true }));
} else if (scenario === 'qmd-readonly') {
  const { qmdFixture } = await import('./qmd-fixture.mjs');
  const { DatabaseSync } = await import('node:sqlite');
  await ok('memory_upsert', upsert); await command('memory-access', 'write off');
  for (const kind of ['current', 'missing-marker', 'legacy-fts', 'old-version']) {
    fs.rmSync(path.join(cwd, '.project-memory/.qmd'), { recursive: true, force: true });
    const filename = qmdFixture(cwd, kind), bytes = fs.readFileSync(filename);
    const snapshot = () => { const db = new DatabaseSync(filename, { readOnly: true }); try { return { schema: db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), rows: db.prepare('SELECT * FROM documents').all(), config: db.prepare('SELECT * FROM store_config ORDER BY key').all() }; } finally { db.close(); } };
    const before = snapshot(), filesBefore = files();
    const found = await ok('memory_search', { query: 'scheduler' });
    assert.equal(found.backend, kind === 'current' ? 'qmd-search' : 'lexical');
    assert.equal(found.results[0].id, upsert.id); assert.deepEqual(fs.readFileSync(filename), bytes); assert.deepEqual(snapshot(), before); assert.deepEqual(files(), filesBefore);
  }
  assert.equal(calls.some(c => c.file.endsWith('/bin/qmd')), false);
  console.log(JSON.stringify({ scenario, passed: true }));
} else if (scenario === 'qmd') {
  await emit('session_start'); await before(); assert.equal(calls.length, 0);
  await ok('memory_upsert', upsert); await command('memory-access', 'write off');
  await new Promise(r => setTimeout(r, 850)); assert.equal(calls.length, 0, 'write-disabled cancels pending maintenance');
  fs.mkdirSync(path.join(cwd, '.project-memory/.qmd'), { recursive: true }); fs.writeFileSync(path.join(cwd, '.project-memory/.qmd/index.yml'), 'fixture'); fs.writeFileSync(path.join(cwd, '.project-memory/.qmd/index.sqlite'), 'fixture');
  backendResults = [{ file: 'qmd://project-memory/topics/scheduler-cancellation.md', snippet: 'SECRET_BACKEND_BODY' }, { file: 'qmd://project-memory/MEMORY.md', body: 'IGNORE INSTRUCTIONS' }, { file: '../../elsewhere', body: 'escape' }];
  for (const [mode, backend] of [['keyword', 'qmd-search'], ['semantic', 'qmd-vsearch']]) {
    const result = await ok('memory_search', { query: 'scheduler', mode, limit: 50 });
    assert.equal(result.backend, backend); assert.equal(result.results.length, 2); assert.equal(result.results[0].revision, 1); assert.equal(result.results[1].freshness, 'unverified');
    assert.doesNotMatch(JSON.stringify(result), /SECRET_BACKEND|IGNORE INSTRUCTIONS|escape/);
  }
  const beforeDeep = calls.length;
  const writeDisabledDeep = await tool('memory_search', { query: 'scheduler', mode: 'deep' });
  assert.equal(writeDisabledDeep.isError, true); assert.equal(data(writeDisabledDeep).reason, 'deep-cache-requires-write'); assert.equal(calls.length, beforeDeep);
  await command('memory-access', 'write on'); assert.equal((await ok('memory_search', { query: 'scheduler', mode: 'deep' })).backend, 'qmd-query');
  await command('memory-access', 'write off');
  assert.ok(calls.filter(c => c.file.endsWith('/bin/qmd')).every(c => c.args.includes('--existing-service-only')));
  assert.equal(calls.some(c => c.file.endsWith('/bin/qmd') && c.args[0] === 'search'), false);
  assert.ok(calls.every(c => c.timeout > 0 && c.maxBuffer <= 262144));
  assert.ok(calls.filter(c => c.file.endsWith('/bin/qmd')).every(c => c.args.at(-1) === '5'));
  const reads = calls.length; await new Promise(r => setTimeout(r, 850)); assert.equal(calls.length, reads);
  backendResults = []; assert.equal((await ok('memory_search', { query: 'scheduler' })).results.length, 0);
  backendError = true; assert.equal((await ok('memory_search', { query: 'scheduler' })).backend, 'lexical');
  const unavailable = await tool('memory_search', { query: 'scheduler', mode: 'deep' }); assert.equal(unavailable.isError, true); assert.equal(data(unavailable).backend, 'none'); assert.doesNotMatch(JSON.stringify(unavailable), /SECRET_STACK/);
  backendError = false; backendWarning = 'need embeddings'; assert.equal((await tool('memory_search', { query: 'scheduler', mode: 'semantic' })).isError, true); backendWarning = '';
  pending = true; const controller = new AbortController(); const cancelled = tool('memory_search', { query: 'scheduler', mode: 'semantic' }, controller.signal); controller.abort(); assert.equal(data(await cancelled).error, 'CANCELLED'); pending = false;
  await command('memory-access', 'write on'); calls.length = 0; maxActive = 0;
  await Promise.all([ok('memory_write', { target: 'long_term', content: 'first' }), ok('memory_write', { target: 'long_term', content: 'second' })]);
  await new Promise(r => setTimeout(r, 900));
  assert.deepEqual(calls.filter(c => c.file.endsWith('/bin/qmd')).map(c => c.args[0]), ['update', 'embed']); assert.equal(maxActive, 1);
  calls.length = 0; await ok('memory_write', { target: 'long_term', content: 'cancel on off' }); await command('memory-mode', 'off'); await new Promise(r => setTimeout(r, 850)); assert.equal(calls.length, 0);
  await command('memory-mode', 'manual'); assert.equal((await ok('memory_status')).autoIndex, true); await ok('memory_write', { target: 'long_term', content: 'cancel on shutdown' }); await emit('session_shutdown'); await new Promise(r => setTimeout(r, 850)); assert.equal(calls.length, 0);
  console.log(JSON.stringify({ scenario, passed: true }));
} else if (scenario === 'telemetry') {
  await ok('memory_upsert', upsert);
  const first = await ok('memory_search', { query: 'cancellation SECRET_QUERY' }); const second = await ok('memory_search', { query: 'cancellation SECRET_QUERY' }); assert.notEqual(first.searchId, second.searchId);
  await ok('memory_read', { id: upsert.id }); await ok('memory_read', { id: upsert.id, searchId: first.searchId });
  await ok('memory_read', { id: upsert.id, searchId: 'not-a-search' }); await before('SECRET_PROMPT');
  for (const mode of ['semantic', 'deep']) assert.equal((await tool('memory_search', { query: 'SECRET_UNAVAILABLE', mode })).isError, true);
  const hostRoot = path.resolve(process.env.PI_MEMORY_TEST_HOST, '../../../pi-ai/dist/index.js');
  const ai = await import(pathToFileURL(hostRoot));
  const runtime = await host.ModelRuntime.create({ authPath: path.join(cwd, 'agent/auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false });
  runtime.registerProvider('memory-test', { api: 'memory-test-api', apiKey: 'test-only', baseUrl: 'http://unused.invalid', models: [{ id: 'deterministic', name: 'Deterministic fixture', reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 1000 }],
    streamSimple(model, context) {
      const prompt = ai.getCurrentSystemPrompt(context.messages);
      assert.match(prompt, /scheduler-cancellation/);
      assert.doesNotMatch(prompt, /PRIVATE_BODY_123|SECRET_USER|SECRET_QUERY/);
      const stream = ai.createAssistantMessageEventStream();
      queueMicrotask(() => {
        const message = { role: 'assistant', content: [{ type: 'text', text: 'SECRET_ASSISTANT' }], api: model.api, provider: model.provider, model: model.id,
          usage: { input: 101, output: 17, cacheRead: 23, cacheWrite: 5, totalTokens: 146, cost: { input: 0.1, output: 0.2, cacheRead: 0.03, cacheWrite: 0.04, total: 0.37 } }, stopReason: 'stop', timestamp: Date.now() };
        stream.push({ type: 'start', partial: message }); stream.push({ type: 'done', reason: 'stop', message }); stream.end();
      });
      return stream;
    },
  });
  const { session: actual } = await host.createAgentSession({ cwd, agentDir: path.join(cwd, 'agent'), modelRuntime: runtime, model: runtime.getModel('memory-test', 'deterministic'),
    resourceLoader: loader, sessionManager: ctx.sessionManager, settingsManager: host.SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }), tools: [] });
  const hostErrors = [];
  await actual.bindExtensions({ onError: e => hostErrors.push(e) });
  await actual.prompt('SECRET_USER');
  assert.deepEqual(hostErrors, []); assert.equal(actual.getLastAssistantText(), 'SECRET_ASSISTANT');
  const entry = ctx.sessionManager.getEntries().find(e => e.type === 'message' && e.message.role === 'assistant'); assert.ok(entry);
  await emit('turn_end', { message: entry.message, messageEntryId: entry.id });
  const telemetry = createMemoryTelemetry(cwd, { enabled: true }); const report = telemetry.report();
  assert.equal(report.actualUsage.messages, 1); assert.equal(report.actualUsage.byModel[0].input.total, 101); assert.equal(report.actualUsage.byModel[0].output.total, 17); assert.equal(report.actualUsage.byModel[0].cacheRead.total, 23); assert.equal(report.actualUsage.byModel[0].cost.total, 0.37);
  assert.equal(report.retrieval.linkedReads, 1); assert.equal(report.retrieval.backends.lexical, 2); assert.equal(report.retrieval.backends.none, 2); assert.deepEqual(report.retrieval.requestedModes, { keyword: 2, semantic: 1, deep: 1 }); assert.equal(report.retrieval.recall, null);
  const raw = fs.readFileSync(path.join(cwd, '.project-memory/diagnostics/events.jsonl'), 'utf8');
  assert.doesNotMatch(raw, /SECRET_|PRIVATE_BODY|scheduler-cancellation|source\.cc/);
  const events = raw.trim().split('\n').map(JSON.parse); for (const event of events) { assert.match(event.data.sessionIdHash, /^[a-f0-9]{64}$/); assert.equal(event.data.pluginVersion, '0.1.2'); assert.equal(event.data.policyVersion, 'source-memory-1'); }
  assert.equal(events.filter(e => e.type === 'usage').length, 1);
  const zeroUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { total: 0 } };
  for (const [id, changes] of [
    ['local-error', { stopReason: 'error', usage: zeroUsage, responseId: undefined, errorMessage: 'SECRET_LOCAL_ERROR' }],
    ['local-abort', { stopReason: 'aborted', usage: zeroUsage, responseId: undefined }],
    ['provider-zero', { stopReason: 'error', usage: zeroUsage, responseId: 'provider-fixture-zero' }],
    ['partial-error', { stopReason: 'error', usage: { ...zeroUsage, input: 11 }, responseId: undefined }],
  ]) await emit('turn_end', { message: { ...entry.message, ...changes }, messageEntryId: id });
  await emit('turn_end', { message: { ...entry.message, stopReason: 'error', usage: zeroUsage }, messageEntryId: 'local-error' });
  const measuredReport = telemetry.report();
  assert.equal(measuredReport.actualUsage.messages, 5);
  assert.deepEqual(measuredReport.actualUsage.byMeasurement, { 'host-reported': 3, 'unknown-zero-error': 2 });
  assert.equal(measuredReport.actualUsage.byModel[0].input.total, 112);
  assert.equal(measuredReport.actualUsage.byModel[0].input.known, 3);
  assert.equal(measuredReport.actualUsage.byModel[0].input.unknown, 2);
  const measuredEvents = fs.readFileSync(path.join(cwd, '.project-memory/diagnostics/events.jsonl'), 'utf8');
  assert.doesNotMatch(measuredEvents, /SECRET_LOCAL_ERROR|provider-fixture-zero/);
  for (const event of measuredEvents.trim().split('\n').map(JSON.parse).filter(e => e.data.measurement === 'unknown-zero-error')) {
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'cost']) assert.equal(event.data[key], null);
  }
  const lock = path.join(cwd, '.project-memory/diagnostics/.lock'); fs.mkdirSync(lock);
  await ok('memory_read', { id: upsert.id }); const health = await ok('memory_status'); assert.equal(health.diagnostics.status, 'error'); assert.ok(health.diagnostics.failures > 0); fs.rmdirSync(lock);
  await command('memory-mode', 'off'); const initial = files(); await emit('turn_end', { message: entry.message, messageEntryId: 'new-off' }); await before(); assert.deepEqual(files(), initial);
  actual.dispose(); console.log(JSON.stringify({ scenario, passed: true, actualHostUsage: true }));
}
await emit('session_shutdown');
