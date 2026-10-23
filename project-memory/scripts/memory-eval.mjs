#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cases } from '../eval/cases.mjs';
import { limits, stopReason, resultStopReason } from '../eval/grading.mjs';
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function installedHost() {
  try { return fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent')); } catch {}
  try {
    const globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8', timeout: 10000 }).trim();
    const entry = path.join(globalRoot, '@earendil-works/pi-coding-agent/dist/index.js');
    if (fs.existsSync(entry)) return entry;
  } catch {}
  return undefined;
}
export const defaultHost = process.env.PI_MEMORY_TEST_HOST || installedHost();
export function parseArgs(args) {
  const options = { live: false, resume: false, provider: 'openai-codex', model: 'gpt-6-astra', caseIds: cases.slice(0, 2).map(c => c.id), out: null };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--live' || flag === '--resume') { options[flag.slice(2)] = true; continue; }
    if (!['--provider', '--model', '--cases', '--out'].includes(flag) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: memory-eval.mjs [--live [--resume]] [--provider NAME --model ID] [--cases id,id] --out /tmp/result.json');
    const value = args[++i];
    if (flag === '--cases') options.caseIds = value === 'all' ? cases.map(c => c.id) : value.split(',');
    else options[flag.slice(2)] = value;
  }
  if (!options.out) throw new Error('--out is required; use a location outside this package');
  if (options.resume && !options.live) throw new Error('--resume requires --live');
  const output = path.resolve(options.out), relative = path.relative(pkg, output);
  if (!relative.startsWith('..' + path.sep) && relative !== '..') throw new Error('Evaluation artifacts must be outside the package');
  if (!options.caseIds.length || options.caseIds.length > limits.cases || new Set(options.caseIds).size !== options.caseIds.length || options.caseIds.some(id => !cases.some(c => c.id === id))) throw new Error('Invalid or unbounded case selection');
  for (const key of ['provider', 'model']) if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,95}$/.test(options[key])) throw new Error('Invalid provider/model identifier');
  return { ...options, out: output };
}
export async function runChild(options, timeoutMs = limits.caseMs) {
  const host = process.env.PI_MEMORY_TEST_HOST || defaultHost;
  if (!host || !fs.existsSync(host)) return { failure: 'Pi SDK not found; set PI_MEMORY_TEST_HOST to its dist/index.js', completed: false };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'project-memory-eval-'));
  return await new Promise(resolve => {
    let result = null;
    const child = fork(path.join(pkg, 'eval/sdk-case.mjs'), [], { cwd: root, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, PI_MEMORY_PROJECT_ROOT: root, PI_MEMORY_TEST_HOST: host, PI_MEMORY_EVAL_OPTIONS: JSON.stringify(options) },
    });
    const timer = setTimeout(() => { result = { id: options.caseId, stopped: 'hard-deadline', completed: false, rubric: { status: 'not-measured', checks: {} } }; child.kill('SIGKILL'); }, timeoutMs);
    child.on('message', value => { result = value; child.kill('SIGTERM'); });
    child.on('error', () => { result = { failure: 'Child process could not start', completed: false }; });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ ...(result ?? { failure: `Child exited without result (code=${code}, signal=${signal})`, completed: false }), fixtureRoot: root });
    });
  });
}
export function validateResume(previous, options) {
  if (previous.kind !== 'live-model-routing-smoke' || previous.stopped || previous.cases.some(c => c.failure || c.stopped || !c.completed)) throw new Error('Cannot resume a failed or stopped live run');
  if (previous.requestedModel.provider !== options.provider || previous.requestedModel.model !== options.model) throw new Error('Cannot change provider/model on resume');
  if (!Number.isFinite(Date.parse(previous.startedAt)) || previous.cases.length > limits.cases || previous.cases.some(c => !c.usage)) throw new Error('Invalid prior live budget evidence');
  return previous;
}
export function evaluationFailed(report) {
  return Boolean(report.stopped || report.outcomes?.fail || (report.retrieval && resultStopReason(report.retrieval)));
}
export async function evaluate(options, { childRunner = runChild } = {}) {
  if (!options.resume && fs.existsSync(options.out)) throw new Error('Refusing to overwrite existing evidence; use a new output path or --live --resume');
  const previous = options.resume ? validateResume(JSON.parse(fs.readFileSync(options.out, 'utf8')), options) : null;
  const startedAt = previous ? Date.parse(previous.startedAt) : Date.now();
  const report = previous ?? { version: 1, kind: options.live ? 'live-model-routing-smoke' : 'deterministic-retrieval-not-model-behavior',
    host: process.env.PI_MEMORY_TEST_HOST || defaultHost, startedAt: new Date(startedAt).toISOString(), limits,
    requestedModel: options.live ? { provider: options.provider, model: options.model } : null,
    cases: [], stopped: null,
    caveats: ['Synthetic fixtures, single repeat; not a product benchmark.', 'Finalized provider usage is full-session usage, not memory-attributable savings.', 'Observed token cap can overshoot by one in-flight request; unknown usage remains bounded by request count and hard deadline.', 'Source reads and verified flags are not semantic verification; correctness matching is heuristic.', 'No QMD index/service: keyword lexical retrieval, not semantic recall.'],
  };
  const persist = () => { fs.mkdirSync(path.dirname(options.out), { recursive: true }); fs.writeFileSync(options.out, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); };
  if (!options.live) {
    report.retrieval = await childRunner({ retrieval: true }, 30000);
    report.stopped = resultStopReason(report.retrieval);
  } else {
    let observedTokens = report.cases.reduce((n, c) => n + (c.usage?.observedTokens ?? 0), 0);
    for (const caseId of options.caseIds.filter(id => !report.cases.some(c => c.id === id))) {
      const reason = stopReason({ cases: report.cases.length, tokens: observedTokens, elapsedMs: Date.now() - startedAt });
      if (reason) { report.stopped = reason; break; }
      const result = await childRunner({ caseId, provider: options.provider, model: options.model, startedAt, observedTokens }, Math.min(limits.caseMs, limits.totalMs - (Date.now() - startedAt)));
      report.cases.push(result);
      observedTokens += result.usage?.observedTokens ?? 0;
      report.stopped = resultStopReason(result);
      persist();
      if (report.stopped) break;
    }
    report.usage = { observedTokens, unknownMessages: report.cases.reduce((n, c) => n + (c.usage?.unknownMessages ?? 0), 0), unmeasuredCases: report.cases.filter(c => !c.usage).length };
    report.outcomes = Object.fromEntries(['pass', 'fail', 'not-measured'].map(status => [status, report.cases.filter(c => c.rubric?.status === status).length]));
    report.notAttempted = options.caseIds.filter(id => !report.cases.some(c => c.id === id));
  }
  report.durationMs = Date.now() - startedAt;
  persist();
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2)), result = await evaluate(options);
    console.log(JSON.stringify({ artifact: options.out, kind: result.kind, outcomes: result.outcomes, retrieval: result.retrieval?.metrics, stopped: result.stopped }));
    if (evaluationFailed(result)) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
