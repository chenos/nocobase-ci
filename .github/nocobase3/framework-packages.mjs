#!/usr/bin/env node
/**
 * Which framework packages Studio's build needs, and the cache key of their `dist`, read from package.json files only:
 * nothing of Studio is run. Studio (`<studio>/package.json` and its own `packages/*`) depends on framework packages
 * through `workspace:` ranges; each of them is a package under `vendor/nocobase3/packages/<group>/<name>`. The job that
 * fills the cache builds `<name>...` (the package and its dependencies) of each in nocobase/nocobase's own workspace.
 *
 *   node framework-packages.mjs <studio-dir> <framework-sha>
 *
 * Writes `packages` (space-separated names) and `key` to $GITHUB_OUTPUT, or prints them without it.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const [studio, sha] = process.argv.slice(2);
if (!studio || !/^[0-9a-f]{40}$/u.test(sha ?? ''))
  throw new Error('Usage: framework-packages.mjs <studio-dir> <40-character framework sha>');

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const packagesOf = (root) =>
  existsSync(root)
    ? readdirSync(root, { withFileTypes: true })
        .filter((group) => group.isDirectory())
        .flatMap((group) =>
          readdirSync(path.join(root, group.name), { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => path.join(root, group.name, entry.name, 'package.json'))
            .filter((file) => existsSync(file)),
        )
    : [];
const workspaceDeps = (manifest) =>
  ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((field) =>
    Object.entries(manifest[field] ?? {})
      .filter(([, range]) => typeof range === 'string' && range.startsWith('workspace:'))
      .map(([name]) => name),
  );

const framework = new Set(
  packagesOf(path.join(studio, 'vendor/nocobase3/packages')).map((file) => readJson(file).name),
);
// Studio's own workspace packages (`packages/*`), whose framework dependencies Studio's build also needs.
const local = existsSync(path.join(studio, 'packages'))
  ? readdirSync(path.join(studio, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(studio, 'packages', entry.name, 'package.json'))
      .filter((file) => existsSync(file))
  : [];
const names = [
  ...new Set(
    [path.join(studio, 'package.json'), ...local]
      .flatMap((file) => workspaceDeps(readJson(file)))
      .filter((name) => framework.has(name)),
  ),
].sort();
for (const name of names)
  if (!/^@nocobase\/[a-z0-9][a-z0-9.-]*$/u.test(name)) throw new Error(`Unexpected package name ${name}`);
if (names.length === 0) throw new Error('Studio depends on no framework package.');

const node = process.versions.node.split('.')[0];
const digest = createHash('sha256').update(names.join('\n')).digest('hex').slice(0, 16);
const key = `studio-framework-dist-v1-node${node}-${sha}-${digest}`;
const out = `packages=${names.join(' ')}\nkey=${key}\n`;
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, out);
else process.stdout.write(out);
