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
  // half-width (percentage points) of the "on track" band around linear pace.
  // |used% - elapsed%| within this -> on track; beyond -> early / won't reach.
  paceBandPp: 10,
  innerStatusline: null,               // command string chained after heavy-usage's segment
};

// Fixed window lengths (seconds). The official windows reset at resets_at, so
// the window started resets_at - WINDOW_SEC; elapsed fraction follows from that.
const WINDOW_SEC = { five: 5 * 3600, seven: 7 * 86400 };

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

// Guard the pace band: a finite number in (0,100]. Anything else (NaN, <=0,
// >100, hand-edited junk) falls back to the default so pace keeps rendering.
function sanitizePaceBand(b) {
  return Number.isFinite(b) && b > 0 && b <= 100 ? b : STATE_DEFAULTS.paceBandPp;
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
      paceBandPp: sanitizePaceBand(p.paceBandPp),
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

// epoch seconds -> local wall-clock "HH:MM" (24h). '' if no value.
function clockStr(resetsAtSec) {
  if (!resetsAtSec) return '';
  const d = new Date(resetsAtSec * 1000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

// --- pace ("on track to hit the limit") -------------------------------------

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

// Fraction 0-1 of a window already elapsed, from its reset time. null if no
// resets_at/windowSec. windowSec is WINDOW_SEC.five or .seven.
function elapsedFrac(resetsAtSec, nowSec, windowSec) {
  if (!resetsAtSec || !windowSec) return null;
  return clamp01((windowSec - (resetsAtSec - nowSec)) / windowSec);
}

// Pace delta in percentage points: used% minus the linear-pace expectation
// (elapsed fraction of the window). Positive = ahead of pace (trending to hit
// the limit before reset); negative = behind (won't reach it at this rate).
function paceDelta(usedPct, resetsAtSec, nowSec, windowSec) {
  const e = elapsedFrac(resetsAtSec, nowSec, windowSec);
  if (e == null || typeof usedPct !== 'number') return null;
  return usedPct - e * 100;
}

// Classify the pace delta into a display tag. Returns null when it can't be
// computed (no resets_at). Within +/-bandPp -> on track (word ''), above ->
// 'early', below -> "won't reach". mag is the signed pp text the bar/report show.
function paceTag(usedPct, resetsAtSec, nowSec, windowSec, bandPp) {
  const d = paceDelta(usedPct, resetsAtSec, nowSec, windowSec);
  if (d == null) return null;
  const band = sanitizePaceBand(bandPp);
  const r = Math.round(d);
  if (d > band) return { state: 'ahead', word: 'early', mag: `+${r}%` };
  if (d < -band) return { state: 'behind', word: "won't reach", mag: `${r}%` };
  return { state: 'ontrack', word: '', mag: `±${Math.abs(r)}%` };
}

function bar(frac) {
  if (frac == null) return '—';
  const f = Math.max(0, Math.min(20, Math.round(frac * 20)));
  return '█'.repeat(f) + '░'.repeat(20 - f);
}

module.exports = {
  STATE_DEFAULTS, WINDOW_SEC, claudeDir, stateDir, statePath, livePath,
  atomicWriteJson, validPair, sanitizeThresholds, sanitizePaceBand, thFor, readState, writeState, readLive, writeLive,
  statusWord, untilStr, clockStr, bar,
  elapsedFrac, paceDelta, paceTag,
};
