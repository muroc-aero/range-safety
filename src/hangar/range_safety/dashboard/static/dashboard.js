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

  // Round-rectangle nodes with explicit sizes, mirroring the omd viewer
  // (default node shape is an ellipse, which is why the graph looked wrong).
  var BASE_NODE = {
    shape: "round-rectangle", width: 110, height: 32,
    label: "data(label)", "text-wrap": "wrap", "text-max-width": "100px",
    "font-size": 9, "text-valign": "center", "text-halign": "center",
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
    {selector: 'node[kind="plan"]', style: kindStyle("#0d1f3c", "#4a9eff", {color: "#a0ccff", width: 140, height: 40, "font-size": 10, "text-max-width": "130px"})},
    {selector: 'node[kind="run_record"]', style: kindStyle("#0a1e2e", "#3ac8fa", {color: "#80d8ff", width: 140, height: 40, "font-size": 10, "text-max-width": "130px"})},
    {selector: 'node[kind="assessment"]', style: kindStyle("#0a2a20", "#2ad0a0", {color: "#70e8c0", width: 120, height: 36, "font-size": 10, "text-max-width": "110px"})},
    {selector: 'node[kind="surface_def"]', style: kindStyle("#0a1828", "#70b8ff", {width: 120, height: 32, "text-max-width": "110px"})},
    {selector: 'node[kind="operating_point"]', style: kindStyle("#0a1820", "#50c0f0", {width: 100, height: 30, "text-max-width": "90px"})},
    {selector: 'node[kind="solver_config"]', style: kindStyle("#101820", "#5080a0", {width: 100, height: 30, "text-max-width": "90px"})},
    {selector: 'node[kind="opt_setup"]', style: kindStyle("#0a1820", "#40d0e0", {width: 120, height: 32, "text-max-width": "110px"})},
    {selector: 'node[kind="aero_results"]', style: kindStyle("#0a2018", "#30c090", {width: 100, height: 32})},
    {selector: 'node[kind="struct_results"]', style: kindStyle("#0a1820", "#40a0b0", {width: 110, height: 32})},
    {selector: 'node[kind="convergence_info"]', style: kindStyle("#101820", "#6080a0", {width: 110, height: 32})},
    {selector: 'node[kind="model_structure"]', style: kindStyle("#101420", "#5070a0", {width: 110, height: 32})},
    {selector: 'node[kind="phase"]', style: kindStyle("#140a2a", "#a080e0", {width: 120, height: 34})},
    {selector: 'node[kind="requirement"]', style: kindStyle("#0a1a2e", "#80a8e0", {color: "#a8c8ff", width: 120, height: 36, "text-max-width": "110px"})},
    {selector: 'node[kind="requirement"][status="verified"]', style: {"border-color": "#40d080", "border-width": 3}},
    {selector: 'node[kind="requirement"][status="violated"]', style: {"border-color": "#e05050", "border-width": 3}},
    {selector: 'node[kind="requirement"][status="waived"]', style: {"border-color": "#808080", "border-style": "dashed"}},
    {selector: 'node[kind="decision"]', style: kindStyle("#2a2010", "#e0b040", {color: "#f0d080", "font-size": 11, width: 240, height: 90, "text-max-width": "220px", padding: "8px"})},
    {selector: 'node[kind="tool_call"]', style: kindStyle("#10283a", "#4a9eda", {width: 130, height: 36, "font-size": 10, color: "#cfe8ff"})},
    {selector: 'node[kind="activity"]', style: kindStyle("#0e1a2e", "#5a8abf", {width: 120, height: 34})},
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
    {selector: 'edge[relation="assesses"]', style: {"line-color": "#3ac8fa", "target-arrow-color": "#3ac8fa", width: 2.5}},
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

  // Plan-detail style: the omd /omd-plan-detail palette, keyed on node_type
  // (the plan/problem structure graph from build_plan_graph).
  var PLAN_DETAIL_COLORS = {
    plan: [160, 44, "#0d1f3c", "#4a9eff"], surface: [120, 36, "#0a1828", "#70b8ff"],
    material: [110, 32, "#1a1028", "#a080c0"], fem_model: [100, 28, "#101820", "#5080a0"],
    mesh: [100, 28, "#0e1828", "#6090b0"], flight_condition: [130, 36, "#0a1820", "#50c0f0"],
    solver: [130, 36, "#101820", "#5080a0"], linear_solver: [100, 28, "#101820", "#406080"],
    objective: [120, 32, "#0a1820", "#40d0e0"], design_variable: [120, 32, "#0a1828", "#50a0f0"],
    constraint: [120, 32, "#0a2018", "#30c090"], requirement: [130, 32, "#1a0a20", "#a060c0"],
    aircraft_config: [140, 40, "#0a1a1a", "#40b0a0"], mission_profile: [130, 36, "#0a1820", "#40b8d0"],
    propulsion_architecture: [120, 32, "#1a1408", "#c08830"], slot_provider: [130, 36, "#14081a", "#9060c0"],
    engine_config: [150, 44, "#1a1008", "#d09030"], engine_element: [110, 30, "#1a1408", "#b8a040"],
    surrogate_deck: [130, 36, "#081a1a", "#3090a0"],
  };
  var PLAN_DETAIL_STYLE = [
    {selector: 'node', style: Object.assign({}, BASE_NODE, {"background-color": "#111828", "border-color": "#3a4a6a"})},
  ].concat(Object.keys(PLAN_DETAIL_COLORS).map(function (t) {
    var c = PLAN_DETAIL_COLORS[t];
    return {selector: 'node[node_type="' + t + '"]',
            style: {width: c[0], height: c[1], "background-color": c[2], "border-color": c[3],
                    "text-max-width": (c[0] - 16) + "px"}};
  })).concat([
    {selector: 'node[node_type="decision"]', style: {shape: "hexagon", width: 110, height: 55, "background-color": "#1a1808", "border-color": "#d0a030", color: "#f0d080"}},
    {selector: 'node:selected', style: {"border-width": 3, "border-color": "#9ab0ff"}},
    {selector: 'edge', style: {width: 2, "line-color": "#2a3a5a", "target-arrow-color": "#2a3a5a", "target-arrow-shape": "triangle", "curve-style": "bezier"}},
    {selector: 'edge[relation="acts_on"]', style: {width: 3, "line-color": "#50a0f0", "target-arrow-color": "#50a0f0"}},
    {selector: 'edge[relation="bounds"]', style: {"line-color": "#30c090", "target-arrow-color": "#30c090"}},
    {selector: 'edge[relation="justifies"]', style: {"line-style": "dashed", "line-color": "#d0a030", "target-arrow-color": "#d0a030"}},
    {selector: 'edge[relation="traces_to"]', style: {"line-style": "dotted", "line-color": "#a060c0", "target-arrow-color": "#a060c0"}},
    {selector: 'edge[relation="flow_to"]', style: {width: 3, "line-color": "#c09030", "target-arrow-color": "#c09030"}},
    {selector: 'edge[relation="has_architecture"]', style: {"line-color": "#c08830", "target-arrow-color": "#c08830"}},
  ]);

  function styleFor(mode) {
    if (mode === "study") return STUDY_STYLE;
    if (mode === "plan_detail") return PLAN_DETAIL_STYLE;
    return PROVENANCE_STYLE;  // provenance / session (tool_call + decision)
  }
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
    root.querySelectorAll("[data-cy]").forEach(function (c) {
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
    var target = evt.detail.target;
    hydrate(target);
    // Close the node inspector only when a main view (without a graph) loads;
    // not on the periodic state-strip poll, which would otherwise dismiss it.
    if (target && target.id === "view") {
      var panel = document.getElementById("panel");
      if (panel && !target.querySelector("[data-cy]")) panel.classList.remove("open");
    }
  });
  document.addEventListener("DOMContentLoaded", function () {
    bindNav();
    hydrate(document);
  });
})();
