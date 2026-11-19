# Multi-tenant platform quality

The platform's five checks are defined in `.github/workflows/multi-tenant-platform-quality.yml`. The Bot's `multi-tenant-platform-quality` row dispatches same-repository PRs targeting main and main pushes. Job names and run-name are a reporting protocol.

The workflow checks the exact head, uses the platform-only OIDC grant, revokes checkout tokens before source code runs, and installs with the frozen lockfile through trusted `platform-setup`. Only read-only `PRO_NPM_TOKEN` is needed. Never add Studio credentials or upload private source, archives, test output or application caches. Build validates and discards the Linux archive; fixed CI rebuilds it after all five checks pass.

Before deploying the Bot registration, merge the workflow/helpers and synchronize them from this repository's main to every active pool copy. Confirm every copy has read-only `PRO_NPM_TOKEN`: Secrets do not synchronize with Git. No child application or shared Preview environment is modified.

## Verification

Run:

```bash
node --test .github/nocobase3/tests/platform-quality-contract.test.mjs .github/nocobase3/tests/validate-inputs.test.mjs .github/nocobase3/tests/prepare-snapshot.test.mjs
actionlint .github/workflows/multi-tenant-platform-quality.yml
```

Static verification does not establish usable Preview behavior. After deploying the Bot and fixed workflow, verify actual source Checks, failure reporting, cancellation, Preview usability and close cleanup.

CI runner logs are public and may contain file paths, test data or source excerpts in error diagnostics. Artifact/cache isolation is not confidentiality of logs. Use synthetic data, never production configuration, and review this exposure before rollout.
