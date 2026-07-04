/**
 * Universal-surfaces kind catalog — the single runtime SoT for every
 * second-axis vocabulary in the universal-feed table family
 * (docs/todo/universal-feed-polymorphic-plan.md §-1 Q11, §2 "Key properties").
 *
 * The DB deliberately does NOT CHECK these axes (feed_key, signal_kind,
 * linkage_type, mutation_kind, node_surface.role, target_kind) so new kinds
 * are additive — registering here IS the migration. What the DB does CHECK
 * (entity_type, membership state/tone, mutation status) is mirrored here so
 * code and DDL can never drift silently: registry.test.ts pins both sides.
 *
 * The AI reads this registry at runtime (it is injected into the assistant's
 * tool schemas and prompt fragments), so every entry carries a `description`
 * written for the model, not just for humans. Adding a kind without a real
 * description degrades the assistant — don't.
 *
 * Pure module: no DB imports, no side effects (unit-testable DB-free, safe
 * from client code).
 */

// ─── Entity types (FIRST discriminator axis — mirrors the DB CHECKs) ────────
// Must stay byte-identical with the `*_entity_type_chk` CHECK lists in
// migrations 2026-07-03d/e/f AND each parent's delete-trigger set. Adding a
// value = new migration (CHECK redefinition + delete trigger) + entry here.

export interface SurfaceEntityTypeDef {
  /** Parent table the id points at (delete-trigger target). */
  parentTable: string;
  /** Lowercase entity_type used when the same fact is emitted to ops_events. */
  opsEventEntityType: string;
  label: string;
  description: string;
}

export const SURFACE_ENTITY_TYPES = {
  RECEIVING: {
    parentTable: 'receiving',
    opsEventEntityType: 'receiving',
    label: 'Receiving carton',
    description: 'An inbound carton/package (receiving table): the unit of dock arrival, unboxing and triage.',
  },
  RECEIVING_LINE: {
    parentTable: 'receiving_lines',
    opsEventEntityType: 'receiving_line',
    label: 'Receiving line',
    description: 'One expected/received item line inside a carton (receiving_lines table).',
  },
  SERIAL_UNIT: {
    parentTable: 'serial_units',
    opsEventEntityType: 'serial_unit',
    label: 'Serial unit',
    description: 'One serialized physical unit (serial_units table): the thing that moves through testing, repair, listing and shipping.',
  },
  ORDER: {
    parentTable: 'orders',
    opsEventEntityType: 'order',
    label: 'Sales order',
    description: 'A marketplace sales order in the local mirror (orders table; eBay/Amazon account_source + order_id).',
  },
  FBA_SHIPMENT: {
    parentTable: 'fba_shipments',
    opsEventEntityType: 'fba_shipment',
    label: 'FBA shipment',
    description: 'An outbound Amazon FBA shipment (fba_shipments table).',
  },
  REPAIR: {
    parentTable: 'repair_service',
    opsEventEntityType: 'repair',
    label: 'Repair job',
    description: 'A repair-service job (repair_service table).',
  },
  WARRANTY_CLAIM: {
    parentTable: 'warranty_claims',
    opsEventEntityType: 'warranty_claim',
    label: 'Warranty claim',
    description: 'A customer warranty claim (warranty_claims table): logged → reviewed → approved/denied → repair/RMA.',
  },
} as const satisfies Record<string, SurfaceEntityTypeDef>;

export type SurfaceEntityType = keyof typeof SURFACE_ENTITY_TYPES;
export const SURFACE_ENTITY_TYPE_LIST = Object.keys(SURFACE_ENTITY_TYPES) as SurfaceEntityType[];

export function isSurfaceEntityType(v: unknown): v is SurfaceEntityType {
  return typeof v === 'string' && Object.hasOwn(SURFACE_ENTITY_TYPES, v);
}

// ─── feed_key (feed_memberships / staff_rail_exclusions / node_surfaces) ────

export interface FeedKeyDef {
  label: string;
  /** The entity type this feed's rows anchor on. */
  entityType: SurfaceEntityType;
  description: string;
}

export const FEED_KEYS = {
  receiving_triage: {
    label: 'Receiving triage',
    entityType: 'RECEIVING',
    description: 'Cartons needing triage: unfound/no-PO, carrier mismatch, pairing not complete. Cleared when triage completes.',
  },
  receiving_unbox: {
    label: 'Unbox queue',
    entityType: 'RECEIVING',
    description: 'Received cartons waiting to be unboxed at the receiving bench.',
  },
  testing_queue: {
    label: 'Testing queue',
    entityType: 'SERIAL_UNIT',
    description: 'Serialized units waiting for (or failing) bench testing.',
  },
  orders_unshipped: {
    label: 'Unshipped orders',
    entityType: 'ORDER',
    description: 'Open sales orders not yet shipped (pick/pack/label pipeline).',
  },
  fba_outbound: {
    label: 'FBA outbound',
    entityType: 'FBA_SHIPMENT',
    description: 'FBA shipments being assembled/awaiting carrier handoff.',
  },
  repairs_queue: {
    label: 'Repairs queue',
    entityType: 'REPAIR',
    description: 'Open repair-service jobs.',
  },
  warranty_claims: {
    label: 'Warranty claims',
    entityType: 'WARRANTY_CLAIM',
    description: 'Open warranty claims in review/repair.',
  },
} as const satisfies Record<string, FeedKeyDef>;

export type FeedKey = keyof typeof FEED_KEYS;
export const FEED_KEY_LIST = Object.keys(FEED_KEYS) as FeedKey[];

export function isFeedKey(v: unknown): v is FeedKey {
  return typeof v === 'string' && Object.hasOwn(FEED_KEYS, v);
}

// ─── feed_memberships.state / tone (mirror the DB CHECKs) ────────────────────

export const FEED_MEMBERSHIP_STATES = ['active', 'needs_match', 'done'] as const;
export type FeedMembershipState = (typeof FEED_MEMBERSHIP_STATES)[number];

/** Mirrors TimelineTone (src/lib/timeline/types.ts) — the house tone registry. */
export const FEED_MEMBERSHIP_TONES = ['default', 'info', 'success', 'warning', 'danger', 'muted'] as const;
export type FeedMembershipTone = (typeof FEED_MEMBERSHIP_TONES)[number];

// ─── signal_kind (entity_signals) ────────────────────────────────────────────

export interface SignalKindDef {
  label: string;
  /** Entity types this kind may anchor on (validation in recordEntitySignal). */
  entityTypes: readonly SurfaceEntityType[];
  /** 'internal' = chokepoint emitter (source_ref NULL); 'external' = mirror-derived (source_ref REQUIRED). */
  origin: 'internal' | 'external';
  description: string;
}

export const SIGNAL_KINDS = {
  return_reason: {
    label: 'Return reason',
    entityTypes: ['SERIAL_UNIT', 'RECEIVING_LINE'],
    origin: 'internal',
    description: 'Why a shipped unit came back — emitted when a returned serial is linked back to its outbound order (linkReturnedSerial / manual sales-order import). Free-text reason in notes; matched order context in meta.',
  },
  warranty_denial: {
    label: 'Warranty denial reason',
    entityTypes: ['WARRANTY_CLAIM'],
    origin: 'internal',
    description: 'Why a warranty claim was denied — reason_code from the governed reason_codes vocabulary (flow_context=warranty_denial).',
  },
  exception_why: {
    label: 'Receiving exception',
    entityTypes: ['RECEIVING', 'RECEIVING_LINE'],
    origin: 'internal',
    description: 'A receiving problem: carton-level NO_PO / CARRIER_MISMATCH (unfound cartons, carrier mismatches, pairing failures — entity RECEIVING) or line-level DAMAGED / SHORT / OVER / WRONG_ITEM (entity RECEIVING_LINE). reason_code = the exception code.',
  },
  triage_outcome: {
    label: 'Triage outcome',
    entityTypes: ['RECEIVING'],
    origin: 'internal',
    description: 'A carton finished triage — staging lane/shelf decision in meta. Emitted by completeTriage.',
  },
  test_fail_reason: {
    label: 'Test failure',
    entityTypes: ['SERIAL_UNIT'],
    origin: 'internal',
    description: 'A unit did not pass bench testing — meta.verdict is TESTING_FAILED (severity 2) or TEST_AGAIN (severity 1). Tech notes in notes; governed verdict-detail reason codes ride reason_code when captured.',
  },
  buyer_note: {
    label: 'Buyer note',
    entityTypes: ['ORDER'],
    origin: 'external',
    description: 'Raw buyer checkout note/message from a marketplace order, projected from the local mirror (never interpreted at ingest — semantic bucketing is a later classifier). source_ref = platform note id or content hash.',
  },
} as const satisfies Record<string, SignalKindDef>;

export type SignalKind = keyof typeof SIGNAL_KINDS;
export const SIGNAL_KIND_LIST = Object.keys(SIGNAL_KINDS) as SignalKind[];

export function isSignalKind(v: unknown): v is SignalKind {
  return typeof v === 'string' && Object.hasOwn(SIGNAL_KINDS, v);
}

// ─── node_surfaces.role ──────────────────────────────────────────────────────

export const NODE_SURFACE_ROLES = {
  inbox: { label: 'Inbox', description: 'The feed items waiting AT this node (its work queue).' },
  outbox: { label: 'Outbox', description: 'Items this node has finished and handed downstream.' },
  display: { label: 'Display', description: 'A read-only contextual feed shown at this node (no queue semantics).' },
} as const satisfies Record<string, { label: string; description: string }>;

export type NodeSurfaceRole = keyof typeof NODE_SURFACE_ROLES;

export function isNodeSurfaceRole(v: unknown): v is NodeSurfaceRole {
  return typeof v === 'string' && Object.hasOwn(NODE_SURFACE_ROLES, v);
}

// ─── insight_links axes ──────────────────────────────────────────────────────

export const INSIGHT_LINKAGE_TYPES = {
  industry_benchmark: { label: 'Industry benchmark', description: 'Typical values for the vertical (seeded, editable).' },
  power_user_comparison: { label: 'Power-user comparison', description: 'What top-performing operations achieve (seeded/aggregated).' },
  suggestion_seed: { label: 'Suggestion seed', description: 'A canned improvement suggestion the assistant may surface when the matching metric drifts.' },
  org_signal_rollup: { label: 'Your signal rollup', description: "This org's OWN entity_signals distribution over a trailing window (nightly cron, source='org_rollup'). Complements the seeded typicals with the operation's real reason-code breakdown." },
} as const satisfies Record<string, { label: string; description: string }>;

export type InsightLinkageType = keyof typeof INSIGHT_LINKAGE_TYPES;

export const INSIGHT_SUBJECT_KINDS = ['node_type', 'feed_key', 'signal_kind'] as const;
export type InsightSubjectKind = (typeof INSIGHT_SUBJECT_KINDS)[number];

export function isInsightSubjectKind(v: unknown): v is InsightSubjectKind {
  return typeof v === 'string' && (INSIGHT_SUBJECT_KINDS as readonly string[]).includes(v);
}

// ─── mutation_kind + trust classes (agent_mutations) ─────────────────────────
// The §8 spec (plan doc "§10. mutation_kind spec") in executable form.
// Trust classes (plan §-2 "Trust model (day one)"):
//   auto         — view-layer only; applies immediately, no review.
//   draft_scoped — applies to a workflow DRAFT without review (the draft is
//                  the safety layer; publish stays the human gate).
//   review       — lands as status='proposed'; a human applies via review.

export type MutationTrustClass = 'auto' | 'draft_scoped' | 'review';

export interface MutationKindDef {
  label: string;
  trust: MutationTrustClass;
  /** target_kind stamped on agent_mutation_affects rows for this kind. */
  targetKind: string;
  description: string;
}

export const MUTATION_KINDS = {
  // auto — view-layer
  'staff_rail_exclusion.insert': {
    label: 'Dismiss rail item',
    trust: 'auto',
    targetKind: 'staff_rail_exclusion',
    description: 'Hide one feed item for one staff member at one station (non-destructive personal dismiss).',
  },
  'staff_rail_exclusion.delete': {
    label: 'Restore rail item',
    trust: 'auto',
    targetKind: 'staff_rail_exclusion',
    description: 'Undo a personal dismiss (delete the exclusion row).',
  },
  'feed_membership.set_state': {
    label: 'Set feed item state',
    trust: 'auto',
    targetKind: 'feed_membership',
    description: 'Flip a membership between active / needs_match / done. Projection-only; never touches the source record.',
  },
  'entity_signal.insert': {
    label: 'Record signal',
    trust: 'auto',
    targetKind: 'entity_signal',
    description: 'Append a structured "why" observation about an entity (registry-validated signal_kind).',
  },
  'node_surface.set_config': {
    label: 'Tune node surface',
    trust: 'auto',
    targetKind: 'node_surface',
    description: 'Update the config JSON of an existing node↔feed surface (sort, filters, display options).',
  },

  // draft_scoped — workflow draft edits (publish is the human gate)
  'workflow_draft.add_node': {
    label: 'Add node (draft)',
    trust: 'draft_scoped',
    targetKind: 'workflow_node',
    description: 'Add a process node to the draft graph.',
  },
  'workflow_draft.remove_node': {
    label: 'Remove node (draft)',
    trust: 'draft_scoped',
    targetKind: 'workflow_node',
    description: 'Remove a node (and its edges) from the draft graph.',
  },
  'workflow_draft.update_node_config': {
    label: 'Update node config (draft)',
    trust: 'draft_scoped',
    targetKind: 'workflow_node',
    description: "Patch one draft node's config (station binding, rules, options).",
  },
  'workflow_draft.add_edge': {
    label: 'Wire edge (draft)',
    trust: 'draft_scoped',
    targetKind: 'workflow_edge',
    description: 'Connect a source node port to a target node in the draft (one port → one target).',
  },
  'workflow_draft.remove_edge': {
    label: 'Remove edge (draft)',
    trust: 'draft_scoped',
    targetKind: 'workflow_edge',
    description: 'Disconnect an edge in the draft.',
  },
  'workflow_draft.set_annotations': {
    label: 'Set annotations (draft)',
    trust: 'draft_scoped',
    targetKind: 'workflow_definition',
    description: "Replace the draft's canvas sticky-note annotations.",
  },
  'node_surface.create': {
    label: 'Create node surface (draft)',
    trust: 'draft_scoped',
    targetKind: 'node_surface',
    description: 'Declare a new node↔feed surface on a DRAFT definition.',
  },
  'node_surface.delete': {
    label: 'Delete node surface (draft)',
    trust: 'draft_scoped',
    targetKind: 'node_surface',
    description: 'Remove a node↔feed surface from a DRAFT definition.',
  },

  // review — masters / live definitions
  'staff.create': {
    label: 'Create staff member',
    trust: 'review',
    targetKind: 'staff',
    description: 'Create a real staff row (+ roles/stations). Always review-gated: touches the identity master.',
  },
  'staff.assign_station': {
    label: 'Assign staff station',
    trust: 'review',
    targetKind: 'staff',
    description: "Change a staff member's station assignments. Review-gated (identity master).",
  },
  'reason_code.create': {
    label: 'Create reason code',
    trust: 'review',
    targetKind: 'reason_code',
    description: 'Add a governed vocabulary entry (reason_codes). Review-gated: vocabularies drive validation everywhere.',
  },
  'setting.update': {
    label: 'Update org setting',
    trust: 'review',
    targetKind: 'setting',
    description: 'Change a settings-registry value for the org. Review-gated: settings alter live behavior.',
  },
} as const satisfies Record<string, MutationKindDef>;

export type MutationKind = keyof typeof MUTATION_KINDS;
export const MUTATION_KIND_LIST = Object.keys(MUTATION_KINDS) as MutationKind[];

export function isMutationKind(v: unknown): v is MutationKind {
  return typeof v === 'string' && Object.hasOwn(MUTATION_KINDS, v);
}

export function mutationTrustClass(kind: MutationKind): MutationTrustClass {
  return MUTATION_KINDS[kind].trust;
}

/** Mirrors the agent_mutations_status_chk CHECK. */
export const AGENT_MUTATION_STATUSES = ['proposed', 'under_review', 'approved', 'applied', 'rejected', 'reverted'] as const;
export type AgentMutationStatus = (typeof AGENT_MUTATION_STATUSES)[number];

/** All target_kind values (agent_mutation_affects) derivable from the kinds. */
export const MUTATION_TARGET_KINDS = [...new Set(Object.values(MUTATION_KINDS).map((k) => k.targetKind))] as readonly string[];
