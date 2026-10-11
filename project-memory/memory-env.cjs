// Code belongs to the package; all mutable state belongs to the consumer.
const fs = require('node:fs');
const path = require('node:path');
const packageRoot = fs.realpathSync(__dirname);
function resolveRoot(cwd = process.env.PI_MEMORY_PROJECT_ROOT || process.cwd()) {
  const root = fs.realpathSync(cwd);
  if (root === packageRoot || root.startsWith(packageRoot + path.sep)) throw new Error('Run from a consumer project, not the package directory.');
  return root;
}
function assertLocal(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) || (() => { try { return fs.lstatSync(current).isSymbolicLink(); } catch { return false; } })()) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Project state must not use symlinks: ' + current);
    }
  }
}
const root = resolveRoot();
function validateState() {
  for (const name of ['.pi/memory', '.pi/cache', '.pi/qmd-state', '.qmd']) {
    assertLocal(root, name);
    const walk = relative => {
      const filename = path.join(root, relative);
      if (!fs.existsSync(filename)) return;
      for (const entry of fs.readdirSync(filename, { withFileTypes: true })) {
        const child = relative + '/' + entry.name;
        assertLocal(root, child);
        if (entry.isDirectory()) walk(child);
      }
    };
    walk(name);
  }
  if (fs.existsSync(path.join(root, '.qmd/index.yaml'))) throw new Error('Conflicting .qmd/index.yaml; review manually before using this package.');
}
validateState();
const values = {
  PI_MEMORY_PROJECT_ROOT: root,
  PI_MEMORY_DIR: path.join(root, '.pi/memory'),
  PI_MEMORY_SNAPSHOT: 'stable',
  PI_MEMORY_MODEL_IDLE_MINUTES: process.env.PI_MEMORY_MODEL_IDLE_MINUTES || '30',
  PI_MEMORY_QMD_UPDATE: 'background',
  PI_MEMORY_EXIT_SUMMARY: 'off',
  PI_MEMORY_SUMMARIZE_TRANSITIONS: '0',
  PI_MEMORY_QMD_SEARCH_TIMEOUT_MS: '120000',
  QMD_LLAMA_GPU: 'cuda', QMD_EMBED_PARALLELISM: '1',
  QMD_EMBED_CONTEXT_SIZE: '1024', QMD_RERANK_CONTEXT_SIZE: '2048', QMD_EXPAND_CONTEXT_SIZE: '2048',
  QMD_EMBED_MODEL: 'hf:Qwen/Qwen3-Embedding-0.6B-GGUF/Qwen3-Embedding-0.6B-Q8_0.gguf',
  QMD_CONFIG_DIR: path.join(root, '.pi/qmd-state'),
  INDEX_PATH: path.join(root, '.qmd/index.sqlite'),
  XDG_CACHE_HOME: path.join(root, '.pi/cache'),
};
values.PATH = [path.join(packageRoot, 'bin'), ...(process.env.PATH || '').split(path.delimiter).filter(Boolean)].join(path.delimiter);
const removed = ['QMD_FORCE_CPU', 'QMD_TRUST_LOCAL_CONFIG', 'QMD_TRUST_UPDATE_HOOKS', 'QMD_MEMORY_NATIVE', 'QMD_NATIVE_VSEARCH'];
function configure() {
  validateState();
  Object.assign(process.env, values);
  for (const key of removed) delete process.env[key];
  return { root, packageRoot, values };
}
configure();
module.exports = { root, packageRoot, values, configure, resolveRoot, assertLocal, validateState };
if (require.main === module) {
  if (process.argv[2] === '--shell') {
    const quote = s => "'" + s.replace(/'/g, "'\\''") + "'";
    for (const [key, value] of Object.entries(values)) console.log(`export ${key}=${quote(value)}`);
    console.log(`unset ${removed.join(' ')}`);
  } else console.log(JSON.stringify({ root, packageRoot, ...values }, null, 2));
}
