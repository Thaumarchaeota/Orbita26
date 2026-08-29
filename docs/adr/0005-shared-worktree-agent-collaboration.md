# Shared-worktree agent collaboration

- Status: Accepted
- Date: 2026-08-24

## Context

Orbita is edited from multiple Cursor/Codex sessions on one Windows host. Parallel
test commands recently created repeated Vitest/Tinypool worker trees and made the
host unusable. The project needs an explicit, risk-proportionate collaboration
model that preserves fast direct UI work while requiring independent review for
stateful and operational changes.

## Decision

Use risk tiers rather than requiring a fixed number of agents for every task:

- L0: a user-specified visual-only change with no interaction, state, performance,
  window, data, or lifecycle effect may be implemented directly by the coordinator.
- L1: a local behaviour change requires an implementation role and an independent
  review/test role.
- L2: cross-module state, interaction, performance, or lifecycle work requires
  separate implementation, testing, and acceptance roles, coordinated by one owner.
- L3: data writes, concurrency, process/window lifecycle, migration, authentication,
  or other safety-critical work adds an independent architecture/safety review before
  dynamic verification.

Dynamic commands remain owned by one coordinator; agent roles and file ownership
must be made explicit before implementation.

The main agent is the coordinator. Any agent that discovers an L0/L1 task affects
state, interaction semantics, performance, data, a window, or process lifecycle
must stop that scope and report the trigger. The main agent decides whether to
promote the tier and revise ownership. A promotion that changes product semantics
or needs new authority remains a user decision.

An implementation agent may add or update regression tests directly adjacent to
its assigned change. A separate test agent independently reviews that coverage and
may add boundary or counterexample tests in a non-overlapping test-file scope, but
may not alter implementation files. The coordinator assigns ownership before edits
so two agents never write the same test file concurrently.

An acceptance agent's evidence-backed P0 or P1 finding blocks completion. The
main agent must either fix it, demonstrate with concrete evidence that it is not a
defect, or escalate it to the user when resolving it would change product semantics
or require new authority. An acceptance finding is not a substitute for the main
agent's final evidence synthesis, but it cannot be silently ignored.

Tiering uses explicit minimum triggers; the main agent may always promote work for
additional risk:

- L0 is limited to a user-specified visual value change. Any event handling, ARIA,
  keyboard behavior, popover/dialog behavior, state, or motion makes it at least L1.
- Cross-module state, asynchronous scheduling, rAF/idle work, filtering, scrolling,
  performance-sensitive rendering, window behavior, or service calls make it at
  least L2.
- Data writes, concurrent mutation, process lifecycle, migration, authentication,
  credentials, or user data make it L3.

The minimum independent subagent composition is:

- L1: implementation plus test/review (two independent agents).
- L2: implementation, test, and acceptance (three independent agents).
- L3: the L2 roles plus independent architecture/safety review (four independent
  agents).

The main agent coordinates and synthesizes evidence but does not count as an
independent implementation, test, acceptance, or safety role.

Only the main agent may run dynamic commands (tests, development servers, browser
automation, sidecars, or other process-spawning tools). Before doing so it must
state the command, purpose, expected duration, maximum concurrency, and stop
condition; afterwards it must verify that owned child processes have exited. This
rule is retained even when a test-run lock exists, because locks do not cover all
resource-heavy tools.

Before delegation, the main agent records allowed write scope, forbidden scope, and
read-only references. Window, process, data-write, concurrency, and shared-UI
primitive changes require independent review before implementation delegation.
Every non-L0 task declares the required verification matrix (unit, targeted
integration, real `dev.bat`, and/or manual Tauri acceptance) before editing; missing
evidence remains explicitly unverified. Unattributed worktree changes stop writes
until their overlap and ownership are reported. During a resource or process
incident, the main agent broadcasts the root process evidence and whether further
dynamic work is permitted; other sessions stay idle until that state is cleared.

## Consequences

- Small, clearly requested UI adjustments stay fast and do not require artificial
  agent fan-out.
- High-risk changes get independent evidence instead of a single implementation
  narrative.
- The tier boundary must be defined precisely enough that a seemingly visual change
  with state or lifecycle consequences cannot be misclassified as L0.

## Alternatives considered

- Require three agents for every task: consistent coverage but disproportionate
  overhead and more shared-worktree contention.
- Use multiple agents only when the user explicitly asks: fastest path but weak
  protection for concurrency, lifecycle, and data risks.

## Open questions

None. Future refinements should be proposed in a successor ADR rather than silently
weakening these shared-host safeguards.
- How should independent acceptance work when the implementation is a small but
  stateful UI primitive?
