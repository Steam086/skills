#!/usr/bin/env node
import path from 'node:path';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { MEMORY_TOOLS } from '../lib/memory-tools.mjs';
import { createMemoryService } from '../lib/memory-service.mjs';

function argumentsConfig(argv) {
  const config = {};
  for (let i = 0; i < argv.length; i++) {
    const option = argv[i];
    if (!['--root', '--mode', '--read', '--write'].includes(option)) throw new Error(`Unknown option: ${option}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${option}`);
    if (option === '--root') config.root = path.resolve(value);
    else if (option === '--mode') {
      if (!['manual', 'code-research', 'off'].includes(value)) throw new Error('--mode must be manual, code-research, or off');
      config.mode = value;
    } else {
      if (!['on', 'off'].includes(value)) throw new Error(`${option} must be on or off`);
      config[option.slice(2) === 'read' ? 'readEnabled' : 'writeEnabled'] = value === 'on';
    }
  }
  return config;
}

async function main() {
  const options = argumentsConfig(process.argv.slice(2));
  if (options.root) process.env.PROJECT_MEMORY_PROJECT_ROOT = options.root;
  const { default: environment } = await import('../memory-env.cjs');
  const service = createMemoryService(environment);
  const overrides = Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'root'));
  if (Object.keys(overrides).length) service.setOverrides(overrides);

  const handle = serveStdio(() => {
    const server = new McpServer({ name: 'project-memory', version: '0.1.2' }, { capabilities: { tools: {} } });
    for (const [name, definition] of Object.entries(MEMORY_TOOLS)) {
      server.registerTool(name, {
        title: definition.title,
        description: definition.description,
        inputSchema: fromJsonSchema(definition.inputSchema),
      }, async (params, ctx) => {
        const result = await service.executeTool(name, params, { signal: ctx.mcpReq.signal, sessionId: ctx.sessionId });
        return { content: result.content, ...(result.isError ? { isError: true } : {}) };
      });
    }
    return server;
  }, { onerror: error => process.stderr.write(`project-memory MCP: ${error.message}\n`) });

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    service.shutdown();
    await handle.close();
  };
  process.once('SIGINT', () => { void close().finally(() => { process.exitCode = 0; }); });
  process.once('SIGTERM', () => { void close().finally(() => { process.exitCode = 0; }); });
}

main().catch(error => {
  process.stderr.write(`project-memory MCP: ${error.message}\n`);
  process.exitCode = 1;
});
