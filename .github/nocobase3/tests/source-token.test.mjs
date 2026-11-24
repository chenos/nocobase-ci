import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = new URL('../source-token.sh', import.meta.url).pathname;
function run(t, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'source-token-'));
  t.after(() => rmSync(dir, {recursive:true, force:true}));
  writeFileSync(join(dir, 'curl'), `#!/usr/bin/env bash
printf 'call\\n' >> "$CALLS"
case "$*" in
  *audience=nocobase-bot*) printf '%s' '{"value":"fake-oidc"}' ;;
  *) printf '%s\\n%s' "$RESPONSE" "$STATUS" ;;
esac
`, {mode:0o700});
  writeFileSync(join(dir, 'output'), '');
  writeFileSync(join(dir, 'calls'), '');
  const result = spawnSync('bash', [script], {encoding:'utf8', env:{...process.env,
    PATH:`${dir}:${process.env.PATH}`, ACTIONS_ID_TOKEN_REQUEST_URL:'https://example.invalid?x=1',
    ACTIONS_ID_TOKEN_REQUEST_TOKEN:'fake', SOURCE_TOKEN_KIND:'sub-app', REQUEST_ID:'request', JOB:'Lint',
    GITHUB_OUTPUT:join(dir,'output'), CALLS:join(dir,'calls'), STATUS:'200', RESPONSE:'{"token":"fake-source"}', ...env}});
  return {...result, output:readFileSync(join(dir,'output'),'utf8'), calls:readFileSync(join(dir,'calls'),'utf8').trim().split('\n').filter(Boolean).length};
}
for (const kind of ['platform','sub-app']) test(`${kind}: writes only a valid masked token`, t => {
  const r=run(t,{SOURCE_TOKEN_KIND:kind});
  assert.equal(r.status,0,r.stderr);
  assert.equal(r.output,'token=fake-source\n');
  assert.match(r.stdout,/::add-mask::fake-source/);
  assert.equal(r.calls,2);
});
for (const status of ['403','409','502']) test(`HTTP ${status} is not replayed`, t => {
  const r=run(t,{STATUS:status,RESPONSE:'{"error":"not an active child quality job","token":"must-not-leak"}'});
  assert.equal(r.status,1);
  assert.equal(r.calls,2);
  assert.equal(r.output,'');
  assert.match(r.stdout,new RegExp(`HTTP ${status}`));
  assert.doesNotMatch(r.stdout,/must-not-leak/);
});
test('unknown errors are redacted',t=>{
  const r=run(t,{STATUS:'403',RESPONSE:'{"error":"secret-value\\n::error::injected"}'});
  assert.equal(r.status,1);
  assert.doesNotMatch(r.stdout,/secret-value|injected/);
});
test('missing OIDC stops before curl',t=>{
  const r=run(t,{ACTIONS_ID_TOKEN_REQUEST_URL:''});
  assert.equal(r.status,1);
  assert.equal(r.calls,0);
});
for (const response of ['{}','not-json','{"token":""}','{"token":"x\\ny"}']) test(`invalid success payload: ${response}`,t=>{
  const r=run(t,{RESPONSE:response});
  assert.equal(r.status,1);
  assert.equal(r.output,'');
});
