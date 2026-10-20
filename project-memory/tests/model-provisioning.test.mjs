import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('offline reuse, atomic provisioning, conflicts, locks and copy policy', () => {
  const result = spawnSync('python3', [fileURLToPath(new URL('./model_provisioning_checks.py', import.meta.url))], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
