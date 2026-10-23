import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const BODY_MAX = 24000;
const HEADER_MAX = 32768;
const FILE_MAX = 140000;
const RECOVERY_MAX = 200000;
const HANDOFF_MAX = 12000;
const TOPICS = '.pi/memory/topics';
const RECOVERY = '.pi/memory/recovery';
const HANDOFF = '.pi/memory-state/handoffs/current.json';
const LOCK = '.pi/memory-state/store.lock';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const normalizedBody = value => value.replace(/\r\n?/g, '\n').replace(/[\t ]+$/gm, '').replace(/\n+$/, '');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownKeys = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

function text(value, name, max, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!allowEmpty && !value.trim())) {
    fail('INVALID_INPUT', `${name} must be ${allowEmpty ? 'a' : 'a nonempty'} string of at most ${max} characters`);
  }
  return value;
}
function idValue(id) {
  if (typeof id !== 'string' || id.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail('INVALID_ID', 'Invalid topic ID');
  return id;
}
function integer(value, fallback, max, name, min = 1) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) fail('INVALID_INPUT', `${name} must be an integer from ${min} to ${max}`);
  return value;
}
function sourcePath(value) {
  text(value, 'anchor path', 512);
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value) || value.includes('\\') || value.split('/').some(part => !part || part === '.' || part === '..')) {
    fail('UNSAFE_PATH', 'Anchor paths must be canonical project-relative paths');
  }
  if (value === '.pi/memory' || value.startsWith('.pi/memory/') || value === '.pi/memory-state' || value.startsWith('.pi/memory-state/')) {
    fail('UNSAFE_PATH', 'Memory state cannot be a source anchor');
  }
  return value;
}
function anchorsValue(anchors = []) {
  if (!Array.isArray(anchors) || anchors.length > 32) fail('INVALID_INPUT', 'anchors must contain at most 32 entries');
  const seen = new Set();
  return anchors.map(anchor => {
    if (!ownKeys(anchor, ['path', 'symbol'])) fail('INVALID_INPUT', 'Invalid anchor');
    const result = { path: sourcePath(anchor.path) };
    if (anchor.symbol !== undefined) result.symbol = text(anchor.symbol, 'symbol', 160);
    const key = JSON.stringify(result);
    if (seen.has(key)) fail('INVALID_INPUT', 'Duplicate anchor');
    seen.add(key);
    return result;
  });
}
function tagsValue(tags = []) {
  if (!Array.isArray(tags) || tags.length > 12) fail('INVALID_INPUT', 'tags must contain at most 12 entries');
  return [...new Set(tags.map(tag => text(tag, 'tag', 48)))];
}
function validateMetadata(meta, expectedId) {
  if (!ownKeys(meta, ['version', 'id', 'title', 'summary', 'tags', 'anchors', 'verified', 'revision', 'createdAt', 'updatedAt', 'sources', 'bodyHash', 'commit']) || meta.version !== 1) {
    fail('INVALID_RECORD', 'Invalid topic metadata');
  }
  idValue(meta.id);
  if (expectedId !== undefined && meta.id !== expectedId) fail('INVALID_RECORD', 'Topic ID does not match filename');
  text(meta.title, 'title', 160);
  text(meta.summary, 'summary', 400);
  if (!Array.isArray(meta.tags) || !Array.isArray(meta.anchors)) fail('INVALID_RECORD', 'Missing tags or anchors');
  tagsValue(meta.tags);
  anchorsValue(meta.anchors);
  if (typeof meta.verified !== 'boolean' || !Number.isSafeInteger(meta.revision) || meta.revision < 1 || !date(meta.createdAt) || !date(meta.updatedAt) || !digest(meta.bodyHash)) {
    fail('INVALID_RECORD', 'Invalid topic revision, timestamps, verification or hash');
  }
  if (!Array.isArray(meta.sources) || meta.sources.length !== meta.anchors.length) fail('INVALID_RECORD', 'Sources must match anchors');
  meta.sources.forEach((source, index) => {
    const anchor = meta.anchors[index];
    if (!ownKeys(source, ['path', 'symbol', 'hash']) || source.path !== anchor.path || source.symbol !== anchor.symbol || !digest(source.hash)) {
      fail('INVALID_RECORD', 'Invalid captured source');
    }
  });
  if (meta.commit !== undefined) text(meta.commit, 'commit', 128);
  return meta;
}
function parseJSON(value, label) {
  try { return JSON.parse(value); } catch { fail('INVALID_RECORD', `Invalid ${label} JSON`); }
}
function encodeTopic(meta, content) {
  const header = JSON.stringify(meta);
  if (Buffer.byteLength(header) > HEADER_MAX - 8) fail('INVALID_INPUT', 'Topic metadata is too large');
  return `---\n${header}\n---\n${content}`;
}
function compact(meta, freshness) {
  return { id: meta.id, revision: meta.revision, title: meta.title, summary: meta.summary, ...(freshness ? { freshness } : {}) };
}
function checkBudget(value, maxChars) {
  return JSON.stringify(value).length <= maxChars;
}

/** Project-local Markdown topics. Reads are lazy; mutations share a fail-closed lock. */
export function createMemoryStore(root) {
  const base = path.resolve(text(root, 'root', 8192));
  const cache = new Map();

  // Check every component, including the supplied root's ancestors. Never follow links.
  function checked(relative, allowMissing = true) {
    const target = path.join(base, relative);
    if (target !== base && !target.startsWith(`${base}${path.sep}`)) fail('UNSAFE_PATH', 'Path escapes project root');
    const parsed = path.parse(target);
    let current = parsed.root;
    const parts = target.slice(parsed.root.length).split(path.sep).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      let stat;
      try { stat = fs.lstatSync(current); } catch (error) {
        if (error.code === 'ENOENT' && allowMissing) return null;
        throw error;
      }
      if (stat.isSymbolicLink()) fail('UNSAFE_PATH', 'Symbolic links are not allowed in project memory or source paths');
      if (i < parts.length - 1 && !stat.isDirectory()) fail('UNSAFE_PATH', 'Path component is not a directory');
      if (i === parts.length - 1) return stat;
    }
    return fs.lstatSync(target);
  }
  function ensureDir(relative) {
    checked('', false);
    let current = '';
    for (const part of relative.split('/')) {
      current = current ? `${current}/${part}` : part;
      const stat = checked(current);
      if (!stat) {
        try { fs.mkdirSync(path.join(base, current), { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      }
      if (!checked(current, false).isDirectory()) fail('UNSAFE_PATH', 'State directory is not a directory');
    }
  }
  function openRead(relative, maxBytes) {
    const stat = checked(relative);
    if (!stat) return null;
    if (!stat.isFile() || stat.size > maxBytes) fail('INVALID_RECORD', 'Expected a bounded regular file');
    const fd = fs.openSync(path.join(base, relative), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const actual = fs.fstatSync(fd);
    if (!actual.isFile() || actual.size > maxBytes || actual.ino !== stat.ino || actual.dev !== stat.dev) {
      fs.closeSync(fd);
      fail('UNSAFE_PATH', 'File changed while opening');
    }
    return fd;
  }
  function readFile(relative, maxBytes = FILE_MAX) {
    const fd = openRead(relative, maxBytes);
    if (fd === null) return null;
    try {
      const buffer = Buffer.alloc(maxBytes + 1);
      let size = 0;
      while (size <= maxBytes) {
        const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
        if (!count) break;
        size += count;
      }
      if (size > maxBytes) fail('INVALID_RECORD', 'File grew beyond size bound');
      return buffer.subarray(0, size).toString('utf8');
    } finally { fs.closeSync(fd); }
  }
  function atomicWrite(relative, content) {
    const directory = path.posix.dirname(relative);
    ensureDir(directory);
    const existing = checked(relative);
    if (existing && !existing.isFile()) fail('UNSAFE_PATH', 'Destination is not a regular file');
    const temporary = `${directory}/.${path.basename(relative)}.${crypto.randomUUID()}.tmp`;
    let fd;
    try {
      fd = fs.openSync(path.join(base, temporary), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      fs.writeFileSync(fd, content, 'utf8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      checked(relative);
      checked(temporary, false);
      fs.renameSync(path.join(base, temporary), path.join(base, relative));
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
      if (checked(temporary)) fs.unlinkSync(path.join(base, temporary));
    }
  }
  function locked(action) {
    ensureDir('.pi/memory-state');
    const deadline = Date.now() + 100;
    let fd;
    while (fd === undefined) {
      checked(LOCK);
      try { fd = fs.openSync(path.join(base, LOCK), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (Date.now() >= deadline) fail('STORE_LOCKED', 'Memory store is locked; stale locks require explicit operator recovery');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    const owned = fs.fstatSync(fd);
    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
      return action();
    } finally {
      fs.closeSync(fd);
      const current = checked(LOCK);
      if (current && current.ino === owned.ino && current.dev === owned.dev) fs.unlinkSync(path.join(base, LOCK));
    }
  }
  function topicPath(id) { return `${TOPICS}/${idValue(id)}.md`; }
  function metadata(id) {
    const relative = topicPath(id);
    const stat = checked(relative);
    if (!stat) { cache.delete(id); return null; }
    if (!stat.isFile() || stat.size > FILE_MAX) fail('INVALID_RECORD', 'Invalid topic file');
    const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
    const cached = cache.get(id);
    if (cached?.signature === signature) return cached.meta;
    const fd = openRead(relative, FILE_MAX);
    try {
      const chunks = [];
      let length = 0;
      let header;
      while (length < HEADER_MAX) {
        const chunk = Buffer.alloc(Math.min(1024, HEADER_MAX - length));
        const count = fs.readSync(fd, chunk, 0, chunk.length, null);
        if (!count) break;
        chunks.push(chunk.subarray(0, count));
        length += count;
        const joined = Buffer.concat(chunks).toString('utf8');
        const end = joined.indexOf('\n---\n', 4);
        if (joined.startsWith('---\n') && end !== -1) { header = joined.slice(4, end); break; }
      }
      if (!header) fail('INVALID_RECORD', 'Missing or oversized topic frontmatter');
      const meta = validateMetadata(parseJSON(header, 'topic metadata'), id);
      cache.set(id, { signature, meta });
      return meta;
    } finally { fs.closeSync(fd); }
  }
  function record(id) {
    const raw = readFile(topicPath(id));
    if (raw === null) fail('NOT_FOUND', `Topic not found: ${id}`);
    const end = raw.indexOf('\n---\n', 4);
    if (!raw.startsWith('---\n') || end < 0 || Buffer.byteLength(raw.slice(0, end)) > HEADER_MAX) fail('INVALID_RECORD', 'Invalid topic frontmatter');
    const meta = validateMetadata(parseJSON(raw.slice(4, end), 'topic metadata'), id);
    const content = text(raw.slice(end + 5), 'content', BODY_MAX);
    if (hash(content) !== meta.bodyHash) fail('INVALID_RECORD', 'Topic body does not match its hash');
    return { meta, content };
  }
  function allMetadata() {
    const stat = checked(TOPICS);
    if (!stat) return [];
    if (!stat.isDirectory()) fail('UNSAFE_PATH', 'Topics path is not a directory');
    return fs.readdirSync(path.join(base, TOPICS)).filter(name => name.endsWith('.md')).sort().map(name => metadata(idValue(name.slice(0, -3)))).filter(Boolean);
  }
  function sourceHash(relative) {
    sourcePath(relative);
    const fd = openRead(relative, Number.MAX_SAFE_INTEGER);
    if (fd === null) fail('SOURCE_MISSING', 'Source anchor does not exist');
    try {
      const before = fs.fstatSync(fd);
      const result = crypto.createHash('sha256');
      const buffer = Buffer.alloc(65536);
      let remaining = before.size;
      while (remaining > 0) {
        const count = fs.readSync(fd, buffer, 0, Math.min(buffer.length, remaining), null);
        if (!count) fail('SOURCE_CHANGED', 'Source changed while hashing; retry verification');
        result.update(buffer.subarray(0, count));
        remaining -= count;
      }
      const after = fs.fstatSync(fd);
      const current = checked(relative, false);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || current.ino !== after.ino || current.dev !== after.dev) {
        fail('SOURCE_CHANGED', 'Source changed while hashing; retry verification');
      }
      return result.digest('hex');
    } finally { fs.closeSync(fd); }
  }
  function freshnessFor(meta) {
    const result = { status: 'unverified', checked: 0, changed: 0, missing: 0, unsafe: 0 };
    for (const source of meta.sources) {
      try {
        const current = sourceHash(source.path);
        result.checked++;
        if (current !== source.hash) result.changed++;
      } catch (error) {
        if (error.code === 'SOURCE_MISSING' || error.code === 'ENOENT') result.missing++;
        else if (['UNSAFE_PATH', 'INVALID_RECORD', 'ELOOP', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) result.unsafe++;
        else if (error.code === 'SOURCE_CHANGED') result.changed++;
        else throw error;
      }
    }
    if (result.changed || result.missing || result.unsafe) result.status = 'stale';
    else if (meta.verified && meta.sources.length) result.status = 'fresh';
    return result;
  }
  function requireMeta(id) {
    const meta = metadata(id);
    if (!meta) fail('NOT_FOUND', `Topic not found: ${id}`);
    return meta;
  }
  function guard(meta, expectedRevision) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== meta.revision) fail('REVISION_CONFLICT', `Expected revision ${meta.revision} for ${meta.id}`);
    if (meta.revision === Number.MAX_SAFE_INTEGER) fail('REVISION_CONFLICT', 'Revision exhausted');
  }
  function scope(value) {
    return JSON.stringify({ anchors: value.anchors.map(anchor => JSON.stringify(anchor)).sort(), tags: [...value.tags].sort(), verified: value.verified, ...(value.anchors.length ? {} : { title: value.title }) });
  }
  function recoveryPath(recoveryId) {
    if (typeof recoveryId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.[a-f0-9-]{36}$/.test(recoveryId) || recoveryId.length > 117) fail('INVALID_ID', 'Invalid recovery ID');
    return `${RECOVERY}/${recoveryId}.json`;
  }
  function recoveryRecord(recoveryId) {
    const raw = readFile(recoveryPath(recoveryId), RECOVERY_MAX);
    if (raw === null) fail('NOT_FOUND', 'Recovery record not found');
    const recovery = parseJSON(raw, 'recovery');
    if (!ownKeys(recovery, ['version', 'deletedAt', 'meta', 'content']) || recovery.version !== 1 || !date(recovery.deletedAt)) fail('INVALID_RECORD', 'Invalid recovery record');
    const meta = validateMetadata(recovery.meta, recoveryId.split('.')[0]);
    text(recovery.content, 'content', BODY_MAX);
    if (hash(recovery.content) !== meta.bodyHash) fail('INVALID_RECORD', 'Invalid recovery body hash');
    return { meta, content: recovery.content };
  }
  function nextRevision(id, minimum = 0) {
    let maximum = minimum;
    const stat = checked(RECOVERY);
    if (stat) {
      if (!stat.isDirectory()) fail('UNSAFE_PATH', 'Recovery path is not a directory');
      for (const name of fs.readdirSync(path.join(base, RECOVERY))) {
        if (name.startsWith(`${id}.`) && name.endsWith('.json')) {
          maximum = Math.max(maximum, recoveryRecord(name.slice(0, -5)).meta.revision);
        }
      }
    }
    if (maximum === Number.MAX_SAFE_INTEGER) fail('REVISION_CONFLICT', 'Revision exhausted');
    return maximum + 1;
  }
  function handoffRecord() {
    const raw = readFile(HANDOFF, 80000);
    if (raw === null) return null;
    const value = parseJSON(raw, 'handoff');
    if (!ownKeys(value, ['version', 'content', 'contentHash', 'sessionId', 'createdAt', 'updatedAt']) || value.version !== 1 || !date(value.createdAt) || !date(value.updatedAt)) fail('INVALID_RECORD', 'Invalid handoff');
    text(value.content, 'handoff content', HANDOFF_MAX);
    if (value.sessionId !== undefined) text(value.sessionId, 'sessionId', 128);
    if (hash(value.content) !== value.contentHash) fail('INVALID_RECORD', 'Invalid handoff hash');
    return value;
  }
  return {
    upsert(input) {
      if (!ownKeys(input, ['id', 'title', 'summary', 'content', 'tags', 'anchors', 'verified', 'expectedRevision'])) fail('INVALID_INPUT', 'Invalid upsert fields');
      const id = idValue(input.id);
      const content = text(input.content, 'content', BODY_MAX);
      const fields = { title: text(input.title, 'title', 160), summary: text(input.summary, 'summary', 400), tags: tagsValue(input.tags), anchors: anchorsValue(input.anchors), verified: input.verified === undefined ? false : input.verified };
      if (typeof fields.verified !== 'boolean') fail('INVALID_INPUT', 'verified must be boolean');
      if (input.expectedRevision !== undefined) integer(input.expectedRevision, undefined, Number.MAX_SAFE_INTEGER, 'expectedRevision');
      return locked(() => {
        const previous = metadata(id) ? record(id) : null;
        const sources = fields.anchors.map(anchor => ({ ...anchor, hash: sourceHash(anchor.path) }));
        if (previous) {
          if (input.expectedRevision !== undefined && input.expectedRevision !== previous.meta.revision) guard(previous.meta, input.expectedRevision);
          const oldFields = Object.fromEntries(Object.keys(fields).map(key => [key, previous.meta[key]]));
          if (previous.content === content && JSON.stringify(oldFields) === JSON.stringify(fields) && JSON.stringify(previous.meta.sources) === JSON.stringify(sources)) return { status: 'unchanged', id, revision: previous.meta.revision };
          guard(previous.meta, input.expectedRevision);
        } else {
          if (input.expectedRevision !== undefined) fail('REVISION_CONFLICT', 'Cannot replace a missing topic');
          for (const candidate of allMetadata()) {
            if (scope(candidate) !== scope(fields)) continue;
            const existing = record(candidate.id);
            if (hash(normalizedBody(existing.content)) === hash(normalizedBody(content)) && JSON.stringify(candidate.sources) === JSON.stringify(sources)) {
              return { status: 'unchanged', id: candidate.id, revision: candidate.revision, duplicateOf: candidate.id, requestedId: id };
            }
          }
        }
        const now = new Date().toISOString();
        const meta = { version: 1, id, ...fields, revision: previous ? previous.meta.revision + 1 : nextRevision(id), createdAt: previous?.meta.createdAt ?? now, updatedAt: now, sources, bodyHash: hash(content) };
        atomicWrite(topicPath(id), encodeTopic(meta, content));
        cache.delete(id);
        return { status: previous ? 'updated' : 'created', id, revision: meta.revision };
      });
    },
    list({ limit, cursor, maxChars } = {}) {
      limit = integer(limit, 20, 100, 'limit');
      maxChars = integer(maxChars, 2400, 24000, 'maxChars', 64);
      if (cursor !== undefined && cursor !== null) idValue(cursor);
      const all = allMetadata();
      const candidates = all.filter(meta => !cursor || meta.id > cursor);
      const result = { records: [], nextCursor: null, total: all.length };
      for (const meta of candidates) {
        // Reserve the larger of a continuation cursor and final null.
        const next = { ...result, records: [...result.records, compact(meta)], nextCursor: meta.id.length >= 4 ? meta.id : null };
        if (next.records.length > limit || !checkBudget(next, maxChars)) break;
        result.records = next.records;
      }
      if (result.records.length < candidates.length) {
        if (!result.records.length) fail('BUDGET_TOO_SMALL', 'Budget cannot fit the next compact record');
        result.nextCursor = result.records.at(-1).id;
      }
      return result;
    },
    read({ id, section, offset, limit, maxChars }) {
      const { meta, content } = record(id);
      offset = integer(offset, 0, BODY_MAX, 'offset', 0);
      limit = integer(limit, BODY_MAX, BODY_MAX, 'limit');
      maxChars = integer(maxChars, 6000, 30000, 'maxChars', 64);
      let selected = content;
      if (section !== undefined) {
        text(section, 'section', 160);
        // Ignore fenced-code headings; the selected section includes its heading and subsections.
        const headings = [];
        let position = 0;
        let fence;
        for (const line of content.split(/(?<=\n)/)) {
          const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
          if (marker) {
            if (!fence) fence = marker[1];
            else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
          } else if (!fence) {
            const heading = /^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
            if (heading) headings.push({ level: heading[1].length, name: heading[2].replace(/[ \t]+#+$/, ''), position });
          }
          position += line.length;
        }
        const index = headings.findIndex(heading => heading.name.toLocaleLowerCase() === section.toLocaleLowerCase());
        if (index < 0) fail('SECTION_NOT_FOUND', `Section not found: ${section}`);
        const heading = headings[index];
        const end = headings.slice(index + 1).find(next => next.level <= heading.level)?.position ?? content.length;
        selected = content.slice(heading.position, end);
      }
      const result = { id: meta.id, revision: meta.revision, title: meta.title, content: '', truncated: false, freshness: freshnessFor(meta) };
      const available = selected.slice(offset, offset + limit);
      const make = length => {
        const end = offset + length;
        const truncated = end < selected.length;
        return { ...result, content: available.slice(0, length), truncated, ...(truncated ? { nextOffset: end } : {}) };
      };
      if (checkBudget(make(available.length), maxChars)) return make(available.length);
      if (!checkBudget(make(0), maxChars)) fail('BUDGET_TOO_SMALL', 'Budget cannot fit read metadata');
      let low = 0;
      let high = available.length;
      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        if (checkBudget(make(middle), maxChars)) low = middle;
        else high = middle - 1;
      }
      if (available.length && !low) fail('BUDGET_TOO_SMALL', 'Budget cannot fit content');
      return make(low);
    },
    search(query, { limit, maxChars } = {}) {
      text(query, 'query', 512);
      limit = integer(limit, 5, 50, 'limit');
      maxChars = integer(maxChars, 2400, 24000, 'maxChars', 64);
      const terms = [...new Set(query.normalize('NFKC').toLocaleLowerCase().match(/[\p{L}\p{N}_$]+/gu) ?? [])];
      if (!terms.length) return [];
      const ranked = allMetadata().map(meta => {
        const fields = [[meta.id, 4], [meta.title, 5], [meta.summary, 2], [meta.tags.join(' '), 3], [meta.anchors.map(anchor => `${anchor.path} ${anchor.symbol ?? ''}`).join(' '), 2], [record(meta.id).content, 1]];
        const score = fields.reduce((sum, [value, weight]) => sum + terms.reduce((total, term) => total + (value.normalize('NFKC').toLocaleLowerCase().includes(term) ? weight : 0), 0), 0);
        return { meta, score };
      }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || a.meta.id.localeCompare(b.meta.id));
      const results = [];
      for (const { meta, score } of ranked) {
        const hit = { ...compact(meta, freshnessFor(meta)), score };
        if (!checkBudget([...results, hit], maxChars)) continue;
        results.push(hit);
        if (results.length >= limit) break;
      }
      return results;
    },
    buildIndex({ maxChars, limit } = {}) {
      maxChars = integer(maxChars, 1800, 12000, 'maxChars', 64);
      limit = integer(limit, 30, 100, 'limit');
      const all = allMetadata();
      const legacy = ['.pi/memory/MEMORY.md', '.pi/memory/SCRATCHPAD.md', '.pi/memory/daily', '.pi/memory/logs', '.pi/memory/long-term.md', '.pi/memory/scratchpad.md'].some(relative => checked(relative));
      const lines = [];
      const render = () => `Topics: ${all.length}; omitted: ${all.length - lines.length}${legacy ? '; legacy available' : ''}\n${lines.join('\n')}`;
      for (const meta of all.slice(0, limit)) {
        lines.push(`- ${meta.id}: ${meta.title.replace(/[\r\n\t]/g, ' ')}`);
        if (render().length > maxChars) { lines.pop(); break; }
      }
      const result = render();
      if (result.length > maxChars) fail('BUDGET_TOO_SMALL', 'Budget cannot fit index count');
      return result;
    },
    forget({ id, expectedRevision }) {
      idValue(id);
      return locked(() => {
        const { meta, content } = record(id);
        guard(meta, expectedRevision);
        const recoveryId = `${id}.${crypto.randomUUID()}`;
        atomicWrite(recoveryPath(recoveryId), JSON.stringify({ version: 1, deletedAt: new Date().toISOString(), meta, content }));
        checked(topicPath(id), false);
        fs.unlinkSync(path.join(base, topicPath(id)));
        cache.delete(id);
        return { id, recoveryId };
      });
    },
    restore(recoveryId) {
      const relative = recoveryPath(recoveryId);
      return locked(() => {
        const { meta, content } = recoveryRecord(recoveryId);
        if (checked(topicPath(meta.id))) fail('REVISION_CONFLICT', 'Cannot restore over a live topic');
        const restored = { ...meta, revision: nextRevision(meta.id, meta.revision), updatedAt: new Date().toISOString() };
        atomicWrite(topicPath(meta.id), encodeTopic(restored, content));
        checked(relative, false);
        fs.unlinkSync(path.join(base, relative));
        cache.delete(meta.id);
        return { status: 'restored', id: meta.id, revision: restored.revision };
      });
    },
    writeHandoff({ content, sessionId }) {
      text(content, 'handoff content', HANDOFF_MAX);
      if (sessionId !== undefined) text(sessionId, 'sessionId', 128);
      return locked(() => {
        const previous = handoffRecord();
        const contentHash = hash(content);
        if (previous?.contentHash === contentHash) return { status: 'unchanged', contentHash };
        const now = new Date().toISOString();
        const value = { version: 1, content, contentHash, ...(sessionId !== undefined ? { sessionId } : {}), createdAt: previous?.createdAt ?? now, updatedAt: now };
        atomicWrite(HANDOFF, JSON.stringify(value));
        return { status: previous ? 'updated' : 'created', contentHash };
      });
    },
    readHandoff() { return handoffRecord(); },
    freshness(id) { return freshnessFor(requireMeta(id)); },
    inspect(id) { return structuredClone(requireMeta(id)); },
  };
}
