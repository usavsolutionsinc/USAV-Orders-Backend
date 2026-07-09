# Prompt: Upgrade Receiving Unboxed Mode Section (Contextual Form + Glassmorphic)

Copy the entire content below into Claude Code (or your Claude session) as the user message to drive the upgrade.

---

You are an expert frontend designer + implementer following the project's strict UI conventions. Use the installed skills **/ui-ux-pro-max** and **/frontend-design:frontend-design** to guide every design decision.

## Target
Upgrade **the receiving unboxed mode section** (the primary contextual information and editing surface shown in Unbox / "receive" mode).

Primary files to reshape:
- `src/components/receiving/workspace/LineEditPanel.tsx` (the unbox composition root)
- `src/components/receiving/workspace/line-edit/CartonContextCard.tsx` (the main "section" — the identity + metadata bar that operators live in)
- Supporting pieces that must stay visually coherent: `InlinePillPicker.tsx`, `LinePoItemsSection.tsx`, `POUnboxingSection.tsx`, `CartonContextCard` consumers via `LineCartonContextSection.tsx`
- `src/components/receiving/workspace/line-edit/LineEditToolbar.tsx` and action bars for context (do not overhaul these unless they conflict)
- Design tokens and primitives: `src/design-system/tokens/colors/semantic.ts`, `WorkspaceCard`, `SearchBar`, etc.

Do **not** touch backend, controllers (`useUnboxLineController`, `useReceivingLineCore`), data fetching, or behavior contracts. Only presentation + structural form organization.

## Current State (read these first)
- In Unbox mode the right pane shows a dense horizontal "chip bar" (Urgency / Platform / Type + wide Listing chip + PO# last4 + Tracking last4 + Claim + Photo buttons) inside a `WorkspaceCard`.
- Below it, editors slide in as separate SearchBar rows when you click pencils or "edit".
- PO items + Package Pairing live in a second `POUnboxingSection` card.
- Everything works but feels like a collection of independent controls rather than a single contextual, intelligent form.
- Visual style is clean but traditional flat cards with rings. No glassmorphism.

## Goals for the upgrade
1. **More contextual + form-based + dependent**
   - Turn the top section into a smart, grouped **contextual form**.
   - Fields, labels, and sub-sections must **depend on current state**:
     - `receivingType === 'RETURN'` → PO#/Order field becomes "Order #" (or "Sales Order"), hides Zoho PO open link + editor promotion, adjusts copy everywhere, treats the value as originating order (still copyable).
     - Platform selection influences displayed urgency hint ("Auto follows Amazon") and may surface platform-specific guidance.
     - Priority/Urgency picker shows derived vs pinned with clear explanation; selecting a manual tier surfaces a small "why override?" contextual note.
     - Tracking area: primary always shown; "Add extra box" only appears when useful (or as a clear +1 affordance); extra rows are dependent children.
     - Listing URL editor appears contextually (only when no strong derived listing, or explicitly requested).
     - When a value is empty vs populated, the form presents differently (prominent input vs compact summary + edit affordance).
   - Use progressive disclosure and dependent rendering inside a single cohesive panel instead of many separate chips + pop-in editors.
   - Keep **exactly the same amount of information** — just organized more intelligently and read at a glance.

2. **Simpler visually**
   - Reduce visual noise and horizontal density.
   - Prefer clear grouped form sections with good vertical rhythm over a single crammed row of 8+ chips.
   - One clear primary identity area per carton, then contextual "References" and "Classification" groups.
   - Inline editors should feel like natural form fields (labels + inputs) that appear in-place or in a predictable drawer area, not scattered.
   - Maintain excellent scan/keyboard speed for operators.

3. **Modern + Glassmorphic**
   - Apply tasteful glassmorphism to the unbox workspace section:
     - Use `bg-white/80` or the existing `glass` semantic token + `backdrop-blur-xl` (and dark-mode equivalents already wired in globals.css).
     - Soft frosted borders: `ring-1 ring-white/40 border-white/30` or equivalent hairline on glass.
     - Subtle layered depth with very soft shadows + inner highlights.
     - Refined larger radii (rounded-3xl or considered 2xl/3xl mix), generous but not wasteful padding.
     - Keep the overall surface feeling premium and calm for a fast station workflow.
   - Follow **/frontend-design** principles: deliberate palette choices (stay inside project semantic tokens; extend glass/overlay only where needed), intentional typography, structure that encodes meaning.
   - Use **/ui-ux-pro-max** for modern form patterns, high-quality spacing, micro-interactions, and glassmorphic card language.
   - Do not invent new hex colors. Prefer semantic tokens (`text-text-default`, `bg-surface-card`, `border-border-hairline`, etc.) + glass translucency.

## Project Constraints & House Style (non-negotiable)
- Follow the rules in `Claude.md`, `.claude/rules/ui-design-system.md`, `.claude/rules/contextual-display.md`, and `.claude/rules/build-gotchas.md`.
- The receiving workspace is a **Workbench** region inside a larger operator surface (see `ReceivingRightPane.tsx` — crossfade the right pane, keep list stable).
- Linear vertical scaffold inside the card. One-row anatomy for summary rows when appropriate.
- Color only from semantic tokens. Icons paired with meaning. `HoverTooltip` for contextual help (not raw title=).
- Preserve existing motion (use `useMotion*` hooks / framer presets if adding new transitions).
- `WorkspaceCard` is the base — you may enhance it for glass or compose a glass variant for this surface only if it stays compatible.
- All editing actions, optimistic updates, copy behavior, open-external links, photo peek, receive bar, etc. must continue to work identically.
- Keep the exact same data exposed to operators: platform, type, priority, listing, PO/order, primary+extra trackings, claim/ticket, photos, etc.
- Mobile is a different surface (photo feed). Focus desktop right-pane unbox view.
- Respect existing `embedded` mode usage in POUnboxingSection and triage.

## Execution Process (follow this)
1. Read the target files + the design rules + semantic tokens + current WorkspaceCard + any globals.css glass rules.
2. Use the thinking process from **frontend-design**: 
   - Ground in the subject (fast, physical unboxing station for a used-goods reseller ops team — hands are busy, scanner primary, glanceable + quick edits secondary).
   - Create a short design plan: palette notes (glass emphasis), typography, layout concept (form sections with dependency), signature element.
   - Critique against "not templated" and project rules.
3. Leverage **ui-ux-pro-max** patterns for the modern glass form treatment.
4. Plan the new structure (e.g.):
   - Top glass header row: key glanceable summary (SKU/title or main identity + status dots if relevant).
   - Contextual Classification group (Type + Platform + Urgency) — pills or segmented that expand to full form row when editing; dependent labels.
   - References form group (context-aware fields: Order/PO, Listing URL, Tracking(s)) with dependent visibility and smart defaults.
   - Quick actions (Claim, Photos) integrated cleanly as icon+label buttons or chips inside the form surface.
5. Implement the change primarily in `CartonContextCard.tsx` (turn it into the new contextual form surface) and wire any small presentational adjustments in `LineEditPanel.tsx` / `LineCartonContextSection.tsx`.
6. Update `POUnboxingSection` / `LinePoItemsSection` presentation only where needed to feel like part of the same modern glassmorphic workspace language (light touch).
7. Add any small token or CSS glass helpers if required (prefer extending existing patterns).
8. Self-review: same information density, simpler reading/editing, beautiful glassmorphism, zero behavior change, follows house rules.
9. Test the flow mentally for common cases: normal Zoho PO carton, unmatched, return (imported order), multi-tracking, priority override.

## Deliverables
- Clean, production-ready TSX + Tailwind changes.
- The section must still work inside the existing `ReceivingRightPane` crossfade + `ReceivingLineWorkspace`.
- If new glass variants or small primitives are useful, keep them narrowly scoped or promote cleanly.
- Include a short comment block at the top of the main changed file explaining the new contextual dependent form approach.
- After code, give a concise before/after visual description + the key dependent behaviors.

Start by reading the key files listed above + the rules. Then produce a design plan summary before writing code.

Begin.