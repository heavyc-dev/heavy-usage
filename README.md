# heavy-usage

**Run Claude Code loops to the edge of your usage limits without losing work.**

`heavy-usage` surfaces your **official** 5-hour and weekly rate-limit numbers and runs an auto **wind-down** hook: when you're near a limit, it tells Claude to commit what's done, write a resume note, and stop the loop cleanly — instead of an unattended `/loop` dying mid-edit with half-finished, uncommitted work.

These are the **real** figures Claude Code shows in `/usage` — not a token estimate.

```
heavy-usage — official usage (Claude Code rate_limits)
──────────────────────────────────────────
5-hour   ██████████████░░░░░░ 72%   WARN
         resets in 2h 30m
Weekly   ██████████████████░░ 88%   WIND DOWN
         resets in 111h 6m
──────────────────────────────────────────
Hook ON · warn 70% · wind-down 85% · updated just now
```

## Why

Claude Code enforces a 5-hour rolling window and a 7-day weekly window. If you run long or unattended loops (`/loop`, overnight agents, "burn my weekly quota productively"), hitting the wall mid-task is destructive — work is lost, uncommitted, and the window may be hours from resetting.

There is **no usage API** ([claude-code#44328](https://github.com/anthropics/claude-code/issues/44328)). The only place the live numbers appear is the **status bar** ([#23975](https://github.com/anthropics/claude-code/issues/23975)). `heavy-usage` is the bridge: it captures those official numbers and turns them into a behavior change — Claude winds down *before* the wall.

## How it works

```
statusLine render → usage-statusline.js → usage-live.json (official 5h/weekly %)
        ├─ /usage             → live %, status bars, reset countdown
        └─ UserPromptSubmit   → 70% warn · 85% WIND DOWN (commit, summarize, stop)
              hook reads usage-live.json every turn
```

Claude Code passes the official `rate_limits` block (`five_hour` / `seven_day`, each `used_percentage` 0–100 + `resets_at`) **only to the statusLine command**. So `heavy-usage` ships a statusLine script that captures it to `usage-live.json` and **chains your existing statusline** (e.g. a caveman badge) so you lose nothing. A `UserPromptSubmit` hook reads that file every turn and injects an authoritative `[heavy-usage]` instruction when you cross a threshold.

## Install

```sh
claude plugin marketplace add "C:\heavy-usage"
claude plugin install heavy-usage@heavy-usage
# restart Claude Code, then:
/usage setup
# restart once more
```

## Commands

| Command | Does |
|---------|------|
| `/usage` | Official 5h + weekly usage — % used, status, reset countdown |
| `/usage setup` | One-time wiring: sets the statusLine (backs up `settings.json`, chains your current one) and offers to add a wind-down primer to your global `CLAUDE.md` |
| `/usage on` · `/usage off` | Toggle the auto wind-down hook |
| `/usage thresholds <warn> <winddown>` | Tune thresholds (fractions; defaults `0.70 0.85`) |

## The wind-down

While the hook is on (default), each turn it checks the worst of your two windows:

| Usage | Behavior |
|-------|----------|
| below **70%** (warn) | silent — normal sessions are never spammed |
| **70%** | "prefer small steps, commit often" |
| **85%** (wind-down) | "stop starting new work, commit, write a resume note, end the loop" |

Because it fires on every prompt, each `/loop` iteration sees fresh official numbers, and the loop closes out gracefully right before the wall. The optional `CLAUDE.md` primer (added in `/usage setup`) makes Claude treat the `[heavy-usage] WIND DOWN` line as an authoritative stop rather than an FYI.

No special `/loop` or prompt syntax is required — it works in any session.

## Honest limitations

- **Pro/Max only.** `rate_limits` is provided only to Claude.ai Pro/Max subscribers, and only **after the first API response** in a session. On API/console billing, or before the first response, `/usage` shows "no data". This is a Claude Code constraint — the data simply isn't exposed otherwise.
- **~1-turn lag.** The hook reads the value captured by the last status-bar render — effectively "as of the previous turn". Negligible for wind-down (usage rises gradually). Idle sessions hold the last-known value (the report shows "updated Xm ago").
- These are Anthropic's own figures (accurate), surfaced — not computed or estimated by this plugin.

## State

Lives in `${CLAUDE_PLUGIN_DATA}` (fallback `~/.claude/heavy-usage/`), survives `/clear` and new sessions:

- `usage-live.json` — last captured official numbers
- `usage-state.json` — `enabled`, `thresholds`, `innerStatusline` (your chained statusline)

## Requirements

Node.js (used by Claude Code's own hooks already). No npm dependencies.

## Development

```sh
node tests/run.js   # unit tests, no framework
```

## License

MIT
