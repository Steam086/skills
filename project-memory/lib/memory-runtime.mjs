import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function fail(code) { const error = new Error(`Project memory: ${code}`); error.code = code; throw error; }
export function integer(value, fallback, min, max) {
  const result = value ?? fallback;
  if (!Number.isSafeInteger(result) || result < min || result > max) fail('INVALID_INPUT');
  return result;
}
export function text(value, max = 24000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_INPUT');
  return value;
}
export function reply(data, budget = 1000) {
  const value = JSON.stringify(data);
  if (value.length > budget) fail('BUDGET_TOO_SMALL');
  return { content: [{ type: 'text', text: value }], details: undefined };
}
export function page(content, metadata, { offset = 0, limit = 6000 } = {}, budget = 6000) {
  integer(offset, 0, 0, 10000000); integer(limit, 6000, 1, 24000);
  let end = Math.min(content.length, offset + limit);
  const result = () => ({ ...metadata, content: content.slice(offset, end), truncated: end < content.length,
    ...(end < content.length ? { nextOffset: end } : {}) });
  while (JSON.stringify(result()).length > budget && end > offset) {
    end = Math.max(offset, end - Math.max(1, Math.ceil((JSON.stringify(result()).length - budget) / 6)));
  }
  if (end <= offset && offset < content.length) fail('BUDGET_TOO_SMALL');
  return result();
}
export function boundedRecords(data, key, budget) {
  if (JSON.stringify(data).length <= budget) return data;
  data.truncated = true;
  const records = data[key];
  let low = 0, high = records.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify({ ...data, [key]: records.slice(0, middle) }).length <= budget) low = middle;
    else high = middle - 1;
  }
  data[key] = records.slice(0, low);
  if (JSON.stringify(data).length > budget) fail('BUDGET_TOO_SMALL');
  return data;
}

// Legacy files use their own serialized RMW lock. Read-only operations never create directories.
export function createLegacyMemory(root, helpers) {
  const maxBytes = 1024 * 1024;
  function inspect(relative, directory = false) {
    let current = root;
    const parts = relative.split('/');
    if (parts.some(p => !p || p === '.' || p === '..')) fail('UNSAFE_PATH');
    let stat;
    for (const [i, part] of parts.entries()) {
      current = path.join(current, part);
      try { stat = fs.lstatSync(current); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
      if (stat.isSymbolicLink() || (i < parts.length - 1 || directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) fail('UNSAFE_PATH');
    }
    return stat;
  }
  function mkdir(relative) {
    let parent = '';
    for (const part of relative.split('/')) {
      parent = parent ? `${parent}/${part}` : part;
      if (!inspect(parent, true)) fs.mkdirSync(path.join(root, parent), { mode: 0o700 });
    }
  }
  function read(relative) {
    const stat = inspect(relative);
    if (!stat) return '';
    if (stat.size > maxBytes) fail('LEGACY_FILE_TOO_LARGE');
    const fd = fs.openSync(path.join(root, relative), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const opened = fs.fstatSync(fd);
      if (!opened.isFile() || opened.nlink !== 1 || opened.ino !== stat.ino || opened.dev !== stat.dev) fail('UNSAFE_PATH');
      const buffer = Buffer.alloc(maxBytes + 1);
      let size = 0, count;
      while (size < buffer.length && (count = fs.readSync(fd, buffer, size, buffer.length - size, null))) size += count;
      if (size > maxBytes) fail('LEGACY_FILE_TOO_LARGE');
      return buffer.subarray(0, size).toString('utf8');
    } finally { fs.closeSync(fd); }
  }
  function write(relative, content) {
    if (Buffer.byteLength(content) > maxBytes) fail('LEGACY_FILE_TOO_LARGE');
    inspect(relative); mkdir(path.posix.dirname(relative));
    const temporary = `${relative}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(path.join(root, temporary), content, { flag: 'wx', mode: 0o600 });
      inspect(relative); fs.renameSync(path.join(root, temporary), path.join(root, relative));
    } finally { if (fs.existsSync(path.join(root, temporary))) fs.unlinkSync(path.join(root, temporary)); }
  }
  function mutate(fn) {
    mkdir('.pi/memory-state');
    const lock = '.pi/memory-state/legacy.lock';
    inspect(lock);
    let fd;
    try { fd = fs.openSync(path.join(root, lock), 'wx', 0o600); }
    catch (e) { if (e.code === 'EEXIST') fail('MEMORY_BUSY'); throw e; }
    try { return fn(); } finally { fs.closeSync(fd); fs.unlinkSync(path.join(root, lock)); }
  }
  function target(params) {
    if (params.target === 'long_term' || params.target === undefined) return '.pi/memory/MEMORY.md';
    if (params.target === 'scratchpad') return '.pi/memory/SCRATCHPAD.md';
    if (params.target !== 'daily') fail('INVALID_INPUT');
    const date = params.date ?? helpers.todayStr();
    if (typeof date !== 'string' || !helpers.isValidDailyDate(date)) fail('INVALID_INPUT');
    return `.pi/memory/daily/${date}.md`;
  }
  function readTarget(params, budget) {
    if (params.target === 'list') {
      const relative = '.pi/memory/daily';
      const files = inspect(relative, true) ? fs.readdirSync(path.join(root, relative)).filter(f => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse() : [];
      for (const file of files) inspect(`${relative}/${file}`);
      const offset = integer(params.offset, 0, 0, 10000000), limit = integer(params.limit, 20, 1, 24000);
      const selected = files.slice(offset, offset + limit);
      const data = boundedRecords({ files: selected, total: files.length, truncated: offset + limit < files.length, nextOffset: offset + selected.length }, 'files', budget);
      if (!data.files.length && offset < files.length) fail('BUDGET_TOO_SMALL');
      data.nextOffset = offset + data.files.length;
      return data;
    }
    const relative = target(params);
    return page(read(relative), { target: params.target ?? 'long_term', freshness: 'unverified' }, params, budget);
  }
  function operation(name, params, sessionId = 'memory') {
    return mutate(() => {
      if (name === 'memory_write') {
        const relative = target(params), content = text(params.content);
        if (!['long_term', 'daily'].includes(params.target) || ![undefined, 'append', 'overwrite'].includes(params.mode)) fail('INVALID_INPUT');
        const old = read(relative);
        const overwrite = params.mode === 'overwrite' && params.target === 'long_term';
        const sid = helpers.shortSessionId(String(sessionId)).replace(/[^a-zA-Z0-9-]/g, '') || 'memory';
        const stamped = `<!-- ${overwrite ? 'last updated: ' : ''}${helpers.nowTimestamp()} [${sid}] -->\n${content}`;
        const next = overwrite ? stamped : old + (old.trim() ? '\n\n' : '') + stamped;
        if (next !== old) write(relative, next);
        return { status: next === old ? 'unchanged' : 'updated', target: params.target };
      }
      if (name === 'scratchpad') {
        const relative = target({ target: 'scratchpad' }), old = read(relative);
        let next;
        if (params.action === 'add') next = helpers.scratchpadAdd(old, text(params.text, 2000), '');
        else if (['done', 'undo'].includes(params.action)) next = helpers.scratchpadToggle(old, text(params.text, 2000), params.action === 'done').content;
        else if (params.action === 'clear_done') next = helpers.scratchpadClearDone(old).content;
        else fail('INVALID_INPUT');
        if (next !== old) write(relative, next);
        return { status: next === old ? 'unchanged' : 'updated', target: 'scratchpad' };
      }
      if (name === 'memory_forget') {
        if (![undefined, 'long_term', 'daily'].includes(params.target)) fail('INVALID_INPUT');
        const relative = target(params), old = read(relative);
        const result = helpers.forgetBlocks(old, text(params.match, 512));
        if (!result.removed.length) return { status: 'unchanged', removed: 0 };
        const recoveryId = randomUUID();
        const record = { version: 1, id: recoveryId, createdAt: new Date().toISOString(), target: params.target ?? 'long_term',
          ...(params.target === 'daily' ? { date: params.date ?? helpers.todayStr() } : {}), removedContent: result.removed };
        write(`.pi/memory/recovery/${recoveryId}.json`, JSON.stringify(record));
        try { write(relative, result.content); } catch { const e = new Error(`Project memory: write failed; recoveryId=${recoveryId}`); e.code = 'IO'; e.recoveryId = recoveryId; throw e; }
        return { status: 'deleted', removed: result.removed.length, recoveryId };
      }
      const id = params.recoveryId;
      if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) fail('INVALID_INPUT');
      const relative = `.pi/memory/recovery/${id}.json`;
      let record;
      try { record = JSON.parse(read(relative)); } catch { fail('INVALID_RECORD'); }
      if (record.version !== 1 || record.id !== id || !['long_term', 'daily'].includes(record.target)
        || (record.target === 'daily' && (typeof record.date !== 'string' || !helpers.isValidDailyDate(record.date)))
        || !Array.isArray(record.removedContent) || !record.removedContent.length || !record.removedContent.every(v => typeof v === 'string')) fail('INVALID_RECORD');
      const destination = target(record), old = read(destination);
      if (record.restoredAt) return { status: 'unchanged', recoveryId: id };
      const missing = record.removedContent.filter(entry => !old.includes(entry));
      if (missing.length) write(destination, old + (old.trim() ? '\n\n' : '') + missing.join('\n\n') + '\n');
      record.restoredAt = new Date().toISOString(); write(relative, JSON.stringify(record));
      return { status: missing.length ? 'restored' : 'unchanged', recoveryId: id };
    });
  }
  function availableTargets() {
    const targets = [];
    if (inspect('.pi/memory/MEMORY.md')) targets.push('long_term');
    if (inspect('.pi/memory/SCRATCHPAD.md')) targets.push('scratchpad');
    const relative = '.pi/memory/daily';
    if (inspect(relative, true)) {
      const directory = fs.opendirSync(path.join(root, relative));
      try {
        let entry;
        while ((entry = directory.readSync())) {
          if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name)) continue;
          if (inspect(`${relative}/${entry.name}`)) { targets.push('daily'); break; }
        }
      } finally { directory.closeSync(); }
    }
    return targets;
  }
  return { read: readTarget, operation, inspect, availableTargets };
}

export function createQmdRuntime(environment, config, { delay = 750 } = {}) {
  let timer, active, warming, generation = 0, chain = Promise.resolve(), health = 'idle';
  const children = new Set();
  function run(file, args, signal, timeout = 120000) {
    if (signal?.aborted) return Promise.reject(Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' }));
    return new Promise((resolve, reject) => {
      const child = childProcess.execFile(file, args, { cwd: environment.root, env: process.env, signal, timeout, maxBuffer: 262144 }, (error, stdout, stderr) => {
        children.delete(child);
        if (error) reject(error); else resolve({ stdout: String(stdout), stderr: String(stderr) });
      });
      children.add(child);
    });
  }
  function available() {
    environment.validateState();
    return ['.qmd/index.yml', '.qmd/index.sqlite'].every(relative => {
      const file = path.join(environment.root, relative);
      return fs.existsSync(file) && fs.lstatSync(file).isFile() && fs.lstatSync(file).nlink === 1;
    });
  }
  async function invoke(args, signal) {
    if (!available()) fail('UNAVAILABLE');
    // Trust validation only: no status, collection creation, index repair, or model download.
    await run(process.execPath, [path.join(environment.packageRoot, 'check-memory-config.mjs'), '--require-trust'], signal, 15000);
    return run(path.join(environment.packageRoot, 'bin/qmd'), args, signal);
  }
  async function search(mode, query, limit, signal) {
    const command = { keyword: 'search', semantic: 'vsearch', deep: 'query' }[mode];
    if (!command) fail('INVALID_INPUT');
    if (mode === 'deep' && !config().writeEnabled) fail('DEEP_REQUIRES_WRITE');
    if (!available()) fail('UNAVAILABLE');
    await run(process.execPath, [path.join(environment.packageRoot, 'check-memory-config.mjs'), '--require-trust'], signal, 15000);
    signal?.throwIfAborted();
    const helper = path.join(environment.packageRoot, 'lib/qmd-readonly.mjs');
    let output;
    if (mode === 'keyword') output = await run(process.execPath, [helper, 'keyword', query, String(limit)], signal);
    else {
      await run(process.execPath, [helper, 'check'], signal, 15000);
      signal?.throwIfAborted();
      output = await run(path.join(environment.packageRoot, 'bin/qmd'), [command, query, '--existing-service-only', '--json', '-c', 'pi-memory', '-n', String(limit)], signal);
    }
    signal?.throwIfAborted();
    if (/need embeddings|missing.*embedding/i.test(output.stderr)) fail('UNAVAILABLE');
    const results = JSON.parse(output.stdout);
    if (!Array.isArray(results)) fail('UNAVAILABLE');
    return { backend: `qmd-${command}`, results: results.slice(0, limit) };
  }
  function cancel() { generation++; clearTimeout(timer); timer = undefined; active?.abort(); warming?.abort(); }
  function schedule() {
    if (!config().writeEnabled || !config().autoIndex) return;
    clearTimeout(timer);
    const scheduledGeneration = generation;
    timer = setTimeout(() => {
      timer = undefined;
      chain = chain.then(async () => {
        if (scheduledGeneration !== generation || !config().writeEnabled || !config().autoIndex) return;
        active = new AbortController();
        try {
          health = 'running';
          await invoke(['update'], active.signal);
          if (config().writeEnabled && config().autoIndex && !active.signal.aborted) await invoke(['embed'], active.signal);
          health = 'ready';
        } catch { health = 'unavailable'; } finally { active = undefined; }
      });
    }, delay);
    timer.unref?.();
  }
  async function warmup() {
    if (!config().warmup || !config().readEnabled) return;
    warming = new AbortController();
    try { await invoke(['service', 'start', '--warm'], warming.signal); health = 'ready'; }
    catch { health = 'unavailable'; } finally { warming = undefined; }
  }
  function shutdown() { cancel(); for (const child of children) child.kill(); }
  return { search, schedule, cancel, shutdown, warmup, status: () => health };
}
