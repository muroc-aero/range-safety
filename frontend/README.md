# range-safety dashboard — SPA

React 18 + Vite + TypeScript single-page app for the V&V study viewer. It is
the dashboard's primary UI, built in the Lakeside AI **Instrument** (App)
surface from the `lakesideai-design` system. It talks only to the dashboard's
read-model JSON API (`/api/*`); there is no separate backend.

## Architecture

```
src/
  design/            ported lakesideai-design system (App surface)
    styles.css         token + font entry (@imports tokens/, fonts/)
    tokens/ fonts/     copied verbatim from the design skill
    components/        17 primitives ported JSX -> typed TSX
                       core / forms / data / brand
    index.ts           barrel: imports styles.css, re-exports primitives
  api/
    types.ts           TS projection of the ReadModel JSON contract
    client.ts          typed fetch wrappers over /api/* (+ ApiError 401/403)
  shell/
    AppShell.tsx       54px top bar + 64px Lucide rail, wraps <Outlet/>
    currentStudy.tsx   last-opened study (rail + breadcrumb), sessionStorage
  routes/
    StudyList.tsx      landing grid (/api/studies, source + substring filter)
    StudyViewer.tsx    sticky header + tabs: results / formulation /
                       decisions / plots / provenance
    ProvenanceView.tsx full-screen provenance graph
    ServersView.tsx    data-source inventory (derived from the study list)
  components/
    CytoscapeGraph.tsx data-driven provenance/plan/reasoning graph, Cytoscape
                       + dagre restyled to the light palette
    Feedback.tsx       loading / error / auth (401/403) / empty states
  lib/                 keys, lifecycle labels, formulation extraction
```

The provenance graph is a **real renderer** (Cytoscape + dagre over the API's
Cytoscape-native elements), not the design kit's static SVG mock; its
kind-keyed style map mirrors the server's `dashboard.js` recoloured into the
Instrument light palette.

## Develop

```bash
npm install
# run a dashboard backend on :8000 in another terminal:
#   cd packages/range-safety && uvicorn hangar.range_safety.dashboard.app:app --port 8000
npm run dev          # vite dev server, proxies /api -> :8000
```

Point the proxy elsewhere with `RS_DASHBOARD_BACKEND=http://host:port npm run dev`.

## Build

```bash
npm run build        # tsc -b && vite build
```

Output is written to `../src/hangar/range_safety/dashboard/static/spa/` (Vite
`base: /static/spa/`). The Starlette app serves `index.html` at `/` and for
client-side routes; assets resolve under the `/static/spa/` mount. The build
output is gitignored and produced by the Docker `frontend` stage (or this
command). When it is absent, the dashboard falls back to the legacy
server-rendered htmx shell, so a source checkout still works without Node.
```
