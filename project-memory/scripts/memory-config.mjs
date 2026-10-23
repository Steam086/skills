#!/usr/bin/env node
import { loadMemoryConfig, saveMemoryConfig } from '../lib/memory-config.mjs';

const usage = 'Usage: memory-config.mjs [--root DIRECTORY] [--mode manual|code-research|off] [--read on|off] [--write on|off] [--diagnostics on|off] [--auto-index on|off] [--warmup on|off]';
try {
  let root = process.cwd();
  const patch = {};
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log(usage);
  else {
    const booleanFields = { '--read': 'readEnabled', '--write': 'writeEnabled', '--auto-index': 'autoIndex', '--warmup': 'warmup' };
    for (let index = 0; index < args.length; index += 2) {
      const flag = args[index], value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error(usage);
      if (flag === '--root') root = value;
      else if (flag === '--mode') patch.mode = value;
      else if (flag === '--diagnostics' || Object.hasOwn(booleanFields, flag)) {
        if (!['on', 'off'].includes(value)) throw new Error('Boolean options require on or off');
        if (flag === '--diagnostics') patch.diagnostics = { enabled: value === 'on' };
        else patch[booleanFields[flag]] = value === 'on';
      } else throw new Error(usage);
    }
    console.log(JSON.stringify(Object.keys(patch).length ? saveMemoryConfig(root, patch) : loadMemoryConfig(root), null, 2));
  }
} catch (error) {
  // No filesystem paths or raw input in CLI error output.
  console.error(error.message.startsWith('Invalid memory configuration:') || error.message === usage || error.message === 'Boolean options require on or off' ? error.message : 'Memory configuration failed: unsafe, unavailable or busy project state');
  process.exitCode = 1;
}
