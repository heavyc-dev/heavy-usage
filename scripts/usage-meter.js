#!/usr/bin/env node
// usage-meter — read the OFFICIAL Claude Code usage numbers (captured from the
// statusLine payload into usage-live.json by usage-statusline.js) and report
// them / drive the loop wind-down hook.
//
// These are the real figures Claude Code shows in /usage — five_hour and
// seven_day used_percentage (0-100) plus resets_at — NOT a token estimate.
// Caveat (from the docs): rate_limits is present only for Claude.ai Pro/Max
// subscribers and only after the first API response in a session. Before that,
// or on API/console billing, there is simply no data and we say so.
//
// CLI:
//   node usage-meter.js                 human report (5h / 7d % + reset countdown)
//   node usage-meter.js --json          machine JSON
//   node usage-meter.js --hook          one-line wind-down context (silent below warn)
//   node usage-meter.js thresholds --warn 0.75 --winddown 0.90
//   node usage-meter.js enable | disable    toggle the wind-down hook
//
// Data is produced by the statusLine capturer; run `/usage setup` to wire it.
// Pure Node, no deps.

const lib = require('./usage-lib');

function nowSec() { return Math.floor(Date.now() / 1000); }

// worst (highest) of the two windows -> { frac, which, window }
function worst(live) {
  if (!live) return null;
  const f5 = live.five_hour && typeof live.five_hour.used_percentage === 'number'
    ? live.five_hour.used_percentage / 100 : null;
  const f7 = live.seven_day && typeof live.seven_day.used_percentage === 'number'
    ? live.seven_day.used_percentage / 100 : null;
  if (f5 == null && f7 == null) return null;
  if ((f7 || -1) >= (f5 || -1)) return { frac: f7, which: 'weekly', window: live.seven_day };
  return { frac: f5, which: '5-hour', window: live.five_hour };
}

function ageStr(capturedAtMs) {
  if (!capturedAtMs) return '';
  const sec = Math.floor((Date.now() - capturedAtMs) / 1000);
  if (sec < 60) return 'just now';
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

function getFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return null;
  const v = args[i + 1];
  if (v == null || v.startsWith('--')) return null; // missing value or next flag
  return v;
}

// fractions: finite, in [0,1], warn strictly below windDown
function thresholdsOk(warn, windDown) {
  return Number.isFinite(warn) && Number.isFinite(windDown)
    && warn >= 0 && windDown <= 1 && warn < windDown;
}

// --- formatting -------------------------------------------------------------

// Color a status word with the same palette as the statusLine segment:
// green OK, yellow WARN, red WIND DOWN / AT LIMIT, dim NO DATA.
function colorWord(word) {
  const c = word === 'OK' ? 71 : word === 'WARN' ? 178 : word === 'NO DATA' ? 244 : 196;
  return `\x1b[38;5;${c}m${word}\x1b[0m`;
}

// One-line threshold summary for the report footer.
function thresholdLine(state) {
  const t = state.thresholds;
  const five = lib.thFor(t, false);
  const wk = lib.thFor(t, true);
  const pct = (n) => `${Math.round(n * 100)}%`;
  return `Hook ${state.enabled ? 'ON' : 'OFF'} · 5h warn ${pct(five.warn)}/wind-down ${pct(five.windDown)}`
    + ` · weekly warn ${pct(wk.warn)}/wind-down ${pct(wk.windDown)}`;
}

function formatHuman(live, state) {
  const th = state.thresholds;
  const sep = '──────────────────────────────────────────';
  const L = [];
  L.push('');
  L.push('heavy-usage — official usage (Claude Code rate_limits)');
  L.push(sep);
  if (!live || worst(live) == null) {
    L.push('No usage data yet.');
    L.push('• rate_limits is provided only to Claude.ai Pro/Max subscribers,');
    L.push('  and only after the first API response in a session.');
    L.push('• Make sure the heavy-usage statusLine is active: run `/usage setup`.');
    L.push(sep);
    L.push(thresholdLine(state));
    L.push('');
    return L.join('\n');
  }
  const now = nowSec();
  const row = (label, w, weekly) => {
    if (!w || typeof w.used_percentage !== 'number') {
      L.push(`${label}   —   no data`);
      return;
    }
    const frac = w.used_percentage / 100;
    const word = lib.statusWord(frac, lib.thFor(th, weekly));
    L.push(`${label}   ${lib.bar(frac)} ${Math.round(w.used_percentage)}%   ${colorWord(word)}`);
    const clk = lib.clockStr(w.resets_at);
    L.push(`         resets in ${lib.untilStr(w.resets_at, now)}${clk ? ` (${clk})` : ''}`);
  };
  row('5-hour', live.five_hour, false);
  row('Weekly', live.seven_day, true);
  L.push(sep);
  L.push(`${thresholdLine(state)} · updated ${ageStr(live.capturedAt)}`);
  L.push('Official figures Claude Code reported to the status bar (this session).');
  L.push('');
  return L.join('\n');
}

// Evaluate each window against ITS OWN thresholds and return the most severe
// band: 2 = wind-down, 1 = warn, 0 = below warn. On a tie the 5-hour window
// wins (it resets sooner, so naming it is the more actionable message).
function topSignal(live, th) {
  if (!live) return null;
  const wins = [
    { which: '5-hour', w: live.five_hour, t: lib.thFor(th, false) },
    { which: 'weekly', w: live.seven_day, t: lib.thFor(th, true) },
  ];
  let best = null;
  for (const x of wins) {
    const frac = x.w && typeof x.w.used_percentage === 'number' ? x.w.used_percentage / 100 : null;
    if (frac == null) continue;
    const band = frac >= x.t.windDown ? 2 : (frac >= x.t.warn ? 1 : 0);
    if (!best || band > best.band) best = { band, frac, which: x.which, window: x.w };
  }
  return best;
}

function formatHook(live, state) {
  if (!state.enabled) return '';
  const s = topSignal(live, state.thresholds);
  if (!s || s.band === 0) return '';
  const pctNum = Math.round(s.frac * 100);
  const resets = lib.untilStr(s.window && s.window.resets_at, nowSec());
  // WARN band: a status-only FYI. It must NOT steer how Claude works (no
  // "smaller steps", no "commit more") — it only asks Claude to surface the
  // current numbers to the user as a one-line footer.
  if (s.band === 1) {
    return `[heavy-usage] FYI for the user (does not change how you work): `
      + `${s.which} usage ${pctNum}%, resets in ${resets}. `
      + `End your reply with exactly this line and nothing else added:\n`
      + `> 🔋 ${s.which} ${pctNum}% · resets in ${resets}`;
  }
  // Wind-down: the one signal that does change behavior.
  return `[heavy-usage] WIND DOWN — official ${s.which} usage is ${pctNum}% (resets in ${resets}). `
    + `Do not start new work. Finish the current step, commit what is done, write a brief state summary, then stop the loop.`;
}

// --- main -------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const sub = args[0] && !args[0].startsWith('--') ? args[0] : null;

  if (sub === 'thresholds') {
    const state = lib.readState();
    // 5-hour flags: --warn/--winddown. Weekly flags: --weekly-warn/--weekly-winddown.
    // A flag present without a usable value (e.g. `--warn` at end, or `--warn
    // --winddown 0.85`) is an error, not a silent no-op.
    const readPair = (warnFlag, wdFlag, cur) => {
      const warnRaw = getFlag(args, warnFlag);
      const wdRaw = getFlag(args, wdFlag);
      const badValue = (args.includes(warnFlag) && warnRaw === null)
        || (args.includes(wdFlag) && wdRaw === null);
      const warn = warnRaw != null ? Number(warnRaw) : cur.warn;
      const windDown = wdRaw != null ? Number(wdRaw) : cur.windDown;
      return { warn, windDown, ok: !badValue && thresholdsOk(warn, windDown) };
    };
    const five = readPair('--warn', '--winddown', lib.thFor(state.thresholds, false));
    const weekly = readPair('--weekly-warn', '--weekly-winddown', lib.thFor(state.thresholds, true));
    if (!five.ok || !weekly.ok) {
      process.stderr.write(
        'Invalid thresholds. Pass fractions 0–1 with warn < wind-down, '
        + 'e.g. `thresholds --warn 0.75 --winddown 0.90 --weekly-warn 0.85 --weekly-winddown 0.95`. '
        + 'State unchanged.\n');
      process.exitCode = 1;
      return;
    }
    state.thresholds.warn = five.warn;
    state.thresholds.windDown = five.windDown;
    state.thresholds.weeklyWarn = weekly.warn;
    state.thresholds.weeklyWindDown = weekly.windDown;
    lib.writeState(state);
    const pct = (n) => `${Math.round(n * 100)}%`;
    process.stdout.write(
      `Thresholds — 5h warn ${pct(five.warn)}/wind-down ${pct(five.windDown)}, `
      + `weekly warn ${pct(weekly.warn)}/wind-down ${pct(weekly.windDown)}\n`);
    return;
  }

  if (sub === 'enable' || sub === 'disable') {
    const state = lib.readState();
    state.enabled = sub === 'enable';
    lib.writeState(state);
    process.stdout.write(`Wind-down hook ${state.enabled ? 'ENABLED' : 'DISABLED'}.\n`);
    return;
  }

  const live = lib.readLive();
  const state = lib.readState();

  if (args.includes('--hook')) {
    const line = formatHook(live, state);
    if (line) process.stdout.write(line + '\n');
    return;
  }
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify({
      five_hour: live ? live.five_hour : null,
      seven_day: live ? live.seven_day : null,
      capturedAt: live ? live.capturedAt : null,
      thresholds: state.thresholds, enabled: state.enabled,
    }, null, 2) + '\n');
    return;
  }
  process.stdout.write(formatHuman(live, state));
}

if (require.main === module) main();

module.exports = { worst, formatHuman, formatHook, ageStr, getFlag, thresholdsOk };
