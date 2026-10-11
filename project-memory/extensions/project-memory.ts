// Environment must be configured before pi-memory resolves its module-level paths.
import environment from '../memory-env.cjs';
import memoryExtension from '../node_modules/pi-memory/index.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

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
      const message = `Project QMD warmup failed; check scripts/qmd-memory: ${String(error).slice(0, 300)}`;
      if (ctx.hasUI) ctx.ui.notify(message, 'warning');
      else console.error(message);
    }
  });
  // Retain the project service between Sessions; its idle timer or explicit stop releases it.
  pi.on('before_agent_start', async (event, ctx) => {
    checkScope(ctx);
    return { systemPrompt: event.systemPrompt + '\nUse memory_search keyword for exact symbols/paths, semantic for cross-language concepts, and deep only when needed. Memory is navigation: verify current source. Never save secrets or full transcripts.\n' };
  });
}
