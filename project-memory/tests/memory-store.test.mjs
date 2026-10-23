import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { createMemoryStore } from '../lib/memory-store.mjs';

function project(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-store-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, store: createMemoryStore(root) };
}
function write(root, relative, content) {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), content);
}
function input(id = 'scheduler-cancellation', extra = {}) {
  return { id, title: 'Scheduler cancellation', summary: 'Cancellation is checked before dispatch.', content: '# Cancellation\nCheck AbortSignal before dispatch.\n', ...extra };
}
function throwsCode(action, code) { assert.throws(action, error => error.code === code); }
function bytes(value) { return JSON.stringify(value).length; }
function source(root, relative = 'src/scheduler.js') {
  write(root, relative, 'export function dispatch(signal) { return !signal.aborted; }\n');
  return { path: relative, symbol: 'dispatch' };
}
function topic(root, id = 'scheduler-cancellation') { return path.join(root, '.pi/memory/topics', `${id}.md`); }
function changeTopicMeta(root, id, change) {
  const raw = fs.readFileSync(topic(root, id), 'utf8');
  const end = raw.indexOf('\n---\n', 4);
  const meta = JSON.parse(raw.slice(4, end));
  change(meta);
  fs.writeFileSync(topic(root, id), `---\n${JSON.stringify(meta)}${raw.slice(end)}`);
}

test('memory-store: construction and every missing-state read are side-effect free', t => {
  const { root, store } = project(t);
  assert.deepEqual(store.list(), { records: [], nextCursor: null, total: 0 });
  assert.deepEqual(store.search('dispatch 中文'), []);
  assert.equal(store.buildIndex(), 'Topics: 0; omitted: 0\n');
  assert.equal(store.readHandoff(), null);
  for (const action of [() => store.read({ id: 'missing' }), () => store.inspect('missing'), () => store.freshness('missing')]) throwsCode(action, 'NOT_FOUND');
  assert.deepEqual(fs.readdirSync(root), []);
  const missingRoot = path.join(root, 'absent');
  assert.deepEqual(createMemoryStore(missingRoot).list().records, []);
  assert.equal(fs.existsSync(missingRoot), false);
});

test('memory-store: captures source hashes, writes Markdown and guards full replacements', t => {
  const { root, store } = project(t);
  const value = input(undefined, { anchors: [source(root)], verified: true, tags: ['scheduler'] });
  assert.deepEqual(store.upsert(value), { status: 'created', id: value.id, revision: 1 });
  const meta = store.inspect(value.id);
  assert.equal(meta.sources[0].hash, crypto.createHash('sha256').update(fs.readFileSync(path.join(root, 'src/scheduler.js'))).digest('hex'));
  assert.deepEqual(meta.anchors, value.anchors);
  assert.equal(meta.verified, true);
  assert.equal(meta.revision, 1);
  assert.equal(meta.content, undefined);
  assert.match(fs.readFileSync(topic(root), 'utf8'), /^---\n\{"version":1,.*\n---\n# Cancellation/);
  const before = fs.statSync(topic(root));
  assert.equal(store.upsert(value).status, 'unchanged');
  assert.equal(fs.statSync(topic(root)).mtimeMs, before.mtimeMs);
  throwsCode(() => store.upsert({ ...value, summary: 'Changed summary.' }), 'REVISION_CONFLICT');
  throwsCode(() => store.upsert({ ...value, expectedRevision: 2 }), 'REVISION_CONFLICT');
  assert.deepEqual(store.upsert({ ...value, summary: 'Changed summary.', expectedRevision: 1 }), { status: 'updated', id: value.id, revision: 2 });
  throwsCode(() => store.upsert({ ...value, expectedRevision: 1 }), 'REVISION_CONFLICT');
  assert.equal(store.inspect(value.id).createdAt, meta.createdAt);
  const copied = store.inspect(value.id);
  copied.sources[0].hash = 'a'.repeat(64);
  assert.notEqual(store.inspect(value.id).sources[0].hash, copied.sources[0].hash);
  assert.equal(store.read({ id: value.id }).content, value.content);
  assert.equal(fs.statSync(topic(root)).mode & 0o777, 0o600);
});

test('memory-store: conservative duplicates require equivalent anchors, hashes and scope', t => {
  const { root, store } = project(t);
  const anchor = source(root);
  const value = input('one', { anchors: [anchor], verified: true, tags: ['dispatch'], content: 'const value = "a b";  \r\n' });
  store.upsert(value);
  assert.deepEqual(store.upsert({ ...value, id: 'two', title: 'Alternative title', content: 'const value = "a b";\n' }), { status: 'unchanged', id: 'one', revision: 1, duplicateOf: 'one', requestedId: 'two' });
  assert.equal(fs.existsSync(topic(root, 'two')), false);
  assert.equal(store.upsert({ ...value, id: 'different-code', content: 'const value = "a  b";\n' }).status, 'created');
  const differentAnchor = source(root, 'src/other.js');
  assert.equal(store.upsert({ ...value, id: 'different-source', anchors: [differentAnchor] }).status, 'created');
  assert.equal(store.upsert({ ...value, id: 'different-scope', tags: ['other'] }).status, 'created');
  assert.equal(store.upsert({ ...value, id: 'different-verification', verified: false }).status, 'created');
  store.upsert(input('unanchored'));
  assert.equal(store.upsert(input('other-title', { title: 'Different unanchored scope' })).status, 'created');
});

test('memory-store: freshness uses file contents, not commits or timestamps', t => {
  const { root, store } = project(t);
  const value = input(undefined, { anchors: [source(root)], verified: true });
  store.upsert(value);
  assert.deepEqual(store.freshness(value.id), { status: 'fresh', checked: 1, changed: 0, missing: 0, unsafe: 0 });
  write(root, '.git/HEAD', 'ref: refs/heads/unrelated\n');
  write(root, 'unrelated.js', 'unrelated change');
  assert.equal(store.freshness(value.id).status, 'fresh');
  const sourceFile = path.join(root, 'src/scheduler.js');
  const original = fs.statSync(sourceFile);
  fs.writeFileSync(sourceFile, fs.readFileSync(sourceFile, 'utf8').replace('!signal', ' signal'));
  fs.utimesSync(sourceFile, original.atime, original.mtime);
  assert.equal(store.freshness(value.id).status, 'stale');
  assert.equal(store.read({ id: value.id }).freshness.changed, 1);
  assert.equal(store.search('dispatch')[0].freshness.status, 'stale');
  throwsCode(() => store.upsert(value), 'REVISION_CONFLICT');
  assert.equal(store.upsert({ ...value, expectedRevision: 1 }).revision, 2);
  assert.equal(store.freshness(value.id).status, 'fresh');
  fs.unlinkSync(sourceFile);
  assert.equal(store.freshness(value.id).missing, 1);
  throwsCode(() => store.upsert({ ...value, expectedRevision: 2 }), 'SOURCE_MISSING');
  store.upsert(input('unverified'));
  assert.equal(store.freshness('unverified').status, 'unverified');
  store.upsert(input('no-anchors', { verified: true }));
  assert.equal(store.freshness('no-anchors').status, 'unverified');
});

test('memory-store: invalid IDs, source paths and inputs cannot escape or silently coerce', t => {
  const { root, store } = project(t);
  for (const id of ['', '../escape', 'A', 'a/b', 'a\\b', 'a.md', '-a', 'a-', 'a--b', 'a'.repeat(81)]) {
    throwsCode(() => store.upsert(input(id)), 'INVALID_ID');
    throwsCode(() => store.read({ id }), 'INVALID_ID');
  }
  for (const relative of ['/etc/passwd', '../escape', 'src/../escape', './file', 'a//b', 'C:\\escape', '.pi/memory/topics/a.md', '.pi/memory-state/secret']) {
    throwsCode(() => store.upsert(input('bad-source', { anchors: [{ path: relative }] })), 'UNSAFE_PATH');
  }
  for (const extra of [{ title: '' }, { title: 'a'.repeat(161) }, { summary: 's'.repeat(401) }, { content: '' }, { content: 'x'.repeat(24001) }, { tags: Array(13).fill('a') }, { anchors: Array(33).fill({ path: 'a' }) }, { verified: 'yes' }, { expectedRevision: '1' }, { tags: [3] }, { anchors: [{ path: 'a', hash: 'spoof' }] }, { unrecognized: true }]) {
    throwsCode(() => store.upsert(input('invalid', extra)), 'INVALID_INPUT');
  }
  throwsCode(() => store.upsert(input('missing-anchor', { anchors: [{ path: 'missing.js' }] })), 'SOURCE_MISSING');
  fs.mkdirSync(path.join(root, 'directory'));
  throwsCode(() => store.upsert(input('directory-anchor', { anchors: [{ path: 'directory' }] })), 'INVALID_RECORD');
  throwsCode(() => store.upsert(input('missing-revision', { expectedRevision: 1 })), 'REVISION_CONFLICT');
  assert.equal(fs.existsSync(path.join(root, '.pi/memory/topics')), false);
});

test('memory-store: reads paginate exact character ranges under serialized budgets', t => {
  const { store } = project(t);
  const content = '# Long line\n' + '\\"😀中文'.repeat(1000);
  store.upsert(input('long', { content }));
  let offset = 0;
  let reconstructed = '';
  for (;;) {
    const result = store.read({ id: 'long', offset, limit: 500, maxChars: 600 });
    assert.ok(bytes(result) <= 600);
    reconstructed += result.content;
    if (!result.truncated) break;
    assert.ok(result.nextOffset > offset);
    offset = result.nextOffset;
  }
  assert.equal(reconstructed, content);
  assert.equal(store.read({ id: 'long', offset: content.length }).content, '');
  assert.equal(store.read({ id: 'long', offset: 10, limit: 5 }).content, content.slice(10, 15));
  throwsCode(() => store.read({ id: 'long', maxChars: 64 }), 'BUDGET_TOO_SMALL');
  for (const extra of [{ offset: -1 }, { offset: 1.5 }, { limit: 0 }, { maxChars: 30001 }]) throwsCode(() => store.read({ id: 'long', ...extra }), 'INVALID_INPUT');
});

test('memory-store: complete short reads fit their exact serialized budget', t => {
  const { store } = project(t);
  store.upsert(input('short', { content: 'x' }));
  const complete = store.read({ id: 'short' });
  assert.deepEqual(store.read({ id: 'short', maxChars: bytes(complete) }), complete);
});

test('memory-store: section names preserve meaningful hashes and strip separated closing hashes', t => {
  const { store } = project(t);
  for (const [id, heading] of [['plain', '## C#'], ['closed', '## C# ##']]) {
    const content = `${heading}\nDetails\n`;
    store.upsert(input(id, { content }));
    assert.equal(store.read({ id, section: 'C#' }).content, content);
    throwsCode(() => store.read({ id, section: 'C' }), 'SECTION_NOT_FOUND');
  }
});

test('memory-store: Markdown section reads include subsections but ignore fenced headings', t => {
  const { store } = project(t);
  const content = '# Intro\nintro\n## Target\nstart\n```md\n## Fake\n```\n### Child\nchild\n## Next\nend\n';
  store.upsert(input('sections', { content }));
  const selected = content.slice(content.indexOf('## Target'), content.indexOf('## Next'));
  assert.equal(store.read({ id: 'sections', section: 'target' }).content, selected);
  assert.equal(store.read({ id: 'sections', section: 'Target', offset: 3, limit: 12 }).content, selected.slice(3, 15));
  throwsCode(() => store.read({ id: 'sections', section: 'Fake' }), 'SECTION_NOT_FOUND');
  throwsCode(() => store.read({ id: 'sections', section: 'missing' }), 'SECTION_NOT_FOUND');
});

test('memory-store: compact list uses stable ID cursors and a total serialized budget', t => {
  const { store } = project(t);
  for (const id of ['c', 'a', 'b']) store.upsert(input(id, { title: `Topic ${id}`, content: `${id}: private body` }));
  const first = store.list({ limit: 2 });
  assert.deepEqual(first.records.map(record => record.id), ['a', 'b']);
  assert.equal(first.nextCursor, 'b');
  assert.equal(first.total, 3);
  assert.deepEqual(store.list({ cursor: first.nextCursor }).records.map(record => record.id), ['c']);
  assert.equal(store.list({ cursor: first.nextCursor }).nextCursor, null);
  const bounded = store.list({ maxChars: 180 });
  assert.ok(bytes(bounded) <= 180);
  assert.equal(bounded.records.length, 1);
  assert.doesNotMatch(JSON.stringify(first), /private body|"content"|"sources"/);
  throwsCode(() => store.list({ maxChars: 64 }), 'BUDGET_TOO_SMALL');
  throwsCode(() => store.list({ cursor: '../bad' }), 'INVALID_ID');
});

test('memory-store: explicit lexical search matches body-only symbols and Chinese, returns no bodies', t => {
  const { store } = project(t);
  store.upsert(input('body-hit', { title: 'Body topic', summary: 'General overview.', content: 'PRIVATE_BODY dispatchQueue 取消调度 should not appear in output.' }));
  store.upsert(input('title-hit', { title: 'dispatchQueue', summary: '取消调度 overview.', content: 'other private content' }));
  assert.deepEqual(store.search('dispatchQueue').map(hit => hit.id), ['title-hit', 'body-hit']);
  assert.deepEqual(store.search('取消').map(hit => hit.id), ['title-hit', 'body-hit']);
  assert.equal(store.search('dispatchQueue', { limit: 1 }).length, 1);
  const bounded = store.search('dispatchQueue', { maxChars: 300 });
  assert.ok(bytes(bounded) <= 300);
  assert.equal(bounded.length, 1);
  assert.doesNotMatch(JSON.stringify(bounded), /PRIVATE_BODY|"content"/);
  assert.deepEqual(store.search('zzzzmissing'), []);
  assert.deepEqual(store.search('!!!'), []);
  assert.deepEqual(store.search('dispatchQueue', { maxChars: 64 }), []);
  assert.doesNotMatch(store.buildIndex(), /PRIVATE_BODY|取消调度|General overview/);
});

test('memory-store: index is capped, stable, body-free, reports omissions and legacy availability', t => {
  const { root, store } = project(t);
  for (let i = 0; i < 30; i++) store.upsert(input(`topic-${String(i).padStart(2, '0')}`, { title: `Title ${i}`, content: `PRIVATE_BODY_${i}` }));
  const before = store.buildIndex({ maxChars: 180, limit: 5 });
  assert.ok(before.length <= 180);
  assert.match(before, /Topics: 30; omitted: 25/);
  assert.doesNotMatch(before, /PRIVATE_BODY|Cancellation is checked/);
  assert.equal(store.buildIndex({ maxChars: 180, limit: 5 }), before);
  write(root, '.pi/memory/MEMORY.md', 'LEGACY_BODY never injected');
  assert.match(store.buildIndex(), /legacy available/);
  assert.doesNotMatch(store.buildIndex(), /LEGACY_BODY/);
  store.writeHandoff({ content: 'HANDOFF never indexed' });
  const forgotten = store.forget({ id: 'topic-00', expectedRevision: 1 });
  const after = store.buildIndex();
  assert.match(after, /Topics: 29/);
  assert.doesNotMatch(after, /HANDOFF|topic-00|recovery/);
  assert.ok(fs.existsSync(path.join(root, '.pi/memory/recovery', `${forgotten.recoveryId}.json`)));
});

test('memory-store: repeated index/list reuse metadata, stat changes invalidate the cache', t => {
  const { root, store } = project(t);
  store.upsert(input('cached', { content: 'X'.repeat(24000) }));
  store.buildIndex();
  const original = fs.readSync;
  let calls = 0;
  fs.readSync = (...args) => { calls++; return original(...args); };
  try {
    store.buildIndex();
    store.list();
    assert.equal(calls, 0, 'unchanged metadata requires no body or header reads');
    const other = createMemoryStore(root);
    other.upsert(input('cached', { title: 'Updated cache title', content: 'X'.repeat(24000), expectedRevision: 1 }));
    calls = 0;
    assert.match(store.buildIndex(), /Updated cache title/);
    assert.ok(calls > 0);
  } finally { fs.readSync = original; }
});

test('memory-store: forget/restore preserve facts, guard revisions and reject conflicts', t => {
  const { root, store } = project(t);
  const value = input(undefined, { anchors: [source(root)], verified: true });
  store.upsert(value);
  throwsCode(() => store.forget({ id: value.id }), 'REVISION_CONFLICT');
  throwsCode(() => store.forget({ id: value.id, expectedRevision: 2 }), 'REVISION_CONFLICT');
  const removed = store.forget({ id: value.id, expectedRevision: 1 });
  assert.equal(removed.id, value.id);
  throwsCode(() => store.read({ id: value.id }), 'NOT_FOUND');
  assert.deepEqual(store.search('dispatch'), []);
  assert.deepEqual(store.restore(removed.recoveryId), { status: 'restored', id: value.id, revision: 2 });
  assert.equal(store.read({ id: value.id }).content, value.content);
  assert.equal(store.freshness(value.id).status, 'fresh');
  throwsCode(() => store.restore(removed.recoveryId), 'NOT_FOUND');
  const next = store.forget({ id: value.id, expectedRevision: 2 });
  store.upsert({ ...value, content: 'Replacement live content' });
  throwsCode(() => store.restore(next.recoveryId), 'REVISION_CONFLICT');
  assert.equal(store.read({ id: value.id }).content, 'Replacement live content');
  throwsCode(() => store.forget({ id: '../escape', expectedRevision: 1 }), 'INVALID_ID');
  throwsCode(() => store.restore('../escape'), 'INVALID_ID');
});

test('memory-store: recovery imports validate filenames, metadata, body hashes and source paths', t => {
  const { root, store } = project(t);
  store.upsert(input());
  const { recoveryId } = store.forget({ id: 'scheduler-cancellation', expectedRevision: 1 });
  const filename = path.join(root, '.pi/memory/recovery', `${recoveryId}.json`);
  const original = JSON.parse(fs.readFileSync(filename, 'utf8'));
  for (const mutate of [
    record => { record.meta.id = 'different'; },
    record => { record.content = 'tampered'; },
    record => { record.meta.verified = 'true'; },
    record => { record.meta.revision = 0; },
    record => { record.meta.createdAt = 'bad'; },
    record => { record.extra = true; },
    record => { record.meta.sources = [{ path: 'a', hash: 'x' }]; },
  ]) {
    const changed = structuredClone(original);
    mutate(changed);
    fs.writeFileSync(filename, JSON.stringify(changed));
    throwsCode(() => store.restore(recoveryId), 'INVALID_RECORD');
    assert.equal(fs.existsSync(topic(root)), false);
  }
  const unsafe = structuredClone(original);
  unsafe.meta.anchors = [{ path: '../escape' }];
  unsafe.meta.sources = [{ path: '../escape', hash: 'a'.repeat(64) }];
  fs.writeFileSync(filename, JSON.stringify(unsafe));
  throwsCode(() => store.restore(recoveryId), 'UNSAFE_PATH');
  fs.writeFileSync(filename, JSON.stringify(original));
  assert.equal(store.restore(recoveryId).status, 'restored');
});

test('memory-store: handoff is separate, bounded, hash-idempotent and validated on read', t => {
  const { root, store } = project(t);
  const first = store.writeHandoff({ content: 'Next: inspect cancellation ownership.', sessionId: 'session-1' });
  assert.equal(first.status, 'created');
  const filename = path.join(root, '.pi/memory-state/handoffs/current.json');
  const stat = fs.statSync(filename);
  assert.equal(store.writeHandoff({ content: 'Next: inspect cancellation ownership.', sessionId: 'session-2' }).status, 'unchanged');
  assert.equal(fs.statSync(filename).mtimeMs, stat.mtimeMs);
  assert.equal(store.readHandoff().sessionId, 'session-1');
  assert.equal(store.writeHandoff({ content: 'Next: run deterministic tests.' }).status, 'updated');
  assert.equal(store.readHandoff().sessionId, undefined);
  assert.equal(store.list().total, 0);
  assert.equal(fs.existsSync(path.join(root, '.pi/memory')), false);
  assert.equal(stat.mode & 0o777, 0o600);
  throwsCode(() => store.writeHandoff({ content: 'x'.repeat(12001) }), 'INVALID_INPUT');
  throwsCode(() => store.writeHandoff({ content: '' }), 'INVALID_INPUT');
  const corrupted = store.readHandoff();
  corrupted.content += 'tamper';
  fs.writeFileSync(filename, JSON.stringify(corrupted));
  throwsCode(() => store.readHandoff(), 'INVALID_RECORD');
  throwsCode(() => store.writeHandoff({ content: 'must not replace corrupt state' }), 'INVALID_RECORD');
});

test('memory-store: symlinked project/state components fail closed for reads and writes', t => {
  const { root } = project(t);
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  for (const component of ['.pi', '.pi/memory', '.pi/memory/topics', '.pi/memory-state', '.pi/memory-state/handoffs']) {
    const local = path.join(root, component.replaceAll('/', '-'));
    fs.mkdirSync(local);
    const link = path.join(local, component);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(outside, link);
    const store = createMemoryStore(local);
    const stateOnly = component.startsWith('.pi/memory-state');
    const action = stateOnly ? () => store.writeHandoff({ content: 'blocked' }) : () => store.upsert(input());
    throwsCode(action, 'UNSAFE_PATH');
    const read = stateOnly ? () => store.readHandoff() : () => store.list();
    throwsCode(read, 'UNSAFE_PATH');
  }
  const linkedRoot = path.join(root, 'linked-root');
  fs.symlinkSync(outside, linkedRoot);
  throwsCode(() => createMemoryStore(linkedRoot).list(), 'UNSAFE_PATH');
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('memory-store: symlinked topics, recovery, handoff and lock files are never followed', t => {
  const { root, store } = project(t);
  write(root, 'outside.txt', 'OUTSIDE');
  const outside = path.join(root, 'outside.txt');
  const link = relative => { fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true }); fs.symlinkSync(outside, path.join(root, relative)); };
  link('.pi/memory/topics/linked.md');
  throwsCode(() => store.read({ id: 'linked' }), 'UNSAFE_PATH');
  throwsCode(() => store.upsert(input('linked')), 'UNSAFE_PATH');
  throwsCode(() => store.buildIndex(), 'UNSAFE_PATH');
  fs.unlinkSync(topic(root, 'linked'));
  link('.pi/memory-state/handoffs/current.json');
  throwsCode(() => store.writeHandoff({ content: 'blocked' }), 'UNSAFE_PATH');
  throwsCode(() => store.readHandoff(), 'UNSAFE_PATH');
  const recoveryId = `linked.${crypto.randomUUID()}`;
  link(`.pi/memory/recovery/${recoveryId}.json`);
  throwsCode(() => store.restore(recoveryId), 'UNSAFE_PATH');
  link('.pi/memory-state/store.lock');
  throwsCode(() => store.upsert(input('blocked')), 'UNSAFE_PATH');
  assert.equal(fs.readFileSync(outside, 'utf8'), 'OUTSIDE');
});

test('memory-store: source symlinks are rejected and later unsafe anchors become stale', t => {
  const { root, store } = project(t);
  const anchor = source(root);
  store.upsert(input(undefined, { anchors: [anchor], verified: true }));
  write(root, 'other.js', 'outside bytes');
  fs.unlinkSync(path.join(root, anchor.path));
  fs.symlinkSync(path.join(root, 'other.js'), path.join(root, anchor.path));
  assert.equal(store.freshness('scheduler-cancellation').unsafe, 1);
  assert.equal(store.freshness('scheduler-cancellation').status, 'stale');
  throwsCode(() => store.upsert(input('linked-source', { anchors: [anchor] })), 'UNSAFE_PATH');
  fs.symlinkSync(path.join(root, 'src'), path.join(root, 'linked-src'));
  throwsCode(() => store.upsert(input('linked-directory', { anchors: [{ path: 'linked-src/scheduler.js' }] })), 'UNSAFE_PATH');
});

test('memory-store: malformed and oversized topic files fail closed without allocating their bodies', t => {
  const { root, store } = project(t);
  store.upsert(input('corrupt'));
  changeTopicMeta(root, 'corrupt', meta => { meta.id = 'mismatch'; });
  throwsCode(() => store.list(), 'INVALID_RECORD');
  throwsCode(() => store.read({ id: 'corrupt' }), 'INVALID_RECORD');
  fs.unlinkSync(topic(root, 'corrupt'));
  write(root, '.pi/memory/topics/oversized.md', 'x'.repeat(140001));
  throwsCode(() => store.buildIndex(), 'INVALID_RECORD');
  throwsCode(() => store.search('x'), 'INVALID_RECORD');
  throwsCode(() => store.read({ id: 'oversized' }), 'INVALID_RECORD');
  fs.unlinkSync(topic(root, 'oversized'));
  write(root, '.pi/memory/topics/bad-header.md', '---\n{"bad":true}\n---\nbody');
  throwsCode(() => store.list(), 'INVALID_RECORD');
  fs.unlinkSync(topic(root, 'bad-header'));
  store.upsert(input('bad-body'));
  fs.appendFileSync(topic(root, 'bad-body'), 'tampering');
  throwsCode(() => store.read({ id: 'bad-body' }), 'INVALID_RECORD');
  throwsCode(() => store.search('tampering'), 'INVALID_RECORD');
});

test('memory-store: atomic write failure preserves live topic and releases own lock', t => {
  const { root, store } = project(t);
  store.upsert(input());
  const before = fs.readFileSync(topic(root), 'utf8');
  const original = fs.renameSync;
  fs.renameSync = () => { throw Object.assign(new Error('injected rename failure'), { code: 'EIO' }); };
  try { throwsCode(() => store.upsert(input(undefined, { summary: 'new summary', expectedRevision: 1 })), 'EIO'); }
  finally { fs.renameSync = original; }
  assert.equal(fs.readFileSync(topic(root), 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, '.pi/memory-state/store.lock')), false);
  assert.deepEqual(fs.readdirSync(path.dirname(topic(root))), ['scheduler-cancellation.md']);
  assert.equal(store.upsert(input(undefined, { summary: 'retry summary', expectedRevision: 1 })).revision, 2);
});

test('memory-store: existing locks are bounded and never stolen, including apparently stale locks', t => {
  const { root, store } = project(t);
  write(root, '.pi/memory-state/store.lock', '{"pid":999999999}');
  for (const action of [() => store.upsert(input()), () => store.writeHandoff({ content: 'blocked' }), () => store.forget({ id: 'missing', expectedRevision: 1 })]) throwsCode(action, 'STORE_LOCKED');
  assert.equal(fs.readFileSync(path.join(root, '.pi/memory-state/store.lock'), 'utf8'), '{"pid":999999999}');
  assert.deepEqual(store.list().records, []);
  assert.equal(fs.existsSync(path.join(root, '.pi/memory/topics')), false);
});

test('memory-store: competing processes cannot silently overwrite a revision', async t => {
  const { root, store } = project(t);
  store.upsert(input('race'));
  const moduleURL = new URL('../lib/memory-store.mjs', import.meta.url).href;
  const code = `import {createMemoryStore} from ${JSON.stringify(moduleURL)};
    process.send('ready'); process.once('message', () => {
      try { process.send(createMemoryStore(process.argv[1]).upsert(JSON.parse(process.argv[2]))); }
      catch (error) { process.send({code:error.code}); }
      process.disconnect();
    });`;
  const children = [1, 2].map(number => spawn(process.execPath, ['--input-type=module', '-e', code, root, JSON.stringify(input('race', { content: `writer ${number}`, expectedRevision: 1 }))], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }));
  t.after(() => children.forEach(child => { if (child.exitCode === null) child.kill(); }));
  const ready = children.map(child => new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); child.once('exit', code => reject(new Error(`early child exit ${code}`))); }));
  await Promise.all(ready);
  const results = children.map(child => new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); }));
  children.forEach(child => child.send('go'));
  const outcomes = await Promise.all(results);
  assert.equal(outcomes.filter(outcome => outcome.status === 'updated').length, 1);
  assert.equal(outcomes.filter(outcome => ['REVISION_CONFLICT', 'STORE_LOCKED'].includes(outcome.code)).length, 1);
  assert.equal(store.inspect('race').revision, 2);
  assert.match(store.read({ id: 'race' }).content, /^writer [12]$/);
});

test('memory-store: recovery history prevents revision reuse across deletion and older restores', t => {
  const { store } = project(t);
  store.upsert(input('incarnation', { content: 'first incarnation' }));
  const first = store.forget({ id: 'incarnation', expectedRevision: 1 });
  assert.equal(store.upsert(input('incarnation', { content: 'second incarnation' })).revision, 2);
  throwsCode(() => store.upsert(input('incarnation', { content: 'old client overwrite', expectedRevision: 1 })), 'REVISION_CONFLICT');
  store.forget({ id: 'incarnation', expectedRevision: 2 });
  assert.equal(store.restore(first.recoveryId).revision, 3);
  assert.equal(store.read({ id: 'incarnation' }).content, 'first incarnation');
  throwsCode(() => store.upsert(input('incarnation', { content: 'second old client overwrite', expectedRevision: 2 })), 'REVISION_CONFLICT');
});

test('memory-store: corrupt retained recovery history cannot silently reset revisions', t => {
  const { root, store } = project(t);
  store.upsert(input('history'));
  const { recoveryId } = store.forget({ id: 'history', expectedRevision: 1 });
  write(root, `.pi/memory/recovery/${recoveryId}.json`, '{"corrupt":true}');
  throwsCode(() => store.upsert(input('history', { content: 'new incarnation' })), 'INVALID_RECORD');
  assert.equal(fs.existsSync(topic(root, 'history')), false);
  assert.equal(store.list().total, 0, 'ordinary reads never scan recovery');
  assert.equal(store.buildIndex(), 'Topics: 0; omitted: 0\n');
});

test('memory-store: maximum escaped body survives recovery serialization', t => {
  const { store } = project(t);
  const content = '\u0001'.repeat(24000);
  store.upsert(input('escaped', { content }));
  const { recoveryId } = store.forget({ id: 'escaped', expectedRevision: 1 });
  assert.equal(store.restore(recoveryId).revision, 2);
  let result = '';
  let offset = 0;
  do {
    const chunk = store.read({ id: 'escaped', offset });
    assert.ok(bytes(chunk) <= 6000);
    result += chunk.content;
    offset = chunk.nextOffset;
  } while (offset !== undefined);
  assert.equal(result, content);
});

test('memory-store: short final cursors never exceed list budget', t => {
  const { store } = project(t);
  store.upsert(input('a'));
  store.upsert(input('b', { content: 'different body' }));
  for (let maxChars = 64; maxChars < 400; maxChars++) {
    try { assert.ok(bytes(store.list({ maxChars })) <= maxChars); }
    catch (error) { assert.equal(error.code, 'BUDGET_TOO_SMALL'); }
  }
});

test('memory-store: symlinked recovery directory cannot remove a live topic', t => {
  const { root, store } = project(t);
  store.upsert(input());
  const outside = path.join(root, 'outside-recovery');
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(root, '.pi/memory/recovery'));
  throwsCode(() => store.forget({ id: 'scheduler-cancellation', expectedRevision: 1 }), 'UNSAFE_PATH');
  assert.equal(store.read({ id: 'scheduler-cancellation' }).revision, 1);
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('memory-store: hundreds of maximum-size topics keep defaults bounded and index reads metadata only', t => {
  const { root, store } = project(t);
  for (let i = 0; i < 200; i++) {
    const id = `scale-${String(i).padStart(3, '0')}`;
    store.upsert(input(id, { title: `Scale title ${i}`, content: `BODY_ONLY_${i} ` + 'x'.repeat(23980) }));
  }
  const freshStore = createMemoryStore(root);
  const original = fs.readSync;
  let readBytes = 0;
  fs.readSync = (...args) => { const count = original(...args); readBytes += count; return count; };
  try {
    const index = freshStore.buildIndex();
    assert.ok(index.length <= 1800);
    assert.match(index, /Topics: 200; omitted: 170/);
    assert.doesNotMatch(index, /BODY_ONLY/);
    assert.ok(readBytes <= 200 * 1024, 'only bounded headers are read, not 4.8M characters of bodies');
    readBytes = 0;
    assert.equal(freshStore.buildIndex(), index);
    assert.equal(readBytes, 0);
    assert.ok(bytes(freshStore.list()) <= 2400);
  } finally { fs.readSync = original; }
  const results = freshStore.search('BODY_ONLY_199');
  assert.deepEqual(results.map(hit => hit.id), ['scale-199']);
  assert.ok(bytes(results) <= 2400);
});
