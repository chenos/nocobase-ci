#!/usr/bin/env bash
# Request once: replaying a token POST can consume the one-time grant after a lost response.
set -euo pipefail
case "${SOURCE_TOKEN_KIND:-}" in
  platform) endpoint=multi-tenant-platform-source-token ;;
  sub-app) endpoint=multi-tenant-sub-source-token ;;
  *) echo '::error::Unknown source token kind.'; exit 1 ;;
esac
if [ -z "${ACTIONS_ID_TOKEN_REQUEST_URL:-}" ] || [ -z "${ACTIONS_ID_TOKEN_REQUEST_TOKEN:-}" ]; then
  echo '::error::The job has no OIDC token; it needs id-token: write.'
  exit 1
fi
if ! oidc=$(curl -fsS --connect-timeout 10 --max-time 30 -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=nocobase-bot" | jq -er '.value | select(type == "string" and length > 0)'); then
  echo '::error::GitHub OIDC credential acquisition failed.'
  exit 1
fi
echo "::add-mask::$oidc"
body=$(jq -n --arg request_id "$REQUEST_ID" --arg job "$JOB" '{request_id: $request_id, job: $job}')
if ! answer=$(curl -sS --connect-timeout 10 --max-time 120 -w '\n%{http_code}' -X POST -H "Authorization: Bearer $oidc" -H 'content-type: application/json' --data "$body" "https://bot.v2.test.nocobase.com/api/ci/$endpoint"); then
  echo '::error::Bot source token transport failed; the POST was not replayed.'
  exit 1
fi
status=${answer##*$'\n'}
answer=${answer%$'\n'*}
if [ "$status" != 200 ]; then
  # Only print known safe reasons; never dump an arbitrary response or a credential.
  reason=$(jq -r '.error // empty' <<<"$answer" 2>/dev/null || true)
  case "$reason" in
    'not an active child quality job'|'not the active child run attempt'|'the child request is no longer active'|'the child request changed during authorization'|'the child run or job did not become active within the visibility window'|'not an authorized child CI target'|'not a CI repository of the pool'|'the run could not be checked'|'the token could not be created') ;;
    *) reason='See Bot logs for the refusal reason.' ;;
  esac
  echo "::error::Bot source token request failed (HTTP $status): $reason"
  exit 1
fi
if ! token=$(jq -er '.token | select(type == "string" and length > 0 and (test("[\\r\\n]") | not))' <<<"$answer"); then
  echo '::error::Bot returned no valid source token.'
  exit 1
fi
echo "::add-mask::$token"
printf 'token=%s\n' "$token" >> "$GITHUB_OUTPUT"
