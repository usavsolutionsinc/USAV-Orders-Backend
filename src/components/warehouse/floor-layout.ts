/**
 * Auto-grid floor-plan layout for the warehouse map.
 *
 * Derives x/y/w/h positions for every bin purely from its `room` /
 * `row_label` / `col_label` (the same grouping the flat table uses), laying
 * one zone rectangle per room left-to-right with wrapping. Org-agnostic:
 * nothing here assumes specific room names, counts, or label formats.
 *
 * Grid math seeded from the deleted design-demo prototype
 * (`warehouse-map-data.ts` @ 34c52758); production Phase 1 is auto-layout only
 * — persisted per-bin coordinates land in Phase 3
 * (docs/todo/warehouse-map-react-flow-plan.md §3/§4).
 */

import type { BinsOverviewRow } from '@/hooks/useBinsOverview';

export interface FloorBin {
  row: BinsOverviewRow;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FloorZone {
  /** Stable id (room name) — doubles as the React Flow node id suffix. */
  room: string;
  letter: string | null;
  binCount: number;
  x: number;
  y: number;
  w: number;
  h: number;
  colLabels: string[];
  rowLabels: string[];
  /** Grid origin relative to the zone box, for col/row label placement. */
  relGridX: number;
  relGridY: number;
  cell: number;
  gap: number;
}

export interface FloorLayout {
  bins: FloorBin[];
  zones: FloorZone[];
}

/* Grid constants (from the prototype's "comfortable" density). */
export const FLOOR_CELL = 54;
export const FLOOR_GAP = 8;
const PAD = 16;
const HEADER = 30;
const ROW_LABEL_W = 26;
const COL_LABEL_H = 16;
const ZONE_GAP = 32;
/** Wrap zones onto a new band once a row of zones exceeds this width. */
const MAX_BAND_W = 1600;

function compareNatural(a: string, b: string): number {
  const ai = Number(a);
  const bi = Number(b);
  if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
  return a.localeCompare(b);
}

interface RoomGroup {
  room: string;
  letter: string | null;
  rowLabels: string[];
  colLabels: string[];
  cellByCoord: Map<string, BinsOverviewRow>;
  binCount: number;
}

function groupByRoom(rows: BinsOverviewRow[]): RoomGroup[] {
  const groups = new Map<string, RoomGroup>();
  for (const b of rows) {
    // Bins without grid coordinates can't be plotted (same rule as the table).
    if (!b.row_label || !b.col_label) continue;
    const roomKey = (b.room || '—').trim();
    let g = groups.get(roomKey);
    if (!g) {
      g = { room: roomKey, letter: b.zone_letter, rowLabels: [], colLabels: [], cellByCoord: new Map(), binCount: 0 };
      groups.set(roomKey, g);
    }
    g.cellByCoord.set(`${b.row_label} ${b.col_label}`, b);
    g.binCount += 1;
  }
  for (const g of groups.values()) {
    const rowSet = new Set<string>();
    const colSet = new Set<string>();
    for (const key of g.cellByCoord.keys()) {
      const idx = key.indexOf(' ');
      rowSet.add(key.slice(0, idx));
      colSet.add(key.slice(idx + 1));
    }
    g.rowLabels = Array.from(rowSet).sort(compareNatural);
    g.colLabels = Array.from(colSet).sort(compareNatural);
  }
  return Array.from(groups.values()).sort((a, b) => a.room.localeCompare(b.room));
}

/**
 * Auto-place every room as a zone rectangle (left-to-right, wrapping into
 * bands) and every bin at its row/col grid slot inside its zone.
 */
export function buildFloorLayout(rows: BinsOverviewRow[]): FloorLayout {
  const cell = FLOOR_CELL;
  const gap = FLOOR_GAP;
  const groups = groupByRoom(rows);

  const bins: FloorBin[] = [];
  const zones: FloorZone[] = [];
  let cursorX = PAD;
  let bandTop = PAD;
  let bandMaxH = 0;

  for (const g of groups) {
    const gridW = g.colLabels.length * cell + (g.colLabels.length - 1) * gap;
    const gridH = g.rowLabels.length * cell + (g.rowLabels.length - 1) * gap;
    const zoneW = PAD + ROW_LABEL_W + gridW + PAD;
    const zoneH = HEADER + COL_LABEL_H + gridH + PAD;

    // Wrap into a new band when this zone would overflow the current one.
    if (cursorX > PAD && cursorX + zoneW > MAX_BAND_W) {
      cursorX = PAD;
      bandTop += bandMaxH + ZONE_GAP;
      bandMaxH = 0;
    }

    const zx = cursorX;
    const zy = bandTop;
    const gridX = zx + PAD + ROW_LABEL_W;
    const gridY = zy + HEADER + COL_LABEL_H;

    zones.push({
      room: g.room,
      letter: g.letter,
      binCount: g.binCount,
      x: zx,
      y: zy,
      w: zoneW,
      h: zoneH,
      colLabels: g.colLabels,
      rowLabels: g.rowLabels,
      relGridX: gridX - zx,
      relGridY: gridY - zy,
      cell,
      gap,
    });

    g.rowLabels.forEach((rLabel, r) => {
      g.colLabels.forEach((cLabel, c) => {
        const bin = g.cellByCoord.get(`${rLabel} ${cLabel}`);
        if (!bin) return; // sparse grids leave the slot open
        bins.push({
          row: bin,
          x: gridX + c * (cell + gap),
          y: gridY + r * (cell + gap),
          w: cell,
          h: cell,
        });
      });
    });

    cursorX += zoneW + ZONE_GAP;
    bandMaxH = Math.max(bandMaxH, zoneH);
  }

  return { bins, zones };
}
