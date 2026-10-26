import fs from 'node:fs';
import path from 'node:path';
import { createHmac, randomBytes } from 'node:crypto';
import { DEFAULT_CONFIG, resolveMemoryConfig, _memoryStateIO as io } from './memory-config.mjs';

const DIRECTORY = '.project-memory/diagnostics';
const SALT = `${DIRECTORY}/salt`;
const LOCK = `${DIRECTORY}/.lock`;
export const TELEMETRY_SCHEMA_VERSION = 1;
const MAX_EVENT_BYTES = 4096;
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const label = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,95}$/.test(value);
const count = value => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 1e12);
const measurement = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e12);
const choice = values => value => values.includes(value);
const outcome = choice(['success', 'empty', 'skipped', 'error', 'created', 'updated', 'unchanged', 'duplicate', 'deleted', 'restored']);
const reason = choice(['requested', 'context-sufficient', 'disabled', 'off', 'read-disabled', 'write-disabled', 'not-permitted', 'unavailable', 'invalid', 'conflict', 'not-found', 'stale', 'budget', 'no-results', 'explicit', 'analysis', 'automatic', 'io', 'busy', 'unknown']);
const identity = { sessionIdHash: digest, pluginVersion: label, policyVersion: label };
const hashes = value => Array.isArray(value) && value.length <= 50 && value.every(digest) && new Set(value).size === value.length;
const common = { ...identity, outcome, reason, latencyMs: measurement };
const SCHEMAS = {
  search: { ...common, queryHash: digest, searchIdHash: digest, mode: choice(['manual', 'code-research', 'off']), requestedMode: choice(['keyword', 'semantic', 'deep']), backend: choice(['lexical', 'qmd-search', 'qmd-query', 'qmd-vsearch', 'none']), limit: value => value === null || (Number.isSafeInteger(value) && value >= 0 && value <= 50), resultIdHashes: hashes, resultCount: count, staleCount: count, outputChars: count, estimatedTokens: count },
  read: { ...common, recordIdHash: digest, searchIdHash: digest, revision: count, outputChars: count, estimatedTokens: count, staleCount: count },
  write: { ...common, recordIdHash: digest, revision: count, inputChars: count, outputChars: count },
  injection: { ...common, chars: count, estimatedTokens: count },
  usage: { ...identity, model: label, provider: label, messageIdHash: digest, measurement: choice(['host-reported', 'unknown-zero-error', 'unavailable']), input: count, output: count, cacheRead: count, cacheWrite: count, cost: measurement },
  relevance: { ...identity, searchIdHash: digest, relevantIdHashes: hashes, labelsComplete: value => typeof value === 'boolean' },
};
// Public field names are exported for runtime integration; validators remain private.
export const TELEMETRY_EVENT_FIELDS = Object.freeze(Object.fromEntries(Object.entries(SCHEMAS).map(([type, fields]) => [type, Object.freeze(Object.keys(fields))])));
function sanitize(type, data) {
  const schema = SCHEMAS[type];
  if (typeof type !== 'string' || !Object.hasOwn(SCHEMAS, type) || !data || typeof data !== 'object' || Array.isArray(data)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(data))) throw new Error('Invalid event');
  const clean = {};
  for (const [field, validate] of Object.entries(schema)) {
    if (!Object.hasOwn(data, field)) continue;
    const value = data[field];
    if (!validate(value)) throw new Error('Invalid event field');
    clean[field] = Array.isArray(value) ? [...value] : value;
  }
  if (type === 'usage' && !clean.messageIdHash) throw new Error('Usage requires message identity');
  if (type === 'usage' && ['unknown-zero-error', 'unavailable'].includes(clean.measurement)
    && ['input', 'output', 'cacheRead', 'cacheWrite', 'cost'].some(key => clean[key] != null)) {
    throw new Error('Unmeasured usage cannot carry measured counters');
  }
  if (type === 'relevance' && (!clean.sessionIdHash || !clean.searchIdHash || !clean.relevantIdHashes || typeof clean.labelsComplete !== 'boolean')) throw new Error('Relevance requires correlated explicit labels');
  return clean;
}
function logPath(index) { return `${DIRECTORY}/events${index ? `.${index}` : ''}.jsonl`; }
function preflight(root) {
  io.inspect(root, DIRECTORY, true); io.inspect(root, SALT);
  for (let index = 0; index < 10; index++) io.inspect(root, logPath(index));
}
function prepare(root) {
  preflight(root);
  io.ensureDirectory(root, DIRECTORY);
  fs.chmodSync(path.join(root, DIRECTORY), 0o700);
}
function remove(root, relative) {
  if (io.inspect(root, relative)) fs.unlinkSync(path.join(root, relative));
}
function salt(root) {
  let value = io.readFile(root, SALT, 65);
  if (value === null) {
    value = `${randomBytes(32).toString('hex')}\n`;
    io.atomicWrite(root, SALT, value);
  }
  if (!/^[a-f0-9]{64}\n$/.test(value)) throw new Error('Invalid salt');
  return Buffer.from(value.trim(), 'hex');
}
function readEvents(root, options) {
  const events = [];
  let invalidEvents = 0;
  for (let index = options.maxFiles - 1; index >= 0; index--) {
    const text = io.readFile(root, logPath(index), options.maxBytes);
    if (text === null) continue;
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        if (Buffer.byteLength(line) > MAX_EVENT_BYTES) throw new Error('Oversized event');
        const event = JSON.parse(line);
        if (event.version !== TELEMETRY_SCHEMA_VERSION || typeof event.at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(event.at)) throw new Error('Invalid envelope');
        events.push({ type: event.type, data: sanitize(event.type, event.data) });
      } catch { invalidEvents++; }
    }
  }
  return { events, invalidEvents };
}
function aggregate({ events, invalidEvents }) {
  const counts = Object.fromEntries(Object.keys(SCHEMAS).map(type => [type, 0]));
  const outcomes = {}, reasons = {};
  const estimates = {};
  const latency = {};
  for (const type of Object.keys(SCHEMAS)) {
    estimates[type] = {};
    for (const field of ['chars', 'inputChars', 'outputChars', 'estimatedTokens'].filter(field => Object.hasOwn(SCHEMAS[type], field))) estimates[type][field] = { total: null, known: 0, unknown: 0 };
    if (Object.hasOwn(SCHEMAS[type], 'latencyMs')) latency[type] = { totalMs: null, samples: 0, unknown: 0, meanMs: null };
  }
  const actualUsage = { messages: 0, duplicateMessages: 0, byMeasurement: {}, byModel: [] };
  const groups = new Map(), seen = new Set(), searches = new Set(), followed = new Set();
  const searchResults = new Map(), relevanceLabels = new Map(), backends = {}, modes = {}, requestedModes = {};
  const correlation = data => JSON.stringify([data.sessionIdHash ?? null, data.searchIdHash]);
  let successfulSearches = 0, searchesWithResults = 0, unknownResultSearches = 0, linkedReads = 0;
  function sum(target, value) {
    if (value === undefined || value === null) target.unknown++;
    else { target.total = (target.total ?? 0) + value; target.known++; }
  }
  for (const { type, data } of events) {
    counts[type]++;
    if (data.outcome) outcomes[data.outcome] = (outcomes[data.outcome] ?? 0) + 1;
    if (data.reason) reasons[data.reason] = (reasons[data.reason] ?? 0) + 1;
    for (const [field, target] of Object.entries(estimates[type])) sum(target, data[field]);
    if (latency[type]) {
      const target = latency[type];
      if (data.latencyMs === undefined || data.latencyMs === null) target.unknown++;
      else { target.totalMs = (target.totalMs ?? 0) + data.latencyMs; target.samples++; }
    }
    if (type === 'search') {
      const key = correlation(data);
      if (data.searchIdHash) {
        searches.add(key);
        // Conflicting duplicate search identities cannot support a truthful recall measurement.
        const result = ['success', 'empty'].includes(data.outcome) && data.resultIdHashes && data.resultCount === data.resultIdHashes.length ? data.resultIdHashes : null;
        if (!searchResults.has(key)) searchResults.set(key, result);
        else if (JSON.stringify(searchResults.get(key)) !== JSON.stringify(result)) searchResults.set(key, null);
      }
      backends[data.backend ?? 'unknown'] = (backends[data.backend ?? 'unknown'] ?? 0) + 1;
      modes[data.mode ?? 'unknown'] = (modes[data.mode ?? 'unknown'] ?? 0) + 1;
      requestedModes[data.requestedMode ?? 'unknown'] = (requestedModes[data.requestedMode ?? 'unknown'] ?? 0) + 1;
      if (data.outcome === 'success' || data.outcome === 'empty') {
        successfulSearches++;
        if (data.resultCount == null) unknownResultSearches++;
        else if (data.resultCount > 0) searchesWithResults++;
      }
    }
    if (type === 'relevance') relevanceLabels.set(correlation(data), data);
    if (type === 'usage') {
      const messageKey = JSON.stringify([data.sessionIdHash ?? null, data.messageIdHash]);
      if (seen.has(messageKey)) { actualUsage.duplicateMessages++; continue; }
      seen.add(messageKey); actualUsage.messages++;
      const measurementKind = data.measurement ?? 'unspecified';
      actualUsage.byMeasurement[measurementKind] = (actualUsage.byMeasurement[measurementKind] ?? 0) + 1;
      const key = JSON.stringify([data.provider ?? null, data.model ?? null]);
      if (!groups.has(key)) {
        const group = { provider: data.provider ?? null, model: data.model ?? null, messages: 0 };
        for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'cost']) group[field] = { total: null, known: 0, unknown: 0 };
        groups.set(key, group);
      }
      const group = groups.get(key); group.messages++;
      for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'cost']) sum(group[field], data[field]);
    }
  }
  for (const { type, data } of events) {
    if (type === 'read' && data.outcome === 'success' && searches.has(correlation(data))) { linkedReads++; followed.add(correlation(data)); }
  }
  let labeledSearches = 0, labeledRelevantRecords = 0, retrievedRelevantRecords = 0;
  for (const [key, labels] of relevanceLabels) {
    const results = searchResults.get(key);
    if (!labels.labelsComplete || !labels.relevantIdHashes.length || !results) continue;
    labeledSearches++; labeledRelevantRecords += labels.relevantIdHashes.length;
    const retrieved = new Set(results);
    retrievedRelevantRecords += labels.relevantIdHashes.filter(id => retrieved.has(id)).length;
  }
  for (const target of Object.values(latency)) if (target.samples) target.meanMs = target.totalMs / target.samples;
  actualUsage.byModel = [...groups.values()];
  return {
    status: 'ok', scope: 'retained-events-only', counts, outcomes, reasons, invalidEvents,
    estimates, latency, actualUsage,
    retrieval: { backends, modes, requestedModes, successfulSearches, searchesWithResults, unknownResultSearches,
      nonemptyResultRate: successfulSearches > unknownResultSearches ? searchesWithResults / (successfulSearches - unknownResultSearches) : null,
      correlatedSearches: searches.size, searchesWithSuccessfulRead: followed.size, linkedReads,
      followUpReadRate: searches.size ? followed.size / searches.size : null,
      labeledSearches, labeledRelevantRecords, retrievedRelevantRecords,
      recall: labeledRelevantRecords ? retrievedRelevantRecords / labeledRelevantRecords : null,
      recallReason: labeledRelevantRecords ? 'explicit-complete-relevance-labels' : 'requires-labeled-relevant-records' },
  };
}

export function createMemoryTelemetry(root, config = DEFAULT_CONFIG) {
  const isOptions = config && typeof config === 'object' && Object.keys(config).every(key => ['enabled', 'maxBytes', 'maxFiles'].includes(key));
  const resolved = resolveMemoryConfig(isOptions ? { diagnostics: config } : config);
  const options = resolved.diagnostics;
  const health = { scope: 'instance', droppedWrites: 0, rotationErrors: 0 };
  const snapshot = () => ({ ...lastStatus, health: { ...health } });
  let lastStatus = { status: options.enabled ? 'ready' : 'disabled', failures: 0 };
  function fail(code, error) {
    lastStatus = { status: 'error', code: error?.code === 'MEMORY_BUSY' ? 'busy' : code, failures: lastStatus.failures + 1 };
    return snapshot();
  }
  function success(status) { lastStatus = { status, failures: lastStatus.failures }; return snapshot(); }
  function locked(operation) { prepare(root); return io.lock(root, LOCK, operation); }
  return Object.freeze({
    hash(value) {
      if (!options.enabled) return null;
      if (typeof value !== 'string' || Buffer.byteLength(value) > 65536) { fail('invalid_hash_input'); return null; }
      try {
        const result = locked(() => createHmac('sha256', salt(root)).update(value, 'utf8').digest('hex'));
        success('ready'); return result;
      } catch (error) { fail('state_io', error); return null; }
    },
    record(type, data = {}) {
      if (!options.enabled) return success('disabled');
      let line, rotating = false;
      try {
        line = `${JSON.stringify({ version: TELEMETRY_SCHEMA_VERSION, at: new Date().toISOString(), type, data: sanitize(type, data) })}\n`;
        if (Buffer.byteLength(line) > MAX_EVENT_BYTES) throw new Error('Event too large');
      } catch { health.droppedWrites++; return fail('invalid_event'); }
      try {
        locked(() => {
          preflight(root);
          rotating = true;
          // Only fixed owned filenames are retained/removed; never sweep arbitrary files.
          for (let index = options.maxFiles; index < 10; index++) remove(root, logPath(index));
          for (let index = 0; index < options.maxFiles; index++) {
            const stat = io.inspect(root, logPath(index));
            if (stat && stat.size > options.maxBytes) remove(root, logPath(index));
          }
          rotating = false;
          const existing = io.readFile(root, logPath(0), options.maxBytes) ?? '';
          if (Buffer.byteLength(existing) + Buffer.byteLength(line) > options.maxBytes) {
            rotating = true;
            remove(root, logPath(options.maxFiles - 1));
            for (let index = options.maxFiles - 2; index >= 0; index--) {
              if (io.inspect(root, logPath(index))) {
                io.inspect(root, logPath(index + 1));
                fs.renameSync(path.join(root, logPath(index)), path.join(root, logPath(index + 1)));
              }
            }
            rotating = false;
            io.atomicWrite(root, logPath(0), line);
          } else io.atomicWrite(root, logPath(0), existing + line);
        });
        return success('recorded');
      } catch (error) {
        health.droppedWrites++;
        if (rotating) health.rotationErrors++;
        return fail('state_io', error);
      }
    },
    report() {
      if (!options.enabled) return { status: 'disabled' };
      try {
        if (!io.inspect(root, DIRECTORY, true)) return { ...aggregate({ events: [], invalidEvents: 0 }), diagnosticStatus: success('ready') };
        const result = io.lock(root, LOCK, () => { preflight(root); return aggregate(readEvents(root, options)); });
        return { ...result, diagnosticStatus: success('ready') };
      } catch (error) { return fail('state_io', error); }
    },
    status() { return snapshot(); },
  });
}
