#!/usr/bin/env node
// Asserts the package version is identical everywhere it is declared:
//   package.json .version
//   .claude-plugin/plugin.json .version
//   .claude-plugin/marketplace.json .metadata.version AND .plugins[0].version
//   CHANGELOG.md top "## X.Y.Z" heading
// Optionally (--tag vX.Y.Z) asserts the git tag matches too — used at release
// time. Without --tag the tag check is skipped (so a plain branch-push CI run
// does NOT compare the branch name against the version). Exits non-zero listing
// every mismatch. Pure Node, no deps.
//
// Run:  node scripts/check-version-sync.js [--tag v1.1.0]
// Importable: require('./check-version-sync').collect() -> {sources, mismatches}

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

function collect() {
  const pkg = json('package.json');
  const plugin = json('.claude-plugin/plugin.json');
  const market = json('.claude-plugin/marketplace.json');

  const changelogTop = (() => {
    const m = read('CHANGELOG.md').match(/^##\s+v?(\d+\.\d+\.\d+)/m);
    return m ? m[1] : null;
  })();

  const sources = {
    'package.json': pkg.version,
    'plugin.json': plugin.version,
    'marketplace.json:metadata': market.metadata && market.metadata.version,
    'marketplace.json:plugins[0]': market.plugins && market.plugins[0] && market.plugins[0].version,
    'CHANGELOG.md:top': changelogTop,
  };

  const ref = sources['package.json'];
  const mismatches = Object.entries(sources)
    .filter(([, v]) => v !== ref)
    .map(([k, v]) => `${k} = ${v ?? '(missing)'} (expected ${ref})`);

  return { sources, ref, mismatches };
}

// Only checks when a tag is explicitly passed (--tag at release time). No env
// fallback: a branch-push CI run has no tag to compare and must not fail.
function checkTag(ref, tagArg) {
  if (!tagArg) return null;
  const tag = tagArg.replace(/^v/, '');
  return tag === ref ? null : `git tag ${tagArg} != version ${ref}`;
}

function main() {
  const tagArg = (() => {
    const i = process.argv.indexOf('--tag');
    return i >= 0 ? process.argv[i + 1] : null;
  })();

  const { sources, ref, mismatches } = collect();
  const tagErr = checkTag(ref, tagArg);

  const errs = [...mismatches];
  if (tagErr) errs.push(tagErr);

  if (errs.length) {
    console.error('✗ version sync FAILED:');
    for (const e of errs) console.error('  - ' + e);
    console.error('\n  sources:', JSON.stringify(sources, null, 2));
    process.exit(1);
  }
  console.log(`✓ version sync OK — all sources at ${ref}${tagArg ? ' (tag matches)' : ''}`);
}

if (require.main === module) main();
module.exports = { collect, checkTag };
