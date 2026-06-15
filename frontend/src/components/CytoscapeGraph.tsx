import { useEffect, useRef, useState } from 'react';
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
  ink700: '#1e2a36', ink500: '#5b6976', ink300: '#8b97a3', ink200: '#aab4bd',
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
    // per-relation edge colors (ports dashboard.js, recoloured to light)
    edge('wasGeneratedBy', C.blue600), edge('used', C.cyan600),
    edge('wasDerivedFrom', C.blue400, { 'line-style': 'dashed', width: 2 }),
    edge('partOf', C.ink200, { 'line-style': 'dotted', 'target-arrow-shape': 'none', label: '' }),
    edge('justifies', C.amber600, { width: 2 }),
    edge('satisfies', C.green600, { width: 2.6 }),
    edge('violates', C.red600, { width: 2.6 }),
    edge('verifies', '#3f8f7a', { width: 2 }),
    edge('assesses', C.cyan600, { width: 2 }),
    edge('informs', C.green600), edge('decides', '#8a6fc4'),
    edge('cross_tool', '#d97a2e', { 'line-style': 'dashed' }),
    // plan-detail relations
    edge('acts_on', C.blue400, { width: 2.4 }), edge('bounds', C.green600),
    edge('traces_to', '#8a6fc4', { 'line-style': 'dotted' }),
    edge('flow_to', '#c0801f', { width: 2.4 }), edge('has_architecture', C.amber600),
  ];
}

function edge(relation: string, color: string, extra: Record<string, unknown> = {}): StyleRule {
  return {
    selector: `edge[relation="${relation}"]`,
    style: { 'line-color': color, 'target-arrow-color': color, ...extra },
  };
}

// -- legend (per graph style) -----------------------------------------------

const LEGENDS: Record<string, { label: string; color: string }[]> = {
  provenance: [
    { label: 'satisfies', color: C.green600 },
    { label: 'violates', color: C.red600 },
    { label: 'verifies', color: '#3f8f7a' },
    { label: 'justifies', color: C.amber600 },
    { label: 'assesses', color: C.cyan600 },
  ],
  session: [
    { label: 'used', color: C.cyan600 },
    { label: 'generated', color: C.blue600 },
    { label: 'decides', color: '#8a6fc4' },
  ],
  plan_detail: [
    { label: 'plan', color: C.blue700 },
    { label: 'design var', color: C.green600 },
    { label: 'constraint', color: C.amber600 },
    { label: 'objective', color: C.blue600 },
    { label: 'decision', color: '#9a5d10' },
  ],
};

export function GraphLegend({ graphStyle = 'provenance' }: { graphStyle?: GraphStyle }) {
  const items = LEGENDS[graphStyle] ?? LEGENDS.provenance;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: '8px 0' }}>
      {items.map((l) => (
        <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--ink-400)' }}>
          <span style={{ width: 14, height: 2.5, background: l.color, borderRadius: 1 }} />
          {l.label}
        </span>
      ))}
    </div>
  );
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
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);

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
    cy.on('tap', 'node', (evt) => {
      const node = evt.target;
      setSelected(node.data());
      onSelect?.(node.id(), node.data());
    });
    cy.on('tap', (evt) => { if (evt.target === cy) setSelected(null); });
    cy.fit(undefined, 24);
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [graph, graphStyle, onSelect]);

  return (
    <div style={{ position: 'relative', width: '100%', height, background: C.panel, borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
      <div ref={ref} style={{ width: '100%', height: '100%' }} />
      {selected ? <NodeInspector data={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

function NodeInspector({ data, onClose }: { data: Record<string, unknown>; onClose: () => void }) {
  const entries = Object.entries(data).filter(
    ([k, v]) => k !== 'id' && k !== 'label' && v !== null && v !== undefined && v !== '',
  );
  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, width: 280, maxWidth: '70%', height: '100%',
      background: 'var(--app-panel)', borderLeft: '1px solid var(--app-line)',
      boxShadow: 'var(--shadow-sm)', overflowY: 'auto', zIndex: 2,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--app-line)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-700)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {String((data.label as string) || data.id || 'node').split('\n')[0]}
        </span>
        <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-400)' }}>close</button>
      </div>
      <div style={{ padding: '10px 14px' }}>
        {entries.map(([k, v]) => (
          <div key={k} style={{ marginBottom: 10 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--ink-300)', marginBottom: 3 }}>{k}</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-700)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
              {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
