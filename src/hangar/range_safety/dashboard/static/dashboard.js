/* Analysis State Dashboard -- thin client.
 *
 * htmx (loaded in the shell) swaps server-rendered fragments into #view.
 * A single htmx:afterSwap handler hydrates the interactive pieces inside the
 * freshly-swapped fragment: Cytoscape graphs and plot galleries. Graph
 * fragments carry a `data-cy` style mode and embed Cytoscape-native elements
 * ({nodes:[{data}], edges:[{data}]}) produced by the shared element builders,
 * so the dashboard renders the same execution graph the tool viewers show.
 * Cytoscape + dagre are CDN globals from the shell.
 */
(function () {
  "use strict";

  if (window.cytoscape && window.cytoscapeDagre) {
    cytoscape.use(window.cytoscapeDagre);
  }

  var BASE_NODE = {
    label: "data(label)", "text-wrap": "wrap", "text-max-width": "130px",
    "font-size": 10, "text-valign": "center", "text-halign": "center",
    "border-width": 2, color: "#cfe0ff",
  };

  // Provenance style: mirrors hangar.omd.provenance / the SDK viewer so the
  // dashboard graphs match the tool viewers. Keyed off the normalized `kind`.
  function kindStyle(bg, border, extra) {
    var s = Object.assign({}, BASE_NODE, {"background-color": bg, "border-color": border});
    return Object.assign(s, extra || {});
  }
  var PROVENANCE_STYLE = [
    {selector: 'node', style: kindStyle("#111828", "#3a4a6a")},
    {selector: 'node[kind="plan"]', style: kindStyle("#0d1f3c", "#4a9eff", {color: "#a0ccff"})},
    {selector: 'node[kind="run_record"]', style: kindStyle("#0a1e2e", "#3ac8fa", {color: "#80d8ff"})},
    {selector: 'node[kind="assessment"]', style: kindStyle("#0a2a20", "#2ad0a0", {color: "#70e8c0"})},
    {selector: 'node[kind="surface_def"]', style: kindStyle("#0a1828", "#70b8ff", {"font-size": 9})},
    {selector: 'node[kind="operating_point"]', style: kindStyle("#0a1820", "#50c0f0", {"font-size": 9})},
    {selector: 'node[kind="solver_config"]', style: kindStyle("#101820", "#5080a0", {"font-size": 9})},
    {selector: 'node[kind="opt_setup"]', style: kindStyle("#0a1820", "#40d0e0", {"font-size": 9})},
    {selector: 'node[kind="aero_results"]', style: kindStyle("#0a2018", "#30c090", {"font-size": 9})},
    {selector: 'node[kind="struct_results"]', style: kindStyle("#0a1820", "#40a0b0", {"font-size": 9})},
    {selector: 'node[kind="convergence_info"]', style: kindStyle("#101820", "#6080a0", {"font-size": 9})},
    {selector: 'node[kind="model_structure"]', style: kindStyle("#101420", "#5070a0", {"font-size": 9})},
    {selector: 'node[kind="phase"]', style: kindStyle("#140a2a", "#a080e0")},
    {selector: 'node[kind="requirement"]', style: kindStyle("#0a1a2e", "#80a8e0", {color: "#a8c8ff"})},
    {selector: 'node[kind="requirement"][status="verified"]', style: {"border-color": "#40d080", "border-width": 3}},
    {selector: 'node[kind="requirement"][status="violated"]', style: {"border-color": "#e05050", "border-width": 3}},
    {selector: 'node[kind="requirement"][status="waived"]', style: {"border-color": "#808080", "border-style": "dashed"}},
    {selector: 'node[kind="decision"]', style: kindStyle("#2a2010", "#e0b040", {color: "#f0d080", "font-size": 11, "text-max-width": "220px", padding: "8px"})},
    {selector: 'node[kind="tool_call"]', style: kindStyle("#10283a", "#4a9eda", {shape: "round-rectangle", width: 130, height: 36, color: "#cfe8ff"})},
    {selector: 'node[kind="activity"]', style: kindStyle("#0e1a2e", "#5a8abf")},
    {selector: 'node[status="failed"]', style: {"border-width": 3, "border-color": "#ff4a4a", "background-color": "#2a0a0a"}},
    {selector: 'node:selected', style: {"border-width": 3, "border-color": "#9ab0ff"}},
    {selector: 'edge', style: {
      width: 2, "line-color": "#2a3a5a", "target-arrow-color": "#2a3a5a",
      "target-arrow-shape": "triangle", "curve-style": "bezier",
      label: "data(label)", "font-size": 8, color: "#5a6a8a", "text-rotation": "autorotate",
    }},
    {selector: 'edge[relation="wasGeneratedBy"]', style: {"line-color": "#3080d0", "target-arrow-color": "#3080d0"}},
    {selector: 'edge[relation="used"]', style: {"line-color": "#2a90a0", "target-arrow-color": "#2a90a0"}},
    {selector: 'edge[relation="wasDerivedFrom"]', style: {"line-style": "dashed", "line-dash-pattern": [6, 3], "line-color": "#5a80c0", "target-arrow-color": "#5a80c0", width: 2.5}},
    {selector: 'edge[relation="partOf"]', style: {width: 1, "line-style": "dotted", "line-dash-pattern": [2, 4], "line-color": "#1e2a40", "target-arrow-color": "#1e2a40", "target-arrow-shape": "none", label: ""}},
    {selector: 'edge[relation="justifies"]', style: {"line-color": "#c08030", "target-arrow-color": "#c08030", width: 2.5}},
    {selector: 'edge[relation="satisfies"]', style: {"line-color": "#40c080", "target-arrow-color": "#40c080", width: 3}},
    {selector: 'edge[relation="violates"]', style: {"line-color": "#e05050", "target-arrow-color": "#e05050", width: 3}},
    {selector: 'edge[relation="verifies"]', style: {"line-color": "#609088", "target-arrow-color": "#609088", width: 2.5}},
    {selector: 'edge[relation="informs"]', style: {"line-color": "#5aaa5a", "target-arrow-color": "#5aaa5a"}},
    {selector: 'edge[relation="decides"]', style: {"line-color": "#9a6add", "target-arrow-color": "#9a6add"}},
    {selector: 'edge[relation="cross_tool"]', style: {"line-style": "dashed", "line-color": "#ff9a3a", "target-arrow-color": "#ff9a3a"}},
  ];

  // Study graph: one node per member plan, colored by current state.
  var STATE_COLORS = {
    gather_requirements: ["#1a1230", "#a080e0"], planning: ["#0d1f3c", "#4a9eff"],
    executing: ["#0a1e2e", "#3ac8fa"], verifying: ["#2a2010", "#e0b040"],
    concluding: ["#0a2a20", "#40d080"],
  };
  var STUDY_STYLE = [
    {selector: 'node', style: Object.assign({}, BASE_NODE, {shape: "round-rectangle", width: 140, height: 40, "background-color": "#101828", "border-color": "#3a4a6a"})},
  ].concat(Object.keys(STATE_COLORS).map(function (st) {
    return {selector: 'node[current_state="' + st + '"]',
            style: {"background-color": STATE_COLORS[st][0], "border-color": STATE_COLORS[st][1]}};
  })).concat([
    {selector: 'node:selected', style: {"border-width": 3, "border-color": "#9ab0ff"}},
    {selector: 'edge', style: {width: 2, "line-style": "dashed", "line-dash-pattern": [6, 3],
      "line-color": "#5a80c0", "target-arrow-color": "#5a80c0", "target-arrow-shape": "triangle",
      "curve-style": "bezier", label: "data(label)", "font-size": 8, color: "#5a6a8a"}},
  ]);

  function styleFor(mode) { return mode === "study" ? STUDY_STYLE : PROVENANCE_STYLE; }
  function layoutFor(mode) {
    var name = window.cytoscapeDagre ? "dagre" : "breadthfirst";
    if (mode === "study") return {name: name, rankDir: "LR", nodeSep: 30, rankSep: 70};
    return {name: name, rankDir: "TB", nodeSep: 40, rankSep: 80, edgeSep: 10};
  }

  // -- side panel ----------------------------------------------------------
  function showPanel(title, dataObj) {
    var panel = document.getElementById("panel");
    if (!panel) return;
    document.getElementById("panel-title").textContent = title;
    var body = document.getElementById("panel-body");
    body.innerHTML = "";
    Object.keys(dataObj).forEach(function (k) {
      if (k === "id" || k === "label" || dataObj[k] === null || dataObj[k] === undefined || dataObj[k] === "") return;
      var v = dataObj[k];
      var isObj = typeof v === "object";
      var row = document.createElement("div");
      row.className = "kv";
      row.innerHTML = '<div class="key">' + escapeHtml(k) + "</div>" +
        (isObj ? "<pre>" + escapeHtml(JSON.stringify(v, null, 2)) + "</pre>"
               : '<div class="val">' + escapeHtml(String(v)) + "</div>");
      body.appendChild(row);
    });
    panel.classList.add("open");
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c];
    });
  }

  function bindPanelClose() {
    var btn = document.getElementById("panel-close");
    if (btn && !btn._bound) {
      btn._bound = true;
      btn.addEventListener("click", function () {
        document.getElementById("panel").classList.remove("open");
      });
    }
  }

  // -- cytoscape graph -----------------------------------------------------
  function renderGraph(container, mode, graph) {
    var nodes = (graph && graph.nodes) || [];
    var edges = (graph && graph.edges) || [];
    if (!nodes.length) {
      container.innerHTML = '<div class="empty">No graph data for this view.</div>';
      return;
    }
    // Defensive: drop edges whose endpoints are absent (Cytoscape throws otherwise).
    var ids = {};
    nodes.forEach(function (n) { ids[n.data.id] = true; });
    edges = edges.filter(function (e) { return ids[e.data.source] && ids[e.data.target]; });

    var cy = cytoscape({
      container: container,
      elements: {nodes: nodes, edges: edges},
      style: styleFor(mode),
      layout: layoutFor(mode),
      wheelSensitivity: 0.2,
    });
    cy.on("tap", "node", function (evt) {
      var d = evt.target.data();
      showPanel(d.label ? String(d.label).split("\n")[0] : d.id, d);
    });
  }

  // -- plot gallery --------------------------------------------------------
  function renderGallery(container) {
    var runId = container.getAttribute("data-run-id");
    var types = JSON.parse(container.getAttribute("data-types") || "[]");
    if (!types.length) {
      container.innerHTML = '<div class="empty">No plot types available for this run ' +
        "(no rendered artifact, or plot backend not installed).</div>";
      return;
    }
    var sel = document.createElement("select");
    types.forEach(function (t) {
      var o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o);
    });
    var controls = document.createElement("div");
    controls.className = "plot-controls";
    controls.appendChild(document.createTextNode("Plot type: "));
    controls.appendChild(sel);
    var imgWrap = document.createElement("div");
    var note = document.createElement("div");

    function load(t) {
      note.textContent = "";
      var img = new Image();
      img.className = "plot-img";
      img.alt = t;
      img.onerror = function () {
        imgWrap.innerHTML = "";
        note.className = "plot-error";
        note.textContent = "Plot '" + t + "' could not be rendered for this run.";
      };
      img.onload = function () { imgWrap.innerHTML = ""; imgWrap.appendChild(img); };
      img.src = "/api/plots/" + encodeURIComponent(runId) + "/" + encodeURIComponent(t);
    }
    sel.addEventListener("change", function () { load(sel.value); });
    container.innerHTML = "";
    container.appendChild(controls);
    container.appendChild(imgWrap);
    container.appendChild(note);
    load(types[0]);
  }

  // -- hydration scan ------------------------------------------------------
  function hydrate(root) {
    bindPanelClose();
    var panel = document.getElementById("panel");
    var graphs = root.querySelectorAll("[data-cy]");
    if (panel && !graphs.length) panel.classList.remove("open");
    graphs.forEach(function (c) {
      var mode = c.getAttribute("data-cy");
      var jsonEl = document.getElementById(c.getAttribute("data-json"));
      var graph = jsonEl ? JSON.parse(jsonEl.textContent) : {nodes: [], edges: []};
      renderGraph(c, mode, graph);
    });
    root.querySelectorAll("[data-plot-gallery]").forEach(renderGallery);
  }

  function bindNav() {
    var nav = document.getElementById("nav");
    if (!nav || nav._bound) return;
    nav._bound = true;
    nav.addEventListener("click", function (evt) {
      var link = evt.target.closest("a.nav-link");
      if (!link || link.classList.contains("disabled")) return;
      nav.querySelectorAll("a.nav-link").forEach(function (a) { a.classList.remove("active"); });
      link.classList.add("active");
    });
  }

  document.body.addEventListener("htmx:afterSwap", function (evt) {
    hydrate(evt.detail.target);
  });
  document.addEventListener("DOMContentLoaded", function () {
    bindNav();
    hydrate(document);
  });
})();
