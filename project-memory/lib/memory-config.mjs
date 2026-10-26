import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const DEFAULT_CONFIG = Object.freeze({
  version: 1, mode: 'manual', readEnabled: true, writeEnabled: true,
  autoIndex: true, warmup: false,
  indexMaxChars: 1800, searchMaxChars: 2400, readMaxChars: 6000, searchLimit: 5,
  diagnostics: Object.freeze({ enabled: true, maxBytes: 1048576, maxFiles: 3 }),
});
const CONFIG_PATH = '.project-memory/config.json';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function invalid(message) { throw new Error(`Invalid memory configuration: ${message}`); }
function keys(value, allowed, name) {
  if (!plain(value)) invalid(`${name} must be an object`);
  if (Object.keys(value).some(key => !allowed.includes(key))) invalid(`${name} has unknown fields`);
}
function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`${name} must be an integer in ${min}..${max}`);
}
function merge(base, patch) {
  keys(patch, Object.keys(DEFAULT_CONFIG), 'config');
  if (Object.hasOwn(patch, 'diagnostics')) keys(patch.diagnostics, Object.keys(DEFAULT_CONFIG.diagnostics), 'diagnostics');
  const result = { ...base, ...patch, diagnostics: { ...base.diagnostics, ...patch.diagnostics } };
  if (result.version !== 1) invalid('version must be 1');
  if (!['manual', 'code-research', 'off'].includes(result.mode)) invalid('mode must be manual, code-research or off');
  for (const key of ['readEnabled', 'writeEnabled', 'autoIndex', 'warmup']) {
    if (typeof result[key] !== 'boolean') invalid(`${key} must be boolean`);
  }
  if (typeof result.diagnostics.enabled !== 'boolean') invalid('diagnostics.enabled must be boolean');
  for (const [key, maximum] of Object.entries({ indexMaxChars: 12000, searchMaxChars: 24000, readMaxChars: 30000 })) {
    integer(result[key], 128, maximum, key);
  }
  integer(result.searchLimit, 1, 50, 'searchLimit');
  integer(result.diagnostics.maxBytes, 4096, 16777216, 'diagnostics.maxBytes');
  integer(result.diagnostics.maxFiles, 1, 10, 'diagnostics.maxFiles');
  return result;
}

export function resolveMemoryConfig(base = DEFAULT_CONFIG, overrides = {}) {
  const config = merge(merge(DEFAULT_CONFIG, base), overrides);
  if (config.mode === 'off') {
    config.readEnabled = false; config.writeEnabled = false;
    config.autoIndex = false; config.warmup = false; config.diagnostics.enabled = false;
  }
  return config;
}

// Shared, internal state I/O for this module and telemetry. Never follows state symlinks.
// Locks fail closed; abandoned locks require explicit operator recovery, never automatic stealing.
function safeRoot(root) {
  if (typeof root !== 'string' || !root) throw new Error('Memory root must be an existing directory');
  const absolute = path.resolve(root);
  if (fs.realpathSync(absolute) !== absolute || !fs.lstatSync(absolute).isDirectory()) throw new Error('Memory root must not use symlinks');
  return absolute;
}
function inspect(root, relative, directory = false) {
  root = safeRoot(root);
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..') || path.isAbsolute(relative)) throw new Error('Unsafe memory state path');
  let current = root, stat;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try { stat = fs.lstatSync(current); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink()) throw new Error('Memory state must not use symlinks');
    if (i < parts.length - 1 || directory) {
      if (!stat.isDirectory()) throw new Error('Memory state component must be a directory');
    } else if (!stat.isFile() || stat.nlink !== 1) throw new Error('Memory state must be a private regular file');
  }
  return stat;
}
function ensureDirectory(root, relative) {
  safeRoot(root);
  let current = '';
  for (const part of relative.split('/')) {
    current = current ? `${current}/${part}` : part;
    if (!inspect(root, current, true)) {
      try { fs.mkdirSync(path.join(root, current), { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
      inspect(root, current, true);
    }
  }
}
function readFile(root, relative, maxBytes) {
  const stat = inspect(root, relative);
  if (!stat) return null;
  const fd = fs.openSync(path.join(root, relative), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.nlink !== 1 || opened.size > maxBytes) throw new Error('Memory state file is unsafe or oversized');
    // A bounded read also protects against a file growing after stat.
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > maxBytes) throw new Error('Memory state file is oversized');
    return buffer.subarray(0, size).toString('utf8');
  } finally { fs.closeSync(fd); }
}
function atomicWrite(root, relative, text) {
  inspect(root, relative);
  const parent = path.posix.dirname(relative);
  if (!inspect(root, parent, true)) throw new Error('Missing memory state directory');
  const temporary = `${parent}/.tmp-${randomBytes(12).toString('hex')}`;
  let fd;
  try {
    fd = fs.openSync(path.join(root, temporary), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, text, 'utf8'); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
    inspect(root, relative); inspect(root, parent, true);
    fs.renameSync(path.join(root, temporary), path.join(root, relative));
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (inspect(root, temporary)) fs.unlinkSync(path.join(root, temporary));
  }
}
function lock(root, directory, operation) {
  ensureDirectory(root, path.posix.dirname(directory));
  inspect(root, directory, true);
  try { fs.mkdirSync(path.join(root, directory), { mode: 0o700 }); }
  catch (error) {
    if (error.code === 'EEXIST') { const busy = new Error('Memory state is busy; lock is never automatically stolen'); busy.code = 'MEMORY_BUSY'; throw busy; }
    throw error;
  }
  try { return operation(); }
  finally { inspect(root, directory, true); fs.rmdirSync(path.join(root, directory)); }
}
export const _memoryStateIO = Object.freeze({ safeRoot, inspect, ensureDirectory, readFile, atomicWrite, lock });

function readConfig(root) {
  const text = readFile(root, CONFIG_PATH, 16384);
  if (text === null) return merge(DEFAULT_CONFIG, {});
  let value;
  try { value = JSON.parse(text); } catch { invalid('file must contain valid JSON'); }
  if (!plain(value) || value.version !== 1) invalid('persisted version must be 1');
  return merge(DEFAULT_CONFIG, value);
}
// Validated underlying preferences, before mode=off gates effective permissions.
export function loadMemoryPreferences(root) { return readConfig(root); }
export function loadMemoryConfig(root) { return resolveMemoryConfig(loadMemoryPreferences(root)); }
export function saveMemoryConfig(root, patch) {
  // Validate before creating anything; serialize the entire read/merge/write.
  merge(DEFAULT_CONFIG, patch);
  root = safeRoot(root);
  inspect(root, CONFIG_PATH);
  return lock(root, '.project-memory/config-lock', () => {
    const config = merge(readConfig(root), patch);
    atomicWrite(root, CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
    return resolveMemoryConfig(config);
  });
}
