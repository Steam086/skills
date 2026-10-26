import fs from 'node:fs';
import path from 'node:path';
import env from './memory-env.cjs';
import YAML from './node_modules/yaml/dist/index.js';
import { sensitiveDigest, isTrusted } from './node_modules/@tobilu/qmd/dist/trust.js';
import { DEFAULT_EMBED_MODEL_URI, DEFAULT_RERANK_MODEL_URI, DEFAULT_GENERATE_MODEL_URI } from './node_modules/@tobilu/qmd/dist/llm.js';

const configPath = path.join(env.memoryDirectory, '.qmd/index.yml');
const config = YAML.parse(fs.readFileSync(configPath, 'utf8'));
const cols = config.collections || {};
const entries = Object.entries(cols);
if (entries.length !== 1 || entries[0][0] !== 'project-memory') throw new Error('Expected only the project-memory collection.');
const col = cols['project-memory'];
const expected = fs.realpathSync(env.memoryDirectory);
const actual = fs.realpathSync(path.resolve(path.dirname(path.dirname(configPath)), col.path));
if (actual !== expected || col.pattern !== '**/*.md' || col.update || col.hooks || (config.hooks && (!Array.isArray(config.hooks) || config.hooks.length))) {
  throw new Error('Unsafe collection scope/pattern/update hook; refusing to run.');
}
if (config.models?.embed !== env.values.QMD_EMBED_MODEL) throw new Error('models.embed differs from the required Qwen3 embedding model.');
if (config.models?.rerank !== DEFAULT_RERANK_MODEL_URI || config.models?.generate !== DEFAULT_GENERATE_MODEL_URI) throw new Error('Unexpected deep-search model; review configuration first.');
const snapshot = {
  hooks: [], paths: entries.map(([collection, value]) => ({ collection, path: value.path })), models: config.models,
};
const builtins = { embed: DEFAULT_EMBED_MODEL_URI, rerank: DEFAULT_RERANK_MODEL_URI, generate: DEFAULT_GENERATE_MODEL_URI };
const trusted = isTrusted(configPath, sensitiveDigest(snapshot, configPath, builtins));
if (process.argv.includes('--require-trust') && !trusted) {
  console.error('QMD project model is NOT trusted. Review .project-memory/.qmd/index.yml, then explicitly run scripts/qmd-memory trust. No global trust bypass is used.');
  process.exit(3);
}
const requestedModels = process.argv.find(arg => arg.startsWith('--models='))?.slice(9).split(',').filter(Boolean) || [];
const cacheNames = { embed: 'hf_Qwen_Qwen3-Embedding-0.6B-Q8_0.gguf', rerank: 'hf_ggml-org_qwen3-reranker-0.6b-q8_0.gguf', generate: 'hf_tobil_qmd-query-expansion-1.7B-q4_k_m.gguf' };
for (const role of requestedModels) {
  if (!cacheNames[role]) throw new Error('Unknown model role: ' + role);
  const filename = path.join(env.memoryDirectory, 'cache/qmd/models', cacheNames[role]);
  if (!fs.existsSync(filename)) throw new Error(`Offline-first: missing cached ${role} model. Explicitly run scripts/memory-models all; no automatic download attempted.`);
  const fd = fs.openSync(filename, 'r');
  const magic = Buffer.alloc(4);
  try { fs.readSync(fd, magic, 0, 4, 0); } finally { fs.closeSync(fd); }
  if (magic.toString() !== 'GGUF') throw new Error('Invalid cached GGUF: ' + filename);
}
if (process.argv.includes('--show')) console.log(JSON.stringify({ root: env.root, memory: expected, config: configPath, index: env.values.INDEX_PATH, trusted, models: config.models }, null, 2));
