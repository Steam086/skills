#!/usr/bin/env node
// Explicit initialization: no settings changes, trust grants, or service startup.
import fs from 'node:fs';
import path from 'node:path';
import env from '../memory-env.cjs';
const template = fs.readFileSync(path.join(env.packageRoot, 'templates/index.yml'), 'utf8');
const config = path.join(env.root, '.qmd/index.yml');
if (fs.existsSync(config) && fs.readFileSync(config, 'utf8') !== template) {
  throw new Error('Existing project config differs; review it manually. No changes made.');
}
// Preflight both local ignore files before creating state or changing config.
// Append our rules last so existing negations cannot expose runtime artifacts.
const ignoreFiles = [
  { relative: '.pi/.gitignore', rules: ['/memory/', '/cache/', '/qmd-state/'] },
  { relative: '.qmd/.gitignore', rules: ['/index.sqlite*'] },
].map(({ relative, rules }) => {
  env.assertLocal(env.root, relative);
  const filename = path.join(env.root, relative);
  if (fs.existsSync(filename) && !fs.statSync(filename).isFile()) throw new Error('Expected a regular ignore file: ' + filename);
  const existing = fs.existsSync(filename) ? fs.readFileSync(filename, 'utf8') : '';
  const block = '# Project Memory private runtime state\n' + rules.join('\n') + '\n';
  const content = existing.endsWith(block) ? existing : existing + (existing && !existing.endsWith('\n') ? '\n' : '') + block;
  return { filename, existing, content };
});
for (const name of ['.qmd', '.pi/memory/daily', '.pi/memory/recovery', '.pi/cache/qmd/models', '.pi/qmd-state']) {
  env.assertLocal(env.root, name);
  fs.mkdirSync(path.join(env.root, name), { recursive: true, mode: 0o700 });
}
for (const { filename, existing, content } of ignoreFiles) {
  if (content !== existing) fs.writeFileSync(filename, content, { mode: 0o600 });
}
if (!fs.existsSync(config)) fs.writeFileSync(config, template, { flag: 'wx', mode: 0o600 });
console.log('Project directories and local ignore rules ready. Review .qmd/index.yml; trust and models remain explicit.');
