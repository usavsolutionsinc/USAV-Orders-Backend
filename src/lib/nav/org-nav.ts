/**
 * Navigation as data (Studio-driven operator-surfaces refactor, Phase 4).
 *
 * The static `APP_SIDEBAR_NAV` is the CODE default (what surfaces the app can
 * render). A per-org `nav_definitions` row is the DATA override — it can hide,
 * rename, or reorder nav items so a business's sidebar reflects its own
 * operation, without a deploy. This mirrors the station/surface split: code
 * registers capabilities, data drives what each org sees.
 *
 * `mergeOrgNav` is pure + DB-free (unit-tested); the loader + API + hook layer
 * it. The override is ADDITIVE and safe — a null/absent override yields the
 * static defaults unchanged, and an override can never introduce a nav item the
 * code doesn't already define (it only references existing ids).
 */

import type { SidebarNavItem } from '@/lib/sidebar-navigation';

/** One per-org override for a nav item, keyed by the item's stable id. */
export interface NavOverrideEntry {
  /** Matches a `SidebarNavItem.id` (e.g. 'receiving', 'outbound'). */
  id: string;
  /** Hide this item from the org's nav. */
  hidden?: boolean;
  /** Rename it (the operator's word for the surface). */
  label?: string;
  /** Explicit sort position; lower sorts first. Unset items keep default order. */
  order?: number;
}

export interface NavDefinition {
  entries: NavOverrideEntry[];
}

/**
 * Apply an org's nav override onto the static defaults: filter hidden items,
 * rename labelled ones, and reorder. Ordering semantics (predictable for the
 * lightweight "pin these to the top" use case): items given an explicit `order`
 * lead, sorted by that order; every item WITHOUT an explicit order follows, in
 * its default relative position. So an override only names the items it wants to
 * pin, and the rest keep their natural order.
 */
export function mergeOrgNav(
  defaults: readonly SidebarNavItem[],
  override: NavDefinition | null | undefined,
): SidebarNavItem[] {
  if (!override || override.entries.length === 0) return [...defaults];
  const byId = new Map(override.entries.map((e) => [e.id, e]));

  const visible = defaults
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => !byId.get(item.id)?.hidden)
    .map(({ item, index }) => {
      const o = byId.get(item.id);
      const merged = o?.label ? { ...item, label: o.label } : item;
      return { item: merged, order: o?.order, index };
    });

  visible.sort((a, b) => {
    const aHas = a.order !== undefined;
    const bHas = b.order !== undefined;
    if (aHas && bHas) return a.order! - b.order! || a.index - b.index;
    if (aHas) return -1; // explicit-order items lead
    if (bHas) return 1;
    return a.index - b.index; // unset items keep their default relative order
  });
  return visible.map((v) => v.item);
}

/** Narrow an unknown jsonb payload into a NavDefinition (defensive, for the loader). */
export function parseNavDefinition(raw: unknown): NavDefinition | null {
  if (!raw || typeof raw !== 'object') return null;
  const entriesRaw = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entriesRaw)) return null;
  const entries: NavOverrideEntry[] = [];
  for (const e of entriesRaw) {
    if (!e || typeof e !== 'object') continue;
    const id = (e as { id?: unknown }).id;
    if (typeof id !== 'string' || !id) continue;
    const entry: NavOverrideEntry = { id };
    const hidden = (e as { hidden?: unknown }).hidden;
    if (typeof hidden === 'boolean') entry.hidden = hidden;
    const label = (e as { label?: unknown }).label;
    if (typeof label === 'string' && label) entry.label = label;
    const order = (e as { order?: unknown }).order;
    if (typeof order === 'number' && Number.isFinite(order)) entry.order = order;
    entries.push(entry);
  }
  return { entries };
}
