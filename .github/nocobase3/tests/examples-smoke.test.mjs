import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../workflows/nocobase3-quality.yml', import.meta.url), 'utf8');

function job(id) {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  assert.notEqual(start, -1, id);
  const rest = workflow.slice(start + 1);
  const next = rest.search(/\n(?:  #[^\n]*\n)*  [a-z][a-z0-9-]*:\n/u);
  return next === -1 ? rest : rest.slice(0, next);
}

function runLastStep(source, env) {
  const run = source.slice(source.lastIndexOf('        run: |\n') + '        run: |\n'.length)
    .split('\n').map((line) => line.replace(/^          /u, '')).join('\n');
  return spawnSync('bash', ['-e', '-c', run], { env: { ...process.env, ...env }, encoding: 'utf8' });
}

test('runs both complete Examples projects without cancelling the other on failure', () => {
  const source = job('create-app-smoke-examples-projects');
  assert.match(source, /matrix:\n        project: \[node, client\]/u);
  assert.match(source, /fail-fast: false/u);
  assert.match(source, /timeout-minutes: 30/u);
  assert.match(source, /needs:\n      - build\n      - quality-plan/u);
  assert.match(source, /if: \$\{\{ needs\.quality-plan\.outputs\.run_create_app == 'true' \}\}/u);
  assert.match(source, /name: create-app-packages\n          path: \$\{\{ runner.temp \}\}\/nocobase-pack-check/u);
  assert.match(source, /uses: \.\/\.github\/actions\/verify-create-app/u);
  assert.match(source, /local-packages-only: 'true'/u);
  assert.match(source, /template-kind: examples\n          test-project: \$\{\{ matrix.project \}\}/u);
  assert.match(source, /package-artifacts: \$\{\{ runner.temp \}\}\/nocobase-pack-check/u);
  assert.doesNotMatch(source, /continue-on-error/u);
});

test('keeps the mirrored check static and rejects a failed, cancelled or missing project', () => {
  const source = job('create-app-smoke-examples');
  assert.match(source, /name: Create-app smoke \(examples\)\n/u);
  assert.match(source, /needs:\n      - quality-plan\n      - create-app-smoke-examples-projects/u);
  assert.match(source, /if: \$\{\{ always\(\) && needs\.quality-plan\.outputs\.run_create_app == 'true' \}\}/u);
  assert.match(source, /RESULT: \$\{\{ needs\['create-app-smoke-examples-projects'\].result \}\}/u);
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
    const run = runLastStep(source, { RESULT: result });
    assert.equal(run.status, result === 'success' ? 0 : 1, run.stderr || run.stdout);
  }
});

test('quality waits for the static check and accepts a skip only when explicitly unplanned', () => {
  const source = job('quality');
  assert.match(source, /      - create-app-smoke-examples\n/u);
  assert.match(source, /CREATE_APP_EXAMPLES_RESULT: \$\{\{ needs\['create-app-smoke-examples'\].result \}\}/u);
  const passing = {
    SCOPE_RESULT: 'success', PLAN_RESULT: 'success', CHANGED_FILES_RESULT: 'success',
    TYPECHECK_RESULT: 'success', TEST_RESULT: 'success', BUILD_RESULT: 'success', DB_PLAN_RESULT: 'success',
    RUN_CREATE_APP: 'true', CREATE_APP_DEFAULT_RESULT: 'success', CREATE_APP_EXAMPLES_RESULT: 'success',
    RUN_APP_INSTALLER: 'true', APP_INSTALLER_SMOKE_RESULT: 'success', DB_SHOULD_RUN: 'false', DB_INTEGRATION_RESULT: 'skipped',
  };
  for (const result of ['success', 'failure', 'cancelled', 'skipped', '']) {
    const run = runLastStep(source, { ...passing, CREATE_APP_EXAMPLES_RESULT: result });
    assert.equal(run.status, result === 'success' ? 0 : 1, run.stderr || run.stdout);
  }
  const skipped = { ...passing, RUN_CREATE_APP: 'false', CREATE_APP_DEFAULT_RESULT: 'skipped', CREATE_APP_EXAMPLES_RESULT: 'skipped' };
  assert.equal(runLastStep(source, skipped).status, 0);
  assert.equal(runLastStep(source, { ...skipped, PLAN_RESULT: 'failure' }).status, 1);
});
