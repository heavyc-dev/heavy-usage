---
name: sweep
description: >
  Run a usage-budgeted, resumable sweep of the codebase that grinds until your
  heavy-usage wind-down threshold, then commits findings and (optionally) resumes
  after reset. Modes: bugs | review | features | roadmap. Fans out subagents while
  usage headroom is wide, collapses to a single serial pass as it narrows. Pairs
  with /loop for true run-until-the-limit behavior.
  Trigger: /sweep <mode>, "sweep the codebase", "run until my limits", "burn-down review".
user-invocable: true
---

# /sweep — usage-budgeted, resumable codebase sweep

You are running the heavy-usage **sweep** skill. It performs a repeated review/discovery
pass over the repo, scaling how hard it works to the remaining usage headroom, and stops
cleanly at the wind-down wall with findings committed and a resume note written.

**Canonical use:** `/loop /sweep <mode>` — `/loop` keeps re-invoking; this skill does each
iteration; the heavy-usage wind-down hook ends the loop at the wall. Run `/sweep <mode>` on
its own for a single budgeted pass. Append `auto` (`/sweep <mode> auto`) to skip the scope
interview and run fully non-interactively (used by `/loop` resumes and scheduled runs).

`$ARGUMENTS` = `<mode> [auto]`. Valid modes: `bugs`, `review`, `features`, `roadmap`.
If no mode given, ask which one (single AskUserQuestion), then proceed.

All bookkeeping goes through the engine — call it, don't reimplement it:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/sweep-state.js" <cmd>` (run from the repo root).
Usage data comes from `node "${CLAUDE_PLUGIN_ROOT}/scripts/usage-meter.js" --json`.

## Modes

| mode | each pass finds | deliverable doc | uses scouts | verify |
|---|---|---|---|---|
| `bugs` | correctness / security defects | `heavy-usage-sweep/FINDINGS.md` | yes | yes — adversarial (`sweep-verifier`) |
| `review` | reuse / simplify / efficiency / altitude cleanups | `heavy-usage-sweep/REVIEW.md` | yes | light self-check |
| `features` | enhancement / capability ideas | `heavy-usage-sweep/FEATURES.md` | yes | no |
| `roadmap` | phased plan synthesized from the repo + `FEATURES.md` | `heavy-usage-sweep/ROADMAP.md` | no (single-agent synthesis) | no |

*Adding a mode = a new row here + a doc name in `sweep-state.js` `DOCS`.*

## Procedure (one pass)

### 1. Preflight
Run `usage-meter.js --json`. Parse `five_hour`/`seven_day`, `thresholds`, `stale`, `enabled`.
- If `enabled` is false or both windows are null/no-data: tell the user usage isn't wired
  (`/usage setup`) and offer to run **unbudgeted** with a hard cap of 3 passes. Otherwise
  the budget tiering below has no signal.
- On first run in this repo, also run `sweep-state.js gitignore` (idempotent — keeps the
  target repo clean by ignoring `.heavy-usage-sweep/`).

### 2. Scope — ask ONCE, persist, never re-prompt
Run `sweep-state.js config-has <mode>`.
- If `has:false` **and** this invocation is interactive (no `auto` arg): ask the
  mode-specific scope questions with **one** AskUserQuestion call (≤4 questions), then save:
  pipe the answers as JSON to `sweep-state.js config-set <mode>`. Question sets:
  - `bugs` — focus paths/globs? exclude (tests / vendored / generated)? severity floor
    (all / medium+ / high+)? security-only (yes/no)?
  - `review` — dimensions (reuse / simplify / perf / altitude — multi)? focus paths?
  - `features` — product area / subsystem to weight? hard constraints (e.g. no new deps)?
  - `roadmap` — horizon (next / quarter / long)? themes to weight?
- If `has:true`, or `auto` was passed, or you are a scheduled/headless resume: **do not
  prompt.** Load the saved scope with `sweep-state.js config-get <mode>` (may be empty →
  use sensible defaults). This is what makes unattended `/loop` and post-reset resumes work.

Store focus/exclude globs into the saved config so the index honors them.

### 3. Index (first pass only)
If `sweep-state.js next <mode> 1` reports no index yet, build it: pipe the saved config to
`sweep-state.js index-build`. It lists tracked files (respects `.gitignore`), applies
focus/exclude, and drops the sweep's own dirs.

### 4. Decide the tier (budget → fan-out)
Pipe the `usage-meter.js --json` output into `sweep-state.js tier`. It returns
`{ fanout, headroom, reason, atWindDown }`:
- `fanout >= 1` → request the next `fanout` disjoint slices (`sweep-state.js next <mode> <k>`
  per scout) and spawn that many **`sweep-scout`** agents in parallel, each with its slice +
  the mode lens + the saved scope.
- `fanout == 0` → do a single **inline** pass yourself over the next one slice
  (`sweep-state.js next <mode> 1`). No subagents — you're near the wall (or data is stale).
- `roadmap` mode ignores fanout: always a single-agent synthesis over `FEATURES.md` + a
  re-read of key files.
Tell the user the tier and `reason` in one line.

### 5. Run the pass
Collect candidate items from the scouts (or your inline read) as objects:
`{ file, line, claim, severity, why }`.
- `bugs`: for each candidate, spawn a **`sweep-verifier`** (adversarial — refute by default);
  keep only `real:true` survivors.
- `review` / `features`: light self-check for obvious false positives.
- `roadmap`: emit phased items (`{ claim, why }` with phase in `claim`).

### 6. Persist
Pipe the surviving items (JSON array) to `sweep-state.js record <mode> <stamp>` (use a short
human stamp like the current time if you have it; the engine dedupes by file+line+claim and
appends to the deliverable doc).

### 7. Continue or stop
Re-read `usage-meter.js --json` (it may have moved a lot if you fanned out; if `stale:true`,
**assume usage is higher than reported** and treat as closer to the wall).
- **Below wind-down** (and no `[heavy-usage] WIND DOWN` line was injected this turn): the pass
  is done. If you were invoked under `/loop`, just end — `/loop` re-invokes you. If invoked
  standalone and the user asked to keep going, you MAY `ScheduleWakeup` with `/sweep <mode>
  auto`; otherwise report progress and stop.
- **At/over wind-down** (`atWindDown:true`, or the hook injected `[heavy-usage] WIND DOWN`):
  finish the current step, then:
  1. `git add heavy-usage-sweep/ && git commit` the deliverable docs (on-brand: commit what's
     done). Do **not** commit `.heavy-usage-sweep/` (it's gitignored).
  2. Write the resume note: pipe `{ "note": "...", "counts": "<n> in <mode>" }` to
     `sweep-state.js resume <mode>`.
  3. If the user opted into post-reset continuation, schedule a one-shot resume (CronCreate /
     the schedule skill) for ~2 minutes after the sooner window's `resets_at`, command
     `/sweep <mode> auto`.
  4. End **without** rescheduling a near-term wakeup. Do not start new work.

## Notes
- Scouts and the verifier are **read-only**. Only the main thread records/commits.
- Never read `rate_limits` directly — it's statusLine-only; always go through `usage-meter.js`.
- Keep the user informed each pass with one tight status line: mode, tier + reason, added/total.
