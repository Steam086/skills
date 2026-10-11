// Loaded only by the scope test, in its owned temporary project.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const host = await import(pathToFileURL(process.env.PI_MEMORY_TEST_HOST));
const cwd = process.cwd();
const loader = new host.DefaultResourceLoader({
  cwd, agentDir: path.join(cwd, 'agent'),
  settingsManager: host.SettingsManager.inMemory({ packages: [], extensions: [] }),
  noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
  additionalExtensionPaths: [process.env.PI_MEMORY_TEST_PACKAGE],
  additionalSkillPaths: [path.join(process.env.PI_MEMORY_TEST_PACKAGE, 'SKILL.md')],
});
await loader.reload();
const skills = loader.getSkills();
assert.deepEqual(skills.diagnostics, []);
assert.ok(skills.skills.some(skill => skill.name === 'project-memory'));
const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, []);
assert.deepEqual(loaded.warnings, []);
assert.equal(loaded.extensions.length, 1);
const tools = loaded.extensions[0].tools;
for (const name of ['memory_write', 'memory_read', 'memory_search', 'memory_forget', 'memory_restore', 'memory_status', 'scratchpad']) assert.ok(tools.has(name), name);
const write = tools.get('memory_write').definition;
const ctx = { cwd, sessionManager: host.SessionManager.inMemory(cwd) };
await write.execute('scope-test', { target: 'long_term', content: process.env.PI_MEMORY_TEST_MARKER }, undefined, undefined, ctx);
assert.match(fs.readFileSync(path.join(cwd, '.pi/memory/MEMORY.md'), 'utf8'), new RegExp(process.env.PI_MEMORY_TEST_MARKER));
await assert.rejects(async () => write.execute('wrong-project', { target: 'daily', content: 'wrong' }, undefined, undefined, { ...ctx, cwd: path.dirname(cwd) }), /bound to its launch directory/);
console.log(JSON.stringify({ tools: [...tools.keys()], memoryWrite: true, wrongProjectRejected: true }));
// Do not emit Session startup or allow background timers to launch GPU work.
process.exit(0);
