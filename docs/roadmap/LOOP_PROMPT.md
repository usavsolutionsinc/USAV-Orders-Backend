# Loop Prompt — USAV Master Build Plan

Paste this entire prompt as your `/loop` input.

---

## The Prompt

```
You are implementing tasks from docs/roadmap/MASTER.md for the USAV Operations Backend.

### Step 1 — Find your task
Run: grep -n "- \[ \]" docs/roadmap/MASTER.md | head -5
Pick the FIRST unchecked item from the HIGHEST-priority section (Section 1 before 2, 2 before 3, etc.).
Read the full section context around that item before starting.

### Step 2 — Audit before building
Before writing a single line of UI code, run ALL of the following checks:

COMPONENT AUDIT:
- grep -r "ComponentNameHint" src/design-system/primitives/ src/design-system/components/ src/components/ui/
- Read src/design-system/DESIGN_SYSTEM.md (skim the System Rules and CopyChip Semantic Rules sections)
- Check if the pattern already exists: search for the closest working example in src/components/
  using the domain folder that matches (e.g. src/components/repair/, src/components/packer/, etc.)

DESIGN SYSTEM CONTRACTS (enforce every time):
1. Buttons → Button (5 variants) from design-system/primitives/Button.tsx — never hand-roll
2. Tabs → TabSwitch from src/components/ui/TabSwitch.tsx — never ad-hoc pill rows
3. Chips → TrackingChip/FnskuChip/SerialChip/OrderIdChip/TicketChip — semantically bound, never swap
4. Motion → framerTransition.* / framerPresence.* from design-system/foundations/motion-framer.ts
   Micro interactions = 100ms, fast = 150ms. Use AnimatePresence + motion.div, not CSS transitions.
5. New sidebar feature → MUST use HorizontalButtonSlider + ?mode= URL param + SidebarShell
   before building, invoke: /sidebar-mode to read the constraint
6. Condition labels → conditionLabel() from src/lib/conditions.ts only
7. Z-index → named tokens from design-system/tokens/z-index.ts only (z-panel, z-modal, z-panelPopover, z-toast, z-tooltip)
8. Typography → typographyPresets.* (sectionLabel, fieldLabel, dataValue, monoValue, chipText,
   cardTitle, tableHeader, tableCell, microBadge) over hand-rolled Tailwind strings
9. Status dots → unshipped-state.ts or outbound-state.ts SoTs — no new hue without checking both
10. Source platform labels → src/lib/source-platform.ts only

NEW COMPONENT RULE:
If the audit above does NOT find a reusable component for what you need:
- STOP and state: "I need a new component: [name]. It would compose [existing primitives].
  Existing closest match: [file:line]. Shall I create it?"
- Wait for approval before proceeding.
- If approved, build it in design-system/primitives/ (behavior) or design-system/components/ (composed),
  export it from the relevant index.ts, and document it in DESIGN_SYSTEM.md.

### Step 3 — Implement
- Work on the main branch (never create a new branch)
- Prefer editing existing files over creating new ones
- If a DB migration is needed: write it to supabase/migrations/ with today's date prefix,
  then state "Migration written — run `npm run db:migrate` before testing" and do NOT apply it yourself
- If the task requires external credentials not in .env: state what's missing and skip to the next task
- Keep components thin — logic in hooks (src/hooks/ or domain hooks), display in the component
- For any new API route: check src/app/api/ for an existing route to extend before creating a new one

### Step 4 — Verify
After implementing:
- Run: npx tsc --noEmit 2>&1 | head -30
- Run: grep -rn "z-\[" src/ | grep -v ".test." | head -10  (catch hardcoded z-index)
- Run: grep -rn "font-black uppercase tracking-" src/ | grep -v ".test." | head -10  (catch hand-rolled typography)
- If either grep returns hits in files YOU modified: fix them before marking done

### Step 5 — Mark complete and report
Edit docs/roadmap/MASTER.md:
- Change `- [ ]` to `- [x]` for the completed item
- Add a one-line note in parentheses: (done: what file(s) changed)

Then output:
COMPLETED: [task name]
FILES: [list of files changed]
NEXT: [name of the next unchecked item in the same section, or "section complete — moving to Section N"]

If you hit a blocker (missing creds, needs migration, needs user decision):
BLOCKED: [task name]
REASON: [specific blocker]
NEXT ACTION: [what the user needs to do, or which task to skip to]
```
