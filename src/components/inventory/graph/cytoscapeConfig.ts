import cytoscape, { type StylesheetStyle, type LayoutOptions } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { SkuGraphMode } from './types';

// Register the dagre layout extension exactly once (module-level guard).
let registered = false;
export function ensureCytoscapeExtensions() {
  if (registered) return;
  cytoscape.use(dagre);
  registered = true;
}

/** Units at or below this count get the low-stock visual override. */
export const LOW_STOCK_THRESHOLD = 3;

// Tier palette (canvas-rendered, so literal hex — not Tailwind tokens).
const TIER_FILL: Record<string, string> = {
  system: '#faf5ff', // purple-50
  assembly: '#f0fdfa', // teal-50
  component: '#fffbeb', // amber-50
};
const TIER_BORDER: Record<string, string> = {
  system: '#9333ea', // purple-600
  assembly: '#0d9488', // teal-600
  component: '#d97706', // amber-600
};

export const stylesheet: StylesheetStyle[] = [
  {
    selector: 'node',
    style: {
      label: 'data(label)',
      'text-wrap': 'wrap',
      'text-max-width': '140px',
      'text-valign': 'center',
      'text-halign': 'center',
      'font-size': '11px',
      'font-weight': 500,
      color: '#1f2937', // gray-800
      'background-color': (n: cytoscape.NodeSingular) => TIER_FILL[n.data('tier')] ?? '#f9fafb',
      'border-color': (n: cytoscape.NodeSingular) => TIER_BORDER[n.data('tier')] ?? '#9ca3af',
      'border-width': 1.5,
      shape: 'round-rectangle',
      width: 'label',
      height: 'label',
      padding: '12px',
    } as cytoscape.Css.Node,
  },
  {
    // Low stock override — amber-200 fill / amber-800 border.
    selector: 'node[?lowStock]',
    style: {
      'background-color': '#fde68a',
      'border-color': '#92400e',
    },
  },
  {
    // Parts-graph pairing state (only the parts view sets `reviewState`; the
    // relationship graph's nodes omit it, so these selectors never match there).
    selector: "node[reviewState = 'confirmed']",
    style: {
      'background-color': '#dcfce7', // emerald-100
      'border-color': '#059669', // emerald-600
    },
  },
  {
    selector: "node[reviewState = 'not_a_part']",
    style: {
      'background-color': '#f3f4f6', // gray-100
      'border-color': '#9ca3af', // gray-400
      'border-style': 'dashed',
      color: '#9ca3af',
    } as cytoscape.Css.Node,
  },
  {
    selector: 'node:selected, node[?focused]',
    style: {
      'border-width': 3,
      'border-color': '#2563eb', // blue-600
      'font-weight': 700,
    } as cytoscape.Css.Node,
  },
  {
    selector: 'edge',
    style: {
      width: 1.5,
      'line-color': '#cbd5e1', // slate-300
      'target-arrow-color': '#cbd5e1',
      'target-arrow-shape': 'triangle',
      'curve-style': 'bezier',
      label: (e: cytoscape.EdgeSingular) => {
        const qty = e.data('qty');
        return qty && qty > 1 ? `×${qty}` : '';
      },
      'font-size': '10px',
      color: '#64748b', // slate-500
      'text-background-color': '#ffffff',
      'text-background-opacity': 1,
      'text-background-padding': '2px',
    } as cytoscape.Css.Edge,
  },
];

export function layoutFor(mode: SkuGraphMode): LayoutOptions {
  if (mode === 'tree') {
    return {
      name: 'dagre',
      rankDir: 'TB',
      nodeSep: 50,
      rankSep: 90,
      padding: 40,
      animate: true,
      animationDuration: 250,
    } as LayoutOptions;
  }
  if (mode === 'children') {
    return {
      name: 'breadthfirst',
      directed: true,
      padding: 50,
      spacingFactor: 1.3,
      animate: true,
      animationDuration: 250,
    } as LayoutOptions;
  }
  // parents — invert breadthfirst so parents sit above the focused node.
  return {
    name: 'breadthfirst',
    directed: true,
    padding: 50,
    spacingFactor: 1.3,
    animate: true,
    animationDuration: 250,
  } as LayoutOptions;
}
