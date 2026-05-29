/* Analysis State Dashboard -- thin client.
 *
 * htmx (loaded in the shell) swaps server-rendered fragments into #view.
 * This script hydrates the interactive pieces inside a freshly-swapped
 * fragment: Cytoscape graphs (plan / study / reasoning) and the plot
 * gallery. It binds no view-specific logic inline -- a single
 * htmx:afterSwap handler scans the swapped node for components to wire,
 * so adding a view needs no JS change unless it introduces a new
 * component kind. Cytoscape + dagre are CDN globals from the shell.
 */
(function () {
  "use strict";

  if (window.cytoscape && window.cytoscapeDagre) {
    cytoscape.use(window.cytoscapeDagre);
  }

  // -- palette (mirrors the provenance viewer) -----------------------------
  var ENTITY_COLORS = {
    plan: "#2a4a7f", run_record: "#1a3a5a", assessment: "#3a2a55",
    decision: "#2a2a10", requirement: "#15321f", observation: "#28304a",
    surface_def: "#1f3a3a", operating_point: "#243a2a", solver_config: "#33304a",
    opt_setup: "#3a3320"
  };
  var STATE_COLORS = {
    gather_requirements: "#3a2a55", planning: "#2a4a7f", executing: "#1a3a5a",
    verifying: "#3a3320", concluding: "#15321f"
  };
  var RELATION_COLORS = {
    satisfies: "#5aaa5a", violates: "#d05a5a", verifies: "#5a8aff",
    justifies: "#9a6add", wasDerivedFrom: "#e0a060", derived_from: "#e0a060"
  };
  var DEFAULT_NODE = "#23263a";
  var DEFAULT_EDGE = "#6070a0";

  function colorForEntity(t) { return ENTITY_COLORS[t] || DEFAULT_NODE; }
  function colorForState(s) { return STATE_COLORS[s] || DEFAULT_NODE; }
  function colorForRelation(r) { return RELATION_COLORS[r] || DEFAULT_EDGE; }

  // -- side panel ----------------------------------------------------------
  function showPanel(title, dataObj) {
    var panel = document.getElementById("panel");
    var header = document.getElementById("panel-title");
    var body = document.getElementById("panel-body");
    if (!panel) return;
    header.textContent = title;
    body.innerHTML = "";
    Object.keys(dataObj).forEach(function (k) {
      if (k === "id" || dataObj[k] === null || dataObj[k] === undefined) return;
      var v = dataObj[k];
      var row = document.createElement("div");
      row.className = "kv";
      var isObj = typeof v === "object";
      row.innerHTML = '<div class="key">' + escapeHtml(k) + "</div>" +
        (isObj ? "<pre>" + escapeHtml(JSON.stringify(v, null, 2)) + "</pre>"
               : '<div class="val">' + escapeHtml(String(v)) + "</div>");
      body.appendChild(row);
    });
    panel.classList.add("open");
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
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

  // -- cytoscape graph builders --------------------------------------------
  function buildElements(kind, data) {
    var els = [];
    (data.nodes || []).forEach(function (n) {
      var label, color;
      if (kind === "study") {
        label = n.plan_id + (n.version != null ? " v" + n.version : "");
        color = colorForState(n.current_state);
      } else {
        label = n.label || n.id;
        color = colorForEntity(n.entity_type);
      }
      els.push({
        group: "nodes",
        data: Object.assign({}, n, { id: n.id, _label: label, _color: color })
      });
    });
    (data.edges || data.lineage || []).forEach(function (e, i) {
      var src = e.source, tgt = e.target;
      if (src == null || tgt == null) return;
      els.push({
        group: "edges",
        data: {
          id: "e" + i, source: src, target: tgt,
          _label: e.relation || "derived_from",
          _color: colorForRelation(e.relation || "derived_from")
        }
      });
    });
    return els;
  }

  function renderGraph(container, kind, data) {
    var els = buildElements(kind, data);
    if (!els.length) {
      container.innerHTML = '<div class="empty">No graph data for this view yet.</div>';
      return;
    }
    var cy = cytoscape({
      container: container,
      elements: els,
      style: [
        {
          selector: "node",
          style: {
            shape: kind === "reasoning" ? "round-rectangle" : "ellipse",
            width: kind === "study" ? 130 : 44, height: kind === "study" ? 40 : 44,
            label: "data(_label)", "font-size": 10, color: "#e0e8ff",
            "text-valign": "center", "text-halign": "center",
            "text-wrap": "ellipsis", "text-max-width": 120,
            "background-color": "data(_color)", "border-width": 1.5,
            "border-color": "#5a6080"
          }
        },
        { selector: "node:selected", style: { "border-width": 3, "border-color": "#7ab8ff" } },
        {
          selector: "edge",
          style: {
            "curve-style": "taxi", "target-arrow-shape": "triangle", "arrow-scale": 1.1,
            "line-color": "data(_color)", "target-arrow-color": "data(_color)",
            label: "data(_label)", "font-size": 9, color: "#888",
            "text-rotation": "autorotate", width: 2
          }
        }
      ],
      layout: { name: window.cytoscapeDagre ? "dagre" : "cose", rankDir: "LR", nodeSep: 30, rankSep: 60 }
    });
    cy.on("tap", "node", function (evt) {
      var d = evt.target.data();
      var clean = {};
      Object.keys(d).forEach(function (k) { if (k[0] !== "_") clean[k] = d[k]; });
      showPanel(d._label, clean);
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
    // graph views own the side panel; tabular views hide it
    if (panel) {
      if (graphs.length) { /* leave state to node clicks */ }
      else { panel.classList.remove("open"); }
    }
    graphs.forEach(function (c) {
      var kind = c.getAttribute("data-cy");
      var jsonEl = document.getElementById(c.getAttribute("data-json"));
      var data = jsonEl ? JSON.parse(jsonEl.textContent) : {};
      renderGraph(c, kind, data);
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
