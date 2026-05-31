# heavy-usage

**Run Claude Code loops to the edge of your usage limits without losing work.**

`heavy-usage` surfaces your **official** 5-hour and weekly rate-limit numbers and runs an auto **wind-down** hook: when you're near a limit, it tells Claude to commit what's done, write a resume note, and stop the loop cleanly — instead of an unattended `/loop` dying mid-edit with half-finished, uncommitted work.

These are the **real** figures Claude Code shows in `/usage` — not a token estimate.

```
heavy-usage — official usage (Claude Code rate_limits)
──────────────────────────────────────────
5-hour   ████████████████░░░░ 78%   WARN
         resets in 2h 30m
Weekly   ██████████████████░░ 92%   WIND DOWN
         resets in 111h 6m
──────────────────────────────────────────
Hook ON · warn 75% · wind-down 90% · updated just now
```

## Why

Claude Code enforces a 5-hour rolling window and a 7-day weekly window. If you run long or unattended loops (`/loop`, overnight agents, "burn my weekly quota productively"), hitting the wall mid-task is destructive — work is lost, uncommitted, and the window may be hours from resetting.

There is **no usage API** ([claude-code#44328](https://github.com/anthropics/claude-code/issues/44328)). The only place the live numbers appear is the **status bar** ([#23975](https://github.com/anthropics/claude-code/issues/23975)). `heavy-usage` is the bridge: it captures those official numbers and turns them into a behavior change — Claude winds down *before* the wall.

## How it works

```
statusLine render → usage-statusline.js → usage-live.json (official 5h/weekly %)
        ├─ /usage             → live %, status bars, reset countdown
        └─ UserPromptSubmit   → 75% warn · 90% WIND DOWN (commit, summarize, stop)
              hook reads usage-live.json every turn
```

Claude Code passes the official `rate_limits` block (`five_hour` / `seven_day`, each `used_percentage` 0–100 + `resets_at`) **only to the statusLine command**. So `heavy-usage` ships a statusLine script that captures it to `usage-live.json` and **chains your existing statusline** (e.g. a caveman badge) so you lose nothing. A `UserPromptSubmit` hook reads that file every turn and injects an authoritative `[heavy-usage]` instruction when you cross a threshold.

## Install

```sh
claude plugin marketplace add heavyc-dev/heavy-usage
claude plugin install heavy-usage@heavy-usage
# restart Claude Code, then:
/usage setup
# restart once more
```

Two restarts is expected: the first loads the plugin's hooks, and the second activates the statusLine that `/usage setup` just wired (the statusLine is read from `settings.json` at startup).

## Commands

| Command | Does |
|---------|------|
| `/usage` | Official 5h + weekly usage — % used, status, reset countdown |
| `/usage setup` | One-time wiring: sets the statusLine (backs up `settings.json`, chains your current one) and offers to add a wind-down primer to your global `CLAUDE.md` |
| `/usage on` · `/usage off` | Toggle the auto wind-down hook |
| `/usage thresholds <warn> <winddown>` | Tune thresholds (fractions; defaults `0.75 0.90`) |

## The wind-down

While the hook is on (default), each turn it checks the worst of your two windows:

| Usage | Behavior |
|-------|----------|
| below **90%** (incl. the warn band) | silent in the prompt — WARN shows in the statusLine/`/usage` only, so usage pressure never steers work mid-session |
| **90%** (wind-down) | "stop starting new work, commit, write a resume note, end the loop" |

Because it fires on every prompt, each `/loop` iteration sees fresh official numbers, and the loop closes out gracefully right before the wall. The optional `CLAUDE.md` primer (added in `/usage setup`) makes Claude treat the `[heavy-usage] WIND DOWN` line as an authoritative stop rather than an FYI.

No special `/loop` or prompt syntax is required — it works in any session. Until you run `/usage setup`, a brief SessionStart reminder shows that tracking is inactive; it goes silent once wired.

## Honest limitations

- **Pro/Max only.** `rate_limits` is provided only to Claude.ai Pro/Max subscribers, and only **after the first API response** in a session. On API/console billing, or before the first response, `/usage` shows "no data". This is a Claude Code constraint — the data simply isn't exposed otherwise.
- **~1-turn lag.** The hook reads the value captured by the last status-bar render — effectively "as of the previous turn". Negligible for wind-down (usage rises gradually). Idle sessions hold the last-known value (the report shows "updated Xm ago").
- These are Anthropic's own figures (accurate), surfaced — not computed or estimated by this plugin.

## State

Lives in `~/.claude/heavy-usage/` (a fixed path so the statusLine capturer, hook, and command always read/write the same place), survives `/clear` and new sessions:

- `usage-live.json` — last captured official numbers
- `usage-state.json` — `enabled`, `thresholds`, `innerStatusline` (your chained statusline)

## Uninstall / revert

`/usage setup` edits two global files and **backs each up first** to `~/.claude/backups/heavy-usage/<UTC-timestamp>/`. To undo it:

1. **statusLine** — restore `~/.claude/settings.json` from the backup, or just remove (or repoint) its `statusLine` entry. To bring back your previous statusline, copy it from `innerStatusline` in `~/.claude/heavy-usage/usage-state.json`.
2. **CLAUDE.md primer** — delete the `## Usage wind-down (heavy-usage)` block from `~/.claude/CLAUDE.md` (or restore that file from the backup).
3. **State** — delete `~/.claude/heavy-usage/` to drop the captured numbers and settings.

Then `claude plugin uninstall heavy-usage@heavy-usage`. (If the plugin is updated and the statusLine ever stops working, the SessionStart check will tell you to re-run `/usage setup`.)

## Requirements

Node.js (used by Claude Code's own hooks already). No npm dependencies.

## Development

```sh
node tests/run.js   # unit tests, no framework
```

## License

MIT
