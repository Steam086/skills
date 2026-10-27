import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('manifest exposes only the explicit installer skill, no runtime or dependencies', () => {
  const manifest = JSON.parse(read('package.json'));
  assert.deepEqual(manifest.pi, {
    skills: ['./SKILL.md'], extensions: [], prompts: [], themes: [],
  });
  assert.equal(manifest.dependencies, undefined);
  for (const file of manifest.pi.skills) assert.ok(fs.statSync(path.join(root, file)).isFile());
});

test('local Markdown references resolve and instructions retain installation boundaries', () => {
  for (const file of ['SKILL.md', 'README.md', 'references/installation.md']) {
    const text = read(file);
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^https?:/.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(file), target)), `${file}: ${target}`);
    }
    assert.doesNotMatch(text, /\/home\/jjr/);
  }
  const instructions = read('SKILL.md') + read('references/installation.md');
  for (const contract of ['disable-model-invocation: true', 'SHA256', 'EXDEV', 'never overwrite', 'Permanent Pi trust', 'Never install the runtime globally', 'Never scan the whole filesystem', 'Never commit memory', 'service start --warm']) {
    assert.ok(instructions.includes(contract), contract);
  }
});

test('registration instructions conditionally deduplicate skills and preserve the runtime', () => {
  const instructions = read('references/installation.md');
  for (const contract of [
    'after registration and on repeated installations',
    'exactly one valid project-local skill',
    '"skills": []',
    'If no project-local skill exists, keep the package skill enabled',
    'change only its `skills` field',
    'preserve the source, extension filters, and all other properties',
    'resolved path',
    'Do not infer validity from file existence alone',
    'Malformed or incompatible local skills',
    'Do not remove the runtime package',
    'exactly one selected skill source',
    'report only static validation',
  ]) {
    assert.ok(instructions.includes(contract), contract);
  }
  for (const file of ['SKILL.md', 'README.md', 'references/installation.md']) {
    assert.doesNotMatch(read(file), /\p{Script=Han}/u, `${file} must use English prose`);
  }
});

test('real Pi discovers the skill but excludes it from automatic skill prompt', async () => {
  const host = process.env.PI_MEMORY_TEST_HOST || path.join(
    execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(),
    '@earendil-works/pi-coding-agent/dist/index.js',
  );
  assert.ok(fs.existsSync(host), 'Set PI_MEMORY_TEST_HOST to the installed Pi dist/index.js');
  const { loadSkills, formatSkillsForPrompt } = await import(pathToFileURL(host).href);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'project-memory-init-test-'));
  try {
    const { skills, diagnostics } = loadSkills({
      cwd: temp, agentDir: temp, skillPaths: [path.join(root, 'SKILL.md')], includeDefaults: false,
    });
    assert.deepEqual(diagnostics, []);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, 'project-memory-init');
    assert.equal(skills[0].disableModelInvocation, true);
    assert.equal(fs.realpathSync(skills[0].baseDir), fs.realpathSync(root));
    assert.doesNotMatch(formatSkillsForPrompt(skills), /project-memory-init/);
    assert.deepEqual(fs.readdirSync(temp), []);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
