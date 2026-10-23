#!/usr/bin/env node
import { loadMemoryConfig } from '../lib/memory-config.mjs';
import { createMemoryTelemetry } from '../lib/memory-telemetry.mjs';

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') console.log('Usage: memory-report.mjs [--root DIRECTORY]');
  else {
    if (args.length !== 0 && !(args.length === 2 && args[0] === '--root' && args[1] && !args[1].startsWith('--'))) throw new Error('Invalid arguments');
    const root = args[1] ?? process.cwd();
    const result = createMemoryTelemetry(root, loadMemoryConfig(root)).report();
    console.log(JSON.stringify(result, null, 2));
    if (result.status === 'error') process.exitCode = 1;
  }
} catch {
  console.error('Memory report failed: invalid arguments, configuration or unsafe project state');
  process.exitCode = 1;
}
