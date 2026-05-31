#!/usr/bin/env node
// sweep-state — bookkeeping + budget-tier engine for the /sweep skill.
//
// The skill runs `node sweep-state.js <cmd>` from the TARGET repo root (the repo
// being swept), the same Node-everywhere pattern as usage-meter.js. This script
// owns three things so the skill stays declarative:
//   1. persisted scope config from the one-time interview   (.heavy-usage-sweep/config.json)
//   2. the coverage index + cursor (which files, how deep)  (.heavy-usage-sweep/index.json)
//   3. the budget→fan-out tier decision, reusing usage-lib  (pure function of --json)
// Deliverable docs (committable) go in heavy-usage-sweep/; bookkeeping (gitignored)
// goes in .heavy-usage-sweep/. Pure Node, no deps.
//
// CLI (see dispatch at bottom):
//   tier            < usage-meter --json on stdin            -> {fanout, headroom, reason}
//   config-has <mode> | config-get <mode> | config-set <mode> (answers JSON on stdin)
//   index-build     < config JSON on stdin (optional)        -> {files, count}
//   next <mode> [n]                                          -> {slice:[...], cursor, depth}
//   record <mode>   < findings JSON array on stdin           -> {added, skipped, doc}
//   resume <mode>   < {note,counts} JSON on stdin            -> {doc}
//   gitignore                                                -> ensures .heavy-usage-sweep/ ignored

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const lib = require('./usage-lib');

// --- paths ------------------------------------------------------------------

// Repo root of the project being swept: explicit override (tests), else git
// toplevel, else cwd.
function repoRoot() {
  if (process.env.HEAVY_USAGE_SWEEP_ROOT) return process.env.HEAVY_USAGE_SWEEP_ROOT;
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return process.cwd();
  }
}

function stateDir() { return path.join(repoRoot(), '.heavy-usage-sweep'); }   // gitignored bookkeeping
function docsDir()  { return path.join(repoRoot(), 'heavy-usage-sweep'); }     // committable deliverables

function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}
function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

// Per-mode deliverable doc name.
const DOCS = { bugs: 'FINDINGS.md', review: 'REVIEW.md', features: 'FEATURES.md', roadmap: 'ROADMAP.md' };
function docFor(mode) { return path.join(docsDir(), DOCS[mode] || `${String(mode).toUpperCase()}.md`); }

// --- config (one-time scope interview) --------------------------------------

function configPath() { return path.join(stateDir(), 'config.json'); }
function loadConfig() { return readJson(configPath(), {}); }
function hasConfig(mode) {
  const c = loadConfig();
  return Object.prototype.hasOwnProperty.call(c, mode) && c[mode] != null;
}
function saveConfig(mode, answers) {
  const c = loadConfig();
  c[mode] = answers || {};
  writeJson(configPath(), c);
  return c[mode];
}

// --- coverage index ---------------------------------------------------------

function indexPath() { return path.join(stateDir(), 'index.json'); }

// Minimal glob -> RegExp: supports ** (any path incl. /), * (any non-slash run),
// and literal segments. Fully anchored against a POSIX path (standard glob
// semantics): `src/*` matches `src/a` but not `src/a/b`; `src/**` matches both.
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
      else re += '[^/]*';
    } else if ('\\^$+?.()|{}[]'.includes(ch)) { re += '\\' + ch; }
    else re += ch;
  }
  return new RegExp('^' + re + '$');
}
function anyMatch(globs, p) { return globs.some((g) => globToRe(g).test(p)); }

// Build the file list from `git ls-files` (tracked, respects .gitignore), then
// apply config focus/exclude globs. Always drop the sweep's own dirs.
function buildIndex(config) {
  let files = [];
  try {
    files = execFileSync('git', ['ls-files'], { cwd: repoRoot(), encoding: 'utf8' })
      .split('\n').map((s) => s.trim()).filter(Boolean);
  } catch { files = []; }

  const focus = (config && config.focus) || [];
  const exclude = (config && config.exclude) || [];
  const SELF = ['.heavy-usage-sweep/', 'heavy-usage-sweep/'];

  files = files.filter((p) => !SELF.some((s) => p.startsWith(s)));
  if (focus.length) files = files.filter((p) => anyMatch(focus, p));
  if (exclude.length) files = files.filter((p) => !anyMatch(exclude, p));

  // Prioritize: shallower paths and source-ish extensions first (cheap heuristic;
  // no churn/git-log cost here — the skill can reorder if it wants).
  const score = (p) => (p.split('/').length) + (/\.(md|json|lock|txt)$/.test(p) ? 10 : 0);
  files.sort((a, b) => score(a) - score(b) || a.localeCompare(b));

  const idx = { files, cursor: 0, depth: 0, builtFrom: focus.length || exclude.length ? 'scoped' : 'all' };
  writeJson(indexPath(), idx);
  return idx;
}

function loadIndex() { return readJson(indexPath(), null); }

// Next disjoint slice of `n` files; advance cursor. When the repo is fully
// covered at this depth, bump depth and wrap (a deeper re-sweep), so the loop
// never runs out of "next target" before the usage wall.
function nextSlice(n) {
  let idx = loadIndex();
  if (!idx) idx = buildIndex(loadConfig().__active || {});
  const size = Math.max(1, n | 0);
  if (!idx.files.length) return { slice: [], cursor: 0, depth: idx.depth, exhausted: true };
  if (idx.cursor >= idx.files.length) { idx.depth += 1; idx.cursor = 0; }
  const slice = idx.files.slice(idx.cursor, idx.cursor + size);
  idx.cursor += slice.length;
  writeJson(indexPath(), idx);
  return { slice, cursor: idx.cursor, depth: idx.depth, total: idx.files.length };
}

// --- budget -> fan-out tier -------------------------------------------------

// Pure function of the usage-meter --json object. Headroom = the smallest gap
// (in percentage points) between current usage and that window's wind-down line.
// Wider headroom -> more parallel scouts; near wind-down -> inline single pass.
// Stale data -> drop a tier (assume real usage is higher than reported).
function decideTier(json) {
  json = json || {};
  const th = json.thresholds || {};
  const gaps = [];
  if (json.five_hour && typeof json.five_hour.used_percentage === 'number' && Number.isFinite(th.windDown)) {
    gaps.push(th.windDown * 100 - json.five_hour.used_percentage);
  }
  if (json.seven_day && typeof json.seven_day.used_percentage === 'number' && Number.isFinite(th.weeklyWindDown)) {
    gaps.push(th.weeklyWindDown * 100 - json.seven_day.used_percentage);
  }
  if (!gaps.length) return { fanout: 0, headroom: null, reason: 'no usage data — conservative single inline pass' };

  const headroom = Math.min(...gaps);
  let fanout;
  if (headroom > 30) fanout = Math.max(2, Math.min(8, Math.floor(headroom / 8)));
  else if (headroom >= 20) fanout = 2;
  else if (headroom >= 10) fanout = 1;
  else fanout = 0; // inline, no subagents

  const tierWord = (n) => (n ? `${n} scout(s)` : 'inline pass');
  let reason = `headroom ${Math.round(headroom)}pp to wind-down -> ${tierWord(fanout)}`;
  if (json.stale && fanout > 0) {
    const before = fanout;
    fanout = fanout <= 1 ? 0 : Math.max(1, Math.floor(fanout / 2));
    reason += `; stale: dropped a tier (${tierWord(before)} -> ${tierWord(fanout)})`;
  }
  if (headroom <= 0) { fanout = 0; reason += '; at/over wind-down — stop after this pass'; }
  return { fanout, headroom: Math.round(headroom), reason, atWindDown: headroom <= 0 };
}

// --- findings (dedupe + append to deliverable doc) --------------------------

function seenPath(mode) { return path.join(stateDir(), `seen-${mode}.json`); }
function keyOf(item) {
  return [item.file || '', item.line == null ? '' : item.line, (item.claim || item.title || '').slice(0, 120)]
    .join('|').toLowerCase();
}
function fmtItem(item) {
  const loc = item.file ? `\`${item.file}${item.line != null ? ':' + item.line : ''}\`` : '';
  const sev = item.severity ? `**${item.severity}** ` : '';
  const claim = item.claim || item.title || '';
  const why = item.why ? ` — ${item.why}` : '';
  return `- ${sev}${loc}${loc ? ': ' : ''}${claim}${why}`;
}
// Dedupe against the per-mode seen-set, append survivors to the doc under a
// timestamped pass header (timestamp passed in — Date.now is avoided for testability).
function recordFindings(mode, items, stamp) {
  items = Array.isArray(items) ? items : [];
  const seen = new Set(readJson(seenPath(mode), []));
  const fresh = [];
  for (const it of items) {
    const k = keyOf(it);
    if (seen.has(k)) continue;
    seen.add(k); fresh.push(it);
  }
  writeJson(seenPath(mode), [...seen]);

  const doc = docFor(mode);
  ensureDir(path.dirname(doc));
  if (!fs.existsSync(doc)) {
    fs.writeFileSync(doc, `# ${mode} sweep — heavy-usage\n\nAccumulated across passes. Deduped by file+line+claim.\n`);
  }
  if (fresh.length) {
    const header = `\n## pass${stamp ? ' ' + stamp : ''} (+${fresh.length})\n`;
    fs.appendFileSync(doc, header + fresh.map(fmtItem).join('\n') + '\n');
  }
  return { added: fresh.length, skipped: items.length - fresh.length, doc, total: seen.size };
}

function writeResume(mode, payload) {
  const doc = path.join(docsDir(), 'RESUME.md');
  ensureDir(path.dirname(doc));
  const idx = loadIndex() || {};
  const lines = [
    `# Sweep resume — heavy-usage`,
    ``,
    `- mode: \`${mode}\``,
    `- cursor: ${idx.cursor ?? '?'} / ${idx.files ? idx.files.length : '?'} files, depth ${idx.depth ?? 0}`,
    payload && payload.counts ? `- findings so far: ${payload.counts}` : null,
    payload && payload.note ? `- note: ${payload.note}` : null,
    ``,
    `Next: \`/loop /sweep ${mode} auto\` (or wait for the scheduled post-reset resume).`,
    ``,
  ].filter((l) => l != null);
  fs.writeFileSync(doc, lines.join('\n'));
  return { doc };
}

// --- gitignore (keep target repo clean) -------------------------------------

function ensureGitignore() {
  const gi = path.join(repoRoot(), '.gitignore');
  const entry = '.heavy-usage-sweep/';
  let cur = '';
  try { cur = fs.readFileSync(gi, 'utf8'); } catch {}
  if (cur.split(/\r?\n/).some((l) => l.trim() === entry)) return { changed: false, gitignore: gi };
  fs.writeFileSync(gi, (cur && !cur.endsWith('\n') ? cur + '\n' : cur) + entry + '\n');
  return { changed: true, gitignore: gi };
}

// --- CLI --------------------------------------------------------------------

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}
function out(obj) { process.stdout.write(JSON.stringify(obj, null, 2) + '\n'); }

function main() {
  const [cmd, a1, a2] = process.argv.slice(2);
  switch (cmd) {
    case 'tier': {
      const raw = readStdin().trim();
      out(decideTier(raw ? JSON.parse(raw) : {}));
      return;
    }
    case 'config-has': { out({ mode: a1, has: hasConfig(a1) }); return; }
    case 'config-get': { out(loadConfig()[a1] || null); return; }
    case 'config-set': {
      const raw = readStdin().trim();
      out(saveConfig(a1, raw ? JSON.parse(raw) : {}));
      return;
    }
    case 'index-build': {
      const raw = readStdin().trim();
      const cfg = raw ? JSON.parse(raw) : (loadConfig()[a1] || {});
      const idx = buildIndex(cfg);
      out({ count: idx.files.length, builtFrom: idx.builtFrom });
      return;
    }
    case 'next': { out(nextSlice(a2 ? parseInt(a2, 10) : 1)); return; }
    case 'record': {
      const raw = readStdin().trim();
      out(recordFindings(a1, raw ? JSON.parse(raw) : [], a2 || ''));
      return;
    }
    case 'resume': {
      const raw = readStdin().trim();
      out(writeResume(a1, raw ? JSON.parse(raw) : {}));
      return;
    }
    case 'gitignore': { out(ensureGitignore()); return; }
    default:
      process.stderr.write('usage: sweep-state.js <tier|config-has|config-get|config-set|index-build|next|record|resume|gitignore> [mode] [n]\n');
      process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  repoRoot, stateDir, docsDir, docFor, DOCS,
  loadConfig, hasConfig, saveConfig,
  globToRe, anyMatch, buildIndex, loadIndex, nextSlice,
  decideTier, keyOf, recordFindings, writeResume, ensureGitignore,
};
