# Changelog

## 0.1.0
- Initial release. Split out from the `heavyc` plugin into a focused, standalone tool.
- **`/usage`** — official 5-hour and weekly usage (`used_percentage` + `resets_at`), with status bars and reset countdown. Reads the real Claude Code `rate_limits`, not a token estimate.
- **`/usage setup`** — wires the statusLine into `~/.claude/settings.json` (backs up first, chains any existing statusline as `innerStatusline` so the caveman badge etc. is preserved), and optionally adds a wind-down primer to global `CLAUDE.md`.
- **statusLine capturer** (`scripts/usage-statusline.js`) — captures `rate_limits` to `usage-live.json` and renders a compact, color-escalating `5h % · 7d %` segment.
- **Auto wind-down hook** — `UserPromptSubmit` runs `scripts/usage-meter.js --hook` each turn: silent below 70%, warns at 70%, and at 85% instructs Claude to commit, summarize, and end the loop so unattended runs close out gracefully.
- `/usage on|off` and `/usage thresholds` to control the hook.
- **SessionStart reminder** — if the statusLine isn't wired yet, a one-line nudge to run `/usage setup`; silent once configured.
- Pure Node, no dependencies (`scripts/usage-lib.js` shared). 21 unit tests in `tests/run.js`; GitHub Actions CI (`.github/workflows/ci.yml`) runs syntax check + tests + manifest validation.
- Documented caveat: `rate_limits` is Pro/Max-only and appears only after the first API response in a session ([claude-code#44328](https://github.com/anthropics/claude-code/issues/44328), [#23975](https://github.com/anthropics/claude-code/issues/23975)).
