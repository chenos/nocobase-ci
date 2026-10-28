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
const expectedJobs = ['Submodule pointer', 'PR description', 'Lint', 'Typecheck', 'Test', 'API document', 'CLI reference', 'Studio e2e'];

function job(id) {
  const start = workflow.indexOf(`\n  ${id}:\n`);
  assert.notEqual(start, -1, `job ${id}`);
  // A job ends where the next one's header comment, if any, begins.
  const next = workflow.slice(start + 1).search(/\n(?:  #[^\n]*\n)*  [a-z][a-z0-9-]*:\n/u);
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

test('keeps the check job names, with PR description and Studio e2e for pull requests only', () => {
  // `Framework build cache` is not a check: nocobase-bot mirrors only the names it expects.
  assert.deepEqual(jobNames(), [...expectedJobs, 'Framework build cache']);
  for (const id of ['pr-description', 'e2e']) {
    assert.match(job(id), /if: \$\{\{ inputs\.event_name == 'pull_request' \}\}/u, id);
  }
  assert.doesNotMatch(workflow, /name: (Preview|Dist)\n/u);
});

test('holds no secret, and checks Studio out with a token each job asks nocobase-bot for under its own name', () => {
  assert.doesNotMatch(workflow, /secrets\.|vars\./u);
  assert.doesNotMatch(checkout, /secrets\.|vars\.|private-key|create-github-app-token/u);
  assert.match(workflow, /^permissions:\n  contents: read\n/mu);
  const jobs = { submodule: 'Submodule pointer', 'pr-description': 'PR description', check: '${{ matrix.name }}', e2e: 'Studio e2e' };
  for (const [id, name] of Object.entries(jobs)) {
    const source = job(id);
    assert.match(source, /    permissions:\n      contents: read\n      id-token: write\n/u, id);
    const helpers = source.indexOf('sparse-checkout: .github/nocobase3\n');
    const studio = source.indexOf(`uses: ./.github/nocobase3/studio-checkout\n        with:\n          path: studio\n          job: ${name}\n`);
    assert.ok(helpers !== -1 && studio !== -1 && helpers < studio, id);
    // The helpers come from this repository, at the commit the run was dispatched from.
    assert.doesNotMatch(source.slice(0, studio), /repository:/u, id);
  }
  assert.equal([...workflow.matchAll(/uses: \.\/\.github\/nocobase3\/studio-checkout\n/gu)].length, 4);
});

test('revokes the source token after checking out, before any step of the workflow runs Studio code', () => {
  assert.match(checkout, /"\$BOT_URL\/api\/ci\/studio-source-token"/u);
  assert.match(checkout, /audience=nocobase-bot/u);
  assert.match(checkout, /--arg job "\$JOB" '\{request_id: \$request_id, job: \$job\}'/u);
  assert.match(checkout, /echo "::add-mask::\$token"\n {8}echo "token=\$token" >> "\$GITHUB_OUTPUT"/u);
  const order = ['- name: Validate dispatch inputs', '- name: Get a read-only source token', '- name: Check out the immutable source head', '- name: Prepare the immutable source snapshot', '- name: Save the pull request description', '- name: Revoke the source token'];
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

test('caches only the framework build, written by a job that runs no Studio code, and uploads only failed e2e results', () => {
  const restore = /uses: actions\/cache\/restore@v4\n/gu;
  const save = /uses: actions\/cache\/save@v4\n/gu;
  // Studio e2e only restores, and does so before installing, so the pull request's code cannot have chosen the key.
  const e2e = job('e2e');
  assert.equal([...e2e.matchAll(restore)].length, 1);
  assert.doesNotMatch(e2e, /actions\/cache\/save|actions\/cache@|^\s+cache:/mu);
  const restored = e2e.indexOf('- name: Restore the framework build');
  assert.ok(e2e.indexOf('- name: Name the framework build') < restored);
  assert.ok(restored !== -1 && restored < e2e.indexOf('- name: Install dependencies'));
  // The only writer never checks Studio out and never asks nocobase-bot for a token.
  const cache = job('framework-cache');
  assert.equal([...workflow.matchAll(save)].length, 1);
  assert.equal([...cache.matchAll(save)].length, 1);
  assert.doesNotMatch(cache, /nocobase3\/studio-checkout|nocobase3\/studio-framework\n|id-token|secrets\.|github-token|SOURCE_TOKEN/u);
  assert.match(cache, /    needs: e2e\n/u);
  assert.match(cache, /https:\/\/github\.com\/nocobase\/nocobase\.git "\$FRAMEWORK_SHA"/u);
  for (const source of [e2e, cache]) assert.match(source, /path: studio\/vendor\/nocobase3\/packages\/\*\/\*\/dist\n/u);
  // No other job caches anything.
  assert.equal([...workflow.matchAll(/uses: actions\/cache/gu)].length, 3);
  assert.doesNotMatch(workflow, /^\s+cache:/mu);
  const uploads = [...workflow.matchAll(/uses: actions\/upload-artifact@v4/gu)];
  assert.equal(uploads.length, 1);
  assert.match(job('e2e'), /if: \$\{\{ failure\(\) \}\}\n        uses: actions\/upload-artifact@v4\n        with:\n          name: studio-e2e-results\n          path: studio\/test-results\n          if-no-files-found: ignore\n          retention-days: 3\n/u);
});

test('saves the pull request description with the source token, and checks it from the checkout with no token or install', () => {
  const save = checkout.slice(checkout.indexOf('- name: Save the pull request description'), checkout.indexOf('- name: Revoke the source token'));
  assert.match(save, /if: \$\{\{ inputs\.pull-request-body != '' && inputs\.event-name == 'pull_request' \}\}/u);
  assert.match(save, /SOURCE_TOKEN: \$\{\{ steps\.source-token\.outputs\.token \}\}/u);
  assert.match(save, /"https:\/\/api\.github\.com\/repos\/nocobase\/studio\/pulls\/\$PR_NUMBER"/u);
  assert.match(save, /jq '\{title: \(\.title \/\/ ""\), body: \(\.body \/\/ ""\)\}'/u);
  assert.match(checkout, /submodules: \$\{\{ inputs\.submodules == 'false' && 'false' \|\| 'recursive' \}\}/u);

  const source = job('pr-description');
  assert.match(source, /          submodules: 'false'\n          pull-request-body: \$\{\{ runner\.temp \}\}\/pull-request\.json\n/u);
  assert.match(source, /timeout-minutes: 10\n/u);
  assert.doesNotMatch(source, /pnpm|install|^\s+(github-)?token:|studio-framework/mu);
  const run = source.indexOf('node "$tools/check-pr-body.mjs" "$RUNNER_TEMP/pull-request.json"');
  assert.ok(run !== -1 && source.indexOf('working-directory: studio') < run);
  // A base without the script is checked with the target branch's scripts/release, never skipped.
  assert.match(source, /git archive "refs\/remotes\/origin\/\$TARGET_BRANCH" scripts\/release/u);
  assert.match(source, /echo "::error::Neither this pull request nor \$TARGET_BRANCH has/u);
  assert.doesNotMatch(source, /the pull request description is not checked/u);
  // Every other job keeps the framework submodule and asks for no description.
  for (const id of ['submodule', 'check', 'e2e']) assert.doesNotMatch(job(id), /submodules:|pull-request-body:/u, id);
});
