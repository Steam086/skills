// One owned fixture per process: the production extension binds its environment at import time.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { sources, anchors, cancellationTopic, distractors, cases, retrievalQueries } from './cases.mjs';
import { actionMetadata, gradeCase, limits, retrievalMetrics, safeFailure, stopReason, usageSummary } from './grading.mjs';
import { saveMemoryConfig } from '../lib/memory-config.mjs';
import { createMemoryStore } from '../lib/memory-store.mjs';
import { createMemoryTelemetry } from '../lib/memory-telemetry.mjs';
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cwd = process.cwd();
const options = JSON.parse(process.env.PI_MEMORY_EVAL_OPTIONS);
const definition = cases.find(c => c.id === options.caseId);
const host = await import(pathToFileURL(process.env.PI_MEMORY_TEST_HOST));
const store = createMemoryStore(cwd);
for (const [relative, text] of Object.entries(sources)) {
  fs.mkdirSync(path.dirname(path.join(cwd, relative)), { recursive: true });
  fs.writeFileSync(path.join(cwd, relative), text);
}
for (const topic of distractors) store.upsert(topic);
if (definition?.seed || options.retrieval) store.upsert(cancellationTopic);
if (definition?.stale) fs.writeFileSync(path.join(cwd, 'src/worker.mjs'), sources['src/worker.mjs'].replace('ticket.lease.release()', "ticket.lease.revoke('cancelled-or-finished')"));
saveMemoryConfig(cwd, { mode: definition?.mode ?? 'manual', autoIndex: false, warmup: false, diagnostics: { enabled: true } });
const settingsManager = host.SettingsManager.inMemory({ packages: [], extensions: [], compaction: { enabled: false }, retry: { enabled: false, provider: { maxRetries: 0 } }, cacheWarming: 'off' });
const loader = new host.DefaultResourceLoader({ cwd, agentDir: path.join(cwd, 'agent'), settingsManager,
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  additionalExtensionPaths: [pkg], additionalSkillPaths: [path.join(pkg, 'SKILL.md')],
});
await loader.reload();
const loaded = loader.getExtensions();
if (loaded.errors.length || loaded.extensions.length !== 1) throw new Error('Isolated memory extension failed to load');
if (!loader.getSkills().skills.some(s => s.name === 'project-memory')) throw new Error('Memory skill not discoverable');
const extension = loaded.extensions[0];
const manager = host.SessionManager.inMemory(cwd);
const ctx = { cwd, hasUI: false, sessionManager: manager };
const invoke = async (name, params) => {
  const value = await extension.tools.get(name).definition.execute('fixture', params, undefined, undefined, ctx);
  return { success: !value.isError, ...JSON.parse(value.content[0].text) };
};
function snapshot() {
  const root = path.join(cwd, '.project-memory');
  const entries = fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).filter(p => fs.lstatSync(path.join(root, p)).isFile()).sort() : [];
  return { hash: createHash('sha256').update(entries.map(p => p + '\0' + fs.readFileSync(path.join(root, p), 'utf8')).join('\0')).digest('hex'), ids: store.list({ limit: 100, maxChars: 24000 }).records.map(r => r.id) };
}
function stateChange(before, after) { return { changed: before.hash !== after.hash, beforeTopics: before.ids.length, afterTopics: after.ids.length, addedTopics: after.ids.filter(id => !before.ids.includes(id)).length }; }
async function retrieval() {
  const telemetry = createMemoryTelemetry(cwd), rows = [];
  for (const query of retrievalQueries) {
    const found = await invoke('memory_search', { query: query.query, mode: 'keyword', limit: 3 });
    const label = telemetry.record('relevance', {
      sessionIdHash: telemetry.hash(`session:${manager.getSessionId()}`),
      searchIdHash: telemetry.hash(`search:${manager.getSessionId()}:${found.searchId}`),
      relevantIdHashes: query.relevant.map(id => telemetry.hash(`record:${id}`)), labelsComplete: query.complete,
    });
    rows.push({ id: query.id, relevant: query.relevant, complete: query.complete, success: found.success, returned: (found.results ?? []).map(r => r.id), backend: found.backend, relevanceRecorded: label.status === 'recorded' });
  }
  const safety = [];
  for (const [command, args, tool, params, expected] of [
    ['memory-access', 'write off', 'memory_upsert', { ...cancellationTopic, reason: 'explicit' }, 'WRITE_DISABLED'],
    ['memory-access', 'read off', 'memory_read', { id: cancellationTopic.id }, 'READ_DISABLED'],
    ['memory-mode', 'off', 'memory_search', { query: 'cancellation' }, 'OFF'],
  ]) {
    await extension.commands.get(command).handler(args, ctx);
    const before = snapshot(), result = await invoke(tool, params);
    safety.push({ expected, actual: result.error, passed: !result.success && result.error === expected && !stateChange(before, snapshot()).changed });
  }
  return { kind: 'deterministic-retrieval-not-model-behavior', completed: true, rows, metrics: retrievalMetrics(rows), safety,
    controls: { cacheWarming: settingsManager.getCacheWarmingMode(), providerMaxRetries: settingsManager.getProviderRetrySettings().maxRetries },
    telemetry: telemetry.report().retrieval };
}
async function live() {
  const start = Date.now(), actions = [], pending = new Map(), sourceReads = new Set(), messages = [];
  let requests = 0, localBudgetMessages = 0, failure = null, stopped = null, session;
  const before = snapshot();
  const runtime = await host.ModelRuntime.create({ allowModelNetwork: false });
  const model = runtime.getModel(options.provider, options.model);
  if (!model) return { id: definition.id, failure: `Configured model not found: ${options.provider}/${options.model}`, completed: false, actions, rubric: { status: 'not-measured', checks: {} } };
  // SDK owns configured credentials; do not inspect auth values or model endpoint/header objects.
  if (!runtime.hasConfiguredAuth(options.provider)) return { id: definition.id, failure: `No configured authentication for ${options.provider}`, completed: false, actions, rubric: { status: 'not-measured', checks: {} } };
  const originalStream = runtime.streamSimple.bind(runtime);
  runtime.streamSimple = (selected, context, requestOptions) => {
    stopped = stopReason({ turns: requests, tokens: options.observedTokens + usageSummary(messages).observedTokens, caseElapsedMs: Date.now() - start, elapsedMs: Date.now() - options.startedAt, providerFailure: !!failure });
    if (stopped) throw new Error(`Evaluation stopped: ${stopped}`);
    if (selected.provider !== options.provider || selected.id !== options.model) throw new Error('Evaluation refuses a model switch');
    requests++;
    return originalStream(selected, context, { ...requestOptions, maxTokens: limits.outputTokens, maxRetries: 0 });
  };
  const fixtureRead = {
    name: 'read', label: 'Read', description: 'Read a source file in this fixture repository, or the discovered project-memory SKILL.md. Accepts path and optional one-based offset/line limit.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, offset: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1 } }, required: ['path'], additionalProperties: false },
    async execute(_id, args) {
      const absolute = path.resolve(cwd, args.path), relative = path.relative(cwd, absolute);
      if (!(Object.hasOwn(sources, relative) || absolute === path.join(pkg, 'SKILL.md'))) return { isError: true, content: [{ type: 'text', text: 'READ_DENIED' }], details: {} };
      const text = fs.readFileSync(absolute, 'utf8').split('\n').slice((args.offset ?? 1) - 1, (args.offset ?? 1) - 1 + (args.limit ?? 200)).join('\n');
      return { content: [{ type: 'text', text }], details: {} };
    },
  };
  const created = await host.createAgentSession({ cwd, agentDir: path.join(cwd, 'agent'), modelRuntime: runtime, model,
    thinkingLevel: 'low', settingsManager, resourceLoader: loader, sessionManager: manager,
    tools: ['read', ...extension.tools.keys()], customTools: [fixtureRead],
  });
  session = created.session;
  if (created.modelFallbackMessage || session.model?.provider !== options.provider || session.model?.id !== options.model) throw new Error('Evaluation refuses model fallback');
  await session.bindExtensions({});
  const activeTools = session.getActiveToolNames();
  if (activeTools.some(name => !['read', ...extension.tools.keys()].includes(name))) throw new Error('Unexpected active tool');
  session.subscribe(event => {
    if (event.type === 'tool_execution_start') pending.set(event.toolCallId, { tool: event.toolName, args: event.args, sourceReads: new Set(sourceReads) });
    if (event.type === 'tool_execution_end') {
      const call = pending.get(event.toolCallId) ?? { tool: event.toolName, args: {}, sourceReads: new Set() };
      const { tool, args } = call;
      let data = {}; const text = event.result?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') ?? '';
      try { data = JSON.parse(text); } catch { /* Source content is never stored in diagnostics. */ }
      const success = !event.isError && !event.result?.isError;
      const relative = tool === 'read' ? path.relative(cwd, path.resolve(cwd, args.path ?? '')) : undefined;
      const anchor = Object.hasOwn(sources, relative ?? '') ? relative : tool === 'read' && path.resolve(cwd, args.path ?? '') === path.join(pkg, 'SKILL.md') ? 'SKILL.md' : undefined;
      if (success && anchor && anchor !== 'SKILL.md') sourceReads.add(anchor);
      actions.push(actionMetadata({ tool, success, outputChars: text.length, anchor,
        relevant: tool === 'memory_read' ? args.id === cancellationTopic.id : tool === 'memory_search' ? data.results?.some(r => r.id === cancellationTopic.id) === true : undefined,
        status: data.status, error: data.error ?? (text === 'READ_DENIED' ? text : data.unavailable ? 'UNAVAILABLE' : undefined),
        mutating: tool === 'scratchpad' ? args.action !== 'list' : undefined,
        analysis: tool === 'memory_upsert' ? args.reason === 'analysis' : undefined,
        anchorsReadBeforeSave: tool === 'memory_upsert' ? Array.isArray(args.anchors) && args.anchors.length > 0 && args.anchors.every(a => call.sourceReads.has(a.path)) : undefined,
        allSourcesReadBeforeSave: tool === 'memory_upsert' ? anchors.every(a => call.sourceReads.has(a.path)) : undefined,
        durationMs: event.durationMs,
      }));
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      if (stopped && event.message.stopReason === 'error' && event.message.errorMessage === `Evaluation stopped: ${stopped}`) localBudgetMessages++;
      else {
        messages.push(event.message);
        if (event.message.stopReason === 'error') failure = safeFailure(event.message.errorMessage ?? 'Provider returned an error');
      }
    }
  });
  const timer = setTimeout(() => { stopped = 'deadline'; void session.abort(); }, Math.min(limits.caseMs, limits.totalMs - (Date.now() - options.startedAt)));
  try { await session.prompt(definition.prompt); }
  catch (error) { if (!stopped) failure = safeFailure(error); }
  finally { clearTimeout(timer); }
  const answer = session.getLastAssistantText() ?? '';
  const result = { id: definition.id, mode: definition.mode, provider: session.model?.provider, model: session.model?.id,
    settings: { thinkingLevel: session.thinkingLevel, temperature: 'provider-default-not-overridden', maxOutputTokens: limits.outputTokens, repeat: 1, retry: false, providerMaxRetries: 0, cacheWarming: settingsManager.getCacheWarmingMode() },
    activeTools, skillDiscoverable: true, durationMs: Date.now() - start, requests, localBudgetMessages, completed: !failure && !stopped && messages.some(m => m.stopReason === 'stop'),
    failure, stopped, actions, usage: usageSummary(messages), outputChars: answer.length,
    correctness: { method: 'substring-heuristic-not-semantic-proof', facts: definition.expectedFacts.length, matched: definition.expectedFacts.filter(f => answer.toLowerCase().includes(f)).length },
    state: stateChange(before, snapshot()),
  };
  result.rubric = gradeCase(definition, result);
  session.dispose();
  return result;
}
try {
  const result = options.retrieval ? await retrieval() : await live();
  process.send?.(result);
} catch (error) {
  process.send?.({ id: options.caseId, failure: safeFailure(error), completed: false, rubric: { status: 'not-measured', checks: {} } });
}
process.disconnect?.();
