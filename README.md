# heavy-usage

**Run Claude Code to the edge of your usage limits without losing work.**

Surfaces your **official** 5-hour and weekly rate-limit numbers (the same ones `/usage` shows — not a token estimate) and, when you near a limit, tells Claude to commit, write a resume note, and stop the loop cleanly — instead of a `/loop` or overnight job dying mid-edit with uncommitted work.

```
heavy-usage — official usage (Claude Code rate_limits)
5-hour   ████████████████░░░░ 78%   WARN     resets in 2h 30m
Weekly   ██████████████████░░ 92%   WIND DOWN resets in 111h 6m
Hook ON · warn 75% · wind-down 90%
```

## Use it if you want to

- Run long or overnight `/loop` / agent jobs that **stop safely** before the wall.
- **Burn your weekly quota productively** near a reset without losing work to a mid-task cutoff.

## Install

```sh
claude plugin marketplace add heavyc-dev/heavy-usage
claude plugin install heavy-usage@heavy-usage
# restart Claude Code
/usage setup
# restart once more
```

Two restarts: first loads the hooks, second activates the statusLine `/usage setup` wired. Pro/Max only — Claude Code exposes the live numbers only to the status bar, and only after the first API response.

## Commands

| Command | Does |
|---------|------|
| `/usage` | Official 5h + weekly usage — % used, status, reset countdown |
| `/usage setup` | One-time wiring (backs up `settings.json`, chains your existing statusline) |
| `/usage on` · `/usage off` | Toggle the wind-down hook |
| `/usage thresholds <warn> <winddown>` | Tune thresholds (fractions; defaults `0.75 0.90`) |

## How it works

A statusLine script captures the official `rate_limits` to `~/.claude/heavy-usage/usage-live.json` (and chains your existing statusline, so you lose nothing). A `UserPromptSubmit` hook reads it each turn:

- **below wind-down** — silent in the prompt; WARN still shows in the statusLine / `/usage`, so usage pressure never steers work mid-session.
- **at wind-down (90%)** — injects an authoritative `[heavy-usage] WIND DOWN` line: stop new work, commit, write a resume note, end the loop.

Fires every turn, so each `/loop` iteration sees fresh numbers and closes out right before the wall.

## Uninstall

`/usage setup` backs up edited files to `~/.claude/backups/heavy-usage/<timestamp>/`. To revert: restore those backups (or remove the `statusLine` entry and the `## Usage wind-down (heavy-usage)` block from your global `CLAUDE.md`), delete `~/.claude/heavy-usage/`, then `claude plugin uninstall heavy-usage@heavy-usage`.

## Development

```sh
node tests/run.js   # unit tests, no framework — needs Node (no npm deps)
```

MIT
