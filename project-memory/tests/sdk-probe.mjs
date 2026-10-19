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
const skill = skills.skills.find(skill => skill.name === 'project-memory');
assert.ok(skill);
assert.equal(skill.disableModelInvocation, false);
assert.ok(skill.description.length <= 1024);
assert.match(skill.description, /^Use only for explicit requests/);
const skillText = fs.readFileSync(path.join(process.env.PI_MEMORY_TEST_PACKAGE, 'SKILL.md'), 'utf8');
assert.doesNotMatch(skillText, /[^\x00-\x7f]/);
assert.match(skillText, /A read-only request does not authorize a write/);
assert.match(skillText, /Do not overwrite all of `MEMORY\.md`/);
assert.match(skillText, /daily logs are not an automatic fallback for unapproved facts/);
assert.match(skillText, /preserve the returned recovery ID and disclose a partial failure/);
assert.doesNotMatch(skillText, /\.\.\/\.\.\/\.\.\//, 'No source-checkout-relative script paths');
const loaded = loader.getExtensions();
assert.deepEqual(loaded.errors, []);
assert.deepEqual(loaded.warnings, []);
assert.equal(loaded.extensions.length, 1);
const extension = loaded.extensions[0];
assert.equal(extension.handlers.get('session_start').length, 2);
assert.equal(extension.handlers.get('session_before_compact').length, 1);
const policyHandlers = extension.handlers.get('before_agent_start');
assert.equal(policyHandlers.length, 2);
const base = 'BASE\nUpstream memory prompt: persist important information.\n';
const event = { type: 'before_agent_start', messageType: 'user', prompt: 'Explain this function.', systemPrompt: base };
const policyHandler = policyHandlers.at(-1);
const result = await policyHandler(event, { cwd });
assert.ok(result.systemPrompt.startsWith(base));
const policy = result.systemPrompt.slice(base.length);
assert.match(policy, /^\nProject memory routing policy:/);
assert.doesNotMatch(policy, /[^\x00-\x7f]/);
for (const pattern of [
  /Default to no memory-tool calls/,
  /Route by affirmative intent, not words/,
  /Quoted\/hypothetical examples, negations, task-local reminders/,
  /read and write opt-outs independently/,
  /do not bypass them with file tools or scripts/,
  /persistence requires a clear user request or approval/,
  /Deduplicate approved long-term writes.*actual tool success/,
  /does not authorize saving, cleanup, reindexing, or repair/,
  /Do not run ritual memory_status\/search checks/,
  /not a plugin on\/off switch/,
]) assert.match(policy, pattern);
for (const prompt of [
  'Translate "remember my preference".',
  'Do not save this temporary setting.',
  'Recall last session, but do not save anything.',
  'Remember this project preference for future sessions.',
  '\u524d\u9762\u7684\u51fd\u6570\u5c31\u5728\u672c\u5bf9\u8bdd\u4e2d\uff0c\u8bf7\u89e3\u91ca\u5b83\u3002',
  '\u4e0d\u8981\u68c0\u7d22\u8bb0\u5fc6\uff0c\u53ea\u5206\u6790\u8fd9\u6bb5\u4ee3\u7801\u3002',
]) assert.equal((await policyHandler({ ...event, prompt }, { cwd })).systemPrompt, result.systemPrompt);
await assert.rejects(async () => policyHandler(event, { cwd: path.dirname(cwd) }), /bound to its launch directory/);
const tools = extension.tools;
for (const name of tools.keys()) assert.ok(skillText.includes('`' + name + '`'), name);
for (const name of ['memory_write', 'memory_read', 'memory_search', 'memory_forget', 'memory_restore', 'memory_status', 'scratchpad']) assert.ok(tools.has(name), name);
const write = tools.get('memory_write').definition;
const ctx = { cwd, sessionManager: host.SessionManager.inMemory(cwd) };
await write.execute('scope-test', { target: 'long_term', content: process.env.PI_MEMORY_TEST_MARKER }, undefined, undefined, ctx);
assert.match(fs.readFileSync(path.join(cwd, '.pi/memory/MEMORY.md'), 'utf8'), new RegExp(process.env.PI_MEMORY_TEST_MARKER));
await assert.rejects(async () => write.execute('wrong-project', { target: 'daily', content: 'wrong' }, undefined, undefined, { ...ctx, cwd: path.dirname(cwd) }), /bound to its launch directory/);
console.log(JSON.stringify({ tools: [...tools.keys()], memoryWrite: true, wrongProjectRejected: true, routingPolicyContract: true }));
// Do not emit Session startup or allow background timers to launch GPU work.
process.exit(0);
