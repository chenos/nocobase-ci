import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../run-studio-browser.sh', import.meta.url));
function fixture(t, version = '1.62.1') {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'studio browser ')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const studio = path.join(root, 'studio');
  const pkg = path.join(studio, 'node_modules/@playwright/test');
  const bin = path.join(root, 'bin');
  mkdirSync(pkg, { recursive: true });
  mkdirSync(bin);
  writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version }));
  const docker = path.join(bin, 'docker');
  writeFileSync(docker, '#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv.slice(2)));\n');
  chmodSync(docker, 0o755);
  return { studio, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PNPM_HOME: bin } };
}

test('uses the installed browser version and preserves paths and command arguments', (t) => {
  const { studio, env } = fixture(t);
  const result = execFileSync('bash', [script, studio, 'pnpm', 'test:e2e', '--grep', 'title with spaces'], { env, encoding: 'utf8' });
  const args = JSON.parse(result.trim().split('\n').at(-1));
  assert.deepEqual(args.slice(-5), ['mcr.microsoft.com/playwright:v1.62.1-noble', 'pnpm', 'test:e2e', '--grep', 'title with spaces']);
  assert.ok(args.includes(`${studio}:${studio}`));
  const nodeRoot = path.dirname(path.dirname(process.execPath));
  assert.ok(args.includes(`${nodeRoot}:${nodeRoot}:ro`));
  assert.ok(args.includes(`${path.dirname(env.PNPM_HOME)}:${path.dirname(env.PNPM_HOME)}:ro`));
  assert.ok(args.includes('--interactive'));
  assert.ok(args.includes('--user'));
  assert.deepEqual(args.flatMap((a, i) => a === '--env' ? [args[i + 1].split('=')[0]] : []), ['HOME', 'PATH', 'CI', 'GITHUB_ACTIONS', 'NODE_OPTIONS']);
});

test('rejects an invalid version before starting a container', (t) => {
  const { studio, env } = fixture(t, '1.62.1/other');
  assert.throws(() => execFileSync('bash', [script, studio, 'pnpm', 'test:e2e'], { env, stdio: 'pipe' }), /Unsupported Playwright version/);
});
