# Multi-tenant platform quality

The platform's five checks are defined in `.github/workflows/multi-tenant-platform-quality.yml`. The Bot's `multi-tenant-platform-quality` row dispatches same-repository PRs targeting main and main pushes. Job names and run-name are a reporting protocol.

The workflow checks the exact head, uses the platform OIDC grant for the fixed platform-and-Pro repository pair, revokes checkout tokens before source code runs, and installs with the root frozen lockfile through trusted `platform-setup`. Only read-only `PRO_NPM_TOKEN` is needed as a quality-repository Secret; Pro Git access uses the short-lived Bot grant, not an npm token or new long-lived credential. Never add Studio credentials or upload private source, archives, test output or application caches. Build validates and discards the Linux archive; fixed CI rebuilds it after all five checks pass.

`chenos/nocobase-ci/main` is the quality workflow/helper maintenance source. The only eligible platform execution copies are `chenos/nocobase-ci` and `cgyrock/nocobase-ci`; after authorized merge, fast-forward the latter to the same reviewed main and verify SHA/tree equality. Do not synchronize or expand other pool copies as part of this change. Confirm each eligible copy retains read-only `PRO_NPM_TOKEN`: Secrets do not synchronize with Git.

Platform checkout disables recursive submodule handling. It accepts exactly one of: no submodule (older published-package applications), the legacy `vendor/nocobase3` OSS gitlink, or `vendor/nocobase3-pro` with exactly one inner `vendor/nocobase3` OSS gitlink. Each committed `.gitmodules` must be a regular 100644 blob containing only the exact path, URL and branch entries. URLs are fixed to `https://github.com/nocobase/nocobase3-pro.git` (`develop`) and `https://github.com/nocobase/nocobase.git` (`v3`); branches prove history reachability, never select checkout revisions. Each recorded SHA is fetched at depth one and checked out detached. The Pro inner layout is validated before materializing its files. Additional gitlinks/config entries, mismatched heads, redirects, alternate URLs, symlinks and unsafe destination paths fail closed. No `--remote`, version synchronization or recursive update is used; leaf OSS submodules are not initialized. Logs/summary record only application SHA, Pro SHA, OSS SHA and layout.

The Bot's platform grant must be deployed with the fixed `multi-tenant-platform-app` + `nocobase3-pro` contents-read scope, and its existing GitHub App installation must include both repositories. Request/run/workflow/job/attempt checks remain unchanged; request bodies cannot choose scope. The token is passed only to the trusted helper, in a process-local HTTP header scoped to the fixed Pro URL, never a remote URL, Git config file, argv or application environment. OSS fetches are anonymous. An always-run revocation follows checkout (including failure) and precedes setup/install. If Pro is outside the App installation, a maintainer must add read access; do not replace the grant with a PAT or installation-wide scope.

Roll out with separate approval: merge/synchronize the reviewed quality changes and the fixed Preview changes, confirm existing App repository access, then merge/deploy the Bot grant. A Bot main merge can automatically deploy shared infrastructure. Rerun the normal source Check only after all pieces are ready. Old structures remain supported after rollout, but the quality grant now requires the App installation to include Pro. No application PR, version, deployment environment or CI key is changed here.

## Verification

Run:

```bash
node --test .github/nocobase3/tests/platform-framework.test.mjs .github/nocobase3/tests/platform-pro-framework.test.mjs .github/nocobase3/tests/platform-quality-contract.test.mjs .github/nocobase3/tests/validate-inputs.test.mjs .github/nocobase3/tests/prepare-snapshot.test.mjs
actionlint .github/workflows/multi-tenant-platform-quality.yml
```

Static verification does not establish usable Preview behavior. After deploying the Bot and fixed workflow, verify actual source Checks, failure reporting, cancellation, Preview usability and close cleanup.

CI runner logs are public and may contain file paths, test data or source excerpts in error diagnostics. Artifact/cache isolation is not confidentiality of logs. Use synthetic data, never production configuration, and review this exposure before rollout.
