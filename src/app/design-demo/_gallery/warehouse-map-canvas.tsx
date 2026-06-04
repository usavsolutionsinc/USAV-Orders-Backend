'use client';

/**
 * Interactive warehouse map — react-konva canvas.
 *
 * The static HTML-table map (src/components/warehouse/WarehouseMap.tsx) drawn on
 * a real 2D canvas so bins become first-class objects you can:
 *   • drag    — grab a bin to reposition it (grab empty space to pan the map)
 *   • resize  — select a bin, drag the corner/edge handles to expand/shrink
 *   • trace   — turn on Trace and click a bin to light up every other bin that
 *               holds the same SKU, with arrows drawn across zones
 *   • zoom    — scroll to zoom toward the cursor
 *
 * Konva paints on a raw canvas and can't read CSS variables, so theme colors are
 * sampled from the live design-system tokens via getComputedStyle and re-read
 * whenever the showroom's light/dark switch flips.
 *
 * Shares layout + tones with the React Flow version via ./warehouse-map-data.
 *
 * Client-only: konva touches `window`, so this module is loaded through
 * next/dynamic({ ssr: false }) from warehouse-map-section.tsx.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Stage, Layer, Rect, Group, Text, Transformer, Arrow } from 'react-konva';
import type Konva from 'konva';
import type { Density } from './sections';
import {
  type Bin,
  type ViewMode,
  buildLayout,
  binTone,
  binValue,
  FILL_LEGEND,
  MIN_SIZE,
  ACCENT,
} from './warehouse-map-data';

/* ────────────────────────────── theme ─────────────────────────────────── */

interface ThemeColors {
  canvas: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
}

function readThemeColors(el: HTMLElement): ThemeColors {
  const cs = getComputedStyle(el);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    canvas: v('--ds-color-background-canvas', '#f8fafc'),
    surface: v('--ds-color-background-surface', '#ffffff'),
    border: v('--ds-color-border-subtle', '#e2e8f0'),
    text: v('--ds-color-text-primary', '#0f172a'),
    muted: v('--ds-color-text-secondary', '#64748b'),
  };
}

/* ──────────────────────────── component ───────────────────────────────── */

export function WarehouseMapCanvas({ density }: { density: Density }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);

  const initial = useMemo(() => buildLayout(density), [density]);
  const [bins, setBins] = useState<Bin[]>(initial.bins);
  const zones = initial.zones;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>('fill');
  const [traceOn, setTraceOn] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [size, setSize] = useState({ w: 0, h: 520 });
  const [colors, setColors] = useState<ThemeColors>({
    canvas: '#f8fafc', surface: '#ffffff', border: '#e2e8f0', text: '#0f172a', muted: '#64748b',
  });

  // Re-seed positions when density changes (cell size shifts the whole grid).
  useEffect(() => {
    setBins(initial.bins);
    setSelectedId(null);
  }, [initial]);

  // Measure container width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setSize((s) => (Math.abs(s.w - w) > 1 ? { ...s, w } : s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Sample theme tokens now and on every light/dark flip.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const sync = () => setColors(readThemeColors(el));
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  // Keep the transformer bound to the current selection.
  useEffect(() => {
    const tr = trRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const node = selectedId ? stage.findOne<Konva.Node>(`#${selectedId}`) : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, bins, mode, density, view]);

  const updateBin = useCallback((id: string, patch: Partial<Bin>) => {
    setBins((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const reset = useCallback(() => {
    setBins(initial.bins);
    setSelectedId(null);
    setView({ x: 0, y: 0, scale: 1 });
  }, [initial]);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const old = view.scale;
    const dir = e.evt.deltaY > 0 ? -1 : 1;
    const next = Math.min(2.4, Math.max(0.4, old * (1 + dir * 0.12)));
    const mouse = { x: (pointer.x - view.x) / old, y: (pointer.y - view.y) / old };
    setView({ scale: next, x: pointer.x - mouse.x * next, y: pointer.y - mouse.y * next });
  }, [view]);

  const selected = bins.find((b) => b.id === selectedId) ?? null;

  // Trace network: bins sharing the selected bin's SKU.
  const traced = useMemo(() => {
    if (!traceOn || !selected) return { ids: new Set<string>(), arrows: [] as number[][] };
    const ids = new Set<string>();
    const arrows: number[][] = [];
    const sx = selected.x + selected.w / 2;
    const sy = selected.y + selected.h / 2;
    for (const b of bins) {
      if (b.sku !== selected.sku) continue;
      ids.add(b.id);
      if (b.id !== selected.id) {
        arrows.push([sx, sy, b.x + b.w / 2, b.y + b.h / 2]);
      }
    }
    return { ids, arrows };
  }, [traceOn, selected, bins]);

  const fontSize = density === 'compact' ? 10 : density === 'comfortable' ? 13 : 11;

  return (
    <div ref={containerRef} className="w-full">
      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-0.5 rounded-lg bg-surface-canvas p-0.5 ring-1 ring-border-soft">
          {(['fill', 'qty'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                mode === m ? 'bg-surface-card text-text-default shadow-sm ring-1 ring-border-soft' : 'text-text-muted hover:text-text-default'
              }`}
            >
              {m === 'fill' ? 'Fill %' : 'Qty'}
            </button>
          ))}
        </div>

        <button
          onClick={() => setTraceOn((v) => !v)}
          aria-pressed={traceOn}
          className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ring-1 transition-colors ${
            traceOn ? 'bg-blue-500/[0.12] text-blue-600 ring-blue-500/25' : 'bg-surface-card text-text-muted ring-border-soft hover:text-text-default'
          }`}
        >
          {traceOn ? 'Trace · on' : 'Trace'}
        </button>

        <button
          onClick={reset}
          className="rounded-lg bg-surface-card px-2.5 py-1 text-[11px] font-semibold text-text-muted ring-1 ring-border-soft transition-colors hover:text-text-default"
        >
          Reset
        </button>

        <span className="ml-auto text-[11px] text-text-muted">
          {selected
            ? traceOn
              ? `${selected.sku} · ${traced.ids.size} bin${traced.ids.size === 1 ? '' : 's'}`
              : `${selected.label} · ${selected.sku}`
            : 'Drag a bin · scroll to zoom · drag empty space to pan'}
        </span>
      </div>

      {/* canvas */}
      <div className="overflow-hidden rounded-xl ring-1 ring-border-soft" style={{ background: colors.canvas }}>
        {size.w > 0 && (
          <Stage
            ref={stageRef}
            width={size.w}
            height={size.h}
            x={view.x}
            y={view.y}
            scaleX={view.scale}
            scaleY={view.scale}
            draggable
            onWheel={handleWheel}
            onDragEnd={(e) => {
              // only the stage drag (pan) updates the view
              if (e.target === stageRef.current) {
                setView((v) => ({ ...v, x: e.target.x(), y: e.target.y() }));
              }
            }}
            onMouseDown={(e) => {
              if (e.target === e.target.getStage()) setSelectedId(null);
            }}
            onTouchStart={(e) => {
              if (e.target === e.target.getStage()) setSelectedId(null);
            }}
          >
            {/* zones + labels */}
            <Layer listening={false}>
              {zones.map((z) => (
                <Group key={z.name}>
                  <Rect
                    x={z.x}
                    y={z.y}
                    width={z.w}
                    height={z.h}
                    cornerRadius={16}
                    fill={colors.surface}
                    stroke={colors.border}
                    strokeWidth={1}
                  />
                  <Text x={z.x + 16} y={z.y + 11} text={z.name} fontStyle="bold" fontSize={13} fill={colors.text} />
                  <Text
                    x={z.x + z.w - 30}
                    y={z.y + 11}
                    width={16}
                    align="center"
                    text={z.letter}
                    fontStyle="bold"
                    fontSize={11}
                    fill={ACCENT}
                  />
                  {z.colLabels.map((c, ci) => (
                    <Text
                      key={c}
                      x={z.gridX + ci * (z.cell + z.gap)}
                      y={z.gridY - 14}
                      width={z.cell}
                      align="center"
                      text={c}
                      fontSize={9}
                      fontStyle="bold"
                      fill={colors.muted}
                    />
                  ))}
                  {z.rowLabels.map((r, ri) => (
                    <Text
                      key={r}
                      x={z.x + 14}
                      y={z.gridY + ri * (z.cell + z.gap) + z.cell / 2 - 5}
                      text={r}
                      fontSize={9}
                      fontStyle="bold"
                      fill={colors.muted}
                    />
                  ))}
                </Group>
              ))}
            </Layer>

            {/* trace arrows */}
            <Layer listening={false}>
              {traced.arrows.map((pts, i) => (
                <Arrow
                  key={i}
                  points={pts}
                  stroke={ACCENT}
                  fill={ACCENT}
                  strokeWidth={2}
                  opacity={0.7}
                  pointerLength={7}
                  pointerWidth={7}
                  dash={[6, 4]}
                />
              ))}
            </Layer>

            {/* bins */}
            <Layer>
              {bins.map((bin) => {
                const tone = binTone(bin);
                const isSel = bin.id === selectedId;
                const isTraced = traced.ids.has(bin.id);
                const value = binValue(bin, mode);
                return (
                  <Group
                    key={bin.id}
                    id={bin.id}
                    x={bin.x}
                    y={bin.y}
                    draggable
                    onClick={() => setSelectedId(bin.id)}
                    onTap={() => setSelectedId(bin.id)}
                    onDragStart={() => setSelectedId(bin.id)}
                    onDragEnd={(e) => updateBin(bin.id, { x: e.target.x(), y: e.target.y() })}
                    onTransformEnd={(e) => {
                      const node = e.target as Konva.Group;
                      const sx = node.scaleX();
                      const sy = node.scaleY();
                      node.scaleX(1);
                      node.scaleY(1);
                      updateBin(bin.id, {
                        x: node.x(),
                        y: node.y(),
                        w: Math.max(MIN_SIZE, bin.w * sx),
                        h: Math.max(MIN_SIZE, bin.h * sy),
                      });
                    }}
                  >
                    <Rect
                      width={bin.w}
                      height={bin.h}
                      cornerRadius={8}
                      fill={tone.fill}
                      stroke={isSel || isTraced ? ACCENT : 'transparent'}
                      strokeWidth={isSel ? 3 : isTraced ? 2 : 0}
                      shadowColor={ACCENT}
                      shadowBlur={isTraced && !isSel ? 8 : 0}
                      shadowOpacity={0.4}
                    />
                    {value && (
                      <Text
                        width={bin.w}
                        height={bin.h}
                        align="center"
                        verticalAlign="middle"
                        text={value}
                        fontSize={fontSize}
                        fontStyle="bold"
                        fill={tone.text}
                        listening={false}
                      />
                    )}
                  </Group>
                );
              })}

              <Transformer
                ref={trRef}
                rotateEnabled={false}
                keepRatio={false}
                anchorSize={8}
                anchorCornerRadius={4}
                borderStroke={ACCENT}
                anchorStroke={ACCENT}
                boundBoxFunc={(oldBox, newBox) => {
                  if (newBox.width < MIN_SIZE || newBox.height < MIN_SIZE) return oldBox;
                  return newBox;
                }}
              />
            </Layer>
          </Stage>
        )}
      </div>

      {/* legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {FILL_LEGEND.map((i) => (
          <span key={i.l} className="flex items-center gap-1.5 text-[11px] text-text-muted">
            <span className="h-3 w-3 rounded" style={{ background: i.c }} />
            {i.l}
          </span>
        ))}
      </div>
    </div>
  );
}
