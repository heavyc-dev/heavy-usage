// usage-lib — shared paths, state IO, and formatting for the heavy-usage guard.
// Required by usage-statusline.js (the capturer) and usage-meter.js (the reader).
// Pure Node, no deps.
//
// Data source: Claude Code's statusLine stdin JSON carries an official
// `rate_limits` block (five_hour / seven_day, each used_percentage 0-100 +
// resets_at epoch seconds). It is delivered ONLY to the statusLine command, so
// the capturer writes it to usage-live.json and everything else reads that.

const fs = require('fs');
const path = require('path');
const os = require('os');

const STATE_DEFAULTS = {
  version: 1,
  enabled: true,                       // wind-down hook on/off
  thresholds: { warn: 0.70, windDown: 0.85 }, // fractions of the official 0-1 usage
  innerStatusline: null,               // command string chained after heavy-usage's segment
};

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Survives /clear and new sessions. Plugin data dir when provided, else ~/.claude/heavy-usage.
function stateDir() {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(claudeDir(), 'heavy-usage');
}

function statePath() { return path.join(stateDir(), 'usage-state.json'); }
function livePath()  { return path.join(stateDir(), 'usage-live.json'); }

function atomicWriteJson(file, obj) {
  const dir = path.dirname(file);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  const data = JSON.stringify(obj, null, 2);
  fs.writeFileSync(tmp, data, 'utf8');
  JSON.parse(fs.readFileSync(tmp, 'utf8')); // parse-check before swap
  fs.renameSync(tmp, file);
}

function readState() {
  try {
    const p = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return {
      ...STATE_DEFAULTS,
      ...p,
      thresholds: { ...STATE_DEFAULTS.thresholds, ...(p.thresholds || {}) },
    };
  } catch {
    return { ...STATE_DEFAULTS, thresholds: { ...STATE_DEFAULTS.thresholds } };
  }
}

function writeState(state) { atomicWriteJson(statePath(), state); }

function readLive() {
  try { return JSON.parse(fs.readFileSync(livePath(), 'utf8')); }
  catch { return null; }
}

function writeLive(live) { atomicWriteJson(livePath(), live); }

// --- formatting helpers -----------------------------------------------------

// fraction 0-1 -> status word against thresholds
function statusWord(frac, th) {
  if (frac == null) return 'NO DATA';
  if (frac >= 1) return 'AT LIMIT';
  if (frac >= th.windDown) return 'WIND DOWN';
  if (frac >= th.warn) return 'WARN';
  return 'OK';
}

// seconds until epoch -> "2h 14m" / "8m" / "now"
function untilStr(resetsAtSec, nowSec) {
  if (!resetsAtSec) return '?';
  let s = resetsAtSec - nowSec;
  if (s <= 0) return 'now';
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function bar(frac) {
  if (frac == null) return '—';
  const f = Math.max(0, Math.min(20, Math.round(frac * 20)));
  return '█'.repeat(f) + '░'.repeat(20 - f);
}

module.exports = {
  STATE_DEFAULTS, claudeDir, stateDir, statePath, livePath,
  atomicWriteJson, readState, writeState, readLive, writeLive,
  statusWord, untilStr, bar,
};
