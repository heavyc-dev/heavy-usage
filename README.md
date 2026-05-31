# heavy-usage

**Run Claude Code to the edge of your usage limits without losing work.**

Surfaces your **official** 5-hour and weekly rate-limit numbers (the same ones `/usage` shows — not a token estimate) and, when you near a limit, tells Claude to commit, write a resume note, and stop the loop cleanly — instead of a `/loop` or overnight job dying mid-edit with uncommitted work.

```
heavy-usage — official usage (Claude Code rate_limits)
5-hour   ████████████████░░░░ 78%   WARN     resets in 2h 30m · pace +18% (early)
Weekly   ██████████████████░░ 92%   WIND DOWN resets in 111h 6m · pace ±3% (on track)
Hook ON · warn 75% · wind-down 90% · pace ±10pp
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
| `/usage` | Official 5h + weekly usage — % used, status, reset countdown, pace |
| `/usage setup` | One-time wiring (backs up `settings.json`, chains your existing statusline) |
| `/usage on` · `/usage off` | Toggle the wind-down hook |
| `/usage thresholds <warn> <winddown> [<weeklyWarn> <weeklyWinddown>] [pace <pp>] [stale <min>]` | Tune thresholds (fractions; defaults 5h `0.75 0.90`, weekly `0.85 0.95`), the pace band (`--pace-band <pp>`, default 10), and the stale window (`--stale-mins <min>`, default 15) |

## How it works

A statusLine script captures the official `rate_limits` to `~/.claude/heavy-usage/usage-live.json` (and chains your existing statusline, so you lose nothing). A `UserPromptSubmit` hook reads it each turn. The **5-hour** and **weekly** windows have **separate thresholds** (defaults 5h warn/wind-down `75/90`, weekly `85/95`); each window is judged against its own pair and the most severe band wins (ties → 5-hour, since it resets sooner):

- **below warn** — silent.
- **warn band** — status only: asks Claude to append a one-line usage footer (`🔋 5-hour 78% · resets in 2h30m`) so you see it in the reply. Does **not** change how Claude works.
- **at wind-down** — authoritative `[heavy-usage] WIND DOWN`: stop new work, commit, write a resume note, end the loop.

Fires every turn, so each `/loop` iteration sees fresh numbers and closes out right before the wall.

**Pace.** Next to each %, the status bar and report show how your burn compares to a linear pace for that window (`used% − elapsed%`, derived from the window length + `resets_at`). Within the band (default ±10pp) → **on track** (`±2%`); above → **early** (`early +18%`, you'll hit the limit before reset); below → **won't reach** (`won't reach -22%`). Set the band with `/usage thresholds … pace <pp>`. The `/usage` report also **projects** where this burn lands by reset and the ETA to 100% (`→ projects ~130% by reset, hits 100% in 50m`).

**Stale-data guard.** The statusLine refreshes the captured numbers only when the UI renders; in a headless/unattended run it can stop while the session keeps prompting. If the capture is older than the stale window (default 15m), the wind-down hook **annotates** its message so Claude and you know real usage may be higher — it never *suppresses* a wind-down on stale data (overshooting the wall is worse than stopping early). Tune with `/usage thresholds … stale <min>`.

## Uninstall

`/usage setup` backs up edited files to `~/.claude/backups/heavy-usage/<timestamp>/`. To revert: restore those backups (or remove the `statusLine` entry and the `## Usage wind-down (heavy-usage)` block from your global `CLAUDE.md`), delete `~/.claude/heavy-usage/`, then `claude plugin uninstall heavy-usage@heavy-usage`.

## Development

```sh
node tests/run.js                # unit tests, no framework — needs Node (no npm deps)
node scripts/check-version-sync.js   # assert version matches across all manifests + CHANGELOG
```

CI runs both on every push/PR (Ubuntu/Windows/macOS) plus `claude plugin validate`.

### Releasing

Version lives in `package.json`, `plugin.json`, `marketplace.json`, and the top `CHANGELOG.md` heading — kept in sync by one command:

```sh
node scripts/bump.js 1.2.0       # writes all four (CHANGELOG gets a stub to edit)
git commit -am "release: v1.2.0"
git tag v1.2.0 && git push && git push --tags
```

The tag push triggers `.github/workflows/release.yml`, which re-checks the tag matches the manifests, runs the tests, and publishes the GitHub release with auto-generated notes.

MIT
