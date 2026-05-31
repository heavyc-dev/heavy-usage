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

// True if settings already point the statusLine at our capturer.
function isWired(settings) {
  if (!settings || !settings.statusLine) return false;
  const sl = settings.statusLine;
  const cmd = typeof sl === 'string' ? sl : (sl && sl.command);
  return typeof cmd === 'string' && cmd.includes('usage-statusline');
}

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(path.join(lib.claudeDir(), 'settings.json'), 'utf8'));
  } catch { return null; }
}

function main() {
  if (isWired(readSettings())) return; // configured -> silent
  process.stdout.write(
    '[heavy-usage] Not wired yet — usage tracking and the loop wind-down are inactive. '
    + 'Run `/usage setup` to enable them (one time).'
  );
}

if (require.main === module) main();

module.exports = { isWired };
