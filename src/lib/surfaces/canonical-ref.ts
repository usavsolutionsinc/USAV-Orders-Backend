/**
 * Canonical-ref grammar — the stable string form every AI payload, ops_event,
 * agent_mutation_affects.target_ref, and endpoint uses to point at a row
 * (docs/todo/universal-feed-polymorphic-plan.md §-1 Q11).
 *
 * Two forms:
 *   Axis form   — `<table>:<axis>:<value>:entity:<id>`
 *                 a row scoped by a vocabulary axis, e.g.
 *                 `feed_memberships:feed_key:receiving_triage:entity:123`
 *   Entity form — `<table>:entity:<id>`
 *                 a direct row ref, e.g. `serial_units:entity:9041`
 *
 * Segments are lower_snake identifiers (`SEGMENT_RE`); `:` is the reserved
 * separator. `id` is a positive integer for BIGINT/serial-keyed tables; TEXT-
 * keyed rows (workflow_nodes, ai_chat_sessions) use the raw id string, so
 * `entityId` is surfaced as a string with `entityIdNumber` as the parsed
 * convenience. This module is pure (no imports) so it stays DB-free testable
 * and safe to reuse from client code.
 */

const SEGMENT_RE = /^[a-z][a-z0-9_]*$/;
const ID_RE = /^[A-Za-z0-9._-]+$/;

export interface CanonicalRef {
  table: string;
  /** Axis qualifier (e.g. 'feed_key'); null for the plain entity form. */
  axis: string | null;
  /** Axis value (e.g. 'receiving_triage'); null for the plain entity form. */
  value: string | null;
  /** Raw id segment (integer string for serial-keyed tables, uuid/text otherwise). */
  entityId: string;
  /** entityId parsed as a positive integer, or null when it isn't one. */
  entityIdNumber: number | null;
}

function parseIdNumber(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function idSegment(entityId: string | number): string {
  // Numeric ids must be positive safe integers — String(NaN)/-5/1.5 would
  // otherwise mint parseable-but-garbage refs into immutable trails.
  if (typeof entityId === 'number' && !(Number.isSafeInteger(entityId) && entityId > 0)) {
    throw new Error(`canonical-ref: invalid numeric entity id ${entityId}`);
  }
  const id = String(entityId);
  if (!ID_RE.test(id)) throw new Error(`canonical-ref: invalid entity id "${id}"`);
  return id;
}

/** `serial_units:entity:9041` */
export function formatEntityRef(table: string, entityId: string | number): string {
  if (!SEGMENT_RE.test(table)) throw new Error(`canonical-ref: invalid table segment "${table}"`);
  return `${table}:entity:${idSegment(entityId)}`;
}

/** `feed_memberships:feed_key:receiving_triage:entity:123` */
export function formatAxisRef(table: string, axis: string, value: string, entityId: string | number): string {
  if (!SEGMENT_RE.test(table)) throw new Error(`canonical-ref: invalid table segment "${table}"`);
  if (!SEGMENT_RE.test(axis) || axis === 'entity') throw new Error(`canonical-ref: invalid axis segment "${axis}"`);
  if (!SEGMENT_RE.test(value)) throw new Error(`canonical-ref: invalid value segment "${value}"`);
  return `${table}:${axis}:${value}:entity:${idSegment(entityId)}`;
}

/** Parse either form; returns null on anything malformed (never throws). */
export function parseCanonicalRef(ref: unknown): CanonicalRef | null {
  if (typeof ref !== 'string' || ref.length === 0 || ref.length > 512) return null;
  const parts = ref.split(':');

  if (parts.length === 3) {
    const [table, marker, id] = parts;
    if (marker !== 'entity') return null;
    if (!SEGMENT_RE.test(table) || !ID_RE.test(id)) return null;
    return { table, axis: null, value: null, entityId: id, entityIdNumber: parseIdNumber(id) };
  }

  if (parts.length === 5) {
    const [table, axis, value, marker, id] = parts;
    if (marker !== 'entity' || axis === 'entity') return null;
    if (!SEGMENT_RE.test(table) || !SEGMENT_RE.test(axis) || !SEGMENT_RE.test(value) || !ID_RE.test(id)) return null;
    return { table, axis, value, entityId: id, entityIdNumber: parseIdNumber(id) };
  }

  return null;
}

export function isCanonicalRef(ref: unknown): ref is string {
  return parseCanonicalRef(ref) !== null;
}
