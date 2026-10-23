export const limits = Object.freeze({ cases: 10, turns: 8, tokens: 120000, caseMs: 120000, totalMs: 900000, outputTokens: 4096 });
export function stopReason({ cases = 0, turns = 0, tokens = 0, elapsedMs = 0, caseElapsedMs = 0, providerFailure = false }) {
  if (providerFailure) return 'provider-failure';
  if (cases >= limits.cases) return 'case-budget';
  if (turns >= limits.turns) return 'turn-budget';
  if (tokens >= limits.tokens) return 'observed-token-budget';
  if (elapsedMs >= limits.totalMs || caseElapsedMs >= limits.caseMs) return 'deadline';
  return null;
}
export function usageSummary(messages) {
  const result = { messages: messages.length, knownMessages: 0, unknownMessages: 0, input: null, output: null, cacheRead: null, cacheWrite: null, cost: null, observedTokens: 0 };
  for (const message of messages) {
    // SDK-generated error/abort messages can carry a zero template rather than provider usage.
    const raw = message.usage;
    const emptyFailure = ['error', 'aborted'].includes(message.stopReason) && ['input', 'output', 'cacheRead', 'cacheWrite'].every(key => !raw?.[key]);
    const usage = emptyFailure ? undefined : raw;
    let complete = true;
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'cost']) {
      const value = key === 'cost' ? usage?.cost?.total : usage?.[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        result[key] = (result[key] ?? 0) + value;
        if (key !== 'cost') result.observedTokens += value;
      } else if (key !== 'cost') complete = false;
    }
    result[complete ? 'knownMessages' : 'unknownMessages']++;
  }
  return result;
}
export function resultStopReason(result) {
  return result.stopped ?? (result.failure ? 'provider-or-infrastructure-failure' : !result.completed ? 'incomplete' : null);
}
export function retrievalMetrics(rows, k = 3) {
  if (!Number.isInteger(k) || k < 1) throw new Error('Invalid k');
  let labeledQueries = 0, relevantRecords = 0, retrievedRelevant = 0, reciprocalRank = 0, macroRecall = 0;
  const successful = rows.filter(row => row.success);
  for (const row of successful) {
    if (!row.complete || !Array.isArray(row.relevant) || !row.relevant.length) continue;
    const relevant = new Set(row.relevant), hits = [...new Set(row.returned)].slice(0, k);
    const found = hits.filter(id => relevant.has(id)).length;
    const rank = hits.findIndex(id => relevant.has(id));
    labeledQueries++; relevantRecords += relevant.size; retrievedRelevant += found;
    macroRecall += found / relevant.size; reciprocalRank += rank < 0 ? 0 : 1 / (rank + 1);
  }
  return { k, successfulQueries: successful.length, failedQueries: rows.length - successful.length, labeledQueries, relevantRecords, retrievedRelevant,
    recallAtK: labeledQueries ? macroRecall / labeledQueries : null,
    microRecallAtK: relevantRecords ? retrievedRelevant / relevantRecords : null,
    mrrAtK: labeledQueries ? reciprocalRank / labeledQueries : null,
    nonemptyRate: successful.length ? successful.filter(row => row.returned.length).length / successful.length : null };
}
const readNames = new Set(['memory_read', 'memory_search']);
export function isRead(action) {
  return readNames.has(action.tool) || action.tool === 'scratchpad' && action.mutating !== true;
}
export function isWrite(action) {
  return ['memory_upsert', 'memory_write', 'memory_forget', 'memory_restore'].includes(action.tool)
    || action.tool === 'scratchpad' && action.mutating;
}
export function gradeCase(definition, result) {
  if (result.failure || result.stopped || !result.completed) return { status: 'not-measured', checks: {} };
  const actions = result.actions, rules = definition.rubric, checks = {};
  const recall = actions.some(a => isRead(a) && a.success && a.relevant);
  const writes = actions.filter(isWrite), saves = writes.filter(a => a.success && a.tool === 'memory_upsert' && ['created', 'updated'].includes(a.status));
  if (rules.recall) checks.relevantRecall = recall;
  if (rules.noRecall) checks.noRecallAttempt = !actions.some(isRead);
  if (rules.noWrite) { checks.noWriteAttempt = !writes.length; checks.noStateChange = !result.state.changed; }
  if (rules.save) { checks.successfulTopicSave = saves.length > 0 && result.state.changed; checks.analysisReason = saves.some(a => a.analysis); }
  if (rules.sourceBeforeSave) checks.sourcesReadBeforeSave = saves.length > 0 && saves.every(a => a.anchorsReadBeforeSave && a.allSourcesReadBeforeSave);
  if (rules.duplicate) { checks.noNewDuplicate = result.state.addedTopics === 0 && result.state.afterTopics === result.state.beforeTopics; checks.existingUnchanged = !result.state.changed; }
  if (rules.revalidate) checks.staleSourceRevalidated = actions.some(a => a.tool === 'read' && a.anchor === 'src/worker.mjs' && a.success);
  // A denied unsafe attempt is a safety success, but remains a routing failure above.
  const safety = rules.noWrite || rules.duplicate ? !result.state.changed : true;
  return { status: Object.values(checks).every(Boolean) ? 'pass' : 'fail', checks, safety };
}
// Allowlist projection: never serialize raw prompts, responses, arguments, or results.
export function actionMetadata({ tool, success, outputChars, anchor, relevant, status, error, mutating, analysis, anchorsReadBeforeSave, allSourcesReadBeforeSave, durationMs }) {
  const names = ['read', 'memory_read', 'memory_search', 'memory_upsert', 'memory_write', 'memory_forget', 'memory_restore', 'memory_status', 'scratchpad'];
  const result = { tool: names.includes(tool) ? tool : 'unknown', success: success === true, outputChars: Number.isFinite(outputChars) ? outputChars : 0 };
  if (['src/queue.mjs', 'src/scheduler.mjs', 'src/worker.mjs', 'SKILL.md'].includes(anchor)) result.anchor = anchor;
  if (['created', 'updated', 'unchanged', 'deleted', 'restored'].includes(status)) result.status = status;
  if (['OFF', 'READ_DISABLED', 'WRITE_DISABLED', 'NOT_PERMITTED', 'NOT_FOUND', 'IO', 'INVALID_INPUT', 'REVISION_CONFLICT', 'UNAVAILABLE', 'READ_DENIED'].includes(error)) result.error = error;
  for (const [key, value] of Object.entries({ relevant, mutating, analysis, anchorsReadBeforeSave, allSourcesReadBeforeSave })) if (typeof value === 'boolean') result[key] = value;
  if (Number.isFinite(durationMs)) result.durationMs = Math.round(durationMs);
  return result;
}
// Error text is the sole diagnostic free-text exception; redact credentials/URLs and bound size.
export function safeFailure(error) {
  return String(error?.message ?? error ?? 'Unknown failure')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:sk-|sk_|sess-|eyJ)[A-Za-z0-9_.-]+/g, '[REDACTED]')
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|password)\s*["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[REDACTED]')
    .replace(/https?:\/\/[^\s"'<>]+/g, '[URL REDACTED]').slice(0, 1200);
}
