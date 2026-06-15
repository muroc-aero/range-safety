import { useEffect, useRef } from 'react';
import cytoscape from 'cytoscape';
import type { Core, ElementDefinition } from 'cytoscape';
import dagre from 'cytoscape-dagre';
import type { Graph, GraphStyle } from '../api/types';

/** One `{ selector, style }` rule. Cytoscape's exported style union changes
    across @types versions, so we keep a loose local shape and cast at the
    call site. */
type StyleRule = { selector: string; style: Record<string, unknown> };

/* Data-driven provenance / plan / reasoning graph.

   Replaces ui_kits/range-safety/ProvenanceGraph.jsx (a hardcoded SVG of one
   run) with a real Cytoscape + dagre renderer fed by the API's
   Cytoscape-native elements. The kind-keyed style map mirrors the server's
   dashboard.js styling but recoloured into the Instrument LIGHT palette:
   white nodes, hairline borders, blueprint blue + signal green accents,
   IBM Plex Mono labels. Cytoscape styles cannot read CSS vars, so token
   values are inlined here (kept in sync with tokens/colors.css). */

cytoscape.use(dagre as never);

// -- palette (mirrors tokens/colors.css; cytoscape needs concrete values) ---
const C = {
  panel: '#ffffff', subtle: '#f6f8fa', line: '#dbe1e7',
  ink700: '#1e2a36', ink500: '#5b6976', ink300: '#8b97a3',
  blue700: '#15487a', blue600: '#1b5e9e', blue400: '#3b82c4', blue50: '#eaf1f8',
  green700: '#197a43', green600: '#1f9d55', green50: '#e7f4ec',
  cyan600: '#1f8aa8', cyan50: '#e2f1f5',
  amber600: '#e08a1e', amber50: '#fbefd9',
  red600: '#d14b3c', red50: '#f8e6e3',
};

const BASE_NODE: Record<string, unknown> = {
  shape: 'round-rectangle', width: 116, height: 34,
  label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': '104px',
  'font-family': 'IBM Plex Mono, monospace', 'font-size': 9,
  'text-valign': 'center', 'text-halign': 'center',
  'border-width': 1, color: C.ink700,
  'background-color': C.panel, 'border-color': C.line,
};

function kind(bg: string, border: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...BASE_NODE, 'background-color': bg, 'border-color': border, ...extra };
}

function buildStylesheet(): StyleRule[] {
  return [
    { selector: 'node', style: BASE_NODE as never },
    // plan / problem structure
    { selector: 'node[kind="plan"]', style: kind(C.blue50, C.blue700, { color: C.blue700, width: 150, height: 42, 'font-size': 10, 'font-weight': 600, 'text-max-width': '138px' }) as never },
    { selector: 'node[kind="component"]', style: kind(C.panel, C.blue400, { 'text-max-width': '104px' }) as never },
    { selector: 'node[kind="surface_def"]', style: kind(C.panel, C.blue400) as never },
    { selector: 'node[kind="operating_point"]', style: kind(C.panel, C.cyan600, { width: 104 }) as never },
    { selector: 'node[kind="solver_config"]', style: kind(C.subtle, C.ink300, { width: 104 }) as never },
    { selector: 'node[kind="opt_setup"]', style: kind(C.panel, C.cyan600) as never },
    { selector: 'node[kind="design_variable"]', style: kind(C.green50, C.green600, { color: C.green700 }) as never },
    { selector: 'node[kind="constraint"]', style: kind(C.amber50, C.amber600) as never },
    { selector: 'node[kind="objective"]', style: kind(C.blue50, C.blue600, { color: C.blue700 }) as never },
    // execution / provenance
    { selector: 'node[kind="run_record"]', style: kind(C.panel, C.cyan600, { color: C.ink700, width: 150, height: 42, 'font-size': 10, 'font-weight': 600, 'text-max-width': '138px' }) as never },
    { selector: 'node[kind="activity"]', style: kind(C.subtle, C.ink300) as never },
    { selector: 'node[kind="tool_call"]', style: kind(C.blue50, C.blue400, { color: C.blue700, width: 132, 'font-size': 9.5 }) as never },
    { selector: 'node[kind="aero_results"]', style: kind(C.green50, C.green600, { color: C.green700 }) as never },
    { selector: 'node[kind="struct_results"]', style: kind(C.panel, C.cyan600) as never },
    { selector: 'node[kind="convergence_info"]', style: kind(C.subtle, C.ink500) as never },
    { selector: 'node[kind="model_structure"]', style: kind(C.subtle, C.ink500) as never },
    { selector: 'node[kind="assessment"]', style: kind(C.green50, C.green600, { color: C.green700, width: 124, height: 38, 'font-weight': 600 }) as never },
    // reasoning
    { selector: 'node[kind="phase"]', style: kind('#f1edf9', '#8a6fc4') as never },
    { selector: 'node[kind="requirement"]', style: kind(C.blue50, C.blue600, { color: C.blue700, width: 128, height: 40 }) as never },
    { selector: 'node[kind="requirement"][status="verified"]', style: { 'border-color': C.green600, 'border-width': 2.5 } as never },
    { selector: 'node[kind="requirement"][status="violated"]', style: { 'border-color': C.red600, 'border-width': 2.5 } as never },
    { selector: 'node[kind="requirement"][status="waived"]', style: { 'border-color': C.ink300, 'border-style': 'dashed' } as never },
    { selector: 'node[kind="decision"]', style: kind(C.amber50, C.amber600, { color: '#9a5d10', 'font-size': 9.5, width: 220, height: 80, 'text-max-width': '200px', 'text-valign': 'center', padding: '8px' }) as never },
    { selector: 'node[kind="conclusion"]', style: kind(C.green50, C.green600, { color: C.green700, 'font-size': 10, width: 150, height: 44, 'font-weight': 600 }) as never },
    { selector: 'node[kind="conclusion"][verdict="fails"]', style: { 'background-color': C.red50, 'border-color': C.red600, color: C.red600 } as never },
    { selector: 'node[kind="conclusion"][verdict="partial"]', style: { 'background-color': C.amber50, 'border-color': C.amber600 } as never },
    // study members carry a lifecycle state, not a kind accent
    { selector: 'node[kind="study_member"]', style: kind(C.panel, C.blue400, { width: 140, height: 40 }) as never },
    { selector: 'node[current_state="gather_requirements"]', style: { 'background-color': '#f1edf9', 'border-color': '#8a6fc4' } as never },
    { selector: 'node[current_state="planning"]', style: { 'background-color': C.blue50, 'border-color': C.blue700 } as never },
    { selector: 'node[current_state="executing"]', style: { 'background-color': C.cyan50, 'border-color': C.cyan600 } as never },
    { selector: 'node[current_state="verifying"]', style: { 'background-color': C.amber50, 'border-color': C.amber600 } as never },
    { selector: 'node[current_state="concluding"]', style: { 'background-color': C.green50, 'border-color': C.green600 } as never },
    // failure / selection
    { selector: 'node[status="failed"]', style: { 'border-width': 2.5, 'border-color': C.red600, 'background-color': C.red50 } as never },
    { selector: 'node:selected', style: { 'border-width': 2.5, 'border-color': C.blue700 } as never },
    // edges
    {
      selector: 'edge',
      style: {
        width: 1.4, 'curve-style': 'bezier',
        'line-color': C.line, 'target-arrow-color': C.ink300,
        'target-arrow-shape': 'triangle', 'arrow-scale': 0.85,
        label: 'data(label)', 'font-family': 'IBM Plex Mono, monospace',
        'font-size': 7.5, color: C.ink300, 'text-rotation': 'autorotate',
        'text-background-color': C.panel, 'text-background-opacity': 0.85,
        'text-background-padding': '1px',
      } as never,
    },
  ];
}

function layoutFor(style: GraphStyle): cytoscape.LayoutOptions {
  // plan-detail reads left-to-right (problem structure); provenance / reasoning
  // read top-to-bottom (lineage over time).
  const rankDir = style === 'plan_detail' || style === 'study' ? 'LR' : 'TB';
  return {
    name: 'dagre',
    rankDir,
    nodeSep: 26,
    rankSep: 46,
    edgeSep: 12,
    padding: 18,
    animate: false,
  } as unknown as cytoscape.LayoutOptions;
}

export interface CytoscapeGraphProps {
  graph: Graph;
  graphStyle?: GraphStyle;
  height?: number | string;
  onSelect?: (nodeId: string, data: Record<string, unknown>) => void;
}

export function CytoscapeGraph({ graph, graphStyle = 'provenance', height = 460, onSelect }: CytoscapeGraphProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const elements: ElementDefinition[] = [
      ...graph.nodes.map((n) => ({ group: 'nodes' as const, data: n.data })),
      ...graph.edges.map((e) => ({ group: 'edges' as const, data: e.data })),
    ];
    const cy = cytoscape({
      container: ref.current,
      elements,
      style: buildStylesheet() as never,
      layout: layoutFor(graphStyle),
      wheelSensitivity: 0.2,
      maxZoom: 2.5,
      minZoom: 0.2,
    });
    cyRef.current = cy;
    if (onSelect) {
      cy.on('tap', 'node', (evt) => {
        const node = evt.target;
        onSelect(node.id(), node.data());
      });
    }
    cy.fit(undefined, 24);
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph, graphStyle, onSelect]);

  return (
    <div
      ref={ref}
      style={{
        width: '100%', height, background: C.panel,
        borderRadius: 'var(--radius-sm)',
      }}
    />
  );
}
