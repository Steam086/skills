#!/usr/bin/env node
// Explicitly prepare one project's shared memory directory and Codex skill.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fs.realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const args = process.argv.slice(2);
let rootArg;
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '--root' || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: memory-setup.mjs [--root PROJECT]');
  if (rootArg) throw new Error('Specify --root only once.');
  rootArg = args[++i];
}
const requestedRoot = rootArg || process.env.PROJECT_MEMORY_PROJECT_ROOT || process.env.PI_MEMORY_PROJECT_ROOT || process.cwd();
const root = fs.realpathSync(path.resolve(requestedRoot));
if (!fs.lstatSync(root).isDirectory()) throw new Error('Project root must be a directory.');
if (root === packageRoot || root.startsWith(packageRoot + path.sep)) throw new Error('Run from a consumer project, not the package directory.');

function inspect(relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      const stat = fs.lstatSync(current);
      if (stat.isSymbolicLink()) throw new Error(`Symlink is not allowed: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function ensureDirectory(relative) {
  inspect(relative);
  fs.mkdirSync(path.join(root, relative), { recursive: true, mode: 0o700 });
  inspect(relative);
}
function regularFile(relative) {
  inspect(relative);
  const filename = path.join(root, relative);
  if (!fs.existsSync(filename)) return null;
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(`Expected a private regular file: ${filename}`);
  return fs.readFileSync(filename, 'utf8');
}

const memoryRoot = '.project-memory';
const template = fs.readFileSync(path.join(packageRoot, 'templates/index.yml'), 'utf8');
const qmdConfig = `${memoryRoot}/.qmd/index.yml`;
const existingConfig = regularFile(qmdConfig);
const hasLegacyQmdConfig = ['.qmd/index.yml', '.qmd/index.yaml'].some(relative => fs.existsSync(path.join(root, relative)));
const customQmdConfig = existingConfig !== null && existingConfig !== template;
const gitignorePath = `${memoryRoot}/.gitignore`;
const oldGitignore = regularFile(gitignorePath) ?? '';
const ignoreBlock = '# Project Memory local data; keep this directory private.\n*\n!.gitignore\n';
const nextGitignore = oldGitignore.endsWith(ignoreBlock)
  ? oldGitignore : oldGitignore + (oldGitignore && !oldGitignore.endsWith('\n') ? '\n' : '') + ignoreBlock;
const skillRelative = '.agents/skills/project-memory/SKILL.md';
const skillPath = path.join(root, skillRelative);
const skill = fs.readFileSync(path.join(packageRoot, 'SKILL.md'), 'utf8');
const existingSkill = regularFile(skillRelative);
if (existingSkill !== null && existingSkill !== skill) throw new Error(`Existing ${skillRelative} differs; reconcile it with the package SKILL.md first.`);

for (const relative of [memoryRoot, `${memoryRoot}/topics`, `${memoryRoot}/daily`, `${memoryRoot}/recovery`,
  `${memoryRoot}/diagnostics`, `${memoryRoot}/handoffs`, `${memoryRoot}/.qmd`, `${memoryRoot}/qmd-state`,
  `${memoryRoot}/cache/qmd/models`, path.posix.dirname(skillRelative)]) ensureDirectory(relative);
if (nextGitignore !== oldGitignore) fs.writeFileSync(path.join(root, gitignorePath), nextGitignore, { mode: 0o600 });
if (existingConfig === null && !hasLegacyQmdConfig) fs.writeFileSync(path.join(root, qmdConfig), template, { flag: 'wx', mode: 0o600 });
if (existingSkill === null) fs.writeFileSync(skillPath, skill, { flag: 'wx', mode: 0o600 });
console.log(`Shared memory directories and Codex skill are ready under ${root}.`);
console.log('Existing Pi memory is preserved; run scripts/memory-migrate.mjs --apply to copy it into .project-memory/.');
if (hasLegacyQmdConfig && existingConfig === null) console.log('Legacy QMD configuration was left untouched; migration will copy and retarget it.');
if (customQmdConfig) console.log(`Existing ${qmdConfig} was preserved; review its collection scope before explicitly trusting QMD.`);
console.log('QMD trust, model provisioning, and service startup remain explicit.');
