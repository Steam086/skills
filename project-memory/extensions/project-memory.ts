import environment from '../memory-env.cjs';
import fs from 'node:fs';
import { Type } from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { MEMORY_TOOLS } from '../lib/memory-tools.mjs';
import { createMemoryService } from '../lib/memory-service.mjs';

function checkScope(ctx: { cwd: string }) {
  if (fs.realpathSync(ctx.cwd) !== environment.root) {
    throw new Error('Project memory is bound to its launch directory. Use a separate Pi process for another project.');
  }
  environment.configure();
}

function toTypeBox(schema: any, required = true): any {
  let result: any;
  if (schema.type === 'object') {
    const requiredKeys = new Set(schema.required ?? []);
    const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([key, value]) => [key, toTypeBox(value, requiredKeys.has(key))]));
    result = Type.Object(properties, { additionalProperties: false });
  } else if (schema.type === 'array') {
    result = Type.Array(toTypeBox(schema.items), { maxItems: schema.maxItems });
  } else if (schema.type === 'string' && schema.enum) {
    result = Type.Union(schema.enum.map((value: string) => Type.Literal(value)));
  } else if (schema.type === 'string') {
    result = Type.String({ minLength: schema.minLength, maxLength: schema.maxLength, pattern: schema.pattern });
  } else if (schema.type === 'integer') {
    result = Type.Integer({ minimum: schema.minimum, maximum: schema.maximum });
  } else if (schema.type === 'boolean') {
    result = Type.Boolean();
  } else {
    throw new Error(`Unsupported memory tool schema type: ${schema.type}`);
  }
  return required ? result : Type.Optional(result);
}

export default function projectMemory(pi: ExtensionAPI) {
  const service = createMemoryService(environment);

  pi.registerCommand('memory-mode', {
    description: 'Session memory mode: manual | code-research | off',
    handler: async (args, ctx) => {
      checkScope(ctx);
      const mode = args.trim();
      if (!['manual', 'code-research', 'off'].includes(mode)) throw new Error('Use manual, code-research, or off.');
      service.setMode(mode);
      if (ctx.hasUI) ctx.ui.notify(`Memory mode: ${mode}`, 'info');
    },
  });

  pi.registerCommand('memory-access', {
    description: 'Session memory permission: read|write on|off',
    handler: async (args, ctx) => {
      checkScope(ctx);
      const [access, enabled, extra] = args.trim().split(/\s+/);
      if (!['read', 'write'].includes(access) || !['on', 'off'].includes(enabled) || extra) {
        throw new Error('Use read|write on|off.');
      }
      service.setAccess(access, enabled === 'on');
      if (ctx.hasUI) ctx.ui.notify(`Memory ${access}: ${enabled}`, 'info');
    },
  });

  pi.on('session_start', async (_event, ctx) => {
    checkScope(ctx);
    await service.warmup();
  });
  pi.on('session_shutdown', async (_event, ctx) => {
    checkScope(ctx);
    service.shutdown();
  });
  pi.on('before_agent_start', async (event, ctx) => {
    checkScope(ctx);
    const sections = event.systemPromptOptions?.sections;
    const access = service.status();
    if (!access.readEnabled || access.mode === 'off') {
      if (sections) delete sections.project_memory;
      return;
    }
    const context = service.context(ctx.sessionManager?.getSessionId());
    if (sections) {
      sections.project_memory = context;
      return;
    }
    return { systemPrompt: `${event.systemPrompt}\n${context}` };
  });
  pi.on('turn_end', async (event, ctx) => {
    checkScope(ctx);
    service.recordUsage({ ...event.message, messageEntryId: event.messageEntryId }, ctx.sessionManager?.getSessionId());
  });

  for (const [name, definition] of Object.entries(MEMORY_TOOLS)) {
    pi.registerTool({
      name,
      label: definition.title,
      description: definition.description,
      parameters: toTypeBox(definition.inputSchema),
      async execute(_callId, params, signal, _onUpdate, ctx) {
        checkScope(ctx);
        return service.executeTool(name, params, { signal, sessionId: ctx.sessionManager?.getSessionId() });
      },
    });
  }
}
