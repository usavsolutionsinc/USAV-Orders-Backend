'use client';

import { useEffect, useRef } from 'react';
import cytoscape, { type Core, type ElementDefinition } from 'cytoscape';
import { ensureCytoscapeExtensions, layoutFor, stylesheet } from './cytoscapeConfig';
import type { SkuGraphMode } from './types';

interface SkuGraphCanvasProps {
  elements: ElementDefinition[];
  mode: SkuGraphMode;
  /** Currently highlighted node id (string of sku_id). */
  selectedId: string | null;
  onNodeSelect: (skuId: number) => void;
  /** Double-click / tap re-centers the whole graph on that node. */
  onNodeRecenter: (skuId: number) => void;
}

export function SkuGraphCanvas({
  elements,
  mode,
  selectedId,
  onNodeSelect,
  onNodeRecenter,
}: SkuGraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  // Keep the latest callbacks without re-binding listeners on every render.
  const selectCb = useRef(onNodeSelect);
  const recenterCb = useRef(onNodeRecenter);
  selectCb.current = onNodeSelect;
  recenterCb.current = onNodeRecenter;

  // Mount once.
  useEffect(() => {
    ensureCytoscapeExtensions();
    if (!containerRef.current) return;
    const cy = cytoscape({
      container: containerRef.current,
      style: stylesheet,
      elements: [],
      minZoom: 0.2,
      maxZoom: 2.5,
      wheelSensitivity: 0.2,
    });
    cyRef.current = cy;

    cy.on('tap', 'node', (evt) => {
      const id = Number(evt.target.id());
      if (Number.isFinite(id)) selectCb.current(id);
    });
    cy.on('dbltap', 'node', (evt) => {
      const id = Number(evt.target.id());
      if (Number.isFinite(id)) recenterCb.current(id);
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, []);

  // Sync elements + relayout on data/mode change.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.json({ elements });
    const layout = cy.layout(layoutFor(mode));
    layout.run();
    cy.fit(undefined, 40);
  }, [elements, mode]);

  // Reflect external selection.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().unselect();
    if (selectedId) {
      const node = cy.getElementById(selectedId);
      if (node.nonempty()) node.select();
    }
  }, [selectedId, elements]);

  return <div ref={containerRef} className="h-full w-full" />;
}
