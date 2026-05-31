#!/usr/bin/env node
// heavy-usage unit tests — plain Node, no framework. Run: node tests/run.js
// Exits non-zero on first failure. Uses a throwaway CLAUDE_PLUGIN_DATA dir so
// no real state is touched.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate state BEFORE requiring modules that resolve paths lazily (they read
// process.env on each call, so setting it here is enough).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'heavy-usage-test-'));
process.env.CLAUDE_PLUGIN_DATA = TMP;

const lib = require('../scripts/usage-lib');
const meter = require('../scripts/usage-meter');
const sl = require('../scripts/usage-statusline');
const session = require('../scripts/usage-session-check');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { console.error(`✗ ${name}\n  ${e.message}`); process.exitCode = 1; }
}

const TH = { warn: 0.70, windDown: 0.85 };

// --- usage-lib --------------------------------------------------------------

test('statusWord bands', () => {
  assert.equal(lib.statusWord(null, TH), 'NO DATA');
  assert.equal(lib.statusWord(0.50, TH), 'OK');
  assert.equal(lib.statusWord(0.72, TH), 'WARN');
  assert.equal(lib.statusWord(0.90, TH), 'WIND DOWN');
  assert.equal(lib.statusWord(1.00, TH), 'AT LIMIT');
});

test('untilStr formatting', () => {
  const now = 1_000_000;
  assert.equal(lib.untilStr(now - 10, now), 'now');
  assert.equal(lib.untilStr(now + 1800, now), '30m');
  assert.equal(lib.untilStr(now + 5400, now), '1h 30m');
  assert.equal(lib.untilStr(null, now), '?');
});

test('bar is 20 cells + fills proportionally', () => {
  assert.equal(lib.bar(0).replace(/[^█░]/g, '').length, 20);
  assert.ok(lib.bar(0).startsWith('░'));
  assert.ok(lib.bar(1).startsWith('█'.repeat(20)));
  assert.equal((lib.bar(0.5).match(/█/g) || []).length, 10);
});

test('readState returns defaults when no file', () => {
  const s = lib.readState();
  assert.equal(s.enabled, true);
  assert.equal(s.thresholds.warn, 0.70);
  assert.equal(s.thresholds.windDown, 0.85);
  assert.equal(s.innerStatusline, null);
});

test('writeState/readState round-trip + merges new keys', () => {
  const s = lib.readState();
  s.thresholds.windDown = 0.9;
  s.innerStatusline = 'printf X';
  lib.writeState(s);
  const back = lib.readState();
  assert.equal(back.thresholds.windDown, 0.9);
  assert.equal(back.innerStatusline, 'printf X');
  assert.equal(back.thresholds.warn, 0.70); // default preserved
});

test('atomic write leaves no tmp file', () => {
  lib.writeState(lib.readState());
  const leftovers = fs.readdirSync(TMP).filter(f => f.includes('.tmp'));
  assert.deepEqual(leftovers, []);
});

test('readLive null when absent, round-trips when written', () => {
  fs.rmSync(lib.livePath(), { force: true });
  assert.equal(lib.readLive(), null);
  lib.writeLive({ version: 1, capturedAt: 123, five_hour: { used_percentage: 5, resets_at: 9 }, seven_day: null });
  assert.equal(lib.readLive().five_hour.used_percentage, 5);
});

// --- usage-meter ------------------------------------------------------------

test('worst picks higher window', () => {
  const live = { five_hour: { used_percentage: 30 }, seven_day: { used_percentage: 80 } };
  const w = meter.worst(live);
  assert.equal(w.which, 'weekly');
  assert.equal(w.frac, 0.80);
});

test('worst picks 5-hour when higher', () => {
  const w = meter.worst({ five_hour: { used_percentage: 95 }, seven_day: { used_percentage: 10 } });
  assert.equal(w.which, '5-hour');
});

test('worst null when no data', () => {
  assert.equal(meter.worst(null), null);
  assert.equal(meter.worst({ five_hour: null, seven_day: null }), null);
});

test('formatHook silent when disabled', () => {
  const live = { five_hour: { used_percentage: 99, resets_at: 9 }, seven_day: null };
  assert.equal(meter.formatHook(live, { enabled: false, thresholds: TH }), '');
});

test('formatHook silent below warn', () => {
  const live = { five_hour: { used_percentage: 50, resets_at: 9 }, seven_day: null };
  assert.equal(meter.formatHook(live, { enabled: true, thresholds: TH }), '');
});

test('formatHook WARN band', () => {
  const live = { five_hour: { used_percentage: 75, resets_at: Math.floor(Date.now()/1000)+60 }, seven_day: null };
  const out = meter.formatHook(live, { enabled: true, thresholds: TH });
  assert.ok(out.startsWith('[heavy-usage] WARN'), out);
  assert.ok(out.includes('75%'));
});

test('formatHook WIND DOWN band', () => {
  const live = { five_hour: { used_percentage: 90, resets_at: Math.floor(Date.now()/1000)+60 }, seven_day: null };
  const out = meter.formatHook(live, { enabled: true, thresholds: TH });
  assert.ok(out.startsWith('[heavy-usage] WIND DOWN'), out);
  assert.ok(out.includes('stop the loop') || out.includes('end'));
});

test('formatHook null live -> silent', () => {
  assert.equal(meter.formatHook(null, { enabled: true, thresholds: TH }), '');
});

test('ageStr', () => {
  assert.equal(meter.ageStr(Date.now()), 'just now');
  assert.equal(meter.ageStr(Date.now() - 5*60*1000), '5m ago');
  assert.equal(meter.ageStr(0), '');
});

// --- usage-statusline -------------------------------------------------------

test('captureRateLimits writes live + returns true', () => {
  fs.rmSync(lib.livePath(), { force: true });
  const ok = sl.captureRateLimits({ rate_limits: {
    five_hour: { used_percentage: 23.5, resets_at: 111 },
    seven_day: { used_percentage: 41.2, resets_at: 222 },
  }}, 999);
  assert.equal(ok, true);
  const live = lib.readLive();
  assert.equal(live.five_hour.used_percentage, 23.5);
  assert.equal(live.seven_day.resets_at, 222);
  assert.equal(live.capturedAt, 999);
});

test('captureRateLimits false when no rate_limits', () => {
  assert.equal(sl.captureRateLimits({}, 1), false);
  assert.equal(sl.captureRateLimits({ rate_limits: {} }, 1), false);
});

test('segment renders 5h/7d, empty without rate_limits', () => {
  const seg = sl.segment({ rate_limits: { five_hour: { used_percentage: 24 }, seven_day: { used_percentage: 41 } } }, { thresholds: TH });
  assert.ok(seg.includes('5h 24%'));
  assert.ok(seg.includes('7d 41%'));
  assert.equal(sl.segment({}, { thresholds: TH }), '');
});

test('chainInner empty when no inner command', () => {
  assert.equal(sl.chainInner({ innerStatusline: null }, '{}'), '');
});

// --- usage-session-check ----------------------------------------------------

test('isWired detects our capturer (object + string forms)', () => {
  assert.equal(session.isWired(null), false);
  assert.equal(session.isWired({}), false);
  assert.equal(session.isWired({ statusLine: { command: 'bash caveman-statusline.sh' } }), false);
  assert.equal(session.isWired({ statusLine: { command: 'node "/x/scripts/usage-statusline.js"' } }), true);
  assert.equal(session.isWired({ statusLine: 'node /x/usage-statusline.js' }), true);
});

// --- summary ----------------------------------------------------------------

fs.rmSync(TMP, { recursive: true, force: true });
if (process.exitCode) {
  console.error(`\n${passed} passed, some FAILED.`);
} else {
  console.log(`✓ all ${passed} tests passed`);
}
