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
    L.push(`Hook ${state.enabled ? 'ON' : 'OFF'} · warn ${Math.round(th.warn * 100)}% · wind-down ${Math.round(th.windDown * 100)}%`);
    L.push('');
    return L.join('\n');
  }
  const now = nowSec();
  const row = (label, w) => {
    if (!w || typeof w.used_percentage !== 'number') {
      L.push(`${label}   —   no data`);
      return;
    }
    const frac = w.used_percentage / 100;
    L.push(`${label}   ${lib.bar(frac)} ${Math.round(w.used_percentage)}%   ${lib.statusWord(frac, th)}`);
    L.push(`         resets in ${lib.untilStr(w.resets_at, now)}`);
  };
  row('5-hour', live.five_hour);
  row('Weekly', live.seven_day);
  L.push(sep);
  L.push(`Hook ${state.enabled ? 'ON' : 'OFF'} · warn ${Math.round(th.warn * 100)}% · wind-down ${Math.round(th.windDown * 100)}% · updated ${ageStr(live.capturedAt)}`);
  L.push('Official figures Claude Code reported to the status bar (this session).');
  L.push('');
  return L.join('\n');
}

function formatHook(live, state) {
  if (!state.enabled) return '';
  const w = worst(live);
  if (!w || w.frac == null) return '';
  const th = state.thresholds;
  // Only wind-down injects into the prompt. Below it (including the WARN band)
  // we stay silent so usage pressure never steers Claude's work mid-session —
  // the WARN level still shows in the statusLine and `/usage` report.
  if (w.frac < th.windDown) return '';
  const pctNum = Math.round(w.frac * 100);
  const resets = lib.untilStr(w.window && w.window.resets_at, nowSec());
  return `[heavy-usage] WIND DOWN — official ${w.which} usage is ${pctNum}% (resets in ${resets}). `
    + `Do not start new work. Finish the current step, commit what is done, write a brief state summary, then stop the loop.`;
}

// --- main -------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const sub = args[0] && !args[0].startsWith('--') ? args[0] : null;

  if (sub === 'thresholds') {
    const state = lib.readState();
    const warnRaw = getFlag(args, '--warn');
    const wdRaw = getFlag(args, '--winddown');
    // A flag present without a usable value (e.g. `--warn` at end, or `--warn
    // --winddown 0.85`) is an error, not a silent no-op.
    const warnBadValue = args.includes('--warn') && warnRaw === null;
    const wdBadValue = args.includes('--winddown') && wdRaw === null;
    const warn = warnRaw != null ? Number(warnRaw) : state.thresholds.warn;
    const windDown = wdRaw != null ? Number(wdRaw) : state.thresholds.windDown;
    if (warnBadValue || wdBadValue || !thresholdsOk(warn, windDown)) {
      process.stderr.write(
        'Invalid thresholds. Pass fractions 0–1 with warn < wind-down, '
        + 'e.g. `thresholds --warn 0.75 --winddown 0.90`. State unchanged.\n');
      process.exitCode = 1;
      return;
    }
    state.thresholds.warn = warn;
    state.thresholds.windDown = windDown;
    lib.writeState(state);
    process.stdout.write(`Thresholds — warn ${Math.round(warn * 100)}%, wind-down ${Math.round(windDown * 100)}%\n`);
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
