import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { cases } from '../eval/cases.mjs';
import { actionMetadata, gradeCase, limits, retrievalMetrics, resultStopReason, safeFailure, stopReason, usageSummary } from '../eval/grading.mjs';
import { evaluate, evaluationFailed, parseArgs, runChild, validateResume } from '../scripts/memory-eval.mjs';
const definition = id => cases.find(c => c.id === id);
const result = (actions = [], state = {}) => ({ completed: true, actions, state: { changed: false, addedTopics: 0, beforeTopics: 4, afterTopics: 4, ...state } });
test('memory-eval rubric accepts direct topic read, not tool existence or failed search', () => {
  assert.equal(gradeCase(definition('costly-recall'), result([{ tool: 'memory_read', success: true, relevant: true }])).status, 'pass');
  assert.equal(gradeCase(definition('costly-recall'), result([{ tool: 'memory_search', success: false, relevant: true }])).status, 'fail');
  assert.equal(gradeCase(definition('costly-recall'), result()).status, 'fail');
});
test('memory-eval denied forbidden write is safety pass and routing failure', () => {
  const grade = gradeCase(definition('research-no-save'), result([{ tool: 'memory_upsert', success: false, error: 'NOT_PERMITTED' }]));
  assert.equal(grade.safety, true); assert.equal(grade.status, 'fail');
  assert.equal(gradeCase(definition('pasted-code'), result([{ tool: 'memory_search', success: false }])).status, 'fail');
  assert.equal(gradeCase(definition('current-context'), result()).status, 'pass');
});
test('memory-eval no-recall rules reject successful and denied scratchpad reads', () => {
  for (const id of ['pasted-code', 'current-context', 'quoted-negated', 'runtime-off']) {
    for (const success of [true, false]) {
      const grade = gradeCase(definition(id), result([{ tool: 'scratchpad', success, mutating: false }]));
      assert.equal(grade.status, 'fail', `${id}: scratchpad read attempt`);
      assert.equal(grade.checks.noRecallAttempt, false);
      assert.equal(grade.safety, true);
    }
  }
});
test('memory-eval offline deadline and incomplete results propagate nonzero exit policy', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-eval-stop-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, child, expected] of [
    ['timeout', { stopped: 'hard-deadline', completed: false }, 'hard-deadline'],
    ['incomplete', { completed: false }, 'incomplete'],
    ['failure', { failure: 'fixture failure', completed: false }, 'provider-or-infrastructure-failure'],
    ['complete', { completed: true }, null],
  ]) {
    const options = parseArgs(['--out', path.join(root, `${name}.json`)]);
    const report = await evaluate(options, { childRunner: async () => child });
    assert.equal(report.stopped, expected);
    assert.equal(evaluationFailed(report), expected !== null);
    assert.equal(JSON.parse(fs.readFileSync(options.out, 'utf8')).stopped, expected);
  }
});
test('memory-eval source save requires successful state change and prior source reads', () => {
  const save = { tool: 'memory_upsert', success: true, status: 'created', analysis: true, anchorsReadBeforeSave: true, allSourcesReadBeforeSave: true };
  assert.equal(gradeCase(definition('research-milestone'), result([save], { changed: true })).status, 'pass');
  assert.equal(gradeCase(definition('research-milestone'), result([{ ...save, anchorsReadBeforeSave: false }], { changed: true })).status, 'fail');
  assert.equal(gradeCase(definition('research-milestone'), result([save])).status, 'fail');
  assert.equal(gradeCase(definition('explicit-duplicate'), result([{ tool: 'memory_read', success: true, relevant: true }])).status, 'pass');
  assert.equal(gradeCase(definition('explicit-duplicate'), result([], { changed: true, addedTopics: 1 })).status, 'fail');
});
test('memory-eval failures and incomplete runs never receive behavior passes', () => {
  for (const extra of [{ failure: 'authentication error' }, { stopped: 'deadline' }, { completed: false }]) assert.equal(gradeCase(definition('pasted-code'), { ...result(), ...extra }).status, 'not-measured');
  assert.equal(gradeCase(definition('stale-source'), result([{ tool: 'memory_read', success: true, relevant: true }])).status, 'fail');
});
test('memory-eval allowlist omits raw args, bodies, output and unknown anchors', () => {
  const clean = actionMetadata({ tool: 'memory_upsert', success: true, args: { token: 'SECRET' }, content: 'SECRET', anchor: '/private/SECRET', error: 'SECRET', prompt: 'SECRET', outputChars: 42 });
  assert.deepEqual(clean, { tool: 'memory_upsert', success: true, outputChars: 42 });
  assert.doesNotMatch(safeFailure('401 api_key=SECRET Bearer TOKEN https://secret.test/key sk-abcdef'), /SECRET|TOKEN|secret.test|sk-abcdef/);
});
test('memory-eval retrieval excludes empty/incomplete labels from recall denominator, not hit rate', () => {
  const rows = [
    { success: true, complete: true, relevant: ['a', 'b'], returned: ['x', 'a', 'a'] },
    { success: true, complete: true, relevant: ['c'], returned: [] },
    { success: true, complete: true, relevant: [], returned: ['noise'] },
    { success: true, complete: false, relevant: ['x'], returned: ['x'] },
    { success: false, complete: true, relevant: ['q'], returned: ['q'] },
  ];
  const metrics = retrievalMetrics(rows);
  assert.equal(metrics.labeledQueries, 2); assert.equal(metrics.relevantRecords, 3);
  assert.equal(metrics.recallAtK, 0.25); assert.equal(metrics.microRecallAtK, 1 / 3); assert.equal(metrics.mrrAtK, 0.25); assert.equal(metrics.nonemptyRate, 0.75);
  assert.equal(retrievalMetrics([rows[2]]).recallAtK, null);
  assert.equal(retrievalMetrics([]).mrrAtK, null);
  assert.throws(() => retrievalMetrics(rows, 0));
});
test('memory-eval finalized usage retains unknowns and counts caches separately', () => {
  assert.deepEqual(usageSummary([]), { messages: 0, knownMessages: 0, unknownMessages: 0, input: null, output: null, cacheRead: null, cacheWrite: null, cost: null, observedTokens: 0 });
  const usage = usageSummary([{ usage: { input: 10, output: 5, cacheRead: 20, cacheWrite: 0, cost: { total: 0.01 } } }, {}]);
  assert.equal(usage.observedTokens, 35); assert.equal(usage.unknownMessages, 1); assert.equal(usage.knownMessages, 1); assert.equal(usage.cacheRead, 20);
  assert.equal(usageSummary([{}]).input, null);
  const syntheticFailure = usageSummary([{ stopReason: 'error', usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }]);
  assert.equal(syntheticFailure.unknownMessages, 1); assert.equal(syntheticFailure.input, null);
});
test('memory-eval unknown usage cannot bypass turn, time, case and failure bounds', () => {
  assert.equal(stopReason({ turns: limits.turns, tokens: usageSummary([{}]).observedTokens }), 'turn-budget');
  assert.equal(stopReason({ tokens: limits.tokens }), 'observed-token-budget');
  assert.equal(stopReason({ cases: limits.cases }), 'case-budget');
  assert.equal(stopReason({ caseElapsedMs: limits.caseMs }), 'deadline');
  assert.equal(stopReason({ elapsedMs: limits.totalMs }), 'deadline');
  assert.equal(stopReason({ providerFailure: true }), 'provider-failure');
  assert.equal(stopReason({}), null);
  assert.equal(resultStopReason({ stopped: 'observed-token-budget', failure: 'Evaluation stopped: observed-token-budget' }), 'observed-token-budget');
  assert.equal(resultStopReason({ failure: '401' }), 'provider-or-infrastructure-failure');
  assert.equal(resultStopReason({ completed: false }), 'incomplete');
});
test('memory-eval command is offline by default and rejects unsafe case/output budgets', () => {
  const args = ['--out', '/tmp/memory-eval-test.json'];
  assert.equal(parseArgs(args).live, false); assert.equal(parseArgs(args).caseIds.length, 2);
  assert.equal(parseArgs([...args, '--live', '--cases', 'all']).caseIds.length, 10);
  assert.throws(() => parseArgs(['--out', 'eval/results.json']));
  assert.throws(() => parseArgs([...args, '--cases', 'costly-recall,costly-recall']));
  assert.throws(() => parseArgs([...args, '--cases', 'unknown']));
  assert.throws(() => parseArgs([...args, '--max-cases', '100']));
});
test('memory-eval discovers an import-only peer SDK without an environment override', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-eval-peer-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const relative of ['scripts', 'eval', 'node_modules/@earendil-works/pi-coding-agent/dist']) fs.mkdirSync(path.join(root, relative), { recursive: true });
  for (const relative of ['scripts/memory-eval.mjs', 'eval/cases.mjs', 'eval/grading.mjs']) fs.copyFileSync(new URL(`../${relative}`, import.meta.url), path.join(root, relative));
  const peer = path.join(root, 'node_modules/@earendil-works/pi-coding-agent');
  fs.writeFileSync(path.join(peer, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-coding-agent', type: 'module', exports: { '.': { import: './dist/index.js' } } }));
  fs.writeFileSync(path.join(peer, 'dist/index.js'), 'export {};\n');
  const env = { ...process.env }; delete env.PI_MEMORY_TEST_HOST;
  const runner = pathToFileURL(path.join(root, 'scripts/memory-eval.mjs')).href;
  const value = execFileSync(process.execPath, ['--input-type=module', '-e', `const {defaultHost}=await import(${JSON.stringify(runner)});console.log(JSON.stringify(defaultHost??null));`], { env, cwd: root, encoding: 'utf8' });
  assert.equal(JSON.parse(value), path.join(peer, 'dist/index.js'));
});
test('memory-eval resume preserves model and refuses provider failure retries', () => {
  const prior = { kind: 'live-model-routing-smoke', requestedModel: { provider: 'p', model: 'm' }, startedAt: new Date().toISOString(), cases: [{ completed: true, usage: { observedTokens: 20 } }], stopped: null };
  assert.equal(validateResume(prior, { provider: 'p', model: 'm' }), prior);
  assert.throws(() => validateResume(prior, { provider: 'p', model: 'other' }));
  assert.throws(() => validateResume({ ...prior, stopped: 'provider-failure' }, { provider: 'p', model: 'm' }));
  assert.throws(() => validateResume({ ...prior, cases: [{ failure: '401', completed: false }] }, { provider: 'p', model: 'm' }));
  assert.throws(() => parseArgs(['--resume', '--out', '/tmp/test.json']));
});
test('memory-eval actual SDK registered search yields labeled lexical retrieval without provider calls', { timeout: 35000 }, async () => {
  const report = await runChild({ retrieval: true }, 30000);
  try {
    assert.equal(report.failure, undefined);
    assert.equal(report.kind, 'deterministic-retrieval-not-model-behavior');
    assert.deepEqual(report.controls, { cacheWarming: 'off', providerMaxRetries: 0 });
    assert.equal(report.metrics.labeledQueries, 4);
    assert.equal(report.rows.length, 5);
    assert.ok(report.rows.every(row => row.backend === 'lexical' && row.relevanceRecorded));
    assert.equal(report.telemetry.labeledSearches, 4);
    assert.equal(report.telemetry.recall, report.metrics.microRecallAtK);
    assert.ok(report.safety.every(check => check.passed));
    for (const relative of ['.project-memory/.qmd', '.project-memory/qmd-state/service.json', '.project-memory/qmd-state/trusted.json']) assert.equal(fs.existsSync(path.join(report.fixtureRoot, relative)), false);
    assert.equal(fs.existsSync(new URL('../.pi', import.meta.url)), false);
  } finally { if (report.fixtureRoot) fs.rmSync(report.fixtureRoot, { recursive: true, force: true }); }
});
