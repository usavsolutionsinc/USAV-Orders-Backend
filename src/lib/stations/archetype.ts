/**
 * Display archetype — the four contextual-display archetypes and the decision
 * algorithm that picks one per region.
 *
 * This is the code form of the `pickArchetype()` pseudocode in
 * `.claude/rules/contextual-display.md`. A surface declares an explicit
 * `archetype` hint in `SURFACE_REGISTRY`; when that hint is absent (a region
 * decided at runtime), `pickArchetype()` runs the same Q1→Q4 discriminator the
 * rules doc mandates. The hint always wins — the algorithm is the fallback.
 *
 * Archetypes (see the rule): Station (scan → crossfade → display), Workbench
 * (list → select → detail → update), Monitor (filter → stream → read), Canvas
 * (graph → zoom/lens → focus → inspect).
 */

export const ARCHETYPE_IDS = ['station', 'workbench', 'monitor', 'canvas'] as const;
export type ArchetypeId = (typeof ARCHETYPE_IDS)[number];

/** The per-region signals the discriminator runs Q1→Q4 over. */
export interface RegionSignals {
  /** Q1 — does this region react to a scanner / keyboard-wedge / camera? */
  inputModel?: 'scanner' | 'pointer' | 'stream';
  /** Q2 — the operator's job. */
  job?: 'act' | 'observe' | 'edit' | 'reshape';
  /** Q3 — the primary data shape. */
  dataShape?: 'entity' | 'records' | 'event-stream' | 'node-graph';
  /** Q3 — how the user navigates the surface. */
  navigation?: 'scan' | 'pick' | 'filter' | 'pan-zoom-focus';
  /** Q6 — what persists after an interaction. */
  persistence?: 'act-and-clear' | 'crud' | 'none' | 'draft-publish';
  /** Q5/Q1 — selection durability. */
  selection?: 'ephemeral' | 'url-addressable' | 'ephemeral-or-none';
  /** An explicit archetype hint (e.g. from SURFACE_REGISTRY) — always wins. */
  archetype?: ArchetypeId;
}

export function isArchetypeId(value: string | null | undefined): value is ArchetypeId {
  return value != null && (ARCHETYPE_IDS as readonly string[]).includes(value);
}

/**
 * Pick the archetype for a region. An explicit hint short-circuits; otherwise
 * run the discriminator in order — first yes wins (Q1 scanner → Station,
 * Q2 observe-only → Monitor, Q3 node-graph → Canvas, Q4 default → Workbench).
 * Workbench is the fallthrough, exactly as the rules doc specifies.
 */
export function pickArchetype(region: RegionSignals = {}): ArchetypeId {
  if (region.archetype) return region.archetype; // explicit hint wins

  // Q1 — scanner short-circuits to Station.
  if (region.inputModel === 'scanner' || region.navigation === 'scan') return 'station';

  // Q2 — observe-only, nothing persists, no durable selection → Monitor.
  if (
    region.job === 'observe' &&
    region.persistence === 'none' &&
    (region.selection === 'ephemeral-or-none' || region.selection == null)
  ) {
    return 'monitor';
  }

  // Q3 — spatial node-graph the user pans/zooms/focuses → Canvas.
  if (region.dataShape === 'node-graph' && region.navigation === 'pan-zoom-focus') {
    return 'canvas';
  }

  // Q4 — default: pick a record from a list and edit it.
  return 'workbench';
}
