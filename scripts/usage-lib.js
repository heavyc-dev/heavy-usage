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
  // fractions of the official 0-1 usage. warn/windDown are the 5-hour window;
  // weeklyWarn/weeklyWindDown are the 7-day window (it moves slower and the
  // overshoot cost differs, so it gets its own, higher pair by default).
  thresholds: { warn: 0.75, windDown: 0.90, weeklyWarn: 0.85, weeklyWindDown: 0.95 },
  innerStatusline: null,               // command string chained after heavy-usage's segment
};

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// Fixed, deterministic state dir. We intentionally DO NOT use CLAUDE_PLUGIN_DATA:
// the harness sets it in some contexts (the slash command) but not others (the
// statusLine command and the hook), which would split state across two dirs —
// the statusLine writes the live file one place while the hook reads another.
// Pinning to ~/.claude/heavy-usage guarantees the capturer, the reader, and the
// command all share one location. (CLAUDE_CONFIG_DIR still relocates the whole
// ~/.claude root, so custom config dirs are honored.)
function stateDir() {
  return path.join(claudeDir(), 'heavy-usage');
}

function statePath() { return path.join(stateDir(), 'usage-state.json'); }
function livePath()  { return path.join(stateDir(), 'usage-live.json'); }

function atomicWriteJson(file, obj) {
  const dir = path.dirname(file);
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
  const data = JSON.stringify(obj, null, 2);
  fs.writeFileSync(tmp, data, 'utf8');
  try {
    JSON.parse(fs.readFileSync(tmp, 'utf8')); // parse-check before swap
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch {} // don't leave an orphan
    throw e;
  }
  fs.renameSync(tmp, file);
}

// A valid pair is finite numbers in [0,1] with warn < windDown.
function validPair(warn, windDown) {
  return Number.isFinite(warn) && Number.isFinite(windDown)
    && warn >= 0 && windDown <= 1 && warn < windDown;
}

// Guard against a corrupt or hand-edited state file. Each window's pair is
// validated independently and falls back to its own default if bad, so the hook
// keeps working instead of going silent on a NaN/inverted threshold. A file
// that predates weekly thresholds (only warn/windDown) gets weekly defaults.
function sanitizeThresholds(th) {
  const d = STATE_DEFAULTS.thresholds;
  th = th || {};
  const five = validPair(th.warn, th.windDown)
    ? { warn: th.warn, windDown: th.windDown }
    : { warn: d.warn, windDown: d.windDown };
  const weekly = validPair(th.weeklyWarn, th.weeklyWindDown)
    ? { warn: th.weeklyWarn, windDown: th.weeklyWindDown }
    : { warn: d.weeklyWarn, windDown: d.weeklyWindDown };
  return {
    warn: five.warn, windDown: five.windDown,
    weeklyWarn: weekly.warn, weeklyWindDown: weekly.windDown,
  };
}

// Resolve the {warn, windDown} pair for a window. weekly=true returns the
// weekly pair; if a thresholds object lacks weekly fields (an old/partial
// object, as several tests pass), it falls back to the 5-hour pair so behavior
// is unchanged.
function thFor(th, weekly) {
  if (weekly && Number.isFinite(th.weeklyWarn) && Number.isFinite(th.weeklyWindDown)) {
    return { warn: th.weeklyWarn, windDown: th.weeklyWindDown };
  }
  return { warn: th.warn, windDown: th.windDown };
}

function readState() {
  try {
    const p = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return {
      ...STATE_DEFAULTS,
      ...p,
      thresholds: sanitizeThresholds({ ...STATE_DEFAULTS.thresholds, ...(p.thresholds || {}) }),
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
  atomicWriteJson, validPair, sanitizeThresholds, thFor, readState, writeState, readLive, writeLive,
  statusWord, untilStr, bar,
};
