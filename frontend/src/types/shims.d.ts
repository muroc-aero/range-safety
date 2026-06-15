// cytoscape-dagre ships no types; it registers a layout extension via
// cytoscape.use(). We only need the default export to pass to use().
declare module 'cytoscape-dagre' {
  const ext: unknown;
  export default ext;
}
