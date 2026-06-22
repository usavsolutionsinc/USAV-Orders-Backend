---

## description: Run a Cycle Forge / USAV WMS roadmap task — a specific ID if given, otherwise auto-select and run the next eligible task. Completed work stops at `review` for human approval. argument-hint: "[task-id] (optional — omit to auto-pick the next todo)" allowed-tools: Read, Edit, Grep, Glob, Bash

Task lifecycle: `todo → in-progress → review → done`. A human promotes `review → done`; you never set `done` yourself. A failed review is sent back to `todo`; a task needing human action is set to `blocked`.

## 1. Load roadmap state

!`grep -nE '^### |Status:|Depends on:' docs/CYCLE-FORGE-ROADMAP.md`

## 2. Select the task

- If `$ARGUMENTS` contains a task ID, that is the task — skip to step 3.
- Otherwise, choose the FIRST task in file order (P0 before P1 before P2 before P3) where BOTH are true:
  - its Status is `todo`, AND
  - every entry under "Depends on" is either `none` or a task whose Status is already `done`.
  - Note: a dependency sitting at `review`, `in-progress`, or `blocked` does NOT count as satisfied — deps must be `done`.
- If no task qualifies, output exactly `NOTHING_LEFT` and stop. Do nothing else.
- Announce the selected task ID, then set its Status to `in-progress` in `docs/CYCLE-FORGE-ROADMAP.md`.

## 3. Discovery — before writing any code

1. Phase 0 — scan the relevant areas of the codebase and report what already exists. Do NOT generate code yet.
2. Re-confirm every dependency is `done`. If any is not, revert this task's Status to `todo`, report the blocker, and stop.
3. Restate the Objective and Acceptance criteria from the roadmap that you are building to.

## 4. Implement

- Keep all operations fully reversible.
- Respect the system-of-record boundary: Supabase owns unit-level truth; Zoho owns SKU-level quantity/financials. Never write one system's data into the other.
- Never regenerate or mutate an existing unit serial (`{SKU}-{WWYY}-{SER6}`).
- Reuse the design tokens and primitives established in `P0-DS-01`.

## 5. Hand off for review

- Verify each Acceptance bullet explicitly and state the result of each.
- Set this task's Status to `review` in `docs/CYCLE-FORGE-ROADMAP.md`. Do NOT set it to `done` — a human approves that promotion.
- Output exactly one summary line: `<task-id> → review — <what changed and what to check>`.

