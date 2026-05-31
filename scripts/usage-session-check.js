#!/usr/bin/env node
// usage-session-check — SessionStart hook. If heavy-usage's statusLine is not
// wired yet, print a one-line reminder so the user knows usage tracking +
// loop wind-down are inactive until they run `/usage setup`. Once wired, it is
// silent forever (the check passes), so it never nags a configured install.
//
// Pure Node, no deps. Reads ~/.claude/settings.json read-only.

const fs = require('fs');
const path = require('path');
const lib = require('./usage-lib');

// The statusLine command string, whether settings.statusLine is a string or
// an object { command }.
function statusLineCmd(settings) {
  const sl = settings && settings.statusLine;
  if (!sl) return null;
  return typeof sl === 'string' ? sl : (sl && sl.command) || null;
}

// True if settings already point the statusLine at our capturer.
function isWired(settings) {
  const cmd = statusLineCmd(settings);
  return typeof cmd === 'string' && cmd.includes('usage-statusline');
}

// Pull the path argument ending in usage-statusline.js (quoted or bare) out of
// a wired command string, so we can check it still exists.
function wiredStatuslinePath(cmd) {
  if (typeof cmd !== 'string') return null;
  const m = cmd.match(/"([^"]*usage-statusline\.js)"|(\S*usage-statusline\.js)/);
  return m ? (m[1] || m[2] || null) : null;
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(lib.claudeDir(), 'settings.json'), 'utf8'));
  } catch { return null; }
}

function main() {
  const settings = readSettings();
  if (!isWired(settings)) {
    process.stdout.write(
      '[heavy-usage] Not wired yet — usage tracking and the loop wind-down are inactive. '
      + 'Run `/usage setup` to enable them (one time).'
    );
    return;
  }
  // Wired — but statusLine settings don't expand ${CLAUDE_PLUGIN_ROOT}, so setup
  // writes a concrete path. If a plugin update moved it, that path goes stale and
  // capture silently dies. Surface it instead of staying silent.
  const p = wiredStatuslinePath(statusLineCmd(settings));
  if (p && path.isAbsolute(p) && !fs.existsSync(p)) {
    process.stdout.write(
      '[heavy-usage] statusLine points at a file that no longer exists '
      + `(${p}) — a plugin update likely moved it. Re-run \`/usage setup\` to re-wire.`
    );
    return;
  }
  // configured and healthy -> silent
}

if (require.main === module) main();

module.exports = { isWired, statusLineCmd, wiredStatuslinePath };
