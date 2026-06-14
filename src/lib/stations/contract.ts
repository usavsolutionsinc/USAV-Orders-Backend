/**
 * Station builder — core contract (Operations Studio layer 2).
 *
 * Stations (receiving Incoming, Unbox, FBA Combine…) are composed from
 * registered BLOCKS bound to DATA SOURCES and ACTIONS; the composition is
 * saved as data in `station_definitions.config`. The split that keeps
 * integrations cheap: blocks are generic (a Checklist doesn't know Gmail
 * exists), integrations ship sources + actions.
 *
 * Everything here is CODE — registered, typed, PR-reviewed. The config rows
 * the Studio edits are DATA. See docs/operations-studio/station-builder-ui-plan.md.
 */

import type { ComponentType } from 'react';

// ─── Slots ───────────────────────────────────────────────────
//
// The named regions of a station chassis a block can occupy. The builder
// enforces compatibility; a block declares which slots it may be dropped into.

export const SLOT_IDS = ['trigger', 'queue', 'workspace', 'advance', 'header'] as const;
export type SlotId = (typeof SLOT_IDS)[number];

// ─── Field kinds ─────────────────────────────────────────────
//
// Semantic kinds are what make binding smart: a `po_ref` field auto-selects
// the PO renderer and makes PO-scoped actions offerable. Renderers for these
// kinds MUST delegate to the existing label SoTs (conditions.ts,
// source-platform.ts, copy-chip-format.ts) — never a second inline map.

export const FIELD_KINDS = [
  'po_ref',
  'tracking_ref',
  'order_ref',
  'sku_ref',
  'serial_ref',
  'condition_grade',
  'source_platform',
  'timestamp',
  'money',
  'text',
  'staff_ref',
] as const;
export type FieldKind = (typeof FIELD_KINDS)[number];

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
}

/** A user-tunable knob the Config Sheet's Source tab renders. */
export interface FilterDef {
  key: string;
  label: string;
  kind: 'boolean' | 'select' | 'text';
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
}

/** One row a data source resolves. `id` must be stable (action targets). */
export interface SourceRow {
  id: string;
  [key: string]: unknown;
}

// ─── Data sources ────────────────────────────────────────────

export interface DataSourceDefinition {
  /** Registry key, e.g. 'po_gmail.unmatched_emails'. */
  id: string;
  label: string;
  /** Owning integration, e.g. 'po-gmail' | 'zoho' | 'receiving'. */
  integration: string;
  /**
   * The EXISTING GET route this source wraps — sources never own a query
   * path. `buildUrl` appends the filter knobs the route already understands.
   */
  endpoint: string;
  buildUrl: (filters: Record<string, unknown>) => string;
  /**
   * Adapt the route's response into rows. Filters the endpoint can't apply
   * server-side may be applied here (still code — config can only pick among
   * declared FilterDefs, never inject logic).
   */
  parse: (json: unknown, filters: Record<string, unknown>) => SourceRow[];
  /** Declared row shape; field kinds drive renderers + action matching. */
  shape: FieldDef[];
  filters?: FilterDef[];
  /** Permission the wrapped GET is gated on — blocks bound to this source render only for holders. */
  permission: string;
  /** Live invalidation channel, when the feed has one. */
  realtime?: { ablyChannel?: string };
}

/** Palette/config-sheet metadata (no functions) — safe to serialize. */
export type DataSourceMeta = Omit<DataSourceDefinition, 'parse' | 'buildUrl'>;

// ─── Actions ─────────────────────────────────────────────────

export interface ActionDefinition {
  /** Registry key, e.g. 'incoming.dismiss_email'. */
  id: string;
  label: string;
  /** lucide icon name (resolved client-side). */
  icon: string;
  /**
   * The EXISTING mutation route this action wraps — descriptors only, the
   * route already owns validation, auth, idempotency, audit. `:id` in the
   * path is replaced with the target row's id.
   */
  endpoint: { method: 'POST' | 'PATCH' | 'DELETE'; path: string };
  /** Request body built from the target row (static for most actions). */
  body?: (row: SourceRow) => unknown;
  /** Existing permission-registry key gating the wrapped route. */
  permission: string;
  /** Offered when the bound source has a field of one of these kinds… */
  appliesTo: FieldKind[];
  /** …or when it belongs to the same integration. */
  integration?: string;
  confirm?: 'none' | 'soft' | 'step_up';
}

export type ActionMeta = Omit<ActionDefinition, 'body'>;

// ─── Blocks ──────────────────────────────────────────────────

/** A display-config knob; the Config Sheet's Display tab renders from these. */
export interface ConfigField {
  key: string;
  label: string;
  kind: 'select' | 'text' | 'toggle';
  options?: Array<{ value: string; label: string }>;
  default?: unknown;
}

/**
 * A named role the block needs mapped to a source field (Checklist: title,
 * ref, meta). `kind` pre-selects the matching source field in the Config
 * Sheet's mapping dropdowns.
 */
export interface BlockRole {
  key: string;
  label: string;
  kind?: FieldKind;
  required?: boolean;
}

/** An action resolved + bound for a block instance: the renderer owns the fetch. */
export interface BoundAction {
  def: ActionMeta;
  /** Run the action against one row. Resolves true on 2xx. */
  run: (row: SourceRow) => Promise<boolean>;
  /** True while `run` is in flight for the given row id. */
  pendingRowId: string | null;
}

/** Props every block component receives — blocks never fetch on their own. */
export interface BlockProps {
  rows: SourceRow[];
  isLoading: boolean;
  /** role key → source field key, from the saved binding. */
  mapping: Record<string, string>;
  /** Field key → kind, from the bound source's shape. */
  fieldKinds: Record<string, FieldKind>;
  display: Record<string, unknown>;
  actions: BoundAction[];
  /** Action id whose success marks a row complete (or null = manual tick). */
  doneWhen: string | null;
}

export interface BlockDefinition {
  /** Registry key, e.g. 'checklist'. Stored in station config. */
  type: string;
  label: string;
  /** lucide icon name (resolved client-side). */
  icon: string;
  category: 'trigger' | 'list' | 'workspace_step' | 'action_bar' | 'integration';
  /** Slots this block may be dropped into. */
  slots: SlotId[];
  /** Shape of data it consumes; the palette greys out incompatible sources. */
  accepts: 'rows' | 'single' | 'none';
  /** Field-mapping roles the Config Sheet's Source tab binds. */
  roles: BlockRole[];
  /** Display knobs the Config Sheet's Display tab renders. */
  configSchema: ConfigField[];
  /** Permissions implied by mounting it (palette card chips). */
  requiredPermissions: string[];
  /** The actual component, lazy-loaded client-side. */
  component: () => Promise<ComponentType<BlockProps>>;
}

export type BlockMeta = Omit<BlockDefinition, 'component'>;

// ─── Station config (the DATA stored in station_definitions.config) ──────────

export interface BlockInstanceConfig {
  /** Stable instance id, e.g. 'blk_8f2'. */
  id: string;
  /** Block registry key. */
  block: string;
  source?: {
    id: string;
    filters?: Record<string, unknown>;
    /** role key → source field key. */
    fields?: Record<string, string>;
  };
  display?: Record<string, unknown>;
  /** Action registry keys this instance exposes. */
  actions?: string[];
  /** Action id that checks an item off (null/absent = manual tick only). */
  done_when?: string | null;
}

/**
 * `slots: 'legacy'` is the explicit escape hatch: render the original
 * hard-coded component tree for this mode. Migrate modes one at a time.
 */
export interface StationConfig {
  slots: Partial<Record<SlotId, BlockInstanceConfig[]>> | 'legacy';
}

export interface StationDefinitionRow {
  id: number;
  pageKey: string;
  modeKey: string;
  label: string;
  workflowNodeId: string | null;
  config: StationConfig;
  version: number;
  isActive: boolean;
  updatedBy: number | null;
  updatedAt: string;
}
