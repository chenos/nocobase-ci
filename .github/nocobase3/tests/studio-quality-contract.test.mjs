import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const workflow = readFileSync(path.join(root, '.github/workflows/studio-quality.yml'), 'utf8');
const checkout = readFileSync(path.join(root, '.github/nocobase3/studio-checkout/action.yml'), 'utf8');

// The check names nocobase-bot mirrors onto nocobase/studio from this workflow (STUDIO_POOLED_CHECK_NAMES there), which
// are also the jobs it hands a nocobase/studio token to.
const expectedJobs = ['Submodule pointer', 'Lint', 'Typecheck', 'Test', 'API document', 'CLI reference', 'Studio e2e'];

function job(id) {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  assert.notEqual(start, -1, `job ${id}`);
  const next = workflow.slice(start + 1).search(/\n  [a-z][a-z0-9-]*:\n/u);
  return next === -1 ? workflow.slice(start) : workflow.slice(start, start + 1 + next);
}

function jobNames() {
  const matrixNames = [...job('check').matchAll(/^          - name: (.+)$/gmu)].map((match) => match[1]);
  return [...workflow.matchAll(/^  ([a-z][a-z0-9-]*):\n    name: (.+)$/gmu)].flatMap(([, , name]) =>
    name === '${{ matrix.name }}' ? matrixNames : name,
  );
}

test('names its runs as nocobase-bot finds them, and takes the forwarded inputs with the head branch', () => {
  assert.match(
    workflow,
    /^run-name: studio-quality:\$\{\{ inputs\.event_name == 'pull_request' && format\('PR-\{0\}', inputs\.pr_number\) \|\| inputs\.target_branch \}\}:\$\{\{ inputs\.request_id \}\}$/mu,
  );
  for (const input of ['request_id', 'event_name', 'head_sha', 'base_sha', 'target_branch', 'pr_number', 'skip_label', 'head_ref']) {
    assert.match(workflow, new RegExp(`^      ${input}:\\n`, 'mu'), input);
  }
});

test('keeps the check job names, with Studio e2e for pull requests only', () => {
  assert.deepEqual(jobNames(), expectedJobs);
  assert.match(job('e2e'), /if: \$\{\{ inputs\.event_name == 'pull_request' \}\}/u);
  assert.doesNotMatch(workflow, /name: (Preview|Dist)\n/u);
});

test('holds no secret, and checks Studio out with a token each job asks nocobase-bot for under its own name', () => {
  assert.doesNotMatch(workflow, /secrets\.|vars\./u);
  assert.doesNotMatch(checkout, /secrets\.|vars\.|private-key|create-github-app-token/u);
  assert.match(workflow, /^permissions:\n  contents: read\n/mu);
  const jobs = { submodule: 'Submodule pointer', check: '${{ matrix.name }}', e2e: 'Studio e2e' };
  for (const [id, name] of Object.entries(jobs)) {
    const source = job(id);
    assert.match(source, /    permissions:\n      contents: read\n      id-token: write\n/u, id);
    const helpers = source.indexOf('sparse-checkout: .github/nocobase3\n');
    const studio = source.indexOf(`uses: ./.github/nocobase3/studio-checkout\n        with:\n          path: studio\n          job: ${name}\n`);
    assert.ok(helpers !== -1 && studio !== -1 && helpers < studio, id);
    // The helpers come from this repository, at the commit the run was dispatched from.
    assert.doesNotMatch(source.slice(0, studio), /repository:/u, id);
  }
  assert.equal([...workflow.matchAll(/uses: \.\/\.github\/nocobase3\/studio-checkout\n/gu)].length, 3);
});

test('revokes the source token after checking out, before any step of the workflow runs Studio code', () => {
  assert.match(checkout, /"\$BOT_URL\/api\/ci\/studio-source-token"/u);
  assert.match(checkout, /audience=nocobase-bot/u);
  assert.match(checkout, /--arg job "\$JOB" '\{request_id: \$request_id, job: \$job\}'/u);
  assert.match(checkout, /echo "::add-mask::\$token"\n {8}echo "token=\$token" >> "\$GITHUB_OUTPUT"/u);
  const order = ['- name: Validate dispatch inputs', '- name: Get a read-only source token', '- name: Check out the immutable source head', '- name: Prepare the immutable source snapshot', '- name: Revoke the source token'];
  const at = order.map((line) => checkout.indexOf(line));
  assert.ok(at.every((index) => index !== -1));
  assert.deepEqual([...at].sort((a, b) => a - b), at);
  assert.match(checkout, /if: \$\{\{ always\(\) && steps\.source-token\.outputs\.token != '' \}\}/u);
  assert.match(checkout, /persist-credentials: false/u);
});

test("gates the framework half before the pull request's own script, which gets no token", () => {
  const source = job('submodule');
  const gate = source.indexOf('uses: ./.github/nocobase3/studio-framework-gate\n');
  const script = source.indexOf('run: node scripts/check-submodule.mjs\n');
  assert.ok(gate !== -1 && script !== -1 && gate < script);
  assert.doesNotMatch(source.slice(script), /token/u);
  for (const id of ['check', 'e2e']) {
    const choose = job(id).indexOf('uses: ./.github/nocobase3/studio-framework\n');
    assert.ok(choose !== -1 && choose < job(id).indexOf('run: pnpm install "$INSTALL_FLAG"'), id);
  }
});

test('caches nothing and uploads only failed e2e results, briefly', () => {
  assert.doesNotMatch(workflow, /actions\/cache|^\s+cache:/mu);
  const uploads = [...workflow.matchAll(/uses: actions\/upload-artifact@v4/gu)];
  assert.equal(uploads.length, 1);
  assert.match(job('e2e'), /if: \$\{\{ failure\(\) \}\}\n        uses: actions\/upload-artifact@v4\n        with:\n          name: studio-e2e-results\n          path: studio\/test-results\n          if-no-files-found: ignore\n          retention-days: 3\n/u);
});
