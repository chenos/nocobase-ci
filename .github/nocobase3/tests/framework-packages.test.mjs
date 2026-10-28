import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const script = fileURLToPath(new URL('../framework-packages.mjs', import.meta.url));
const sha = 'a'.repeat(40);

function write(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value));
}

function studio() {
  const root = mkdtempSync(path.join(tmpdir(), 'framework-packages-'));
  write(path.join(root, 'package.json'), {
    dependencies: { '@nocobase/app-server': 'workspace:*', '@nocobase/studio-cli': 'workspace:*', zod: '^4' },
    devDependencies: { '@nocobase/app-client': 'workspace:^' },
  });
  write(path.join(root, 'packages/studio-cli/package.json'), { name: '@nocobase/studio-cli', dependencies: { '@nocobase/app-cli-client': 'workspace:*' } });
  for (const [group, name] of [['app', 'app-server'], ['app', 'app-client'], ['app', 'app-cli-client'], ['libs', 'db']])
    write(path.join(root, `vendor/nocobase3/packages/${group}/${name}/package.json`), { name: `@nocobase/${name}` });
  return root;
}

const run = (...args) => execFileSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' } });

test('names the framework packages Studio and its own packages depend on, never Studio packages or registry ones', () => {
  const out = run(studio(), sha);
  assert.match(out, /^packages=@nocobase\/app-cli-client @nocobase\/app-client @nocobase\/app-server$/mu);
  assert.match(out, new RegExp(`^key=studio-framework-dist-v1-node\\d+-${sha}-[0-9a-f]{16}$`, 'mu'));
});

test('refuses anything but a 40-character commit', () => {
  assert.throws(() => run(studio(), 'main'));
  assert.throws(() => run(studio()));
});
