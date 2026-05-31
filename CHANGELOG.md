# Changelog

## 1.2.0
- **Stale-data guard in the wind-down hook.** The statusLine refreshes `usage-live.json` only when the UI renders; in a headless/unattended run it can stop firing while the session keeps prompting, leaving the hook reading old numbers. The hook now **annotates** its WARN/WIND DOWN message when the capture is older than `staleMins` (default 15) — "these numbers are Nm old — the statusLine may have stopped refreshing, so real usage could be higher" — so the staleness is visible. It deliberately never *suppresses* a wind-down on stale data: overshooting the wall is worse than stopping early. `/usage --json` now also reports `ageSec` + `stale`. Tune with `/usage thresholds … --stale-mins <min>` (minutes 0–1440).
- **Pace projection in the `/usage` report.** Below each window's pace line the report now extrapolates the current burn: `→ projects ~130% by reset, hits 100% in 50m`. Pure derivation from `used%` + elapsed fraction (needs ≥2% of the window elapsed for a stable rate); the ETA only shows when the burn crosses 100% before reset. The statusLine stays lean (pace pp only) — projection is report-only.
- **Release tooling.** `scripts/check-version-sync.js` asserts the version is identical across `package.json`, both manifests, and the top CHANGELOG heading (with an optional `--tag` check at release time); `scripts/bump.js` writes all of them from one command. Added `package.json` (no deps). Releases are cut locally — see the README Releasing section.

## 1.1.0
- **Pace indicator — are you on track to hit the limit?** Next to each window's % the statusLine and `/usage` report now show how far usage is above or below a linear burn for that window: `used% − elapsed%` in percentage points. Within a band (default ±10pp) reads **on track** (`±2%`); above it reads **early** (`early +18%`, trending to hit the limit before reset); below it reads **won't reach** (`won't reach -22%`, won't hit it at this rate). Derived from the window length + `resets_at` already in `rate_limits` — no new data, no extra calls. Shown for both 5-hour and weekly. Set the band with `/usage thresholds … --pace-band <pp>` (percentage points, 0–100; default 10).

## 1.0.0
First stable release. The guard is feature-complete and tested (35 unit tests, cross-platform CI). Highlights since 0.1.0:
- **Injection only winds work down at the wall.** Below wind-down the prompt is never steered; the warn band emits a status-only footer (current usage + reset) and nothing more. Behavior changes solely at wind-down.
- **Separate 5-hour and weekly thresholds** (defaults 5h `75/90`, weekly `85/95`), each window judged against its own pair; most-severe band wins.
- **Display:** `/usage` shows per-window status bars with colored status words and both relative + absolute (`HH:MM`) reset times; the statusLine appends a reset countdown once a window is hot.
- Earlier hardening: validated thresholds, fixed state-dir path, stale-statusLine detection, atomic writes.

## 0.1.6
- **Display polish.** The `/usage` report now shows the **absolute reset clock** next to the relative countdown (`resets in 1h 15m (00:50)`) so you can plan around the wall time, and **colors the status word** (green OK / yellow WARN / red WIND DOWN) with the same palette as the statusLine. The statusLine segment now **appends the reset countdown** for any window that is hot (≥ its warn threshold), e.g. `5h 88% 1h15m`, so urgency is visible without running `/usage`.

## 0.1.5
- **Separate thresholds for the weekly window.** The 5-hour and 7-day windows are now judged against their own warn/wind-down pairs instead of one shared pair. Defaults: 5h `75% / 90%` (unchanged), weekly `85% / 95%`. Each window is evaluated independently and the most severe band drives the hook (ties go to 5-hour, which resets sooner). Set them with `/usage thresholds <warn> <winddown> <weeklyWarn> <weeklyWinddown>` (weekly pair optional; CLI flags `--weekly-warn` / `--weekly-winddown`). State files predating this migrate cleanly — a file with only `warn`/`windDown` gets the weekly defaults, and the statusLine colors + `/usage` report now reflect each window's own thresholds.

## 0.1.4
- **WARN band no longer steers Claude's work; it's now a status-only FYI.** The `UserPromptSubmit` hook used to nudge Claude toward smaller steps / more commits the moment usage crossed the *warn* threshold (75%) — before any real limit pressure. The warn band now injects only a non-behavioral line asking Claude to append a one-line usage footer (`🔋 <window> <pct>% · resets in <t>`) so the user sees current usage and reset time in the reply. Behavior changes only at *wind-down* (90%), unchanged. Below warn: fully silent.
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
