# Design: The Chase Plane (push observer)

Direction 6 from `DESIGN_DIRECTIONS.md`, worked out to buildable detail.

The dashboard is a *pull* surface: oversight happens only when a human
remembers to open it. The Chase Plane inverts that. It is an always-on
observer service that tails the same stores the dashboard reads, turns state
changes into an **event stream**, runs a small set of **detectors** over that
stream, and pushes to where the humans already are (Slack first), with deep
links back into the dashboard. It also exposes the read model as
**conversational tools** so questions like "why did run 14 fail?" get
answered in the channel without anyone opening the SPA.

Design goal, stated as a behavior change: an engineer whose agent runs a
study overnight should wake up to either one quiet summary line or one
loud, specific alarm — never to silence that means "nobody looked."

## Principles

1. **Read-only against the-hangar, same as the dashboard.** The Chase Plane
   never writes to omd/sdk stores. It owns exactly one new store: its own
   small cursor/notification db (`chase.db`), which records what it has seen
   and what it has said — never analysis data.
2. **The read model is the single lens.** Every fact the Chase Plane narrates
   or answers with comes through the existing `Source` adapters
   (`OmdSource`, `SdkSessionSource`, `StudyFsSource` behind `MultiSource`).
   No new query paths into the-hangar; if a detector needs data the read
   model can't provide, that is a read-model feature first.
3. **The interrupt policy is the product.** A noisy observer gets muted and
   then there is no oversight at all. Default behavior is brutally quiet:
   alarms only. Everything chattier is opt-in per study or per channel.
4. **Poll now, tap later.** V1 polls (the dashboard state strip already
   polls ~8s; the Chase Plane polls the same projections at a slower cadence).
   The tailer is a seam: when the event-log substrate (Direction 5) exists,
   it replaces the poller behind the same `StudyEvent` stream with no change
   to detectors or surfaces.

## Architecture

```
                 the-hangar stores (read-only)
        analysis.db   sessions.db + artifacts   studyfs
             │                │                    │
             └──────── MultiSource (existing) ─────┘
                              │
                    ┌─────────▼──────────┐
                    │ Tailer             │  poll list_studies/get_state,
                    │ (snapshot differ)  │  diff vs chase.db cursors
                    └─────────┬──────────┘
                              │  StudyEvent stream
                    ┌─────────▼──────────┐
                    │ Detectors          │  pure functions:
                    │ (alarm catalog)    │  events + read model -> Findings
                    └─────────┬──────────┘
                              │  Finding stream
                    ┌─────────▼──────────┐
                    │ Policy engine      │  severity, dedup, hysteresis,
                    │ (interrupt policy) │  routing, digests, mute/snooze
                    └─────────┬──────────┘
              ┌───────────────┼────────────────┐
        ┌─────▼─────┐   ┌─────▼─────┐    ┌─────▼─────┐
        │ Slack     │   │ Webhook   │    │ CLI tail /│
        │ surface   │   │ surface   │    │ event API │
        └───────────┘   └───────────┘    └───────────┘

        + Observer MCP server: read-model views as tools, so any chat
          agent can answer questions over the same lens.
```

Module layout (new subpackage, mirrors `dashboard/`):

```
src/hangar/range_safety/chase/
├── events.py        # StudyEvent / Finding dataclasses, kinds enum
├── tailer.py        # polling loop, snapshot differ, cursor persistence
├── detectors.py     # the alarm catalog (pure: (events, source) -> findings)
├── policy.py        # severity routing, dedup, digests, mute/snooze
├── store.py         # chase.db: cursors, sent-notification ledger, mutes
├── surfaces/
│   ├── slack.py     # Block Kit messages, per-channel routing
│   └── webhook.py   # generic JSON POST (pager/email bridges hang here)
├── mcp.py           # observer MCP server exposing read-model views
└── cli.py           # `range-safety chase` entrypoints (run, tail, ask)
```

## The event stream

The tailer polls `MultiSource.list_studies()` plus `get_state(study_key)`
for active studies, diffs against the last snapshot in `chase.db`, and emits
`StudyEvent`s:

```python
StudyEvent = {
  "study_key": "omd:cessna-composite-wing",   # {source}:{id}, as everywhere
  "kind": str,        # see below
  "ts": iso8601,      # observation time (store timestamps in payload)
  "payload": dict,    # kind-specific, from read-model dicts
}
```

Event kinds derived purely from snapshot diffs:

| kind | derived from |
|---|---|
| `study_appeared` | new key in `list_studies()` |
| `state_changed` | `get_state().current` changed; payload carries `from`, `to`, `trigger` (`forward`/`replan`/`rerun`/`rescope`, from the transition inference) |
| `run_completed` / `run_failed` | new entry in `list_runs()`; failure from result `validation`/status |
| `assertion_result` | `view_results().checks` changed (convergence / constraint checks) |
| `requirements_changed` | `view_requirements()` hash changed |
| `plan_version_created` | new plan version in `view_plan()` lineage |
| `conclusion_recorded` | `view_report()` gains a conclusion; payload carries the verdict scorecard |
| `study_stalled` | synthetic: no event for a study in a non-terminal state for `stall_after` (clock-driven, emitted by the tailer itself) |

Two-tier polling keeps this cheap at ~1600 studies: the study *list* (with
its cheap per-study state, which `list_studies()` already computes) polls on
`poll_list_s` (default 30s); the expensive per-study view diffs run only for
studies whose cheap state changed or that are in an active state
(`executing`/`verifying`), on `poll_active_s` (default 15s). Everything else
is touched at most once per `poll_idle_s` (default 10 min).

Events are appended to `chase.db` (`events` table) with a monotonic id.
That table is also served at `GET /api/events?since=<id>` when the chase
service runs embedded in the dashboard app, giving the SPA a free "activity
feed" later — but the SPA is not a v1 consumer.

## The alarm catalog (detectors)

Detectors are pure functions over `(new_events, source)` returning
`Finding`s:

```python
Finding = {
  "detector": str, "severity": "info" | "notice" | "alarm",
  "study_key": str, "title": str, "detail": str,
  "dedup_key": str,          # stable across re-observations of the same fact
  "links": [ {label, spa_route} ],   # deep links into the dashboard
}
```

V1 catalog, in priority order:

1. **`conclude_without_verify`** (alarm) — a `conclusion_recorded` event for
   a study whose Verifying stage coverage is `absent`/`thin`
   (StateCoverage) or whose transition history never entered `verifying`.
   This is the single most important alarm in the system: an agent asserting
   an answer it never checked.
2. **`assertion_breach`** (alarm) — an `assertion_result` where a
   convergence or constraint check flipped to failed, or a `run_failed`.
   Payload names the specific check and the margin.
3. **`verdict_violated`** (alarm) — a conclusion whose scorecard contains a
   `violated` primary requirement. Not an error — but a human should hear
   "the study finished and the answer is *no*" as loudly as a failure.
4. **`loop_churn`** (notice) — ≥ N (default 4) `replan`/`rerun` backward
   transitions on the same plan without a new decision entity or a
   requirements change in between: the agent is thrashing, not iterating.
5. **`stalled`** (notice) — `study_stalled` in `executing`/`verifying`
   (default 45 min). Catches dead runs and wedged agents.
6. **`requirements_drift`** (notice) — `requirements_changed` *after* a
   conclusion was recorded (a rescope happened; prior conclusions are
   stale), or requirements edited mid-`executing`.
7. **`concluded`** (info) — clean `conclusion_recorded` with all
   requirements met. One line, the daily bread of the narration feed.
8. **`state_progress`** (info) — forward `state_changed`. Narration only.

Deliberately **not** in v1: physics-envelope checks (Direction 1 owns
in-flight envelopes), cross-fidelity dissent (Direction 2), probabilistic
margins (Direction 4). The catalog is a registry (`DETECTORS: list`), so
those land as new entries without touching the pipeline.

## The policy engine (anti-fatigue is the feature)

Severity maps to delivery:

| severity | default delivery |
|---|---|
| `alarm` | immediate push to the study's channel, @-mention the owner |
| `notice` | batched into a per-channel digest (default: hourly, and only if non-empty) |
| `info` | narration feed only — posted **only** to channels that opted into `narrate` mode; otherwise visible via `range-safety chase tail` and `/api/events` |

Mechanisms, all recorded in `chase.db`:

- **Dedup:** a `Finding.dedup_key` that has already been delivered is
  suppressed until its underlying fact changes (e.g. the failing check flips
  back to pass and fails again). Re-observation is not re-notification.
- **Hysteresis:** `stalled` and `loop_churn` need the condition to hold for
  two consecutive observation windows before firing; a single slow poll
  never pages anyone.
- **Storm collapse:** > K alarms for one study inside one window collapse
  into a single "study X is in trouble (K findings)" message with links.
- **Mute/snooze as first-class:** `mute study <key> [duration]` from Slack or
  CLI writes a mute row; the policy engine honors it and the digest notes
  "2 muted studies had findings" so mutes stay visible rather than silent.
- **Ownership routing:** a finding routes to the channel(s) subscribed to
  that study, falling back to the owner's DM (study `owner` is already
  recorded by the dashboard), falling back to a configured default channel.
  A study visible to nobody generates no outbound traffic — same scoping
  rule as the dashboard's study list.

Config is one YAML file (`chase.yaml`, path via `RS_CHASE_CONFIG`):

```yaml
poll: {list_s: 30, active_s: 15, idle_s: 600}
thresholds: {stall_min: 45, churn_loops: 4, storm_k: 3}
digest: {every_min: 60}
surfaces:
  slack:
    token_env: RS_CHASE_SLACK_TOKEN
    default_channel: "#hangar-analyses"
    channels:
      "#wing-team": {studies: ["omd:cessna-*"], mode: narrate}   # opt-in chatty
      "#hangar-analyses": {studies: ["*"], mode: alarms}          # default quiet
  webhook: {url_env: RS_CHASE_WEBHOOK_URL}
dashboard_base_url: "https://dash.example.com"   # for deep links
```

Every pushed message ends with deep links built from the SPA routes the
frontend already serves (`/study/{key}`, and the state view the finding
concerns), using `dashboard_base_url`.

## The conversational layer (observer MCP)

Rather than building a chatbot, the Chase Plane exposes the read model as a
read-only **MCP server** (`chase/mcp.py`), so whatever agent surface the
team already uses (Claude in Slack, a CLI agent) can answer over the same
lens the dashboard renders:

| tool | wraps |
|---|---|
| `list_studies(filter)` | `MultiSource.list_studies` + cheap state |
| `study_status(study_key)` | `get_state` + StateCoverage + latest findings from `chase.db` |
| `explain_run(run_id)` | `view_results` (final values, checks, opt history summary) |
| `diff_plans(study_key, a, b)` | `view_plan_diff` (element-level diff) |
| `requirements_scorecard(study_key)` | `view_report` scorecard + conclusion narrative |
| `recent_events(study_key, n)` | `chase.db` events table |

All tools return the same plain dicts the `/api/*` routes serve, plus a
`links` list of SPA deep links so answers in chat can hand off to the full
UI. The MCP server reuses the dashboard's auth posture: unauthenticated in
local dev, and behind the same OIDC/token gate in deployment. No write
tools — the "holds the pen" waiver flow is explicitly deferred to the FTS
direction (Direction 1) and would arrive as its own, separately-gated tool.

`range-safety chase ask "<question>"` is a thin local convenience that runs
a single-shot agent over these same MCP tools.

## CLI

```bash
range-safety chase run   [--config chase.yaml]   # the service (tailer+policy+surfaces)
range-safety chase tail  [--study KEY] [--follow] # human-readable event/finding stream
range-safety chase ask   "why did run 14 fail?"   # one-shot Q&A over the observer MCP
range-safety chase mute  <study_key> [--for 2h]
```

`chase run` is deployable standalone (its own container next to the
dashboard, sharing the read-only volume mounts) or embedded in the dashboard
process via a lifespan task (`RS_CHASE_EMBEDDED=1`) for small installs.

## Phasing

- **C1 — spine (no external surface).** `events.py`, `tailer.py`,
  `store.py`, the first three detectors (`conclude_without_verify`,
  `assertion_breach`, `verdict_violated`), and `chase tail`. Exit criterion:
  replaying the demo fixtures (`omd:cessna-composite-wing`, the two sdk
  sessions) through the tailer produces the expected event/finding stream.
- **C2 — Slack + policy.** `policy.py`, `surfaces/slack.py`, digests, mutes,
  the remaining detectors, `chase run` as a service. Exit criterion: a live
  study narrates to an opted-in channel and a forced assertion failure pages
  exactly once.
- **C3 — conversational.** `mcp.py` + `chase ask`. Exit criterion: "what
  changed between plan v3 and v4" answered correctly in-channel for the demo
  study.
- **C4 — the pen (deferred).** Waiver/hold actions from chat. Blocked on
  Direction 1's enforcement seam; designed here only to the extent that no
  v1 decision precludes it (write tools would be separate, separately-gated
  MCP tools writing through normal provenance paths).

## Testing

- **Detector units:** synthetic snapshot pairs → expected events → expected
  findings. Pure functions, no I/O.
- **Tailer replay:** run the existing dashboard fixtures through the tailer
  with a fake clock; assert the event sequence, including `study_stalled`
  hysteresis (advance clock, no state change, expect exactly one finding).
- **Policy:** ledger-driven tests — same finding twice dedups; storm of 5
  collapses; mute suppresses and digest counts it.
- **Surfaces:** Slack client behind an interface; tests assert Block Kit
  payloads, never hit the network.

## Open questions

- **Digest scope:** per-channel or per-owner? Start per-channel (matches
  Slack mental model); revisit if DM routing dominates.
- **Event retention:** `chase.db` events grow unbounded; default a 90-day
  prune, or promote to the Direction-5 event log when that exists.
- **Cross-instance dedup:** two `chase run` instances against the same
  stores would double-notify; v1 says "run one" (a `chase.db` lock),
  clustering is out of scope.
- **`state_changed` fidelity:** transition `trigger` inference is only as
  good as the state machine's; churn detection may need the read model to
  expose transition history with reasons (it computes them today but does
  not surface counts) — likely the one small read-model addition C1 needs.
