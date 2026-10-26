// Resolve project-local shared state for both Pi and Codex MCP processes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const packageRoot = fs.realpathSync(__dirname);
const MEMORY_RELATIVE = '.project-memory';
const MIGRATION_MARKER = `${MEMORY_RELATIVE}/migration-v1.json`;

function resolveRoot(cwd = process.env.PROJECT_MEMORY_PROJECT_ROOT || process.env.PI_MEMORY_PROJECT_ROOT || process.cwd()) {
  const root = fs.realpathSync(cwd);
  if (!fs.lstatSync(root).isDirectory()) throw new Error('Project root must be a directory.');
  if (root === packageRoot || root.startsWith(packageRoot + path.sep)) throw new Error('Run from a consumer project, not the package directory.');
  return root;
}

function assertLocal(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Project memory state must not use symlinks: ' + current); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

const root = resolveRoot();
function legacyMemoryPresent() {
  for (const relative of ['.pi/memory-config.json', '.qmd/index.yml', '.qmd/index.yaml']) {
    if (fs.existsSync(path.join(root, relative))) return true;
  }
  for (const relative of ['.pi/memory', '.pi/memory-state']) {
    const legacy = path.join(root, relative);
    if (!fs.existsSync(legacy)) continue;
    const stack = [legacy];
    while (stack.length) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (entry.isSymbolicLink()) return true;
        const child = path.join(current, entry.name);
        if (entry.isDirectory()) stack.push(child);
        else if (entry.isFile()) return true;
      }
    }
  }
  return false;
}

function migrationRecord() {
  const marker = path.join(root, MIGRATION_MARKER);
  if (!fs.existsSync(marker)) return null;
  assertLocal(root, MIGRATION_MARKER);
  try {
    const stat = fs.lstatSync(marker);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 1024 * 1024) throw new Error('unsafe marker');
    const migration = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (migration.version !== 1 || !Array.isArray(migration.copied)) throw new Error('invalid marker');
    return migration;
  } catch { throw new Error('Project memory migration marker is invalid; stop for manual review.'); }
}

function oldQmdConfigIsRecorded(relative, migration) {
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) return true;
  assertLocal(root, relative);
  if (!migration) return false;
  try {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    return migration.legacyQmdConfigHashes?.[relative] === digest;
  } catch { return false; }
}

function validateState({ deep = true, allowLegacy = false } = {}) {
  for (const name of [MEMORY_RELATIVE, `${MEMORY_RELATIVE}/.qmd`, `${MEMORY_RELATIVE}/qmd-state`, `${MEMORY_RELATIVE}/cache`, '.pi/memory', '.pi/memory-state', '.pi/qmd-state', '.pi/memory-config.json', '.qmd']) {
    assertLocal(root, name);
    if (!deep || !fs.existsSync(path.join(root, name))) continue;
    const start = path.join(root, name);
    const walk = current => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const child = path.join(current, entry.name);
        if (entry.isSymbolicLink()) throw new Error('Project memory state must not use symlinks: ' + child);
        if (entry.isDirectory()) walk(child);
      }
    };
    if (fs.lstatSync(start).isDirectory()) walk(start);
  }
  const migration = migrationRecord();
  if (!allowLegacy && legacyMemoryPresent() && !migration) {
    throw new Error('Legacy Pi memory found. Run scripts/memory-migrate.mjs --apply before using shared memory.');
  }
  for (const relative of ['.qmd/index.yml', '.qmd/index.yaml']) {
    if (fs.existsSync(path.join(root, relative)) && !oldQmdConfigIsRecorded(relative, migration)) {
      throw new Error(`Legacy ${relative} found. Run scripts/memory-migrate.mjs --apply before using shared memory.`);
    }
  }
  if (['.pi/qmd-state/service.json', '.pi/qmd-state/qmd.sock'].some(relative => fs.existsSync(path.join(root, relative)))) {
    throw new Error('Legacy Pi QMD service is still present. Stop it before using shared memory.');
  }
}

const memoryDirectory = path.join(root, MEMORY_RELATIVE);
const modelIdleMinutes = process.env.PI_MEMORY_MODEL_IDLE_MINUTES || '30';
const values = {
  PROJECT_MEMORY_PROJECT_ROOT: root,
  PROJECT_MEMORY_DIR: memoryDirectory,
  // Compatibility variables are scoped to this subprocess and point to the shared directory.
  PI_MEMORY_PROJECT_ROOT: root,
  PI_MEMORY_DIR: memoryDirectory,
  PI_MEMORY_SNAPSHOT: 'stable',
  PI_MEMORY_MODEL_IDLE_MINUTES: modelIdleMinutes,
  PI_MEMORY_QMD_UPDATE: 'background',
  PI_MEMORY_EXIT_SUMMARY: 'off',
  PI_MEMORY_SUMMARIZE_TRANSITIONS: '0',
  PI_MEMORY_QMD_SEARCH_TIMEOUT_MS: '120000',
  QMD_LLAMA_GPU: 'cuda', QMD_EMBED_PARALLELISM: '1',
  QMD_EMBED_CONTEXT_SIZE: '1024', QMD_RERANK_CONTEXT_SIZE: '2048', QMD_EXPAND_CONTEXT_SIZE: '2048',
  QMD_EMBED_MODEL: 'hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf',
  QMD_CONFIG_DIR: path.join(memoryDirectory, 'qmd-state'),
  INDEX_PATH: path.join(memoryDirectory, '.qmd/index.sqlite'),
  XDG_CACHE_HOME: path.join(memoryDirectory, 'cache'),
};
values.PATH = [path.join(packageRoot, 'bin'), ...(process.env.PATH || '').split(path.delimiter).filter(Boolean)].join(path.delimiter);
const cudaRuntime = path.join(packageRoot, 'runtime/cuda');
if (fs.existsSync(cudaRuntime)) {
  values.LD_LIBRARY_PATH = [...new Set([cudaRuntime, ...(process.env.LD_LIBRARY_PATH || '').split(path.delimiter).filter(Boolean)])].join(path.delimiter);
}
const removed = ['QMD_FORCE_CPU', 'QMD_TRUST_LOCAL_CONFIG', 'QMD_TRUST_UPDATE_HOOKS', 'QMD_MEMORY_NATIVE', 'QMD_NATIVE_VSEARCH'];
function configure() {
  validateState({ deep: false });
  Object.assign(process.env, values);
  for (const key of removed) delete process.env[key];
  return { root, packageRoot, memoryDirectory, values };
}

configure();
module.exports = { root, packageRoot, memoryDirectory, values, configure, resolveRoot, assertLocal, validateState, legacyMemoryPresent };
if (require.main === module) {
  if (process.argv[2] === '--shell') {
    const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
    for (const [key, value] of Object.entries(values)) console.log(`export ${key}=${quote(value)}`);
    console.log(`unset ${removed.join(' ')}`);
  } else console.log(JSON.stringify({ root, packageRoot, ...values }, null, 2));
}
