// Environment must be configured before pi-memory resolves its module-level paths.
import environment from '../memory-env.cjs';
import memoryExtension from '../node_modules/pi-memory/index.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

// Append this after upstream's generic memory prompt. Keep routing by intent;
// a loaded snapshot or skill does not itself authorize memory operations.
const memoryRoutingPolicy = `
Project memory routing policy:
- Default to no memory-tool calls when the current conversation, supplied text, or current source is sufficient. Retrieve only requested stored information or genuinely missing prior-session project context; an explicit stored-record inspection still warrants a targeted read.
- Route by affirmative intent, not words such as "remember", "previously", or "last time". Quoted/hypothetical examples, negations, task-local reminders, and questions about memory software do not themselves authorize memory operations.
- Honor read and write opt-outs independently and within their stated scope; do not bypass them with file tools or scripts. A read-only request does not authorize saving, cleanup, reindexing, or repair.
- Model-initiated persistence requires a clear user request or approval, not merely an important discovery. Apply the project-memory skill for authorized operations; loading it alone grants no read/write permission. Deduplicate approved long-term writes, keep scope concise, and confirm only actual tool success. Do not routinely offer saves or log completed tasks.
- Query only the missing fact: keyword for exact symbols/paths, semantic for conceptual or cross-language recall, deep only if needed. Memory is dated navigation, not authority; verify current code and disclose gaps or conflicts. Never save secrets or full transcripts, read other projects' memories, or enable legacy repo-memory.
- Do not run ritual memory_status/search checks. These are model-routing rules, not a plugin on/off switch: automatic snapshot injection, startup warmup, and compaction handoffs remain runtime behavior; do not claim a natural-language opt-out disables them or removes already-loaded context.
`;

function checkScope(ctx: { cwd: string }) {
  if (fs.realpathSync(ctx.cwd) !== environment.root) {
    throw new Error('Project memory is bound to its launch directory. Use a separate Pi process for another project.');
  }
  environment.configure();
}

export default function (pi: ExtensionAPI) {
  // Guard every upstream callback, including direct SDK tool execution.
  const scoped = new Proxy(pi, {
    get(target, key) {
      if (key === 'on') return (event: any, handler: any) => target.on(event, async (value: any, ctx: any) => {
        checkScope(ctx);
        return handler(value, ctx);
      });
      if (key === 'registerTool') return (tool: any) => target.registerTool({ ...tool,
        execute: (...args: any[]) => { checkScope(args[4]); return tool.execute(...args); },
      });
      if (key === 'registerCommand') return (name: string, command: any) => target.registerCommand(name, { ...command,
        handler: (args: any, ctx: any) => { checkScope(ctx); return command.handler(args, ctx); },
      });
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  memoryExtension(scoped);
  pi.on('session_start', async (_event, ctx) => {
    checkScope(ctx);
    try {
      await promisify(execFile)(path.join(environment.packageRoot, 'bin/qmd'), ['service', 'start', '--warm'], {
        cwd: environment.root, env: process.env, timeout: 15000, maxBuffer: 65536,
      });
    } catch (error) {
      const stderr = (error as { stderr?: string }).stderr;
      const detail = stderr?.trim() || String(error);
      const message = `Project QMD warmup failed: ${detail.slice(0, 900)}\nSee ${environment.root}/.pi/qmd-state/service.log`;
      if (ctx.hasUI) ctx.ui.notify(message, 'warning');
      else console.error(message);
    }
  });
  // Retain the project service between Sessions; its idle timer or explicit stop releases it.
  pi.on('before_agent_start', async (event, ctx) => {
    checkScope(ctx);
    return { systemPrompt: event.systemPrompt + memoryRoutingPolicy };
  });
}
