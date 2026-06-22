/**
 * People-lens coverage assembly (Operations Studio ST6 / Phase E1).
 *
 * The People lens overlays, per workflow node, WHICH STAFF are scoped to that
 * node's station — so an owner sees staffing coverage on the same graph. It is
 * strictly READ-ONLY (Studio law #7): it reads staff access and deep-links to
 * the staff editor; it never writes grants.
 *
 * ── The node → station → staff mapping (the load-bearing decision) ──
 *
 * There are TWO independent station vocabularies in this codebase:
 *
 *   1. node.config.station — the operations-catalog STATIONS *department* key
 *      (RECEIVING · TECH · PACK · LABELS · FBA · ADMIN). EVERY process node
 *      carries it; it already drives L0 business-map grouping.
 *   2. staff_stations.station — the per-staff assignment enum
 *      (TECH · PACK · UNBOX · SALES · FBA), set in the admin Stations card.
 *
 * They overlap only on TECH/PACK/FBA, so a direct string join would silently
 * drop coverage for receiving/label nodes. This module owns the ONE crosswalk
 * (DEPARTMENT_TO_STAFF_STATION) from the node department key to the staff
 * enum, chosen from the clearest real-world signal:
 *
 *   RECEIVING → UNBOX   (the receiving floor staff station is "UNBOX")
 *   TECH      → TECH
 *   PACK      → PACK
 *   LABELS    → PACK    (label printing happens at the pack bench — see the
 *                        operations-catalog LABELS blurb + the shipping flow,
 *                        where PACK owns the LABEL_PRINTED step)
 *   FBA       → FBA
 *   ADMIN     → (none)  (back-office / SYSTEM actors — no floor staff station)
 *
 * `node.config.station` is the primary join because it is dense (present on
 * every node) and is the same key L0 already groups on, keeping the lens a pure
 * repaint of the laid-out graph. `station_definitions.workflow_node_id` (the
 * Phase-D node→station binding) is sparse and orthogonal, so it is NOT used as
 * the staffing signal here — a node with no department key simply reads as a
 * coverage gap, which is exactly the owner-facing signal we want.
 *
 * Pure + DB-free so it unit-tests with plain objects; the route does the SQL.
 */

import { asStation, type StationKey } from '@/lib/neon/staff-stations-queries';

/**
 * operations-catalog department key (node.config.station) → staff_stations enum.
 * A null value means "no floor staff station maps to this department" (ADMIN).
 * Keys are the catalog STATIONS.key values; see the module header for rationale.
 */
export const DEPARTMENT_TO_STAFF_STATION: Record<string, StationKey | null> = {
  RECEIVING: 'UNBOX',
  TECH: 'TECH',
  PACK: 'PACK',
  LABELS: 'PACK',
  FBA: 'FBA',
  ADMIN: null,
};

/**
 * Resolve a node's department key (node.config.station) to the staff_stations
 * enum value whose assigned staff cover it, or null when the department has no
 * floor staff station (ADMIN) or the key is unknown/absent.
 */
export function staffStationForNodeDepartment(
  department: string | null | undefined,
): StationKey | null {
  if (!department) return null;
  const key = String(department).toUpperCase();
  if (key in DEPARTMENT_TO_STAFF_STATION) return DEPARTMENT_TO_STAFF_STATION[key];
  // Defensive: if a future department key happens to already be a valid staff
  // station enum (e.g. a renamed catalog), accept it directly rather than gap.
  return asStation(key);
}

/** One node as the assembler sees it — just its id and its department key. */
export interface PeopleNodeRef {
  id: string;
  /** node.config.station — the operations-catalog department key (may be absent). */
  station: string | null;
}

/** One staffer scoped to a station (from staff ⋈ staff_stations). */
export interface StaffStationAssignment {
  staffId: number;
  name: string;
  role: string | null;
  /** The staff_stations enum value they are assigned to. */
  station: StationKey;
  isPrimary: boolean;
}

/** Per-node staffing the People lens renders. */
export interface PeopleNodeCoverage {
  /** Staff scoped to this node's station (primary first, then by name). */
  staff: Array<{ id: number; name: string; role: string | null; isPrimary: boolean }>;
  /** staff.length — the count badge / gap signal (0 = uncovered). */
  coverage: number;
  /** The staff_stations enum this node resolved to, or null (uncovered by mapping). */
  station: StationKey | null;
}

export interface StudioPeopleResponse {
  ok: boolean;
  nodes: Record<string, PeopleNodeCoverage>;
  /** Total distinct staff covering at least one node in the graph. */
  totalCovering: number;
  /** Nodes with zero scoped staff — the coverage gaps. */
  uncoveredNodeIds: string[];
  error?: string;
}

export interface AssemblePeopleInput {
  nodes: PeopleNodeRef[];
  /** All staff↔station assignments for the org (any station). */
  assignments: StaffStationAssignment[];
}

/**
 * Assemble per-node staffing coverage from the graph's nodes and the org's
 * staff↔station assignments. Pure — no DB, no clock.
 *
 * Each node maps (via staffStationForNodeDepartment) to one staff_stations enum;
 * its coverage is every staffer assigned to that station. Nodes whose department
 * doesn't map (ADMIN / unknown / absent) read as uncovered.
 */
export function assemblePeopleCoverage(input: AssemblePeopleInput): StudioPeopleResponse {
  // staff_stations enum → its assigned staff (primary first, then name).
  const byStation = new Map<StationKey, StaffStationAssignment[]>();
  for (const a of input.assignments) {
    const list = byStation.get(a.station) ?? [];
    list.push(a);
    byStation.set(a.station, list);
  }
  for (const list of byStation.values()) {
    list.sort((x, y) => {
      if (x.isPrimary !== y.isPrimary) return x.isPrimary ? -1 : 1;
      return x.name.localeCompare(y.name);
    });
  }

  const nodes: Record<string, PeopleNodeCoverage> = {};
  const uncoveredNodeIds: string[] = [];
  const coveringIds = new Set<number>();

  for (const n of input.nodes) {
    const station = staffStationForNodeDepartment(n.station);
    const assigned = station ? byStation.get(station) ?? [] : [];
    const staff = assigned.map((a) => ({
      id: a.staffId,
      name: a.name,
      role: a.role,
      isPrimary: a.isPrimary,
    }));
    nodes[n.id] = { staff, coverage: staff.length, station };
    if (staff.length === 0) uncoveredNodeIds.push(n.id);
    else for (const a of assigned) coveringIds.add(a.staffId);
  }

  return {
    ok: true,
    nodes,
    totalCovering: coveringIds.size,
    uncoveredNodeIds,
  };
}
