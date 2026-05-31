#!/usr/bin/env node
// Single source of truth for bumping the version. Writes the new version into
// every place check-version-sync.js validates, and prepends a CHANGELOG stub if
// one is missing for that version. Pure Node, no deps.
//
// Run:  node scripts/bump.js 1.2.0
// Then: review the CHANGELOG stub, then commit, tag, push, and publish:
//       git commit -am "release: vX.Y.Z" && git tag vX.Y.Z && git push --tags
//       gh release create vX.Y.Z --generate-notes

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const p = (f) => path.join(ROOT, f);

const next = (process.argv[2] || '').replace(/^v/, '');
if (!/^\d+\.\d+\.\d+$/.test(next)) {
  console.error('usage: node scripts/bump.js <major.minor.patch>');
  process.exit(1);
}

function editJson(file, fn) {
  const raw = fs.readFileSync(p(file), 'utf8');
  const obj = JSON.parse(raw);
  fn(obj);
  // Preserve trailing newline convention.
  fs.writeFileSync(p(file), JSON.stringify(obj, null, 2) + '\n');
  console.log(`  ${file}`);
}

console.log(`Bumping to ${next}:`);

editJson('package.json', (o) => { o.version = next; });
editJson('.claude-plugin/plugin.json', (o) => { o.version = next; });
editJson('.claude-plugin/marketplace.json', (o) => {
  if (o.metadata) o.metadata.version = next;
  if (o.plugins && o.plugins[0]) o.plugins[0].version = next;
});

// Prepend a CHANGELOG stub unless this version already has a heading.
const clPath = p('CHANGELOG.md');
const cl = fs.readFileSync(clPath, 'utf8');
const has = new RegExp(`^##\\s+v?${next.replace(/\./g, '\\.')}\\b`, 'm').test(cl);
if (has) {
  console.log('  CHANGELOG.md (heading already present — left as is)');
} else {
  const header = '# Changelog\n';
  const idx = cl.indexOf(header);
  const stub = `## ${next}\n- TODO: describe changes.\n\n`;
  const out = idx === 0
    ? header + '\n' + stub + cl.slice(header.length).replace(/^\n+/, '')
    : stub + cl;
  fs.writeFileSync(clPath, out);
  console.log('  CHANGELOG.md (stub prepended — edit it)');
}

console.log(`\nDone. Next: edit CHANGELOG, then:\n  git commit -am "release: v${next}"\n  git tag v${next} && git push && git push --tags`);
