/**
 * Shared, framework-agnostic data + helpers for the warehouse-map showroom
 * sections. Consumed by BOTH the react-konva canvas and the @xyflow/react
 * (React Flow) version so the two are an apples-to-apples comparison: same
 * zones, same bins, same fill tones, same trace SKUs — only the rendering
 * library differs.
 *
 * No konva / react-flow imports here on purpose — just numbers and strings.
 */

import type { Density } from './sections';

export interface Bin {
  id: string;
  label: string;
  zone: string;
  sku: string;
  fillPct: number; // 0 = empty, 1 = full, >1 = over capacity
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ZoneBox {
  name: string;
  letter: string;
  x: number;
  y: number;
  w: number;
  h: number;
  colLabels: string[];
  rowLabels: string[];
  /** grid origin (absolute) for column/row label placement */
  gridX: number;
  gridY: number;
  cell: number;
  gap: number;
}

export type ViewMode = 'fill' | 'qty';

export const SKUS = ['AVR-100', 'HDM-220', 'CBL-90', 'PSU-450', 'SWT-12', 'RTR-88'];

export const ZONE_DEFS = [
  { name: 'Zone 1 – New',     letter: 'A', rows: ['01', '02', '03'], cols: ['1-00', '1-01', '2-00', '3-00', '4-00'] },
  { name: 'Zone 2 – Returns', letter: 'B', rows: ['01', '02'],       cols: ['1-00', '1-01', '2-00', '3-00'] },
  { name: 'Zone 3 – Bulk',    letter: 'C', rows: ['01', '02', '03', '04'], cols: ['1-00', '2-00'] },
];

export const MIN_SIZE = 24;
export const ACCENT = '#3b82f6';

export function cellSize(density: Density): number {
  return density === 'compact' ? 36 : density === 'comfortable' ? 54 : 44;
}

/** Deterministic pseudo-fill so the map looks the same every render. */
export function seededFill(zi: number, r: number, c: number): number {
  const n = ((zi + 1) * 13 + r * 7 + c * 5) % 13; // 0..12
  if (n === 0) return 0;
  return Math.min(1.2, n / 10);
}

export function buildLayout(density: Density): { bins: Bin[]; zones: ZoneBox[] } {
  const cell = cellSize(density);
  const gap = 8;
  const pad = 16;
  const header = 30;
  const rowLabelW = 26;
  const colLabelH = 16;
  const zoneGap = 32;

  const bins: Bin[] = [];
  const zones: ZoneBox[] = [];
  let cursorX = pad;
  const top = pad;

  ZONE_DEFS.forEach((d, zi) => {
    const gridW = d.cols.length * cell + (d.cols.length - 1) * gap;
    const gridH = d.rows.length * cell + (d.rows.length - 1) * gap;
    const zoneW = pad + rowLabelW + gridW + pad;
    const zoneH = header + colLabelH + gridH + pad;

    const zx = cursorX;
    const zy = top;
    const gridX = zx + pad + rowLabelW;
    const gridY = zy + header + colLabelH;

    zones.push({
      name: d.name,
      letter: d.letter,
      x: zx,
      y: zy,
      w: zoneW,
      h: zoneH,
      colLabels: d.cols,
      rowLabels: d.rows,
      gridX,
      gridY,
      cell,
      gap,
    });

    d.rows.forEach((rLabel, r) => {
      d.cols.forEach((cLabel, c) => {
        bins.push({
          id: `z${zi}-r${r}-c${c}`,
          label: `${rLabel}·${cLabel}`,
          zone: d.name,
          sku: SKUS[(zi * 7 + r * 3 + c) % SKUS.length],
          fillPct: seededFill(zi, r, c),
          x: gridX + c * (cell + gap),
          y: gridY + r * (cell + gap),
          w: cell,
          h: cell,
        });
      });
    });

    cursorX += zoneW + zoneGap;
  });

  return { bins, zones };
}

export function binTone(bin: Pick<Bin, 'fillPct'>): { fill: string; text: string } {
  const p = bin.fillPct;
  if (p === 0) return { fill: '#e2e8f0', text: '#94a3b8' };
  if (p > 1) return { fill: '#ef4444', text: '#ffffff' };
  if (p > 0.95) return { fill: '#fbbf24', text: '#78350f' };
  if (p > 0.5) return { fill: '#34d399', text: '#064e3b' };
  return { fill: '#a7f3d0', text: '#065f46' };
}

export function binValue(bin: Pick<Bin, 'fillPct'>, mode: ViewMode): string {
  if (bin.fillPct === 0) return '';
  return mode === 'fill' ? String(Math.round(bin.fillPct * 100)) : String(Math.round(bin.fillPct * 24));
}

export const FILL_LEGEND = [
  { c: '#e2e8f0', l: 'Empty' },
  { c: '#a7f3d0', l: '<50%' },
  { c: '#34d399', l: '50–95%' },
  { c: '#fbbf24', l: '95–100%' },
  { c: '#ef4444', l: 'Over' },
];
