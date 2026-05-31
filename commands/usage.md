---
description: Show your OFFICIAL Claude Code usage (5-hour + weekly rate limits, % used and reset time) and drive an auto wind-down hook that tells Claude to commit and stop cleanly before you hit a limit — built for long/unattended loops. Subcommands — setup, on/off, thresholds.
argument-hint: "[setup] | [on|off] | [thresholds <warn> <winddown> [<weeklyWarn> <weeklyWinddown>]]"
disable-model-invocation: true
---

# /usage — official usage readout + loop wind-down guard

You are running the `heavy-usage` usage guard (`/heavy-usage:usage`). It surfaces the **official** Claude Code rate-limit numbers (the same ones `/usage` shows) and lets a long/unattended session **wind down cleanly before hitting a limit** instead of dying mid-task.

## How the data flows (important)
Claude Code exposes the official `rate_limits` block (five_hour / seven_day → `used_percentage` 0–100 + `resets_at`) **only to the statusLine command** — not to hooks or the API. So heavy-usage ships a statusLine script that captures it to `usage-live.json`; the `/usage` report and the wind-down hook read that file.

→ **This only works once the heavy-usage statusLine is wired.** If the report says "No usage data yet", run **`/usage setup`** first.

Scripts (pure Node, run with `node`):
- Reader: `${CLAUDE_PLUGIN_ROOT}/scripts/usage-meter.js`
- Statusline capturer: `${CLAUDE_PLUGIN_ROOT}/scripts/usage-statusline.js`

## Dispatch on `$ARGUMENTS`

| `$ARGUMENTS` | Do |
|---|---|
| *(empty)* | `node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-meter.js"` — print the report verbatim, then one plain-language line |
| `on` / `off` | `node "...usage-meter.js" enable` / `disable` — toggle the auto wind-down hook |
| `thresholds <warn> <winddown> [<weeklyWarn> <weeklyWinddown>]` | `node "...usage-meter.js" thresholds --warn <warn> --winddown <winddown>` and, if the user also gave weekly values, append `--weekly-warn <weeklyWarn> --weekly-winddown <weeklyWinddown>` (fractions; defaults 5h `0.75 0.90`, weekly `0.85 0.95`). The 5-hour and weekly windows are evaluated against their own pairs. |
| `setup` | Wire the statusLine — follow the **Setup** procedure below |

## Setup procedure (`/usage setup`)
Goal: make `~/.claude/settings.json` `statusLine` point at heavy-usage's capturer, **without losing** the user's current statusline.

1. Read `~/.claude/settings.json` (resolve `~` via `$env:USERPROFILE\.claude` on Windows / `$HOME/.claude`). **Back it up** to `~/.claude/backups/heavy-usage/<UTC-timestamp>/settings.json` before any write (heavy-usage always backs up first).
2. Inspect the existing `statusLine`:
   - If it already points at heavy-usage's `usage-statusline.js`, report "already wired" and stop.
   - If another statusLine exists (e.g. the caveman badge script), **preserve it as the chained inner line.** The meter CLI does not write `innerStatusline`, so set it directly: read `~/.claude/heavy-usage/usage-state.json`, merge in `{ "innerStatusline": "<their old command string>" }`, and write it back (create the file/dir if absent; change nothing else).
   - If no statusLine exists, leave `innerStatusline` null.
3. Set `settings.json` `statusLine` to:
   ```json
   { "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/usage-statusline.js\"", "padding": 2 }
   ```
   Resolve `${CLAUDE_PLUGIN_ROOT}` to the actual installed plugin path so the setting is portable (statusLine settings don't expand plugin vars — use the concrete absolute path to `usage-statusline.js`).
4. Show the diff, confirm, write atomically (temp → JSON-parse-check → move).
5. **Offer the CLAUDE.md wind-down primer** (ask Yes/No — default Yes). The `UserPromptSubmit` hook injects `[heavy-usage]` lines, but they are context, not a hard stop; this primer makes Claude treat WIND DOWN as authoritative so loops reliably close out. If accepted:
   - Read global `~/.claude/CLAUDE.md` (resolve `~` as above). **Back it up** to the same `~/.claude/backups/heavy-usage/<UTC-timestamp>/` dir.
   - **Merge, don't clobber.** If a `## Usage wind-down (heavy-usage)` section already exists, leave it (idempotent — report "already present"). Otherwise append the block below. Create `CLAUDE.md` if absent.
   - Block to append verbatim:
     ```markdown
     ## Usage wind-down (heavy-usage)
     Lines prefixed `[heavy-usage]` are authoritative signals from the usage guard.
     Only WIND DOWN is injected (WARN shows in the statusLine only, so it never
     steers work mid-session):
     - WIND DOWN — stop starting new work now. Commit what's done, write a one-line
       resume note, then end the loop. Do not begin new tasks until usage resets.
     ```
   - Show the diff, confirm, write.
6. Tell the user to **restart Claude Code** for the statusLine + hook to take effect, then run `/usage` to confirm numbers appear (remember: they only populate after the first API response, Pro/Max only).

## Auto wind-down (the loop feature)
With the hook on (default) the `UserPromptSubmit` hook checks the worst of your two windows each turn:
- below **warn** (default 75%) → silent,
- **warn** band (75–90%) → status-only FYI: Claude appends a one-line usage footer (`🔋 <window> <pct>% · resets in <t>`) so the user sees current usage/reset; it does **not** change how Claude works,
- at **wind-down** (default 90%) → firm "stop starting new work, commit, summarize state, end the loop".

Because it fires every prompt, each `/loop` iteration sees fresh official numbers and the loop closes out gracefully right before the wall. State (`enabled`, `thresholds`, `innerStatusline`) lives in `~/.claude/heavy-usage/usage-state.json` (a fixed path so the statusLine, hook, and command always agree).

## Honesty note for the user
These are the **official** figures Claude Code reports (not a token estimate). Caveat: `rate_limits` is provided **only to Claude.ai Pro/Max subscribers** and **only after the first API response** in a session — before that, or on API/console billing, `/usage` will show "no data".
