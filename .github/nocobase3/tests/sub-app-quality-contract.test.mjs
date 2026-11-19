import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const workflow = readFileSync(new URL('../../workflows/multi-tenant-sub-quality.yml', import.meta.url), 'utf8');
const checkout = readFileSync(new URL('../sub-app-checkout/action.yml', import.meta.url), 'utf8');
const setup = readFileSync(new URL('../sub-app-setup/action.yml', import.meta.url), 'utf8');

test('the sub-app workflow matches the Bot run-name, dispatch inputs and five check names', () => {
  assert.match(workflow, /^run-name: multi-tenant-sub-quality:.*inputs\.request_id/mu);
  assert.deepEqual(
    [...workflow.slice(0, workflow.indexOf('\npermissions:')).matchAll(/^      ([a-z_]+):$/gmu)].map((m) => m[1]),
    ['request_id', 'event_name', 'head_sha', 'base_sha', 'target_branch', 'pr_number', 'skip_label'],
  );
  assert.deepEqual(
    [...workflow.matchAll(/^          - name: (.+)$/gmu)].map((m) => m[1]),
    ['Lint', 'Typecheck', 'Node tests', 'Client tests'],
  );
  assert.match(workflow, /  build:\n    name: Build\n    needs: quality/u);
  assert.doesNotMatch(workflow, /pull_request_target|^  push:|^  pull_request:/mu);
});

test('checks the exact head with a sub-app-only OIDC token revoked before application installation', () => {
  assert.match(checkout, /repository: nocobase\/multi-tenant-sub-app/u);
  assert.match(checkout, /ref: \$\{\{ inputs\.head-sha \}\}/u);
  assert.match(checkout, /MERGE_PULL_REQUEST: 'false'/u);
  assert.match(checkout, /SUBMODULES: 'false'/u);
  assert.match(checkout, /audience=nocobase-bot/u);
  assert.match(checkout, /api\/ci\/multi-tenant-sub-source-token/u);
  assert.doesNotMatch(checkout, /secrets\.|studio-source-token|private-key|create-github-app-token/u);
  assert.match(checkout, /if: \$\{\{ always\(\) && steps\.source-token\.outputs\.token != '' \}\}/u);
  assert.match(checkout, /https:\/\/api.github.com\/installation\/token/u);
  assert.equal((workflow.match(/id-token: write/gu) ?? []).length, 2);
  assert.ok(
    workflow.indexOf('uses: ./.github/nocobase3/sub-app-checkout') <
      workflow.indexOf('uses: ./.github/nocobase3/sub-app-setup'),
  );
});

test('retains the sub-app checks, frozen install, Linux target and credential cleanup', () => {
  for (const command of [
    'pnpm lint && pnpm format:check',
    'pnpm typecheck',
    'pnpm check:packages && pnpm exec vitest run --project node --maxWorkers=1 --passWithNoTests=false',
    'pnpm exec vitest run --project client --maxWorkers=2 --passWithNoTests=false',
    'pnpm build --target linux-x64 --node-version 24 --tar',
  ])
    assert.ok(workflow.includes(command), command);
  assert.match(setup, /pnpm install --frozen-lockfile/u);
  assert.match(setup, /umask 077/u);
  assert.match(setup, /package_json_file: sub-app\/package.json/u);
  assert.match(setup, /node-version: 24/u);
  assert.equal((workflow.match(/rm -f "\$RUNNER_TEMP\/sub-app-npmrc"/gu) ?? []).length, 2);
  assert.doesNotMatch(workflow, /secrets\.(?!PRO_NPM_TOKEN)|upload-artifact|actions\/cache|NB_STUDIO_API_KEY/u);
});

test('the composite shell scripts parse without running them', () => {
  for (const content of [checkout, setup]) {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim().startsWith('run: |')) continue;
      const indent = lines[i].search(/\S/u);
      const body = [];
      for (let j = i + 1; j < lines.length && (lines[j].trim() === '' || lines[j].search(/\S/u) > indent); j++)
        body.push(lines[j].slice(indent + 2));
      const result = spawnSync('bash', ['-n'], { input: body.join('\n'), encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
  }
});

test('Node 24 is selected before the declared pnpm version is installed', () => {
  assert.ok(setup.indexOf('uses: actions/setup-node@v4') < setup.indexOf('uses: pnpm/action-setup@v4'));
});
