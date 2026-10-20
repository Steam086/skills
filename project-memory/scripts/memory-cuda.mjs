#!/usr/bin/env node
// Map existing CUDA libraries into a package-local loader directory. No installs,
// downloads, global loader edits, project trust changes, or GPU initialization.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--lib-dir')) {
  throw new Error('Usage: node scripts/memory-cuda.mjs [--lib-dir /absolute/CUDA/library/directory]');
}
const explicit = args[1] || process.env.PI_MEMORY_CUDA_LIB_DIR;
if (explicit && !path.isAbsolute(explicit)) throw new Error('CUDA library directory must be absolute.');
const discover = parent => {
  try { return fs.readdirSync(parent).filter(name => /^cuda(?:[-\d.]|$)/.test(name)).sort().reverse().map(name => path.join(parent, name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return []; }
};
const roots = [process.env.CUDA_HOME, process.env.CUDA_PATH, '/usr/local/cuda', '/opt/cuda',
  ...discover('/usr/local'), ...discover('/data/local')].filter(Boolean);
const directories = explicit ? [explicit] : [...new Set(roots.flatMap(root => [
  root, path.join(root, 'lib64'), path.join(root, 'lib'), path.join(root, 'targets/x86_64-linux/lib'),
]))];
const libraries = ['libcudart', 'libcublas', 'libcublasLt'];
let selected;
for (const directory of directories) {
  let files;
  try { files = fs.readdirSync(directory); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) continue; throw error; }
  for (const major of ['13', '12']) {
    const mappings = libraries.map(library => {
      const matcher = new RegExp(`^${library}\\.so\\.${major}(?:\\.\\d+)*$`);
      const candidates = files.filter(name => matcher.test(name)).sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
      const name = candidates.find(name => fs.statSync(path.join(directory, name)).isFile());
      return name && { source: fs.realpathSync(path.join(directory, name)), name: `${library}.so.${major}` };
    });
    if (mappings.every(Boolean)) { selected = mappings; break; }
  }
  if (selected) break;
}
if (!selected) {
  if (explicit) throw new Error('No complete CUDA 12/13 runtime (cudart, cublas, cublasLt) found in ' + explicit);
  console.log('No local CUDA 12/13 toolkit found; using system loader discovery. Set PI_MEMORY_CUDA_LIB_DIR and rerun this helper for a custom installation.');
} else {
  const runtime = path.join(pkg, 'runtime/cuda');
  for (const directory of [path.join(pkg, 'runtime'), runtime]) {
    try {
      const info = fs.lstatSync(directory);
      if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('Expected a real runtime directory: ' + directory);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  // Preflight every destination before creating any link; never overwrite one.
  const missing = selected.filter(({ source, name }) => {
    const destination = path.join(runtime, name);
    try {
      const info = fs.lstatSync(destination);
      if (!info.isSymbolicLink() || fs.realpathSync(destination) !== source) {
        throw new Error('Existing CUDA runtime entry differs; review manually: ' + destination);
      }
      return false;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      // A broken existing symlink is a conflict, not an absent destination.
      try { fs.lstatSync(destination); } catch (missingError) { if (missingError.code === 'ENOENT') return true; throw missingError; }
      throw new Error('Existing CUDA runtime entry is broken: ' + destination);
    }
  });
  fs.mkdirSync(runtime, { recursive: true, mode: 0o700 });
  for (const { source, name } of missing) fs.symlinkSync(source, path.join(runtime, name));
  console.log(`CUDA loader ready: ${runtime} (${selected.map(item => item.name).join(', ')}). Restart existing project QMD services to apply it.`);
}
