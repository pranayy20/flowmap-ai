#!/usr/bin/env node
/**
 * Thin wrapper around Node's built-in test runner (`node --test`).
 *
 * Deliberately ignores any CLI args this script is invoked with (e.g.
 * pr-checks.yml runs `npm test -- --coverage`) and always runs the same
 * fixed, known-good command -- `node --test` treats an unrecognized
 * trailing flag like `--coverage` as a test-path glob and fails to find a
 * match, so passing it straight through breaks CI. Coverage is always on
 * via --experimental-test-coverage regardless of what's appended after
 * `npm test --`.
 */
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['--experimental-test-coverage', '--test', 'extension/src/export/__tests__'],
  { stdio: 'inherit' }
);

process.exit(result.status ?? 1);
