import { createMeshWorld } from "./webgl-world.js";

const svgNS = "http://www.w3.org/2000/svg";
const state = {
  model: null,
  selectedId: null,
  zoom: 1,
  events: 0,
  currentJob: null,
  currentJobKind: null,
  source: null,
  dragId: null,
  mode: "2d",
  history: [],
  future: [],
  editMode: true,
  camera: { x: -12, y: -18, zoom: 1 },
  hanaCapabilities: [],
  pendingTool: null,
  meshWorld: null,
  deepDiveWorld: null,
  interiorWorld: null,
  lensWorld: null,
  activeLens: null,
  session: null,
  interiorTool: null,
  previousView: "2d",
  robotScenarios: [],
  activeRobotScenario: null,
  activeGrafcetStep: null,
  activeGrafcetTransition: null,
  grafcetVisited: new Set(),
  robotManualIndex: 0
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

const lensProfiles = {
  vector: { visual: "reactor", engine: "Vector similarity", query: "Find the three assets most similar to PRESS-03 by maintenance-event embedding.", description: "Explore embedding similarity, nearest-neighbor retrieval, and AI-enriched asset context." },
  spatial: { visual: "warehouse", engine: "Spatial proximity", query: "Find production assets within 50 meters of the quality gate in plant MX-01.", description: "Inspect plant geometry, routes, asset proximity, and spatial containment." },
  "property-graph": { visual: "tower", engine: "Property graph traversal", query: "Traverse Asset → Work Order → Lot → Control for the current exception.", description: "Follow operational relationships and execute bounded graph traversals." },
  "knowledge-graph": { visual: "pavilion", engine: "Knowledge graph semantics", query: "Explain how OEE, availability, assets, and controls are semantically related.", description: "Inspect business meaning, ontology relationships, and reusable semantic context." },
  json: { visual: "crate", engine: "JSON document query", query: "Extract asset id, signal kind, value, and unit from the latest event documents.", description: "Query flexible operational payloads without changing their source documents." }
};

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
}

function snapshotModel() {
  return structuredClone(state.model);
}

function nodeById(id) {
  return state.model.nodes.find((node) => node.id === id);
}

function svgText(parent, x, y, value, className) {
  const text = document.createElementNS(svgNS, "text");
  text.setAttribute("x", x);
  text.setAttribute("y", y);
  text.setAttribute("class", className);
  text.textContent = value;
  parent.appendChild(text);
}

function modelNodeWidth() {
  return state.model?.layout?.includes("campus") ? 142 : 178;
}

function shortLabel(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function renderModel() {
  if (!state.model) return;
  $("#model-name").textContent = state.model.name;
  $("#model-version").textContent = `v${state.model.version}`;
  const svg = $("#model-canvas"), nodeWidth = modelNodeWidth(), campusLayout = state.model.layout?.includes("campus");
  svg.setAttribute("viewBox", "0 0 1120 650");
  svg.replaceChildren();
  const markerDefs = document.createElementNS(svgNS, "defs");
  const marker = document.createElementNS(svgNS, "marker");
  marker.setAttribute("id", "arrow"); marker.setAttribute("viewBox", "0 0 10 10"); marker.setAttribute("refX", "9"); marker.setAttribute("refY", "5"); marker.setAttribute("markerWidth", "5"); marker.setAttribute("markerHeight", "5"); marker.setAttribute("orient", "auto-start-reverse");
  const arrow = document.createElementNS(svgNS, "path"); arrow.setAttribute("d", "M 0 0 L 10 5 L 0 10 z"); arrow.setAttribute("fill", "#587393"); marker.appendChild(arrow); markerDefs.appendChild(marker); svg.appendChild(markerDefs);

  for (const [fromId, toId] of state.model.edges) {
    const from = nodeById(fromId); const to = nodeById(toId);
    if (!from || !to) continue;
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", from.x + nodeWidth); line.setAttribute("y1", from.y + 34); line.setAttribute("x2", to.x); line.setAttribute("y2", to.y + 34); line.setAttribute("class", `edge${from.zone !== to.zone ? " cross-zone" : ""}`); line.setAttribute("marker-end", "url(#arrow)");
    svg.appendChild(line);
  }

  for (const node of state.model.nodes) {
    const group = document.createElementNS(svgNS, "g");
    group.setAttribute("class", `node-group${state.selectedId === node.id ? " selected" : ""}`); group.dataset.id = node.id;
    const rect = document.createElementNS(svgNS, "rect"); rect.setAttribute("x", node.x); rect.setAttribute("y", node.y); rect.setAttribute("width", nodeWidth); rect.setAttribute("height", 68); rect.setAttribute("rx", 7); rect.setAttribute("fill", `${node.color}20`); rect.setAttribute("stroke", `${node.color}b8`); rect.setAttribute("stroke-width", 1);
    const stripe = document.createElementNS(svgNS, "rect"); stripe.setAttribute("x", node.x); stripe.setAttribute("y", node.y); stripe.setAttribute("width", 4); stripe.setAttribute("height", 68); stripe.setAttribute("rx", 2); stripe.setAttribute("fill", node.color);
    group.append(rect, stripe);
    svgText(group, node.x + 14, node.y + 25, shortLabel(node.name, campusLayout ? 20 : 28), "node-label");
    svgText(group, node.x + 14, node.y + 45, shortLabel(node.subtitle, campusLayout ? 24 : 34), "node-subtitle");
    svgText(group, node.x + nodeWidth - 21, node.y + 20, String(node.z).padStart(2, "0"), "node-subtitle");
    group.addEventListener("pointerdown", (event) => startDrag(event, node.id));
    group.addEventListener("click", (event) => { event.stopPropagation(); state.selectedId = node.id; renderModel(); renderInspector(); });
    svg.appendChild(group);
  }

  render3d();
}

function render3d() {
  if (!state.meshWorld || !state.model) return;
  state.meshWorld.setModel(state.model);
  state.meshWorld.setSelected(state.selectedId);
  const zoneLabels = $("#scene-zone-labels"), platformCount = state.model.nodes.filter((node) => node.zone === "platform").length, robotCount = state.model.nodes.filter((node) => node.layer === "robotics").length;
  if (zoneLabels) {
    zoneLabels.classList.toggle("hidden", state.model.layout !== "unified-campus");
    if (state.model.layout === "unified-campus") zoneLabels.innerHTML = `<span><b>SAP BUSINESS DATA CLOUD</b>${platformCount} platform objects</span><i>CONNECTED DIGITAL THREAD</i><span><b>PHYSICAL EXECUTION</b>${robotCount} physical assets</span>`;
  }
}

function renderInspector() {
  const target = state.selectedId ? nodeById(state.selectedId) : null;
  const lenses = state.hanaCapabilities.map((lens) => `<button class="lens-chip" data-lens-id="${lens.id}" style="--lens:${lens.color}" title="${lens.detail}"><span></span>${lens.name}</button>`).join("");
  const miniScene = `<div class="inspector-visual"><div class="mini-world"><div class="mini-object ${target?.visual || "tower"}" style="--structure-color:${target?.color || "#2f80ed"}"></div><span>${target ? target.name : "Data fabric control room"}</span></div></div>`;
  if (!target) {
    $("#inspector-title").textContent = "Model Health";
    $("#inspector-content").innerHTML = `
      ${miniScene}
      <div class="health-score"><strong>98</strong><span>safe readiness<br />demo score</span></div>
      <div class="inspector-section"><h3>Runtime guardrails</h3>
        <div class="key-value"><span>Tenant access</span><b style="color:var(--green)">Disabled</b></div>
        <div class="key-value"><span>Production writes</span><b style="color:var(--green)">Denied</b></div>
        <div class="key-value"><span>Edition</span><b style="color:var(--blue)">${state.editMode ? "Editable model" : "View only"}</b></div>
      </div>
      <div class="inspector-section"><h3>In-memory data lenses</h3><div class="lens-list">${lenses}</div></div>
      <div class="inspector-section"><h3>Model composition</h3>
        <div class="key-value"><span>DES objects</span><b>${state.model.nodes.length}</b></div>
        <div class="key-value"><span>Connections</span><b>${state.model.edges.length}</b></div>
        <div class="key-value"><span>Versioning</span><b>In-memory snapshot</b></div>
      </div>`;
    return;
  }
  $("#inspector-title").textContent = target.name;
  $("#inspector-content").innerHTML = `
    ${miniScene}
    <div class="health-score"><strong style="color:${target.color}">${target.z}</strong><span>semantic layer<br />object depth</span></div>
    <div class="inspector-section"><h3>Semantic object</h3>
      <div class="key-value"><span>Type</span><b>${target.kind}</b></div>
      <div class="key-value"><span>Subtitle</span><b>${target.subtitle}</b></div>
      <div class="key-value"><span>Position</span><b>${Math.round(target.x)}, ${Math.round(target.y)}, ${target.z}</b></div>
    </div>
    <div class="inspector-section"><h3>DES behavior</h3>
      <div class="key-value"><span>Capacity</span><b>${target.capacity} resources</b></div>
      <div class="bar-row"><div><span>Configured service time</span><b>${target.service} units</b></div><div class="bar"><i style="width:${Math.min(100, target.service * 12)}%;background:${target.color}"></i></div></div>
    </div>
    <div class="inspector-section"><h3>Safety scope</h3>
      <div class="key-value"><span>Write scope</span><b style="color:var(--green)">None in demo</b></div>
      <div class="key-value"><span>Evidence</span><b>Audit event required</b></div>
    </div>
    <div class="inspector-section"><h3>Data lenses</h3><div class="lens-list">${lenses}</div></div>`;
}

function startDrag(event, id) {
  if (event.button !== 0) return;
  if (!state.editMode) { showToast("Turn on Edit Mode to rearrange the model."); return; }
  state.dragId = id;
  state.selectedId = id;
  event.preventDefault();
  document.addEventListener("pointermove", dragMove);
  document.addEventListener("pointerup", endDrag, { once: true });
}

function dragMove(event) {
  if (!state.dragId) return;
  const svg = $("#model-canvas");
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  const node = nodeById(state.dragId);
  node.x = Math.max(8, Math.min(1100 - modelNodeWidth(), point.x - modelNodeWidth() / 2));
  node.y = Math.max(8, Math.min(570, point.y - 34));
  renderModel();
}

async function endDrag() {
  document.removeEventListener("pointermove", dragMove);
  if (!state.dragId) return;
  state.dragId = null;
  await saveModel(false);
}

const objectDefinitions = {
  source: { kind: "source", visual: "warehouse", name: "New SAP LoB Source", subtitle: "S/4HANA, EWM, or Digital Manufacturing event source", color: "#31506a", capacity: 2, service: 3 },
  process: { kind: "bdc", visual: "tower", name: "New SAP BDC Service", subtitle: "Governed business-data and process service", color: "#40566a", capacity: 2, service: 4 },
  data: { kind: "data", visual: "crate", name: "New SAP Data Product", subtitle: "Business context for agent and robot execution", color: "#66589c", capacity: 3, service: 4 },
  audit: { kind: "audit", visual: "gate", name: "New Governance Control", subtitle: "Accountability and evidence checkpoint", color: "#814b5b", capacity: 1, service: 2 },
  gate: { kind: "audit", visual: "gate", name: "New Human Approval Gate", subtitle: "Physical-action approval checkpoint", color: "#c7893e", capacity: 1, service: 2 },
  agent: { kind: "agent", visual: "robot", name: "New Joule Agent", subtitle: "Bounded business-to-robot handoff", color: "#1e6d64", capacity: 2, service: 3 }
};

const interiorProfiles = {
  source: { system: "SAP S/4HANA / EWM Source Cockpit", role: "Transactional source", description: "Orders, master data, work orders, inventory, and asset events enter the simulation here.", tabs: ["Overview", "Catalog", "APIs", "Events"] },
  process: { system: "SAP BDC Cockpit", role: "Orchestration service", description: "Install data packages, run pre-flight checks, monitor pipelines, and activate governed content.", tabs: ["Cockpit", "SQL Console", "SQL Analyzer", "PAL HGBT", "Graph Viewer", "Catalog"] },
  data: { system: "SAP Datasphere Data Product Studio", role: "Semantic data layer", description: "Model the business meaning of data, expose contracts, trace lineage, and prepare operational insight.", tabs: ["Semantic Model", "Vector", "Spatial", "JSON", "Graph", "API Contract"] },
  audit: { system: "SAP Governance Control Room", role: "Evidence and controls", description: "Inspect control coverage, exceptions, approvals, and the evidence emitted by every simulated action.", tabs: ["Controls", "Evidence", "Exceptions", "Lineage"] },
  gate: { system: "Physical Action Safety Gate", role: "Policy checkpoint", description: "Enforce read-only mock mode, approval requirements, tenant boundaries, and simulation release policy.", tabs: ["Policy", "Approvals", "Simulation"] },
  agent: { system: "Joule Agent Workbench", role: "Bounded specialist", description: "Plan actions, inspect tools, route work, and show the guardrails that constrain automated operations.", tabs: ["Plan", "Tools", "Guardrails", "Trace"] }
};

const codeSnippet = (text, language = "SQL") => `<div class="code-toolbar"><span>${language}</span><button data-interface-action="format">Format</button><button data-interface-action="execute">Run background</button></div><pre class="code-editor">${text}</pre>`;
const tablePreview = (headers, rows) => `<div class="result-table"><div class="result-row result-head">${headers.map((header) => `<span>${header}</span>`).join("")}</div>${rows.map((row) => `<div class="result-row">${row.map((cell) => `<span>${cell}</span>`).join("")}</div>`).join("")}</div>`;

function interfaceContent(tool, tab) {
  const common = {
    Overview: `<div class="interface-cards"><article><small>ACTIVE FLOWS</small><strong>18</strong><span>source-to-insight paths</span></article><article><small>HEALTH</small><strong class="good">99.2%</strong><span>mock pipeline availability</span></article><article><small>QUEUE DEPTH</small><strong>24</strong><span>entities awaiting work</span></article></div><div class="interface-panel"><h4>Operational context</h4><p>Production orders, inventory, maintenance events, and quality signals are mapped into a governed simulation route.</p><div class="status-line"><span class="status-check">●</span> Read-only source boundary verified <b>PASS</b></div><div class="status-line"><span class="status-check">●</span> Data contract available <b>PASS</b></div></div>`,
    Catalog: `<div class="ide-layout"><div class="catalog-tree"><b>CATALOG</b><span>▾ BUSINESS_SCHEMA</span><span>　▸ ORDERS</span><span>　▸ ASSETS</span><span>　▸ WORK_ORDERS</span><span>　▸ QUALITY_EVENTS</span><span>▸ VIEWS</span><span>▸ PROCEDURES</span></div><div class="interface-panel"><h4>WORK_ORDERS</h4>${tablePreview(["ID", "ASSET", "STATUS"], [["WO-1042", "LINE-07", "READY"], ["WO-1043", "ROBOT-12", "RUNNING"], ["WO-1044", "PRESS-03", "QUEUED"]])}</div></div>`,
    APIs: `<div class="interface-panel"><h4>Source interface registry</h4><div class="api-row"><b>OData / JSON</b><span class="api-state">connected · mock</span><button data-interface-action="test">Test</button></div><div class="api-row"><b>REST / XML</b><span class="api-state">connected · mock</span><button data-interface-action="test">Test</button></div><div class="api-row"><b>MQTT / OPC UA</b><span class="api-state">edge gateway</span><button data-interface-action="test">Test</button></div></div>`,
    Events: `<div class="event-stream"><div><b>asset.temperature</b><span>LINE-07 · 72.4°C</span><em>now</em></div><div><b>workorder.created</b><span>WO-1044 · PRESS-03</span><em>0.4s</em></div><div><b>quality.check</b><span>LOT-9001 · accepted</span><em>1.2s</em></div></div>`
  };
  if (tool === "source") return common[tab] || common.Overview;
  if (tool === "process") {
    if (tab === "Cockpit") return `<div class="interface-cards"><article><small>DATA PACKAGES</small><strong>12</strong><span>8 active · 4 staged</span></article><article><small>PREFLIGHT</small><strong class="good">PASS</strong><span>0 missing objects</span></article><article><small>PIPELINES</small><strong>07</strong><span>2 running · 5 idle</span></article></div><div class="interface-panel"><h4>Activation queue</h4><div class="activation-row"><span class="package-icon">◈</span><b>Maintenance Intelligence</b><span>ready to activate</span><button data-interface-action="activate">Activate</button></div><div class="activation-row"><span class="package-icon">◈</span><b>Production Quality</b><span>pre-flight passed</span><button data-interface-action="activate">Activate</button></div></div>`;
    if (tab === "SQL Console") return `<div class="ide-layout"><div class="catalog-tree"><b>DATABASE EXPLORER</b><span>▾ SQL CONSOLES</span><span>　▸ WORKSPACE_01</span><span>　▸ WORKSPACE_02</span><span>▾ GRAPH WORKSPACES</span><span>　▸ ASSET_NETWORK</span></div><div>${codeSnippet("SELECT TOP 100\n  ASSET_ID, STATUS, OEE\nFROM INDUSTRY_ASSETS\nWHERE PLANT = 'MX-01'\nORDER BY OEE ASC;", "SQL")}${tablePreview(["ASSET_ID", "STATUS", "OEE"], [["PRESS-03", "WARN", "71.2"], ["LINE-07", "RUNNING", "84.9"]])}</div></div>`;
    if (tab === "SQL Analyzer") return `<div class="interface-panel"><h4>SQL Analyzer Plan File</h4>${codeSnippet("SELECT * FROM WORK_ORDERS WHERE PRIORITY = 'HIGH';", "PLAN")}${tablePreview(["OPERATOR", "ROWS", "COST"], [["TABLE SCAN", "2,401", "18%"], ["FILTER", "344", "7%"], ["JOIN", "344", "12%"]])}<div class="status-line"><span class="status-check">●</span> Estimated bottleneck: missing asset index <b>REVIEW</b></div></div>`;
    if (tab === "PAL HGBT") return `<div class="interface-panel"><div class="pal-header"><div><h4>Hybrid Gradient Boosting Tree</h4><p>Mixed categorical + continuous features for predictive maintenance.</p></div><button class="primary-button" data-interface-action="train">Train background job</button></div><div class="parameter-grid"><label>Target<select><option>FAILURE_RISK</option></select></label><label>Seed<input value="42" /></label><label>Split method<select><option>histogram</option><option>exact</option></select></label><label>Task<select><option>classification</option><option>regression</option></select></label></div><div class="interface-cards compact"><article><small>FEATURES</small><strong>18</strong><span>numeric + categorical</span></article><article><small>CROSS-VAL AUC</small><strong class="good">0.91</strong><span>5 folds</span></article><article><small>TOP SIGNAL</small><strong>VIBRATION</strong><span>importance 0.38</span></article></div></div>`;
    if (tab === "Graph Viewer") return `<div class="graph-workspace"><div class="graph-canvas"><svg viewBox="0 0 360 220" aria-label="Asset graph"><path d="M70 80 180 45 285 93 180 160 70 80M180 45 180 160M70 80 285 93" fill="none" stroke="#77a8c5" stroke-width="3"/><circle cx="70" cy="80" r="18" fill="#2f80ed"/><circle cx="180" cy="45" r="18" fill="#7c5cff"/><circle cx="285" cy="93" r="18" fill="#16a085"/><circle cx="180" cy="160" r="18" fill="#e25575"/><text x="52" y="120">PRESS-03</text><text x="162" y="17">LINE-07</text><text x="272" y="132">LOT-9001</text><text x="161" y="196">WO-1044</text></svg></div><div class="graph-tools"><button data-interface-action="neighborhood">Neighborhood</button><button data-interface-action="path">Shortest Path</button><button data-interface-action="cypher">Cypher</button><label>Filter<input placeholder="asset.type = 'press'" /></label></div></div>`;
    if (tab === "Catalog") return common.Catalog;
  }
  if (tool === "data") {
    if (tab === "Semantic Model") return `<div class="semantic-map"><div class="semantic-node">Assets</div><div class="semantic-link">has event</div><div class="semantic-node purple">Work Orders</div><div class="semantic-link">produces</div><div class="semantic-node green">Quality</div></div><div class="interface-panel"><h4>Business meaning</h4><p>One reusable semantic model joins plant assets, work orders, production output, maintenance, and quality context without breaking lineage.</p></div>`;
    if (tab === "Vector") return `<div class="interface-panel">${codeSnippet("SELECT TOP 10\n  ASSET_ID, COSINE_SIMILARITY(\n    EMBEDDING, TO_REAL_VECTOR('[0.12, 0.44, 0.81]')\n  ) AS SIMILARITY\nFROM ASSET_EMBEDDINGS\nORDER BY SIMILARITY DESC;", "VECTOR SQL")}<div class="vector-bars"><i style="width:91%">PRESS-03 · 0.91</i><i style="width:78%">LINE-07 · 0.78</i><i style="width:64%">ROBOT-12 · 0.64</i></div></div>`;
    if (tab === "Spatial") return `<div class="spatial-map"><div class="plant-outline"></div><span class="asset-pin pin-a">PRESS-03</span><span class="asset-pin pin-b">LINE-07</span><span class="asset-pin pin-c">ROBOT-12</span><div class="spatial-legend">ST_POINT · ST_GEOMETRY · route proximity</div></div>`;
    if (tab === "JSON") return `<div class="interface-panel">${codeSnippet("SELECT JSON_VALUE(EVENT, '$.asset.id') AS ASSET_ID,\n       JSON_VALUE(EVENT, '$.signal.value') AS VALUE\nFROM EVENT_COLLECTION\nWHERE JSON_VALUE(EVENT, '$.signal.kind') = 'temperature';", "JSON SQL")}${tablePreview(["ASSET_ID", "VALUE", "UNIT"], [["LINE-07", "72.4", "°C"], ["PRESS-03", "68.9", "°C"]])}</div>`;
    if (tab === "Graph") return interfaceContent("process", "Graph Viewer");
    if (tab === "API Contract") return `<div class="interface-panel"><h4>Data product contract</h4><div class="contract-row"><b>Endpoint</b><code>/industry/asset-health/v1</code></div><div class="contract-row"><b>Formats</b><code>JSON · OData · GraphQL</code></div><div class="contract-row"><b>Freshness</b><code>15 min SLA</code></div><div class="status-line"><span class="status-check">●</span> Lineage and owner present <b>PASS</b></div></div>`;
  }
  if (tool === "audit") {
    return tab === "Controls" ? `<div class="interface-cards"><article><small>CONTROL COVERAGE</small><strong>96%</strong><span>24 of 25 controls active</span></article><article><small>OPEN EXCEPTIONS</small><strong class="warn">03</strong><span>awaiting review</span></article><article><small>EVIDENCE</small><strong>184</strong><span>events retained</span></article></div><div class="interface-panel"><h4>Control matrix</h4>${tablePreview(["CONTROL", "SCOPE", "STATE"], [["SoD-001", "activation", "PASS"], ["DATA-014", "lineage", "PASS"], ["WRITE-003", "production", "DENIED"]])}</div>` : `<div class="interface-panel"><h4>${tab}</h4><p>${tab === "Evidence" ? "Every simulated action emits a trace, actor, policy decision, and model version." : tab === "Exceptions" ? "Exceptions are isolated from production routes until a human approval is recorded." : "Trace a control back through data products, graph edges, and source events."}</p><button class="primary-button" data-interface-action="export">Export evidence bundle</button></div>`;
  }
  if (tool === "gate") return `<div class="interface-panel"><h4>${tab} policy</h4><div class="status-line"><span class="status-check">●</span> Mock-only tenant boundary <b>ON</b></div><div class="status-line"><span class="status-check">●</span> Production writes <b>DENIED</b></div><div class="status-line"><span class="status-check">●</span> Human approval for live route <b>REQUIRED</b></div>${tab === "Simulation" ? `<div class="interface-cards compact"><article><small>SAFE ROUTES</small><strong>13</strong><span>all read-only</span></article><article><small>BLOCKED</small><strong class="warn">04</strong><span>live writes</span></article></div>` : ""}</div>`;
  if (tool === "agent") return `<div class="interface-panel"><h4>${tab}</h4><div class="agent-step"><b>1</b><span>Planner</span><em>decompose scenario</em></div><div class="agent-step"><b>2</b><span>DES specialist</span><em>run bounded experiment</em></div><div class="agent-step"><b>3</b><span>Governance reviewer</span><em>validate evidence</em></div><button class="primary-button" data-interface-action="delegate">Delegate bounded task</button></div>`;
  return `<div class="interface-panel"><h4>${tab}</h4><p>Workspace ready for this object.</p></div>`;
}

function renderInterfaceTab(tool, tab) {
  const profile = interiorProfiles[tool] || interiorProfiles.process;
  $("#interface-workspace").innerHTML = interfaceContent(tool, tab);
  $$("#interface-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  $("#interface-workspace").dataset.activeTab = tab;
  $("#interior-system").textContent = profile.system;
}

function toolForNode(node) {
  if (["warehouse", "posTerminal", "rack", "retailShelf", "partsFeeder"].includes(node.visual)) return "source";
  if (["tower", "silo", "conveyor", "loadingDock", "assemblyFixture", "torqueStation", "robotDock", "processMachine"].includes(node.visual)) return "process";
  if (["reactor", "crate", "sensorMast"].includes(node.visual)) return "data";
  if (["robot", "mobileManipulator", "amr", "cobotCell", "quadruped"].includes(node.visual)) return "agent";
  if (["gate", "safetyZone", "inspectionCell"].includes(node.visual)) return "audit";
  return "process";
}

function openObjectSubmenu(tool, sourceNode = null) {
  const definition = { ...(objectDefinitions[tool] || objectDefinitions.process), ...(sourceNode ? { name: sourceNode.name, subtitle: sourceNode.subtitle, color: sourceNode.color, visual: sourceNode.visual, capacity: sourceNode.capacity, service: sourceNode.service } : {}) };
  const profile = interiorProfiles[tool] || interiorProfiles.process;
  state.pendingTool = tool; state.interiorTool = tool; state.previousView = state.mode;
  $("#interior-dive").classList.remove("hidden");
  $("#interior-title").textContent = definition.name;
  $("#interior-type").textContent = `${profile.role} · rendered polygonal model`;
  $("#interior-description").textContent = profile.description;
  $("#interior-capacity").textContent = `${definition.capacity} resources`;
  $("#interior-service").textContent = `${definition.service} units`;
  $("#interior-role").textContent = profile.role;
  $("#interface-tabs").innerHTML = profile.tabs.map((tab, index) => `<button class="${index === 0 ? "active" : ""}" data-tab="${tab}">${tab}</button>`).join("");
  renderInterfaceTab(tool, profile.tabs[0]);
  if (state.interiorWorld) { state.interiorWorld.setModel({ nodes: [{ id: "interior", ...definition, x: 550, y: 325, z: 0 }], edges: [] }); state.interiorWorld.setSelected("interior"); state.interiorWorld.setCamera({ azimuth: -.62, elevation: .34, zoom: 1.1 }); }
  if (state.mode !== "3d") changeView("3d");
  showToast(`${definition.name} deep-dive environment opened.`);
}

function addObject(tool) {
  if (!state.editMode) { showToast("Turn on Edit Mode to add objects."); return; }
  const definition = objectDefinitions[tool];
  if (!definition) return;
  state.history.push(snapshotModel()); state.future = [];
  const id = `${tool}-${Date.now()}`;
  state.model.nodes.push({ id, ...definition, x: 420 + Math.random() * 180, y: 90 + Math.random() * 400, z: 2 });
  state.selectedId = id; renderModel(); renderInspector(); saveModel(false); showToast(`${definition.name} added to the model.`);
}

async function saveModel(show = true) {
  const saved = await api("/api/model", { method: "POST", body: JSON.stringify(state.model) });
  state.model = saved.model;
  if (show) showToast("Model snapshot accepted asynchronously.");
}

const exampleRunbookSteps = [
  ["source", "Source Cockpit", "Inspect SAP EWM order context, S/4HANA master data, and robot-relevant APIs and events.", "Open source"],
  ["process", "SAP BDC Cockpit", "Activate governed data products and inspect SQL, PAL HGBT, and graph context.", "Open service"],
  ["data", "SAP Datasphere", "Review the semantic model, vector, spatial, JSON, graph, and robot-task contract.", "Open data"],
  ["integrate", "SAP BTP integration", "Validate the SAP EWM, event, OPC UA, MQTT, and robot interfaces in mock mode.", "Open runway"],
  ["simulate", "Physical-flow DES", "Run 24 warehouse orders and watch AMRs, the picking cell, queues, and confirmations.", "Run DES"],
  ["audit", "Governance Control Room", "Review controls, evidence, exceptions, and lineage for the simulated flow.", "Open Governance"],
  ["gate", "Human Approval Gate", "Confirm that live physical commands require accountable human approval.", "Open gate"],
  ["lens", "SAP HANA Cloud engines", "Inspect vector, spatial, graph, knowledge-graph, and JSON context for the robot task.", "Open Vector"],
  ["agent", "Joule Agent Orchestration", "Let Joule prepare and supervise a bounded SAP EWM-to-robot outcome with no live commands.", "Prepare goal"],
  ["save", "Governed evidence snapshot", "Save the business decision, agent plan, robot trace, and human approvals together.", "Save snapshot"]
];

function renderExampleRunbook(example, persisted) {
  $("#runbook-status-text").textContent = persisted ? "Example loaded and saved to the current tenant snapshot." : "Example loaded in this browser session; saving requires an editor or administrator role.";
  $("#runbook-steps").innerHTML = exampleRunbookSteps.map(([id, title, description, label], index) => `<article class="runbook-step" data-runbook-step="${id}"><span class="runbook-step-number">${index + 1}</span><div class="runbook-step-copy"><strong>${title}</strong><span>${description}</span></div><button data-runbook-action="${id}">${label}</button></article>`).join("");
  $("#example-runbook").classList.remove("hidden");
}

function runExampleAction(action) {
  const step = $(`[data-runbook-step="${action}"]`), button = step?.querySelector("button");
  if (step) step.classList.add("complete");
  if (button) button.textContent = "Activated";
  if (["integrate", "simulate", "lens", "agent"].includes(action)) $("#example-runbook").classList.add("hidden");
  if (["source", "process", "data", "audit"].includes(action)) {
    const node = state.model?.nodes.find((item) => toolForNode(item) === action);
    if (node) { state.selectedId = node.id; renderModel(); renderInspector(); return openObjectSubmenu(action, node); }
    return openObjectSubmenu(action);
  }
  if (action === "gate") return openObjectSubmenu("gate");
  if (action === "integrate") { document.querySelector(".integration-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }); return showToast("Integration runway opened. Choose an adapter for a mock dry-run."); }
  if (action === "simulate") { $("#simulation-mode").value = "fast"; $("#entity-count").value = "24"; document.querySelector(".metrics-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }); return runSimulation(); }
  if (action === "lens") { const lens = state.hanaCapabilities.find((item) => item.id === "vector") || state.hanaCapabilities[0]; if (lens) return openLensWorkbench(lens); return showToast("Data Lenses are still loading."); }
  if (action === "agent") { const goal = "Compare Fast DES and Monte Carlo for 24 orders, identify the highest queue risk, and produce a safe review with no production writes."; $("#agent-goal").value = goal; document.querySelector(".console-panel")?.scrollIntoView({ behavior: "smooth", block: "center" }); $("#agent-goal").focus(); return showToast("Joule Agent Orchestration goal prepared. Press Delegate to run it."); }
  if (action === "save") return saveModel(true);
}

async function loadExample(button) {
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  try {
    const example = await api("/api/model/example");
    if (!example || !Array.isArray(example.nodes) || !Array.isArray(example.edges)) throw new Error("The example model payload is incomplete.");
    if (state.model) state.history.push(snapshotModel());
    state.future = [];
    state.model = example;
    state.selectedId = example.nodes.find((node) => node.id === "source-s4")?.id || example.nodes[0]?.id || null;
    state.pendingTool = null;
    state.interiorTool = null;
    state.events = 0;
    $("#object-submenu").classList.add("hidden");
    $("#interior-dive").classList.add("hidden");
    $("#lens-workbench").classList.add("hidden");
    changeView("2d");
    $("#model-status").textContent = "Example loaded · SAP EWM Order-to-Dispatch ready";
    $("#event-count").textContent = "0 events";
    $("#clock-label").textContent = "t = 0.00";
    $("#timeline-fill").style.width = "0%";
    state.meshWorld?.setFlowState({ running: false, queues: {} });
    let persisted = false;
    try { await saveModel(false); persisted = true; } catch (saveError) { logLine("system", `Example loaded locally; snapshot save skipped: ${saveError.message}`, true); }
    renderModel();
    renderInspector();
    renderExampleRunbook(state.model, persisted);
    showToast(`Example loaded: ${example.nodes.length} objects, ${example.edges.length} connections.`);
  } catch (error) {
    console.error("Load Example failed", error);
    showToast(`Load Example failed: ${error.message}`);
    logLine("system", `Load Example failed: ${error.message}`, true);
  } finally {
    if (button) { button.disabled = false; button.removeAttribute("aria-busy"); }
  }
}

function logLine(actor, message, alert = false) {
  const log = $("#console-log");
  const time = new Date().toLocaleTimeString([], { hour12: false });
  const line = document.createElement("div"); line.className = `console-line${alert ? " alert" : ""}`;
  line.innerHTML = `<span>${time}</span><strong>${actor}</strong><p>${message}</p>`;
  log.appendChild(line); log.scrollTop = log.scrollHeight;
  while (log.children.length > 45) log.firstElementChild.remove();
}

function updateMetrics(summary) {
  $("#metric-throughput").textContent = summary.throughput ?? "—";
  $("#metric-cycle").textContent = summary.averageCycle ?? "—";
  $("#metric-p95").textContent = summary.p95Cycle ?? "—";
  $("#metric-breaches").textContent = summary.audit?.breaches ?? "—";
}

function consumeEvent(event) {
  if (event.type === "job_started") state.currentJobKind = event.kind;
  state.events += 1;
  $("#event-count").textContent = `${state.events} events`;
  if (event.snapshot) {
    state.meshWorld?.setFlowState({ running: true, queues: event.snapshot.queues || {} });
    const total = Number($("#entity-count").value || 24);
    $("#clock-label").textContent = `t = ${event.snapshot.clock}`;
    $("#timeline-fill").style.width = `${Math.min(100, (event.snapshot.completed / total) * 100)}%`;
    $("#metric-breaches").textContent = event.snapshot.audit.breaches;
  }
  if (["arrival", "transfer", "service_start"].includes(event.type)) logLine(event.type.replaceAll("_", " "), `${event.entityId} → ${event.nodeId}`);
  if (event.type === "audit_breach") logLine("Governance", `${event.entityId} flagged for control review`, true);
  if (event.type === "monte_carlo_run") logLine("Monte Carlo", `run ${event.run}/${event.runs}: throughput ${event.result.throughput}`);
  if (event.type === "simulation_complete") {
    state.meshWorld?.setFlowState({ running: false });
    updateMetrics(event.summary); $("#model-status").textContent = "Experiment complete"; $("#run-simulation").disabled = false;
    logLine("orchestrator", `completed ${event.summary.completed} entities; p95 cycle ${event.summary.p95Cycle}`);
  }
  if (event.type === "orchestrator_analysis") logLine("Sol 5.6", `analyzing with ${event.model} / ${event.effort}`);
  if (event.type === "specialist_launched") logLine(event.specialist, `step ${event.step}: ${event.objective}`);
  if (event.type === "fallback_activated") logLine("fallback", `${event.from} → ${event.to}: ${event.reason}${event.safetyMode === "safe-review-only" ? " (safe review only)" : ""}`, true);
  if (event.type === "provider_status") logLine("provider", `${event.providerId}: ${event.status}`);
  if (event.type === "lens_query_started") logLine("data lens", `${event.lens} query running under read-only RLS`);
  if (event.type === "robot_routine_started") {
    state.grafcetVisited = new Set();
    state.activeGrafcetTransition = null;
    state.meshWorld?.setFlowState({ running: true, queues: {} });
    logLine("robot controller", `${event.scenarioName} started in ${event.mode} mode`);
  }
  if (event.type === "grafcet_step_active") {
    setGrafcetActive(event.stepId);
    $("#robot-sensor").textContent = `${event.sensor}: awaiting ${event.expected}`;
    $("#robot-command").textContent = event.action;
    logLine("GRAFCET", `${event.stepId} · ${event.label}`);
  }
  if (event.type === "sensor_sample") {
    $("#robot-sensor").textContent = `${event.source}: ${event.value}`;
  }
  if (event.type === "robot_command") {
    const status = event.disposition === "approval_required" ? "approval required" : event.disposition === "shadow_only" ? "shadow only" : "simulated";
    $("#robot-command").textContent = `${event.command} · ${status}`;
    logLine("digital twin", `${event.command} · ${status}; production output blocked`);
  }
  if (event.type === "grafcet_transition_fired") {
    setGrafcetActive(event.from, event.transitionId);
    logLine("receptivity", `${event.transitionId}: ${event.receptivity} → ${event.to}`);
  }
  if (event.type === "robot_routine_complete") {
    state.meshWorld?.setFlowState({ running: false });
    setGrafcetActive(event.finalStep || state.activeRobotScenario?.grafcet.initial || "S0");
    const button = $("#run-robot-routine");
    button.disabled = false; button.textContent = "Run routine";
    $("#model-status").textContent = `${event.cycles} robot cycle${event.cycles === 1 ? "" : "s"} complete`;
    logLine("robot controller", `${event.cycles} validated cycle${event.cycles === 1 ? "" : "s"} completed`);
  }
  if (event.type === "job_complete" && event.result?.lens) {
    renderLensResults(event.result); const button = $("#lens-run"); button.disabled = false; button.textContent = "Run background query";
  }
  if (event.type === "job_complete" && event.result?.plan) {
    logLine("consolidator", event.result.summary || `${event.result.plan.length} specialist results consolidated.`);
    const button = $("#run-agent-task"); button.disabled = false; button.textContent = "Delegate";
  }
  if (event.type === "job_failed") { if (state.currentJobKind === "simulation") { $("#model-status").textContent = "Experiment failed"; $("#run-simulation").disabled = false; } logLine("system", event.error, true); }
  if (event.type === "job_failed") {
    const lens = $("#lens-run"), agent = $("#run-agent-task"), robot = $("#run-robot-routine");
    if (lens) { lens.disabled = false; lens.textContent = "Run background query"; }
    if (agent) { agent.disabled = false; agent.textContent = "Delegate"; }
    if (robot && state.currentJobKind === "robot_routine") { robot.disabled = false; robot.textContent = "Run routine"; state.meshWorld?.setFlowState({ running: false }); }
  }
}

function watchJob(jobId, endpoint) {
  if (state.source) state.source.close();
  state.source = new EventSource(endpoint);
  state.source.onmessage = (event) => consumeEvent(JSON.parse(event.data));
  ["job_started", "service_start", "service_complete", "arrival", "transfer", "entity_complete", "audit_breach", "audit_pass", "monte_carlo_run", "simulation_complete", "job_complete", "job_failed", "connection_decision", "orchestrator_analysis", "specialist_launched", "fallback_activated", "provider_status", "lens_query_started", "lens_query_complete", "robot_routine_started", "grafcet_step_active", "sensor_sample", "robot_command", "grafcet_transition_fired", "robot_routine_complete"].forEach((type) => {
    state.source.addEventListener(type, (event) => {
      const payload = JSON.parse(event.data); consumeEvent(payload);
      if (type === "job_complete" || type === "job_failed") state.source.close();
      if (type === "connection_decision") showToast(payload.decision.allowed ? "Dry-run adapter permitted." : "Adapter denied by safety policy.");
    });
  });
  state.currentJob = jobId;
}

async function runSimulation() {
  if (!state.model) return;
  const button = $("#run-simulation"); button.disabled = true; state.events = 0; $("#event-count").textContent = "0 events"; $("#timeline-fill").style.width = "0%"; $("#model-status").textContent = "Experiment queued";
  const payload = { mode: $("#simulation-mode").value, entities: Number($("#entity-count").value), runs: 5, seed: 42 };
  state.meshWorld?.setFlowState({ running: true, queues: {} });
  logLine("orchestrator", `queued ${payload.mode}; bounded at 2,400 tokens / 8 steps`);
  const job = await api("/api/simulations", { method: "POST", body: JSON.stringify(payload) });
  logLine("worker", `${job.jobId} accepted as background job`); watchJob(job.jobId, job.events);
}

async function testAdapter(adapter) {
  const job = await api("/api/connections/test", { method: "POST", body: JSON.stringify({ adapter, environment: "mock", operation: "read" }) });
  logLine("adapter", `${adapter} dry-run queued; live writes disabled`); watchJob(job.jobId, job.events);
}

function openLensWorkbench(lens) {
  const profile = lensProfiles[lens.id] || lensProfiles.json;
  state.activeLens = lens;
  $("#lens-title").textContent = lens.name;
  $("#lens-description").textContent = `${profile.description} Read-only blocks mutations, not queries.`;
  $("#lens-engine").textContent = profile.engine;
  $("#lens-query").value = profile.query;
  $("#lens-results").innerHTML = `<div class="lens-empty"><strong>${lens.name} workspace ready</strong><span>${lens.detail}</span><small>Queries execute as tenant-scoped background jobs.</small></div>`;
  $("#lens-workbench").classList.remove("hidden");
  state.lensWorld?.setModel({ nodes: [{ id: `lens-${lens.id}`, kind: "data", visual: profile.visual, name: `${lens.name} Lens`, subtitle: lens.detail, x: 550, y: 325, z: 0, capacity: 3, service: 2, color: lens.color }], edges: [] });
  state.lensWorld?.setSelected(`lens-${lens.id}`);
  showToast(`${lens.name} lens opened in query-only mode.`);
}

function renderLensResults(result) {
  if (!result?.rows) return;
  $("#lens-engine").textContent = result.engine;
  $("#lens-results").innerHTML = `<div class="lens-result-heading"><strong>${result.rows.length} rows returned</strong><span>RLS tenant scope · no mutation</span></div>${tablePreview(["OBJECT", "RELATION / VALUE", "CONTEXT"], result.rows)}`;
}

async function runLensQuery() {
  if (!state.activeLens) return;
  const button = $("#lens-run"); button.disabled = true; button.textContent = "Query queued…";
  const job = await api("/api/lenses/query", { method: "POST", body: JSON.stringify({ lens: state.activeLens.id, query: $("#lens-query").value }) });
  logLine("data lens", `${state.activeLens.name} query accepted as ${job.jobId}`);
  watchJob(job.jobId, job.events);
}

async function runAgentTask() {
  const goal = $("#agent-goal").value.trim();
  if (!goal) return showToast("Describe a bounded goal first.");
  const button = $("#run-agent-task"); button.disabled = true; button.textContent = "Delegating…";
  const job = await api("/api/agent/tasks", { method: "POST", body: JSON.stringify({ goal }) });
  logLine("Sol 5.6", `goal analyzed and queued as ${job.jobId}`);
  watchJob(job.jobId, job.events);
}

function renderAdapters(list) {
  $("#adapter-grid").replaceChildren(...list.map((adapter) => {
    const button = document.createElement("button"); button.className = "adapter-card"; button.innerHTML = `<strong>${adapter.name}</strong><small>● simulated / read-only</small>`; button.title = `${adapter.category}: ${adapter.protocols.join(", ")}`; button.addEventListener("click", () => testAdapter(adapter.id)); return button;
  }));
}

function renderHanaLenses(list) {
  state.hanaCapabilities = list;
  $("#hana-lenses .lens-grid")?.remove();
  $("#hana-lenses").insertAdjacentHTML("beforeend", `<div class="lens-grid">${list.map((lens) => `<button class="data-lens" data-lens-id="${lens.id}" style="--lens:${lens.color}" title="${lens.detail}"><span class="lens-glyph">${lens.name.slice(0, 1)}</span><span><strong>${lens.name}</strong><small>${lens.detail}</small></span><em>Open ↗</em></button>`).join("")}</div>`);
  $$(".data-lens").forEach((button) => button.addEventListener("click", () => openLensWorkbench(list.find((lens) => lens.id === button.dataset.lensId))));
}

function routineCodeFor(scenario) {
  if (!scenario) return "// Select a scenario to generate its executable routine.";
  const lines = [
    `// ${scenario.domain}: ${scenario.name}`,
    `// Controller: ${scenario.controller}`,
    `async function runCycle(io, robot, enterprise, audit) {`,
    `  let step = "${scenario.grafcet.initial}";`,
    `  while (!io.stopRequested) {`
  ];
  for (const current of scenario.grafcet.steps) {
    const transition = scenario.grafcet.transitions.find((item) => item.from === current.id);
    lines.push(`    if (step === "${current.id}") {`);
    lines.push(`      await ${current.command};`);
    lines.push(`      const signal = await io.read("${current.sensor}");`);
    lines.push(`      await audit.record("${current.id}", { signal, expected: "${current.expected}" });`);
    if (transition) lines.push(`      if (io.guard("${transition.receptivity}")) step = "${transition.to}";`);
    lines.push(`    }`);
  }
  lines.push(`  }`, `}`);
  return lines.join("\n");
}

function renderRobotBindings(scenario) {
  $("#routine-bindings").innerHTML = scenario.model.nodes.map((item) => `<div class="binding-row"><b>${item.name}</b><span>${item.protocols.join(" · ")}</span><em>${item.deviceClass.toUpperCase()} / MOCK</em></div>`).join("");
}

function renderGrafcet(scenario) {
  const svg = $("#grafcet-diagram"), steps = scenario.grafcet.steps, transitions = scenario.grafcet.transitions, width = Math.max(1000, 80 + steps.length * 145), y = 82, boxWidth = 112, boxHeight = 58, startX = 34, gap = (width - 68 - boxWidth) / Math.max(1, steps.length - 1);
  svg.setAttribute("viewBox", `0 0 ${width} 210`);
  const positions = new Map(steps.map((current, index) => [current.id, { x: startX + index * gap, y }]));
  const paths = transitions.map((transition) => {
    const from = positions.get(transition.from), to = positions.get(transition.to);
    if (!from || !to) return "";
    if (to.x > from.x) {
      const x1 = from.x + boxWidth, x2 = to.x, mid = (x1 + x2) / 2;
      return `<g data-transition-id="${transition.id}"><line class="grafcet-line" x1="${x1}" y1="${y + boxHeight / 2}" x2="${x2}" y2="${y + boxHeight / 2}"/><rect class="grafcet-transition" x="${mid - 2}" y="${y + boxHeight / 2 - 11}" width="4" height="22"/><text class="grafcet-transition-label" x="${mid}" y="${y + boxHeight / 2 - 16}" text-anchor="middle">${transition.id}</text></g>`;
    }
    const fromCenter = from.x + boxWidth / 2, toCenter = to.x + boxWidth / 2;
    return `<g data-transition-id="${transition.id}"><path class="grafcet-line" d="M ${fromCenter} ${y + boxHeight} V 184 H ${toCenter} V ${y + boxHeight}"/><rect class="grafcet-transition" x="${(fromCenter + toCenter) / 2 - 11}" y="181" width="22" height="4"/><text class="grafcet-transition-label" x="${(fromCenter + toCenter) / 2}" y="202" text-anchor="middle">${transition.id}</text></g>`;
  }).join("");
  const stepMarkup = steps.map((current, index) => {
    const position = positions.get(current.id), initial = current.id === scenario.grafcet.initial ? `<rect class="grafcet-initial" x="-5" y="-5" width="${boxWidth + 10}" height="${boxHeight + 10}"/>` : "";
    const label = current.label.length > 19 ? `${current.label.slice(0, 18)}…` : current.label;
    return `<g class="grafcet-step${index === 0 ? " active" : ""}" data-step-id="${current.id}" transform="translate(${position.x} ${position.y})">${initial}<rect width="${boxWidth}" height="${boxHeight}"/><text class="step-id" x="10" y="21">${current.id}</text><text class="step-label" x="10" y="41">${label}</text></g>`;
  }).join("");
  svg.innerHTML = `${paths}${stepMarkup}`;
}

function setGrafcetActive(stepId, transitionId = null) {
  const scenario = state.activeRobotScenario;
  if (!scenario) return;
  state.activeGrafcetStep = stepId;
  if (transitionId) state.activeGrafcetTransition = transitionId;
  state.grafcetVisited.add(stepId);
  $$(".grafcet-step").forEach((element) => {
    const id = element.dataset.stepId;
    element.classList.toggle("active", id === stepId);
    element.classList.toggle("visited", state.grafcetVisited.has(id) && id !== stepId);
  });
  $$("[data-transition-id]").forEach((element) => {
    const fired = element.dataset.transitionId === state.activeGrafcetTransition;
    element.querySelector(".grafcet-line")?.classList.toggle("fired", fired);
    element.querySelector(".grafcet-transition")?.classList.toggle("fired", fired);
  });
  const current = scenario.grafcet.steps.find((item) => item.id === stepId), transition = scenario.grafcet.transitions.find((item) => item.from === stepId);
  if (!current) return;
  $("#grafcet-state").textContent = current.id;
  $("#grafcet-detail").innerHTML = `<strong>${current.label}</strong><span>${current.action}<br><b>Command:</b> ${current.command} · <b>Sensor:</b> ${current.sensor}${transition ? ` · <b>Transition:</b> ${transition.receptivity}` : ""}</span>`;
  const modelNode = state.model?.nodes.find((item) => item.id === current.nodeId);
  if (modelNode) { state.selectedId = modelNode.id; state.meshWorld?.setSelected(modelNode.id); renderInspector(); }
}

function selectRobotScenario(id) {
  const scenario = state.robotScenarios.find((item) => item.id === id);
  if (!scenario) return;
  state.activeRobotScenario = scenario;
  state.activeGrafcetStep = scenario.grafcet.initial;
  state.activeGrafcetTransition = null;
  state.grafcetVisited = new Set();
  state.robotManualIndex = 0;
  $$(".robot-scenario-card").forEach((button) => button.classList.toggle("active", button.dataset.scenarioId === id));
  $("#grafcet-title").textContent = `${scenario.domain} · ${scenario.name}`;
  $("#routine-title").textContent = scenario.controller;
  $("#routine-code").textContent = routineCodeFor(scenario);
  renderRobotBindings(scenario);
  renderGrafcet(scenario);
  setGrafcetActive(scenario.grafcet.initial);
  $("#robot-sensor").textContent = scenario.sensors.slice(0, 2).join(" + ");
  $("#robot-command").textContent = "routine ready";
}

function renderRobotLab(scenarios) {
  state.robotScenarios = scenarios;
  $("#robot-scenario-tabs").innerHTML = scenarios.map((scenario) => `<button class="robot-scenario-card" data-scenario-id="${scenario.id}"><small>${scenario.domain.toUpperCase()}</small><strong>${scenario.name}</strong><span>${scenario.robot}</span></button>`).join("");
  const preferred = scenarios.find((scenario) => scenario.id === state.model?.activeScenarioId) || scenarios[0];
  if (preferred) selectRobotScenario(preferred.id);
}

async function loadRobotCell() {
  const scenario = state.activeRobotScenario;
  if (!scenario) return showToast("Choose a robot scenario first.");
  if (state.model) state.history.push(snapshotModel());
  state.future = [];
  try {
    const result = await api(`/api/robot-scenarios/${scenario.id}/compose`, { method: "POST", body: "{}" });
    state.model = result.model;
    state.selectedId = scenario.grafcet.steps[0]?.nodeId || scenario.model.nodes[0]?.id || null;
    renderModel(); renderInspector(); changeView("3d");
    $("#model-status").textContent = `${scenario.domain} workcell connected to SAP process and business-data context`;
    state.meshWorld?.setFlowState({ running: false, queues: {} });
    document.querySelector(".model-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    const summary = result.composition;
    logLine("digital twin", `${summary.platformObjects} SAP platform objects + ${summary.robotObjects} robot assets connected by ${summary.connections} routes`);
    showToast(`${scenario.name} connected to the SAP-to-physical 3D model.`);
  } catch (error) {
    state.history.pop();
    logLine("robot lab", `Unified model load failed: ${error.message}`, true);
    showToast(`Could not combine the workcell: ${error.message}`);
  }
}

function advanceRobotRoutine() {
  const scenario = state.activeRobotScenario;
  if (!scenario) return;
  const steps = scenario.grafcet.steps, current = steps[state.robotManualIndex % steps.length], transition = scenario.grafcet.transitions.find((item) => item.from === current.id);
  setGrafcetActive(current.id, transition?.id || null);
  $("#robot-sensor").textContent = `${current.sensor}: ${current.expected}`;
  $("#robot-command").textContent = current.command;
  state.robotManualIndex = (state.robotManualIndex + 1) % steps.length;
  logLine("GRAFCET", `${current.id} ${current.label} · ${transition?.receptivity || "complete"}`);
}

async function runRobotRoutine() {
  const scenario = state.activeRobotScenario;
  if (!scenario) return;
  const button = $("#run-robot-routine"), payload = { scenarioId: scenario.id, mode: $("#robot-mode").value, cycles: Number($("#robot-cycles").value), speed: Number($("#robot-speed").value) };
  button.disabled = true; button.textContent = "Routine running…";
  state.grafcetVisited = new Set(); state.activeGrafcetTransition = null;
  state.meshWorld?.setFlowState({ running: true, queues: {} });
  try {
    const job = await api("/api/robot-routines", { method: "POST", body: JSON.stringify(payload) });
    logLine("robot lab", `${scenario.name} queued in ${payload.mode} mode as ${job.jobId}`);
    watchJob(job.jobId, job.events);
  } catch (error) {
    button.disabled = false; button.textContent = "Run routine";
    state.meshWorld?.setFlowState({ running: false });
    showToast(error.message); logLine("Safety Gate", error.message, true);
  }
}

function renderRoutineTab(tab) {
  $$(".routine-tabs button").forEach((button) => button.classList.toggle("active", button.dataset.routineTab === tab));
  $("#routine-code-panel").classList.toggle("hidden", tab !== "code");
  $("#routine-bindings-panel").classList.toggle("hidden", tab !== "bindings");
  $("#routine-walkthrough-panel").classList.toggle("hidden", tab !== "walkthrough");
}

function renderRibbon(tab) {
  const sets = {
    model: [["select", "↖", "Select"], ["source", "＋", "Source"], ["process", "▣", "Process"], ["data", "◈", "Data Product"], ["audit", "✓", "Governance"], ["gate", "⌑", "Gate"], ["save", "▣", "Save Snapshot"], ["undo", "↶", "Undo"], ["redo", "↷", "Redo"]],
    simulate: [["select", "↖", "Select"], ["run", "▶", "Run"], ["realtime", "◉", "Real-time"], ["monte", "∿", "Monte Carlo"], ["rewind", "↺", "Reset clock"], ["save", "▣", "Save Snapshot"]],
    integrate: [["select", "↖", "Select"], ["adapter", "⌘", "Adapter"], ["test", "✓", "Dry-run test"], ["source", "＋", "Source"], ["save", "▣", "Save Snapshot"]],
    audit: [["select", "↖", "Select"], ["audit", "✓", "Governance"], ["gate", "⌑", "Gate"], ["evidence", "▤", "Evidence"], ["save", "▣", "Save Snapshot"]],
    agent: [["select", "↖", "Select"], ["agent", "✦", "Joule Agent"], ["route", "⇄", "Route"], ["fallback", "↘", "Fallback"], ["save", "▣", "Save Snapshot"]],
    robot: [["robotlab", "◇", "Open Embodied AI Lab"], ["loadcell", "▣", "Connect Workcell"], ["stepgrafcet", "↦", "Next GRAFCET"], ["runroutine", "▶", "Run Routine"], ["shadow", "◉", "Shadow Mode"], ["save", "▣", "Save Snapshot"]]
  };
  $("#ribbon-tools").replaceChildren(...sets[tab].map(([id, glyph, label]) => {
    const button = document.createElement("button"); button.className = "tool-button"; button.dataset.tool = ["source", "process", "data", "audit", "gate", "agent", "select"].includes(id) ? id : ""; button.dataset.command = button.dataset.tool ? "" : id; button.innerHTML = `${glyph}<span>${label}</span>`; return button;
  }));
}

function handleRibbonAction(button) {
  const tool = button.dataset.tool;
  const command = button.dataset.command;
  if (tool) return tool === "select" ? showToast("Selection mode active.") : openObjectSubmenu(tool);
  if (command === "run" || command === "realtime" || command === "monte") { $("#simulation-mode").value = command === "monte" ? "monte-carlo" : command; return runSimulation(); }
  if (command === "rewind") { $("#clock-label").textContent = "t = 0.00"; $("#timeline-fill").style.width = "0%"; showToast("Simulation clock reset."); return; }
  if (command === "adapter" || command === "test") { document.querySelector(".integration-panel").scrollIntoView({ behavior: "smooth" }); return showToast("Choose an adapter below to run a dry test."); }
  if (command === "evidence") { return api("/api/audit").then((entries) => showToast(`${entries.length} audit entries available.`)); }
  if (command === "route") return showToast("Agent route: Joule assistant → domain agent → robot skill → governance reviewer.");
  if (command === "fallback") return showToast("Fallback route armed: GPT-5.5 Pro on safeguard or limit event.");
  if (command === "robotlab") { document.querySelector("#robot-lab").scrollIntoView({ behavior: "smooth", block: "start" }); return showToast("Embodied AI Lab opened."); }
  if (command === "loadcell") return loadRobotCell();
  if (command === "stepgrafcet") return advanceRobotRoutine();
  if (command === "runroutine") return runRobotRoutine();
  if (command === "shadow") { $("#robot-mode").value = "shadow"; document.querySelector("#robot-lab").scrollIntoView({ behavior: "smooth", block: "start" }); return showToast("Shadow mode selected: real inputs permitted, physical commands blocked."); }
  if (command === "save") return saveModel(true);
  if (command === "undo") return undo();
  if (command === "redo") return redo();
}

function changeView(view) {
  state.mode = view;
  $$("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#model-canvas").classList.toggle("hidden", view !== "2d"); $("#scene-3d").classList.toggle("hidden", view !== "3d");
  $("#stage-hint-text").textContent = view === "2d" ? "SAP business context above · physical execution below · drag to rearrange" : state.model?.layout === "unified-campus" ? "One connected loop · SAP intent + Joule orchestration + physical robot execution" : "Rendered meshes + live workers · click any object to enter its cockpit";
}

function attachOrbitControls() {
  // Orbiting is owned by the WebGL canvas. Keeping this hook preserves the app lifecycle seam.
}

function undo() {
  if (!state.history.length) return showToast("Nothing to undo yet.");
  state.future.push(snapshotModel()); state.model = state.history.pop(); renderModel(); renderInspector(); saveModel(false); showToast("Undo applied.");
}

function redo() {
  if (!state.future.length) return showToast("Nothing to redo yet.");
  state.history.push(snapshotModel()); state.model = state.future.pop(); renderModel(); renderInspector(); saveModel(false); showToast("Redo applied.");
}

async function boot() {
  state.session = await api("/api/session");
  state.editMode = state.session.permissions.editModel;
  $("#identity-pill").textContent = `${state.session.tenantId} · ${state.session.roles.join("/")}`;
  $("#edit-toggle").classList.toggle("active", state.editMode);
  $("#edit-toggle").innerHTML = `<span></span> ${state.editMode ? "EDIT MODE" : "VIEW MODE"}`;
  state.model = await api("/api/model");
  state.meshWorld = createMeshWorld($("#webgl-world"), { onSelect: (id) => { const node = nodeById(id); state.selectedId = id; renderModel(); renderInspector(); if (node) openObjectSubmenu(toolForNode(node), node); } });
  state.interiorWorld = createMeshWorld($("#interior-canvas"), { deepDive: true });
  state.lensWorld = createMeshWorld($("#lens-canvas"), { deepDive: true });
  renderModel(); renderInspector();
  renderAdapters(await api("/api/adapters"));
  renderHanaLenses(await api("/api/hana-capabilities")); renderInspector();
  renderRobotLab(await api("/api/robot-scenarios"));
  const runtime = await api("/api/runtime");
  $(".route-badge").textContent = `${runtime.orchestrator.toUpperCase()} ${runtime.reasoningEffort.toUpperCase()} → ${runtime.fallback.toUpperCase()}`;
  renderRibbon("model"); attachOrbitControls();
  $("#run-simulation").addEventListener("click", runSimulation);
  $("#run-agent-task").addEventListener("click", runAgentTask);
  $("#load-robot-cell").addEventListener("click", loadRobotCell);
  $("#step-robot-routine").addEventListener("click", advanceRobotRoutine);
  $("#run-robot-routine").addEventListener("click", runRobotRoutine);
  $("#robot-scenario-tabs").addEventListener("click", (event) => {
    const scenarioId = event.target.closest("[data-scenario-id]")?.dataset.scenarioId;
    if (scenarioId) selectRobotScenario(scenarioId);
  });
  $("#grafcet-diagram").addEventListener("click", (event) => {
    const stepId = event.target.closest("[data-step-id]")?.dataset.stepId;
    if (stepId) setGrafcetActive(stepId);
  });
  $(".routine-tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-routine-tab]")?.dataset.routineTab;
    if (tab) renderRoutineTab(tab);
  });
  $("#agent-goal").addEventListener("keydown", (event) => { if (event.key === "Enter") runAgentTask(); });
  $("#lens-close").addEventListener("click", () => $("#lens-workbench").classList.add("hidden"));
  $("#lens-run").addEventListener("click", runLensQuery);
  $("#lens-example").addEventListener("click", () => { if (state.activeLens) $("#lens-query").value = (lensProfiles[state.activeLens.id] || lensProfiles.json).query; });
  $("#guide-close").addEventListener("click", () => $("#guide-panel").classList.add("hidden"));
  $("#example-runbook-close").addEventListener("click", () => $("#example-runbook").classList.add("hidden"));
  $("#runbook-steps").addEventListener("click", (event) => { const action = event.target.closest("[data-runbook-action]")?.dataset.runbookAction; if (action) runExampleAction(action); });
  document.addEventListener("click", (event) => { const chip = event.target.closest(".lens-chip[data-lens-id]"); if (chip) { const lens = state.hanaCapabilities.find((item) => item.id === chip.dataset.lensId); if (lens) openLensWorkbench(lens); } });
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => changeView(button.dataset.view)));
  $("#ribbon-tools").addEventListener("click", (event) => { const button = event.target.closest("button"); if (button) handleRibbonAction(button); });
  $("#submenu-close").addEventListener("click", () => $("#object-submenu").classList.add("hidden"));
  $("#submenu-place").addEventListener("click", () => { const tool = state.pendingTool; if (tool) { addObject(tool); $("#submenu-place").textContent = "Place another"; showToast("Mesh placed on the shared 3D plane."); } });
  $("#submenu-inspect").addEventListener("click", () => { $(".inspector-panel").scrollIntoView({ behavior: "smooth", block: "nearest" }); showToast("Inspector opened while the deep-dive scene remains active."); });
  $("#interior-back").addEventListener("click", () => { $("#interior-dive").classList.add("hidden"); changeView(state.previousView || "2d"); });
  $("#interior-close").addEventListener("click", () => { $("#interior-dive").classList.add("hidden"); changeView(state.previousView || "2d"); });
  $("#interior-place").addEventListener("click", () => { if (state.interiorTool) { addObject(state.interiorTool); $("#interior-place").textContent = "Place another"; showToast("Mesh placed on the shared model plane."); } });
  $("#interface-tabs").addEventListener("click", (event) => { const tab = event.target.closest("button"); if (tab) renderInterfaceTab(state.interiorTool, tab.dataset.tab); });
  $("#interface-workspace").addEventListener("click", (event) => { const action = event.target.closest("[data-interface-action]")?.dataset.interfaceAction; if (action) { const messages = { execute: "SQL job submitted to the background queue.", format: "SQL formatted with catalog metadata.", train: "PAL HGBT training job submitted with seed 42.", activate: "Data package activation queued behind the safety gate.", neighborhood: "Graph neighborhood expanded to depth 2.", path: "Shortest-path analysis completed.", cypher: "Cypher query executed against the mock graph workspace.", export: "Evidence bundle prepared for export.", delegate: "Bounded specialist delegation queued.", test: "Interface dry-run passed." }; showToast(messages[action] || "Interface action accepted."); logLine("interior", messages[action] || "Interface action accepted."); } });
  $("#edit-toggle").addEventListener("click", () => { if (!state.session.permissions.editModel) return showToast("Your role is view-only."); state.editMode = !state.editMode; $("#edit-toggle").classList.toggle("active", state.editMode); $("#edit-toggle").innerHTML = `<span></span> ${state.editMode ? "EDIT MODE" : "VIEW MODE"}`; renderInspector(); showToast(state.editMode ? "Edition mode enabled." : "View mode enabled; model structure is locked."); });
  $$(".library-item[data-tool]").forEach((button) => button.addEventListener("click", () => openObjectSubmenu(button.dataset.tool)));
  $$(".top-actions [data-command]").forEach((button) => button.addEventListener("click", async () => {
    const command = button.dataset.command;
    if (command === "save") return saveModel(true);
    if (command === "undo") return undo(); if (command === "redo") return redo();
    if (command === "load") return loadExample(button);
    if (command === "new") { state.history.push(snapshotModel()); state.future = []; state.model = { id: `model-${Date.now()}`, name: "Untitled SAP Embodied AI Scenario", version: "0.5.0-embodied-ai", nodes: [], edges: [] }; state.selectedId = null; renderModel(); renderInspector(); await saveModel(false); return showToast("New editable model created."); }
    if (command === "open") { state.model = await api("/api/model"); state.selectedId = null; renderModel(); renderInspector(); return showToast("Current model snapshot opened."); }
    if (command === "getting-started") { $("#guide-panel").classList.remove("hidden"); return; }
  }));
  $$("[data-ribbon]").forEach((button) => button.addEventListener("click", () => { $$("[data-ribbon]").forEach((item) => item.classList.toggle("active", item === button)); renderRibbon(button.dataset.ribbon); showToast(`${button.textContent} ribbon selected.`); }));
  $$("[data-zoom]").forEach((button) => button.addEventListener("click", () => { const action = button.dataset.zoom; state.zoom = action === "in" ? Math.min(1.3, state.zoom + .1) : action === "out" ? Math.max(.7, state.zoom - .1) : 1; $("#zoom-label").textContent = `${Math.round(state.zoom * 100)}%`; $("#model-canvas").style.transform = `scale(${state.zoom})`; }));
  $("#palette-search").addEventListener("input", (event) => $$(".library-item").forEach((item) => item.classList.toggle("hidden", !item.textContent.toLowerCase().includes(event.target.value.toLowerCase()))));
  const deepLink = new URLSearchParams(location.search);
  if (deepLink.get("view") === "3d") changeView("3d");
  if (deepLink.get("lens")) { const lens = state.hanaCapabilities.find((item) => item.id === deepLink.get("lens")); if (lens) openLensWorkbench(lens); }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

boot().catch((error) => { showToast(error.message); logLine("system", error.message, true); });
