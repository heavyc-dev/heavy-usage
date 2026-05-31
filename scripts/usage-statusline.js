#!/usr/bin/env node
// usage-statusline — heavy-usage's statusLine command.
//
// Claude Code pipes the statusLine payload (JSON) on stdin. That payload is the
// ONLY place the official `rate_limits` block is exposed. This script:
//   1. captures rate_limits -> writes usage-live.json (read by the wind-down
//      hook and the /usage command),
//   2. renders a compact usage segment for the status bar,
//   3. chains the user's previous statusLine (state.innerStatusline) so they
//      keep e.g. the caveman badge — heavy-usage owns the statusLine but yields the
//      rest of the line back to whatever was there before.
//
// Wire it via /usage setup (sets ~/.claude/settings.json statusLine -> this).
// Pure Node, no deps. Must stay fast: the status bar blocks on it.

const fs = require('fs');
const { spawnSync } = require('child_process');
const lib = require('./usage-lib');

// pull rate_limits -> normalized {five_hour:{used_percentage,resets_at}, ...}
function captureRateLimits(payload, nowMs) {
  const rl = payload && payload.rate_limits;
  if (!rl) return false;
  const norm = (w) => w && typeof w.used_percentage === 'number'
    ? { used_percentage: w.used_percentage, resets_at: w.resets_at || null }
    : null;
  const five = norm(rl.five_hour);
  const seven = norm(rl.seven_day);
  if (!five && !seven) return false;
  try {
    lib.writeLive({ version: 1, capturedAt: nowMs, five_hour: five, seven_day: seven });
  } catch { /* never break the status bar over a write error */ }
  return true;
}

// compact colored segment, e.g. "5h 24% · 7d 41%" (color escalates with usage)
function segment(payload, state) {
  const rl = payload && payload.rate_limits;
  if (!rl) return ''; // API users / pre-first-response: render nothing extra
  const th = state.thresholds;
  const now = Math.floor(Date.now() / 1000);
  const C = String.fromCharCode(27); // ESC, for inline ANSI color around the pace tag
  const part = (label, w, weekly) => {
    if (!w || typeof w.used_percentage !== 'number') return null;
    const frac = w.used_percentage / 100;
    const t = lib.thFor(th, weekly);
    // ansi: green <warn, yellow <winddown, red >=winddown
    const color = frac >= t.windDown ? 196 : (frac >= t.warn ? 178 : 71);
    // pace tag in its OWN color so the % keeps its threshold color and pace
    // reads as secondary: ahead=178 (caution), behind=73 (headroom), ontrack=244 (dim)
    const windowSec = weekly ? lib.WINDOW_SEC.seven : lib.WINDOW_SEC.five;
    const tag = lib.paceTag(w.used_percentage, w.resets_at, now, windowSec, state.paceBandPp);
    const paceColor = tag ? (tag.state === 'ahead' ? 178 : tag.state === 'behind' ? 73 : 244) : 0;
    const paceTxt = tag ? (tag.word ? `${tag.word} ${tag.mag}` : tag.mag) : '';
    // once hot (>= warn), append the reset countdown so urgency shows without /usage
    const tail = frac >= t.warn && w.resets_at ? ` ${lib.untilStr(w.resets_at, now)}` : '';
    // reset, emit pace in its own color, then restore the window color for tail
    const pace = paceTxt ? `${C}[0m ${C}[38;5;${paceColor}m${paceTxt}${C}[38;5;${color}m` : '';
    return `[38;5;${color}m${label} ${Math.round(w.used_percentage)}%${pace}${tail}[0m`;
  };
  const segs = [part('5h', rl.five_hour, false), part('7d', rl.seven_day, true)].filter(Boolean);
  return segs.join(' · ');
}

// run the chained inner statusline, feeding it the SAME payload on stdin
function chainInner(state, rawStdin) {
  const cmd = state.innerStatusline;
  if (!cmd || typeof cmd !== 'string') return '';
  try {
    const shell = process.platform === 'win32';
    const res = spawnSync(cmd, {
      input: rawStdin || '',
      shell: shell ? true : '/bin/sh',
      timeout: 2000,
      maxBuffer: 1 << 20,
      encoding: 'utf8',
    });
    return (res.stdout || '').replace(/\n+$/, '');
  } catch { return ''; }
}

function main() {
  const nowMs = Date.now();
  let raw = '';
  if (!process.stdin.isTTY) {
    try { raw = fs.readFileSync(0, 'utf8'); } catch {}
  }
  let payload = null;
  try { payload = raw.trim() ? JSON.parse(raw) : null; } catch {}

  const state = lib.readState();
  if (payload) captureRateLimits(payload, nowMs);

  const inner = chainInner(state, raw);
  const seg = segment(payload, state);

  // inner (e.g. caveman badge) on the left, heavy-usage segment on the right
  const out = [inner, seg].filter(Boolean).join('  ');
  if (out) process.stdout.write(out);
}

if (require.main === module) main();

module.exports = { captureRateLimits, segment, chainInner };
