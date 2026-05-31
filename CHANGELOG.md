# Changelog

## 0.1.4
- **Only wind-down is injected into the prompt now; the WARN band no longer is.** The `UserPromptSubmit` hook used to inject a behavioral line as soon as 5-hour usage crossed the *warn* threshold (75%), nudging Claude toward smaller steps mid-session before any real limit pressure. It now stays silent in the prompt below the *wind-down* threshold — WARN still shows in the statusLine and the `/usage` report, it just no longer steers work. Net effect: fewer injected tokens and no behavior change until you're actually near the wall.
- **README trimmed** to a concise what / use-cases / install / commands / how-it-works reference.

## 0.1.3
- **Default thresholds changed to warn 75% / wind-down 90%** (were 70% / 85%). Wind-down risk is asymmetric — overshooting the limit mid-task is worse than stopping a little early — but for the typical user the old 85% stopped sooner than necessary given the every-turn re-check and the 70% warn tier. Heavy unattended loops with large context / many subagents per turn (where one turn can jump usage several points) should still lower these via `/usage thresholds 0.65 0.80`.

## 0.1.2
- **Input hardening (was a silent failure).** `/usage thresholds` now validates its arguments: a missing value, a non-number, an out-of-range value (outside 0–1), or an inverted pair (`warn ≥ wind-down`) is rejected with a message and a non-zero exit, leaving state unchanged. Previously a bad value could be stored as `NaN`, which made every `frac >= NaN` comparison false and **silently disabled the wind-down hook**. `readState` now also sanitizes a corrupt or hand-edited thresholds block back to defaults.
- **Stale statusLine detection.** Because statusLine settings can't expand `${CLAUDE_PLUGIN_ROOT}`, `/usage setup` writes a concrete path. If a plugin update moves that file, the SessionStart check now warns (instead of staying silent) that the statusLine points at a missing file and to re-run `/usage setup`.
- **Atomic writes** delete their temp file if the pre-swap parse-check fails, so no `.tmp` orphan is left behind.
- **Cross-platform CI** — the test matrix now runs on Ubuntu, Windows, and macOS (the syntax-check step is Node-based so it runs on all three).
- Added tests for threshold validation, threshold sanitizing, `formatHuman`, partial `rate_limits`, and stale-path extraction (30 tests total). README gains an "Uninstall / revert" section and a note on why install needs two restarts; `/usage setup` docs clarified (defined backup paths, reworded the `innerStatusline` step).

## 0.1.1
- **Fix: state directory was split across two locations.** The statusLine capturer and the hook fall back to `~/.claude/heavy-usage`, but the slash command sometimes ran with `CLAUDE_PLUGIN_DATA` set to `…/plugins/data/…` — so the live capture, the hook's reads, and `/usage setup`'s writes could land in different dirs (symptom: chained statusline/caveman badge dropped, thresholds not what you set). State is now pinned to a fixed path (`~/.claude/heavy-usage/`, honoring `CLAUDE_CONFIG_DIR`); `CLAUDE_PLUGIN_DATA` is no longer used. Tests isolate via `CLAUDE_CONFIG_DIR`.

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
