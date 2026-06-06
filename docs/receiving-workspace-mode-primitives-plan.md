# Receiving workspace — mode-aware primitives plan

**Status:** plan + Phase 1 implemented (2026-06-06)
**Why:** The triage ("Receiving") right pane now reuses `LineEditPanel` (good — one
editor), but triage is an *identify-before-unbox* step and must NOT show unbox-only
actions: **add photos, claim, label preview, print·receive, serial scan**. Serials are
captured only at unbox. Rather than scatter `mode === 'triage'` checks, we give the
receiving workspace a **single `variant` prop backed by a capabilities registry**, so
each mode/use-case declares what it shows in one place and new modes are a config entry.

---

## 1. The model: one `variant`, a capabilities registry

`src/components/receiving/workspace/workspace-capabilities.ts` (new) — the single source
of truth for "what does this receiving workspace mode show":

```ts
export type ReceivingWorkspaceVariant = 'unbox' | 'triage';

export interface WorkspaceCapabilities {
  photos: boolean;        // "+ click to add photos" dropzone
  claim: boolean;         // CLAIM button
  labelPreview: boolean;  // label preview card
  receiveBar: boolean;    // sticky Print·receive action bar
  serialScan: boolean;    // serial-number entry (unmatched card + matched active row)
  editLines: boolean;     // PO-items accordion interactivity (expand/switch/edit) — read-only when false
  saveBar: boolean;       // sticky "Save for unbox" bar (triage's terminal action)
}

export const WORKSPACE_CAPABILITIES = {
  unbox:  { photos: true,  claim: true,  labelPreview: true,  receiveBar: true,  serialScan: true,  editLines: true,  saveBar: false },
  triage: { photos: false, claim: false, labelPreview: false, receiveBar: false, serialScan: false, editLines: false, saveBar: true  },
};

export function workspaceCapabilities(v: ReceivingWorkspaceVariant): WorkspaceCapabilities {
  return WORKSPACE_CAPABILITIES[v] ?? WORKSPACE_CAPABILITIES.unbox;
}
```

**Why a registry, not booleans-per-section or `mode==='triage'` checks:**
- One place answers "what does each mode show" — readable + diff-able.
- New use-cases (a future `qc`, `tech`, `return-only` variant) = one row, no editor surgery.
- The editor stays variant-agnostic: it reads `caps.X`, never the mode string.

Everything NOT in the capability list (classify pills, PO# link, add-item, notes, the
carton context, the rail) stays on in every mode — those are the identify essentials.

---

## 2. Prop threading (one prop, top → down)

`ReceivingDashboard` knows the mode → passes `variant` → `ReceivingLineWorkspace` →
`LineEditPanel` → the few children that own a gated section.

| Step | File:line | Change |
|---|---|---|
| 1 | `ReceivingDashboard.tsx` (workspace render) | `variant={isTriageMode ? 'triage' : 'unbox'}` |
| 2 | `ReceivingLineWorkspace.tsx` (props + `<LineEditPanel>`) | add `variant`, forward it |
| 3 | `LineEditPanel.tsx` (props) | add `variant`; `const caps = workspaceCapabilities(variant)` |
| 4 | `LineEditPanel.tsx:792` | `{caps.labelPreview && <LineLabelPreviewCard …/>}` |
| 5 | `LineEditPanel.tsx:816` | `{caps.receiveBar && <LineReceiveActionBar …/>}` |
| 6 | `LineEditPanel.tsx:661` → `CartonContextCard` | pass `showStaffPhotoRow={caps.photos}` + `onMakeClaim={caps.claim ? … : undefined}` |
| 7 | `CartonContextCard.tsx` → `ReceivingCartonStaffDropdown` | gate the photo+claim row on the new flag |
| 8 | `LineEditPanel.tsx:722` → `UnmatchedItemsSection` | pass `showSerialScan={caps.serialScan}` |
| 9 | `UnmatchedItemsSection.tsx:418` | gate the "SCAN A SERIAL NUMBER" card |

---

## 3. Phase 1 (implemented now) — the explicit removals

Gated OFF in `triage`, ON in `unbox`:
1. **Photos + Claim** — `CartonContextCard` → `ReceivingCartonStaffDropdown` photo+claim row.
2. **Label preview** — `LineLabelPreviewCard` in `LineEditPanel`.
3. **Print·receive bar** — `LineReceiveActionBar` in `LineEditPanel`.
4. **Serial scan (unmatched)** — the "SCAN A SERIAL NUMBER" card in `UnmatchedItemsSection`
   (Image #15). `LINK REPAIR SERVICE` + `ADD ITEM` stay — those are identify actions.

What triage KEEPS: carton context (listing / PO# / tracking / **classify** platform+type
pills), **Add item** + **Link repair service**, notes, the "Unfound/Found" identity.

---

## 4. Phase 2 (DONE — option a) — matched-carton serial + condition

For MATCHED cartons the serial input lives **inside** `ActiveLineConditionSerial`'s
`SerialCard`, which also renders the **condition** pills. We chose **option (a)**: in
triage the whole active condition/serial slot is hidden (`activeRowSlot` returns `null`
when `!caps.serialScan`) — both serial AND condition are assessed only at unbox, which is
consistent with "you only scan the serial when unboxing." The PO lines still render
(`PoLinesAccordion`); only the active-row editor is suppressed.

Alternative (b) — a `hideSerialEntry` prop on the shared `SerialCard` to keep condition
but drop only the serial input — was not taken (more surgical, touches a widely-shared
primitive). Revisit if triage later needs condition grading.

---

## 5. Use-case matrix (the "different modes acknowledgement")

| Capability | unbox | triage | (future) qc | (future) tech |
|---|---|---|---|---|
| classify (platform/type) | ✓ | ✓ | ✓ | – |
| add item / link repair | ✓ | ✓ | – | – |
| PO# link | ✓ | ✓ | – | – |
| photos | ✓ | ✗ | ✓ | ✓ |
| claim | ✓ | ✗ | ✓ | ✓ |
| serial scan | ✓ | ✗ | ✓ | ✓ |
| label preview | ✓ | ✗ | ✗ | ✗ |
| print·receive | ✓ | ✗ | ✗ | ✗ |

Future columns are illustrative — they show the registry absorbs new modes without
touching `LineEditPanel`'s JSX, only adding a row to `WORKSPACE_CAPABILITIES`.

---

## 6. Risks
- The gated children (`CartonContextCard`, `UnmatchedItemsSection`) gain a new optional
  prop — default to the unbox behavior so every existing call site is unchanged.
- Don't gate the *data* hooks (serial submit, receive action) — only their UI. The
  handlers stay wired so toggling a variant never leaves dangling state.
- `variant` defaults to `'unbox'` everywhere, so any workspace mounted without the prop
  (e.g. a deep link, the testing station) behaves exactly as today.
