#!/usr/bin/env node
// Copy legacy Pi project memory into the single shared project directory.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const packageRoot = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const argv = process.argv.slice(2);
const options = { apply: false, root: undefined };
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--apply') options.apply = true;
  else if (argv[i] === '--root' && argv[i + 1] && !argv[i + 1].startsWith('--')) options.root = argv[++i];
  else throw new Error('Usage: memory-migrate.mjs [--root PROJECT] [--apply]');
}
const requestedRoot = options.root || process.env.PROJECT_MEMORY_PROJECT_ROOT || process.env.PI_MEMORY_PROJECT_ROOT || process.cwd();
const root = fs.realpathSync(path.resolve(requestedRoot));
if (!fs.lstatSync(root).isDirectory()) throw new Error('Project root must be a directory.');
if (root === packageRoot || root.startsWith(packageRoot + path.sep)) throw new Error('Run from a consumer project, not the package directory.');
if (['.pi/qmd-state/service.json', '.pi/qmd-state/qmd.sock'].some(relative => fs.existsSync(path.join(root, relative)))) {
  throw new Error('Legacy Pi QMD service metadata/socket is present; stop that service before migration.');
}

const memoryRoot = '.project-memory';
const markerRelative = `${memoryRoot}/migration-v1.json`;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const planned = new Map();
const legacyQmdConfigHashes = {};

function assertPath(relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlink is not allowed: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function add(source, target, bytes, sourceLabel = source) {
  assertPath(target);
  const entry = { source: sourceLabel, target, bytes, sha256: digest(bytes) };
  const previous = planned.get(target);
  if (previous && previous.sha256 !== entry.sha256) throw new Error(`Two legacy sources map to conflicting target ${target}`);
  if (!previous) planned.set(target, entry);
}
function collectTree(sourceRelative, targetPrefix) {
  const source = path.join(root, sourceRelative);
  if (!fs.existsSync(source)) return;
  assertPath(sourceRelative);
  const rootStat = fs.lstatSync(source);
  if (!rootStat.isDirectory()) throw new Error(`Expected a directory: ${source}`);
  const walk = (directory, relative) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(filename);
      if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${filename}`);
      if (stat.isDirectory()) walk(filename, childRelative);
      else if (stat.isFile()) {
        if (entry.name === '.lock' || entry.name.endsWith('.lock')) throw new Error(`A legacy lock exists at ${filename}; stop the old host and retry.`);
        if (stat.nlink !== 1 || stat.size > 32 * 1024 * 1024) throw new Error(`Unsafe or oversized memory file: ${filename}`);
        const targetSuffix = childRelative === '.gitignore' ? 'legacy-memory.gitignore' : childRelative;
        add(`${sourceRelative}/${childRelative}`, `${targetPrefix}/${targetSuffix}`, fs.readFileSync(filename));
      } else throw new Error(`Unsupported memory entry: ${filename}`);
    }
  };
  walk(source, '');
}
function readLegacyConfig(relative) {
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) return null;
  assertPath(relative);
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error(`Unsafe or oversized QMD config: ${filename}`);
  const bytes = fs.readFileSync(filename);
  legacyQmdConfigHashes[relative] = digest(bytes);
  let config;
  try { config = YAML.parse(bytes.toString('utf8')); } catch { throw new Error(`Cannot parse ${relative}; no files copied.`); }
  if (!config || typeof config !== 'object' || Array.isArray(config) || !config.collections || typeof config.collections !== 'object') {
    throw new Error(`Unsupported ${relative}; expected one QMD collection. No files copied.`);
  }
  if (config.hooks && (!Array.isArray(config.hooks) || config.hooks.length)) {
    throw new Error(`${relative} contains QMD hooks; review and migrate them manually. No files copied.`);
  }
  const names = Object.keys(config.collections);
  if (names.length !== 1) throw new Error(`${relative} has custom collection scope; review and migrate it manually. No files copied.`);
  const oldName = names[0];
  const collection = config.collections[oldName];
  if (!collection || typeof collection !== 'object' || collection.pattern !== '**/*.md' || collection.update || collection.hooks) {
    throw new Error(`${relative} has custom collection behavior; review and migrate it manually. No files copied.`);
  }
  config.collections = { 'project-memory': { ...collection, path: '.' } };
  return Buffer.from(YAML.stringify(config), 'utf8');
}
function ensureDirectory(relative) {
  assertPath(relative);
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) fs.mkdirSync(filename, { recursive: true, mode: 0o700 });
  assertPath(relative);
  if (!fs.lstatSync(filename).isDirectory()) throw new Error(`Expected directory: ${filename}`);
}
function writeExclusive(relative, bytes) {
  assertPath(relative);
  const target = path.join(root, relative);
  const parent = path.dirname(target);
  const temporary = path.join(parent, `.migration-${crypto.randomBytes(12).toString('hex')}`);
  let fd;
  try {
    fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
    fs.linkSync(temporary, target);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

collectTree('.pi/memory', memoryRoot);
for (const relative of ['.pi/memory-state/store.lock', '.pi/memory-state/legacy.lock']) {
  if (fs.existsSync(path.join(root, relative))) throw new Error(`A legacy write lock exists at ${relative}; stop the old host and retry.`);
}
collectTree('.pi/memory-state', memoryRoot);
const oldConfigRelative = '.pi/memory-config.json';
if (fs.existsSync(path.join(root, oldConfigRelative))) {
  assertPath(oldConfigRelative);
  const stat = fs.lstatSync(path.join(root, oldConfigRelative));
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error(`Unsafe or oversized config: ${oldConfigRelative}`);
  add(oldConfigRelative, `${memoryRoot}/config.json`, fs.readFileSync(path.join(root, oldConfigRelative)));
}

const oldQmdFiles = ['.qmd/index.yml', '.qmd/index.yaml'].filter(relative => fs.existsSync(path.join(root, relative)));
if (oldQmdFiles.length > 1) throw new Error('Both .qmd/index.yml and .qmd/index.yaml exist; review them manually. No files copied.');
if (oldQmdFiles.length) {
  add(oldQmdFiles[0], `${memoryRoot}/.qmd/index.yml`, readLegacyConfig(oldQmdFiles[0]));
} else if (!planned.has(`${memoryRoot}/.qmd/index.yml`)) {
  add('package template', `${memoryRoot}/.qmd/index.yml`, fs.readFileSync(path.join(packageRoot, 'templates/index.yml')));
}

assertPath(markerRelative);
const existingMarker = fs.existsSync(path.join(root, markerRelative))
  ? fs.readFileSync(path.join(root, markerRelative), 'utf8') : null;
if (existingMarker) {
  const stat = fs.lstatSync(path.join(root, markerRelative));
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error('Existing migration marker is unsafe; stop for manual review.');
  let prior;
  try { prior = JSON.parse(existingMarker); } catch { throw new Error('Existing migration marker is invalid; stop for manual review.'); }
  if (prior.version !== 1) throw new Error('Existing migration marker has an unsupported version.');
  for (const [relative, sha256] of Object.entries(legacyQmdConfigHashes)) {
    if (prior.legacyQmdConfigHashes?.[relative] !== sha256) throw new Error(`Legacy QMD config ${relative} changed after migration; review it manually.`);
  }
}

const report = [];
for (const entry of planned.values()) {
  assertPath(entry.target);
  const target = path.join(root, entry.target);
  let state = 'copy';
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Unsafe migration target: ${entry.target}`);
    if (digest(fs.readFileSync(target)) !== entry.sha256) throw new Error(`Migration conflict at ${entry.target}; no files copied.`);
    state = 'identical';
  }
  report.push({ source: entry.source, target: entry.target, bytes: entry.bytes.length, sha256: entry.sha256, state });
}

if (options.apply) {
  for (const entry of planned.values()) {
    if (entry.source === 'package template') continue;
    assertPath(entry.source);
    const sourcePath = path.join(root, entry.source);
    const sourceStat = fs.lstatSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || sourceStat.nlink !== 1 || digest(fs.readFileSync(sourcePath)) !== entry.sha256) {
      throw new Error(`Legacy source ${entry.source} changed during migration planning; no files copied.`);
    }
  }
  const directories = new Set([memoryRoot]);
  for (const entry of planned.values()) {
    let parent = path.posix.dirname(entry.target);
    while (parent && parent !== '.') { directories.add(parent); parent = path.posix.dirname(parent); }
  }
  for (const directory of [...directories].sort((a, b) => a.split('/').length - b.split('/').length)) ensureDirectory(directory);
  for (const entry of planned.values()) {
    const target = path.join(root, entry.target);
    if (!fs.existsSync(target)) writeExclusive(entry.target, entry.bytes);
  }
  if (!existingMarker) {
    const marker = {
      version: 1,
      migratedAt: new Date().toISOString(),
      copied: report.map(({ source, target, sha256 }) => ({ source, target, sha256 })),
      legacyQmdConfigHashes,
    };
    writeExclusive(markerRelative, Buffer.from(`${JSON.stringify(marker, null, 2)}\n`));
  }
}

console.log(JSON.stringify({ root, mode: options.apply ? 'apply' : 'dry-run', alreadyMigrated: Boolean(existingMarker), files: report }, null, 2));
if (!options.apply) console.log('Dry run only. Re-run with --apply to copy; legacy sources are retained.');
