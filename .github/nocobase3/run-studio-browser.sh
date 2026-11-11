#!/usr/bin/env bash
# Build dependencies on the matching Ubuntu host, then run the test server and browser together with preinstalled
# browser libraries. Keep the same absolute paths for workspace symlinks and the host's Node ABI for native modules.
set -euo pipefail
studio=$(realpath "${1:?Usage: run-studio-browser.sh <studio-dir> <command> [args...]}")
shift
[ "$#" -gt 0 ] || { echo 'A command is required.' >&2; exit 1; }
cd "$studio"
version=$(node -p 'require("@playwright/test/package.json").version')
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Unsupported Playwright version.' >&2; exit 1; }
node_root=$(dirname "$(dirname "$(node -p 'process.execPath')")")
pnpm_root=$(dirname "${PNPM_HOME:?PNPM_HOME must point to the installed pnpm bin directory}")
image="mcr.microsoft.com/playwright:v${version}-noble"
printf 'Running with %s\n' "$image"
exec docker run --rm --interactive --init --ipc=host \
  --user "$(id -u):$(id -g)" \
  --volume "$studio:$studio" \
  --volume "$node_root:$node_root:ro" \
  --volume "$pnpm_root:$pnpm_root:ro" \
  --workdir "$studio" \
  --env HOME=/tmp \
  --env "PATH=$node_root/bin:$PNPM_HOME:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" \
  --env CI --env GITHUB_ACTIONS --env NODE_OPTIONS \
  "$image" "$@"
