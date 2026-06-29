# Source-of-truth invariants

Each concern below has exactly one source module. Read from it; never inline, copy, or re-derive the mapping.
Summarized in the root `CLAUDE.md`; this file holds the detail and rationale.

## Condition grade → label

- Source: `src/lib/conditions.ts`, function `conditionLabel(code, variant)`.
- 6 variants: `pill` / `table` / `compact` / `label` / `full` / `option`.
- Never inline a grade→label map anywhere else; add a variant here instead.

## Condition grade → color (picker + inline badges)

- Source: `src/lib/condition-tone.ts` (`CONDITION_GRADE_TONE`, `conditionGradeTextClass`, `conditionPillClass`).
- UI hook: `src/hooks/useConditionGradeStyle.ts` — label + text class for inline readouts.
- Never hardcode per-grade Tailwind colors in components; import from here so pills and meta rows stay in sync.

## Z-index

- Source: `src/design-system/tokens/z-index.ts`, wired into Tailwind as named utilities
  (`z-panel`, `z-modal`, `z-panelPopover`, `z-toast`, `z-tooltip`).
- Never hardcode `z-[NNN]` or inline numeric `zIndex`. Add/adjust a named token instead.

## Source platform → label / tone

- Source: `src/lib/source-platform.ts` (`SOURCE_PLATFORM_OPTS` / `SOURCE_PLATFORM_LABELS` derive from it).
- Urgency / priority is a priority-tier picker on `receiving.priority_tier`; SoT is `src/lib/receiving/priority-override.ts`
  (`is_priority` = synced tier-0).

## Copy-chip / serial display

- Three layers: pure helpers in `src/lib/copy-chip-format.ts`; behavior in `useCopyChip` / `useChipTooltip` (`@/hooks`);
  `CHIP_TONES` tone registry in `CopyChip.tsx` (incl. `price` for unit cost).
- Condition meta chips use `ConditionGradeChip` → `src/lib/condition-tone.ts` for per-grade underline/icon hue.
- `resolveSerialDisplay` / `resolveChipDisplay` are the label SoT for serials/chips.

## Buttons

- Canonical `Button` (5 variants) lives in `src/design-system/primitives`. `PrimaryButton` is now a thin alias.
- New code uses `Button`; don't hand-roll button class strings.

## SKU identity (data-integrity)

- `items` (Zoho) and `sku_catalog` are **two independent SKU numbering schemes**.
- **Never join on the SKU string** — they collide. `items.name` is the title-display SoT
  (`get-title-by-sku` prefers `items.name`, not `sku_catalog` / `sku_stock`).
