import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { prepareSnapshot } from '../prepare-snapshot.mjs';

let fixture;
let common;
let cleanBase;
let cleanHead;
let conflictBase;
let conflictHead;

function git(args) {
  return execFileSync('git', args, {
    cwd: fixture,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function commit(message) {
  git(['add', '.']);
  git(['commit', '-m', message]);
  return git(['rev-parse', 'HEAD']);
}

before(() => {
  fixture = mkdtempSync(path.join(tmpdir(), 'nocobase3-pro-ci-'));
  git(['init']);
  git(['config', 'user.name', 'Pro CI test']);
  git(['config', 'user.email', 'pro-ci-test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);

  writeFileSync(path.join(fixture, 'shared.txt'), 'common\n');
  common = commit('common base');

  git(['checkout', '-b', 'clean-base']);
  writeFileSync(path.join(fixture, 'base.txt'), 'base\n');
  cleanBase = commit('clean base');

  git(['checkout', '-b', 'clean-head', common]);
  writeFileSync(path.join(fixture, 'head.txt'), 'head\n');
  cleanHead = commit('clean head');

  git(['checkout', '-b', 'conflict-base', common]);
  writeFileSync(path.join(fixture, 'shared.txt'), 'base side\n');
  conflictBase = commit('conflict base');

  git(['checkout', '-b', 'conflict-head', common]);
  writeFileSync(path.join(fixture, 'shared.txt'), 'head side\n');
  conflictHead = commit('conflict head');
});

after(() => {
  rmSync(fixture, { recursive: true, force: true });
});

test('creates a merge whose parents are the fixed base and head', () => {
  git(['checkout', '--detach', cleanHead]);
  prepareSnapshot({
    cwd: fixture,
    eventName: 'pull_request',
    headSha: cleanHead.toUpperCase(),
    baseSha: cleanBase,
    mergePullRequest: 'true',
  });

  assert.equal(git(['rev-parse', 'HEAD^1']), cleanBase);
  assert.equal(git(['rev-parse', 'HEAD^2']), cleanHead);
  assert.equal(readFileSync(path.join(fixture, 'base.txt'), 'utf8'), 'base\n');
  assert.equal(readFileSync(path.join(fixture, 'head.txt'), 'utf8'), 'head\n');
});

test('keeps the exact head for checks that must not use a merge result', () => {
  git(['checkout', '--detach', cleanHead]);
  prepareSnapshot({
    cwd: fixture,
    eventName: 'pull_request',
    headSha: cleanHead,
    baseSha: cleanBase,
    mergePullRequest: 'false',
  });

  assert.equal(git(['rev-parse', 'HEAD']), cleanHead);
});

test('fails a conflicting fixed snapshot and aborts the merge', () => {
  git(['checkout', '--detach', conflictHead]);
  assert.throws(
    () =>
      prepareSnapshot({
        cwd: fixture,
        eventName: 'pull_request',
        headSha: conflictHead,
        baseSha: conflictBase,
        mergePullRequest: 'true',
      }),
    /does not merge cleanly/u,
  );

  assert.equal(git(['rev-parse', 'HEAD']), conflictBase);
  assert.equal(git(['status', '--porcelain']), '');
});

test('skips the submodule update when the job does not need the framework', () => {
  git(['checkout', '--detach', cleanHead]);
  // A .gitmodules naming a submodule that cannot be fetched would fail `submodule update --init`.
  writeFileSync(path.join(fixture, '.gitmodules'), '[submodule "vendor/missing"]\n\tpath = vendor/missing\n\turl = /nonexistent/nocobase3\n');
  git(['update-index', '--add', '--cacheinfo', `160000,${common},vendor/missing`]);
  // Staged by name: `git add .` would drop the gitlink, whose directory is absent.
  git(['add', '.gitmodules']);
  git(['commit', '-m', 'add an unreachable submodule']);
  const withModule = git(['rev-parse', 'HEAD']);
  prepareSnapshot({
    cwd: fixture,
    eventName: 'push',
    headSha: withModule,
    baseSha: '0'.repeat(40),
    mergePullRequest: 'false',
    submodules: 'false',
  });
  assert.equal(git(['rev-parse', 'HEAD']), withModule);
  assert.throws(() =>
    prepareSnapshot({ cwd: fixture, eventName: 'push', headSha: withModule, baseSha: '0'.repeat(40), mergePullRequest: 'false' }),
  );
});

test('fetches only the committed framework pointer when the job asks for a shallow submodule', () => {
  const framework = mkdtempSync(path.join(tmpdir(), 'nocobase3-framework-'));
  // Git refuses file:// submodules unless allowed; the real framework is fetched over https.
  const allowed = process.env.GIT_ALLOW_PROTOCOL;
  process.env.GIT_ALLOW_PROTOCOL = 'file';
  const run = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    run(framework, ['init']);
    run(framework, ['config', 'user.name', 'Pro CI test']);
    run(framework, ['config', 'user.email', 'pro-ci-test@example.com']);
    run(framework, ['config', 'commit.gpgsign', 'false']);
    // Serve any commit by SHA, as GitHub does for `submodule update --depth 1`.
    run(framework, ['config', 'uploadpack.allowAnySHA1InWant', 'true']);
    for (const step of ['one', 'two', 'three']) {
      writeFileSync(path.join(framework, 'step.txt'), `${step}\n`);
      run(framework, ['add', '.']);
      run(framework, ['commit', '-m', step]);
    }
    const pointer = run(framework, ['rev-parse', 'HEAD~1']);
    git(['checkout', '--detach', cleanHead]);
    writeFileSync(path.join(fixture, '.gitmodules'), `[submodule "vendor/framework"]\n\tpath = vendor/framework\n\turl = file://${framework}\n`);
    git(['update-index', '--add', '--cacheinfo', `160000,${pointer},vendor/framework`]);
    git(['add', '.gitmodules']);
    git(['commit', '-m', 'add the framework submodule']);
    const withModule = git(['rev-parse', 'HEAD']);
    prepareSnapshot({
      cwd: fixture,
      eventName: 'push',
      headSha: withModule,
      baseSha: '0'.repeat(40),
      mergePullRequest: 'false',
      submodules: 'shallow',
    });
    const vendor = path.join(fixture, 'vendor/framework');
    assert.equal(run(vendor, ['rev-parse', 'HEAD']), pointer);
    assert.equal(run(vendor, ['rev-parse', '--is-shallow-repository']), 'true');
    assert.equal(run(vendor, ['rev-list', '--count', 'HEAD']), '1');
  } finally {
    if (allowed === undefined) delete process.env.GIT_ALLOW_PROTOCOL;
    else process.env.GIT_ALLOW_PROTOCOL = allowed;
    rmSync(framework, { recursive: true, force: true });
  }
});
