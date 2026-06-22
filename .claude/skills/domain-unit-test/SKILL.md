---
name: domain-unit-test
description: Write a DB-free unit test for a src/lib domain function using the project's Deps-injection pattern — node:test + tsx, a fakes() factory that captures collaborator calls, asserting on both the return value and what was threaded into the injected deps. Use when adding/changing a domain helper in src/lib that takes an injectable Deps argument. Distinct from e2e-spec-writer (Playwright).
allowed-tools: Read, Grep, Glob, Edit, Write, Bash
---

# Domain unit test (DB-free)

Covers the **unit** layer — pure-ish `src/lib/**` domain logic with its DB/IO collaborators
faked. (Playwright end-to-end flows are the `e2e-spec-writer` agent's job; this is not that.)

The whole point: the domain fn accepts an injectable `Deps` object defaulting to real impls,
so a test passes fakes and runs with **zero DB**. Reference:
`src/lib/workflow/applyTransition.ts` + `src/lib/workflow/applyTransition.test.ts`.

## Runner & conventions

- Node's built-in runner via tsx: `npx tsx --test <file>`. Tests are **co-located**
  `*.test.ts` next to the module.
- `import test from 'node:test';` and `import assert from 'node:assert/strict';`.
- Each test domain has a named npm script (`test:workflow`, `test:auth`, …) — add the new
  file to the relevant one (or create `test:<area>: tsx --test <files>`).

## Step 1 — confirm the fn is injectable

The target should look like:
```ts
export interface FooDeps { save: (...)=>Promise<...>; emit: (...)=>Promise<void>; }
const defaultDeps: FooDeps = { save: realSave, emit: realEmit };
export async function foo(args: FooArgs, deps: FooDeps = defaultDeps): Promise<FooResult> { … }
```
If the fn reaches for `pool`/`fetch`/clients directly instead of through `deps`, it isn't
unit-testable yet — **refactor the IO behind a `Deps` field first** (default = the real
impl, so callers are unchanged), then test. Don't mock the `pg` pool; inject a fake.

## Step 2 — build a capturing `fakes()` factory

Mirror the reference: a `Captured` struct of arrays, a `fakes(...)` that returns
`{ deps, cap }` where each dep pushes its input into `cap` and returns a canned result.

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { foo, type FooDeps } from './foo';

interface Captured { saved: SaveInput[]; emitted: EmitArgs[]; }

function fakes(saveResult = { id: 1 }) {
  const cap: Captured = { saved: [], emitted: [] };
  const deps: FooDeps = {
    save: async (input) => { cap.saved.push(input); return saveResult; },
    emit: async (args)  => { cap.emitted.push(args); },
  };
  return { deps, cap };
}
```

## Step 3 — assert BOTH sides

A good unit test checks the **return value** *and* **what was threaded into the deps**
(that's where the real logic lives — org scoping, idempotency flags, field mapping):

```ts
test('foo: happy path saves then emits', async () => {
  const { deps, cap } = fakes();
  const out = await foo(baseArgs, deps);

  assert.deepEqual(out, { ok: true, status: 200, id: 1 });
  assert.equal(cap.saved.length, 1);
  assert.equal(cap.saved[0].orgId, ORG);          // org came from args, not a default
  assert.equal(cap.emitted.length, 1);            // side-effect fired exactly once
});
```

Cover the branches that matter for this repo's invariants:
- **idempotency** — a re-entered/duplicate call is a no-op (`idempotent: true`, no second emit).
- **org scoping** — `orgId` is threaded through, never defaulted/dropped.
- **error/conflict mapping** — a failing collaborator maps to the right `status` (404/409),
  and **side-effects do NOT fire** on the failure path.
- **field mapping** — inputs land on the right collaborator fields (the reference asserts
  each `transitionInputs[0].*`).

## Step 4 — wire & run

```bash
npx tsx --test src/lib/<area>/<module>.test.ts     # run just this file
```
Add the file to the matching `test:<area>` script in `package.json` (append to its file
list, or add a new script). Report pass/fail with the runner output. Don't commit.

## Rules

- Inject fakes; **never touch a real DB/pool/network** in a unit test. If you can't avoid
  it, the fn needs a `Deps` seam first.
- Assert the threaded collaborator inputs, not just the return value — the invariants
  (org scope, idempotency, audit/side-effect firing) live in what gets passed onward.
- Co-locate `*.test.ts`; use `node:test` + `assert/strict`; run with `tsx --test`.
- Keep fakes minimal and call-capturing; don't rebuild the real collaborator's logic.
