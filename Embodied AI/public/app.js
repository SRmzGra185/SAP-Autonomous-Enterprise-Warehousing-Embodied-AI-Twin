import { createMeshWorld } from "./webgl-world.js";
import { createExecutionUI } from "./execution-ui.js";
import { initConnectionsUI } from "./connections-ui.js";
import { initExperimentsUI } from "./experiments-ui.js";
import { initJouleChat } from "./joule-chat.js";

const svgNS = "http://www.w3.org/2000/svg";
const state = {
  model: null,
  selectedId: null,
  zoom: 1,
  events: 0,
  currentJob: null,
  currentJobKind: null,
  source: null,
  sources: new Map(),
  executionUI: null,
  robotRunning: false,
  dragId: null,
  mode: "2d",
  history: [],
  future: [],
  editMode: true,
  camera: { x: -12, y: -18, zoom: 1 },
  operationsScope: null,
  agentPlan: null,
  pendingTool: null,
  meshWorld: null,
  deepDiveWorld: null,
  interiorWorld: null,
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

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

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
  svg.setAttribute("viewBox", `0 0 1120 ${Math.max(650, ...state.model.nodes.map(node => node.y + 115))}`);
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

  for (const relation of state.model.relationships || []) {
    if (relation.type !== "coordinates") continue;
    const from = nodeById(relation.from), to = nodeById(relation.to);
    if (!from || !to) continue;
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", from.x + nodeWidth / 2); line.setAttribute("y1", from.y + 68);
    line.setAttribute("x2", to.x + nodeWidth / 2); line.setAttribute("y2", to.y);
    line.setAttribute("stroke", "#a15bea"); line.setAttribute("stroke-width", "3"); line.setAttribute("stroke-dasharray", "8 5");
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
    group.addEventListener("dblclick", () => openObjectSubmenu(toolForNode(node), node));
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
    if (state.model.layout === "unified-campus") zoneLabels.innerHTML = `<span><b>GOVERNED OPERATIONS</b>${platformCount} context objects</span><i>CONNECTED DIGITAL THREAD</i><span><b>PHYSICAL EXECUTION</b>${robotCount} physical assets</span>`;
  }
}

function renderInspector() {
  const target = state.selectedId ? nodeById(state.selectedId) : null;
  const miniScene = `<div class="inspector-visual"><div class="mini-world"><div class="mini-object ${target?.visual || "tower"}" style="--structure-color:${target?.color || "#2f80ed"}"></div><span>${target ? target.name : "Autonomous operations twin"}</span></div></div>`;
  if (!target) {
    $("#inspector-title").textContent = "Model Health";
    $("#inspector-content").innerHTML = `
      ${miniScene}
      <div class="health-score"><strong>MOCK</strong><span>local simulation<br />no production execution</span></div>
      <div class="inspector-section"><h3>Runtime guardrails</h3>
        <div class="key-value"><span>Tenant access</span><b style="color:var(--green)">Disabled</b></div>
        <div class="key-value"><span>Production writes</span><b style="color:var(--green)">Denied</b></div>
        <div class="key-value"><span>Edition</span><b style="color:var(--blue)">${state.editMode ? "Editable model" : "View only"}</b></div>
      </div>
      <div class="inspector-section"><h3>External connection scope</h3><p>SAP BDC Connect · Joule</p><p>Local mock runtime. Joule NOT CONNECTED.</p><button class="secondary-button" data-operation="connections">Connection settings</button></div>
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
    <div class="inspector-section"><h3>Operations workspace</h3><button class="secondary-button" data-operation="inspect">Open workspace</button></div>`;
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
  node.y = Math.max(8, Math.min(Math.max(570, ...state.model.nodes.map(item => item.y + 45)), point.y - 34));
  renderModel();
}

async function endDrag() {
  document.removeEventListener("pointermove", dragMove);
  if (!state.dragId) return;
  state.dragId = null;
  await saveModel(false);
}

const domainScenarios = {
  "asset-management": "autonomous-inspection",
  manufacturing: "adaptive-assembly",
  orchestration: "autonomous-orchestration",
  logistics: "warehouse-fulfillment"
};

const objectDefinitions = Object.fromEntries([
  ["connect", "SAP BDC Connect", "Mock shared data products and contracts", "bdc", "tower", "#40566a"],
  ["context", "Governed Operations Context", "Local operational context for the selected scenario", "data", "crate", "#66589c"],
  ["agent", "Joule", "NOT CONNECTED · local bounded mock planning", "agent", "joule", "#a15bea"],
  ["asset-management", "Asset Management", "Local autonomous inspection scenario", "process", "warehouse", "#31506a"],
  ["manufacturing", "Manufacturing", "Local adaptive assembly scenario", "process", "tower", "#40566a"],
  ["orchestration", "Orchestration", "Local autonomous orchestration scenario", "process", "tower", "#66589c"],
  ["logistics", "Logistics", "Local warehouse fulfillment scenario", "process", "warehouse", "#31506a"],
  ["approval", "Human Approval Gate", "Server-enforced approval per simulated action", "audit", "gate", "#c7893e"],
  ["evidence", "Evidence", "Recorded events, approvals and audit trail", "audit", "gate", "#814b5b"],
  ["physical", "Physical Workcell", "Local routine and GRAFCET object", "process", "processMachine", "#40566a"]
].map(([workspace, name, subtitle, kind, visual, color]) => [workspace, { workspace, name, subtitle, kind, visual, color, capacity: 2, service: 3 }]));

function workspaceProfile(tool) {
  const definition = objectDefinitions[tool] || objectDefinitions.physical;
  return { system: definition.name, role: domainScenarios[tool] ? "Local scenario workspace" : tool === "physical" ? "Simulated physical object" : "Operations workspace", description: definition.subtitle };
}

function operationButton(action, label) {
  return `<button class="secondary-button" data-operation="${action}">${label}</button>`;
}

function interfaceContent(tool) {
  const scenario = state.activeRobotScenario;
  const notice = '<p class="operations-notice">Local simulation prototype · no native SAP application or live robot execution.</p>';
  const routine = `<h4>${escapeHtml(scenario?.domain || "Operations")} · ${escapeHtml(scenario?.name || "Select a scenario")}</h4><p>Inspect executable steps, transition conditions, I/O bindings and routine code. The selected execution mode is preserved.</p><div class="operations-actions">${operationButton("grafcet", "Open GRAFCET & routine")}${operationButton("runroutine", "Run selected routine")}</div>`;
  let content = routine;
  if (tool === "connect" || tool === "context") content = `
    <h4>${tool === "connect" ? "Shared products & contracts" : "Governed Operations Context"}</h4>
    <p>Mock shared product: ${escapeHtml(scenario?.domain || "Asset Management")} operational context.</p>
    <dl><dt>Local contract</dt><dd>Scenario identity → routine steps → synthetic sensor inputs → approval decisions → recorded evidence.</dd><dt>Connection boundary</dt><dd>SAP BDC Connect shares context; Joule is the only other supported external connection. Neither is required for local simulation.</dd></dl>
    <p>These are local prototype contracts, not a live product catalog.</p>
    <div class="operations-actions">${operationButton("connections", "Connection settings")}${operationButton("grafcet", "Inspect current routine")}</div>`;
  if (tool === "agent") content = `
    <h4>Joule · NOT CONNECTED</h4><p>This action starts a bounded local mock plan. It does not call Joule or execute its recommendations.</p>
    <label for="workspace-agent-goal">Operations goal</label><textarea id="workspace-agent-goal" maxlength="2000" rows="3">${escapeHtml($("#agent-goal").value)}</textarea>
    <div class="operations-actions">${operationButton("joule-chat", "Open chat & reusable routines")}${operationButton("agent-start", "Start local mock plan")}${operationButton("trace", "Open recorded trace")}${operationButton("connections", "Connection settings")}</div>
    <h4>Latest local plan</h4><pre id="workspace-agent-plan">${escapeHtml(state.agentPlan ? JSON.stringify(state.agentPlan, null, 2) : "No completed local plan yet.")}</pre>`;
  if (tool === "approval") content = `
    <h4>Assisted execution</h4><p>Assisted mode pauses before each simulated action. Approve or reject the actual pending request in the twin. Live execution remains locked; shadow uses synthetic inputs.</p>
    <div class="operations-actions">${operationButton("assisted", "Select assisted mode")}${operationButton("approval", "View pending approval")}${operationButton("runroutine", "Run selected routine")}</div>`;
  if (tool === "evidence") content = `
    <h4>Recorded evidence</h4><p>${state.events} received events in this session. Export contains the routine events and approvals captured by the execution controls.</p>
    <div class="operations-actions">${operationButton("timeline", "View event timeline")}${operationButton("export", "Export routine evidence")}${operationButton("audit", "Load audit trail")}</div>
    <pre id="workspace-audit">Load the tenant-scoped audit trail to inspect actual server records.</pre>`;
  return `<div class="operations-workspace">${notice}${content}<p class="operations-error" role="status" id="workspace-error"></p></div>`;
}

function renderInterfaceTab(tool) {
  $("#interface-workspace").innerHTML = interfaceContent(tool);
  $("#interior-system").textContent = workspaceProfile(tool).system;
}

function toolForNode(node) {
  if (node.workspace && objectDefinitions[node.workspace]) return node.workspace;
  if (node.layer === "robotics" || node.deviceClass) return "physical";
  const ids = { connect: "connect", "operation-context": "context", joule: "agent", approval: "approval", evidence: "evidence" };
  return ids[node.id] || (domainScenarios[node.id] ? node.id : "physical");
}

function openObjectSubmenu(tool, sourceNode = null) {
  if (!objectDefinitions[tool]) tool = "physical";
  // Inspecting a domain must not replace the active full-circle case.
  const definition = { ...objectDefinitions[tool], ...(sourceNode || {}) };
  const profile = workspaceProfile(tool);
  state.pendingTool = tool; state.interiorTool = tool; state.previousView = state.mode;
  $("#interior-dive").classList.remove("hidden");
  $("#interior-title").textContent = definition.name;
  $("#interior-type").textContent = profile.role;
  $("#interior-description").textContent = profile.description;
  $("#interior-capacity").textContent = `${definition.capacity} resources`;
  $("#interior-service").textContent = `${definition.service} units`;
  $("#interior-role").textContent = profile.role;
  $("#interior-place").disabled = !state.editMode || Boolean(sourceNode);
  $("#interior-place").textContent = sourceNode ? "Already in model" : "Place in model";
  $("#interface-tabs").replaceChildren();
  renderInterfaceTab(tool);
  if (state.interiorWorld) { state.interiorWorld.setModel({ nodes: [{ ...definition, id: "interior", x: 550, y: 325, z: 0 }], edges: [] }); state.interiorWorld.setSelected("interior"); state.interiorWorld.setCamera({ azimuth: -.62, elevation: .34, zoom: 1.1 }); }
  if (state.mode !== "3d") changeView("3d");
}

async function handleOperation(action) {
  const reveal = (selector) => {
    $("#interior-dive").classList.add("hidden");
    $("#example-runbook").classList.add("hidden");
    const target = $(selector); target?.scrollIntoView({ behavior: "smooth", block: "center" });
    return target;
  };
  if (action === "inspect") { const node = nodeById(state.selectedId); if (node) openObjectSubmenu(toolForNode(node), node); }
  if (action === "connections") reveal("#connections-settings");
  if (action === "grafcet") reveal("#robot-lab");
  if (action === "runroutine") await runRobotRoutine();
  if (action === "agent-start") {
    $("#agent-goal").value = $("#workspace-agent-goal").value;
    await runAgentTask();
  }
  if (action === "trace") reveal(".console-panel");
  if (action === "joule-chat") reveal("#joule-chat");
  if (action === "timeline") reveal("#event-timeline");
  if (action === "export") $("#mission-export").click();
  if (action === "audit") {
    const target = $("#workspace-audit"); target.textContent = "Loading audit records…";
    try { const entries = await api("/api/audit"); target.textContent = JSON.stringify(entries, null, 2); }
    catch (error) { target.textContent = `Audit unavailable: ${error.message}`; }
  }
  if (action === "approval") {
    reveal("#mission-scenario");
    if (!$("#approval-panel").classList.contains("hidden")) $("#approval-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    else showToast("No pending approval. Run a routine in assisted mode to request one.");
  }
  if (action === "assisted") {
    if (state.robotRunning) return showToast("Stop the routine before changing execution mode.");
    $("#robot-mode").value = "assisted"; $("#mission-mode").value = "assisted";
    reveal("#mission-scenario");
  }
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
  ["connect", "SAP BDC Connect", "Inspect mock shared products and contracts; configure the supported connection.", "Open context"],
  ["asset-management", "Asset Management", "Select autonomous inspection and inspect its executable GRAFCET routine.", "Open scenario"],
  ["agent", "Joule · not connected", "Prepare a bounded local mock plan and inspect its recorded trace.", "Open local planner"],
  ["approval", "Human approval", "Select assisted mode to require an actual decision before each simulated action.", "Open approval"],
  ["simulate", "Physical-flow DES", "Compare queueing and cycle-time metrics for the loaded operations model.", "Run DES"],
  ["evidence", "Evidence & audit", "Export recorded routine events and approvals; read the actual audit trail.", "Open evidence"],
  ["save", "Editable model snapshot", "Save the current model layout. Export execution evidence separately.", "Save snapshot"]
];

function renderExampleRunbook(example, persisted) {
  $("#runbook-status-text").textContent = persisted ? "Example loaded and saved to the current tenant snapshot." : "Example loaded in this browser session; saving requires an editor or administrator role.";
  $("#runbook-steps").innerHTML = exampleRunbookSteps.map(([id, title, description, label], index) => `<article class="runbook-step" data-runbook-step="${id}"><span class="runbook-step-number">${index + 1}</span><div class="runbook-step-copy"><strong>${title}</strong><span>${description}</span></div><button data-runbook-action="${id}">${label}</button></article>`).join("");
  $("#example-runbook").classList.remove("hidden");
}

async function runExampleAction(action) {
  $("#example-runbook").classList.add("hidden");
  if (objectDefinitions[action]) {
    const node = state.model?.nodes.find((item) => toolForNode(item) === action);
    if (node) { state.selectedId = node.id; renderModel(); renderInspector(); }
    return openObjectSubmenu(action, node);
  }
  if (action === "simulate") { $("#simulation-mode").value = "fast"; $(".metrics-panel").scrollIntoView({ behavior: "smooth", block: "center" }); return runSimulation(); }
  if (action === "save") return saveModel(true);
}

async function loadExample(button) {
  if (state.robotRunning) return showToast("Stop the active routine before loading an example.");
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  try {
    const example = await api("/api/model/example");
    if (!example || !Array.isArray(example.nodes) || !Array.isArray(example.edges)) throw new Error("The example model payload is incomplete.");
    if (state.model) state.history.push(snapshotModel());
    state.future = [];
    state.model = example;
    state.selectedId = example.nodes.find((node) => node.workspace === "asset-management" || node.id === "asset-management")?.id || example.nodes[0]?.id || null;
    state.pendingTool = null;
    state.interiorTool = null;
    state.events = 0;
    $("#object-submenu").classList.add("hidden");
    $("#interior-dive").classList.add("hidden");
    selectRobotScenario("autonomous-inspection");
    changeView("3d");
    $("#model-status").textContent = "Example loaded · Asset Management autonomous inspection ready";
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
  line.innerHTML = `<span>${escapeHtml(time)}</span><strong>${escapeHtml(actor)}</strong><p>${escapeHtml(message)}</p>`;
  log.appendChild(line); log.scrollTop = log.scrollHeight;
  while (log.children.length > 45) log.firstElementChild.remove();
}

function updateMetrics(summary) {
  const value = number => Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
  $("#metric-throughput").textContent = value(summary.throughputPerHour);
  $("#metric-cycle").textContent = value(summary.averageCycle);
  $("#metric-p95").textContent = value(summary.p95Cycle);
  $("#metric-breaches").textContent = "Separate proof";
}

function consumeEvent(event) {
  state.currentJobKind = event.kind || state.currentJobKind;
  state.events += 1;
  $("#event-count").textContent = `${state.events} events`;
  if (event.snapshot) {
    if (!state.robotRunning) state.meshWorld?.setFlowState({ running: true, queues: event.snapshot.queues || {}, ...(event.fromNodeId ? { fromNodeId: event.fromNodeId, toNodeId: event.nodeId, activeNodeId: event.nodeId, durationMs: 800, startedAt: performance.now() } : {}) });
    const total = Number($("#entity-count").value || 24);
    $("#clock-label").textContent = `t = ${Number(event.snapshot.clock).toFixed(2)} s`;
    $("#timeline-fill").style.width = `${Math.min(100, (event.snapshot.completed / total) * 100)}%`;
    $("#metric-breaches").textContent = "Not evaluated";
  }
  if (["arrival", "transfer", "service_start"].includes(event.type)) logLine(event.type.replaceAll("_", " "), `${event.entityId} → ${event.nodeId}`);
  if (event.type === "audit_breach") logLine("Governance", `${event.entityId} flagged for control review`, true);
  if (event.type === "monte_carlo_run") logLine("Monte Carlo", `run ${event.run}/${event.runs}: throughput ${event.result.throughput}`);
  if (event.type === "simulation_complete") {
    if (!state.robotRunning) state.meshWorld?.setFlowState({ running: false });
    updateMetrics(event.summary); $("#model-status").textContent = "Experiment complete"; $("#run-simulation").disabled = false;
    logLine("orchestrator", `completed ${event.summary.completed} entities; p95 cycle ${event.summary.p95Cycle}`);
  }
  if (event.type === "orchestrator_analysis") logLine("local mock planner", event.analysis || event.message || "Preparing a bounded operations plan; Joule NOT CONNECTED");
  if (event.type === "specialist_launched") logLine(event.specialist, `step ${event.step}: ${event.objective}`);
  if (event.type === "provider_status") logLine("provider", `${event.providerId}: ${event.status}`);
  if (event.type === "robot_routine_started") {
    state.robotRunning = true;
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
  if (event.type === "shelf_exception") {
    logLine("Shelf exception", `${event.caseContext.sku}: ${event.rackState}. No material dispatch; resolve the shelf condition before retrying.`, true);
    $("#model-status").textContent = `Stopped · ${event.rackState}`;
  }
  if (event.type === "guardrail_override") logLine("Guardrail override", `${event.label} · authorized and recorded to the audit trail at ${new Date(event.at).toLocaleTimeString()}`, true);
  if (event.type === "resource_proposal") logLine("Demo resource selection", `${event.proposal.kind}: ${event.proposal.selected?.name || "NO FEASIBLE RESOURCE"} · synthetic candidates, human review required`);
  if (event.type === "robot_command") {
    const status = event.disposition === "approved_simulation" ? "human approved · simulated" : event.disposition === "shadow_mock" ? "shadow · synthetic inputs" : "simulated";
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
    logLine("robot controller", `${event.cycles} simulated cycle${event.cycles === 1 ? "" : "s"} completed`);
  }


  if (event.type === "job_complete" && event.result?.plan) {
    state.agentPlan = event.result;
    if ($("#workspace-agent-plan")) $("#workspace-agent-plan").textContent = JSON.stringify(state.agentPlan, null, 2);
    logLine("local mock planner", event.result.summary || `${event.result.plan.length} local plan steps recorded. Joule NOT CONNECTED.`);
    const button = $("#run-agent-task"); button.disabled = false; button.textContent = "Start local plan";
  }
  if (event.type === "job_failed") { if (state.currentJobKind === "simulation") { $("#model-status").textContent = "Experiment failed"; $("#run-simulation").disabled = false; } logLine("system", event.error, true); }
  if (event.type === "job_failed") {
    const agent = $("#run-agent-task"), robot = $("#run-robot-routine");
    if (agent) { agent.disabled = false; agent.textContent = "Start local plan"; }
    if (robot && state.currentJobKind === "robot_routine") { robot.disabled = false; robot.textContent = "Run routine"; state.meshWorld?.setFlowState({ running: false }); }
  }
  if (event.type === "approval_required") logLine("human approval", `${event.stepId}: waiting for an explicit operator decision`, true);
  if (event.type === "approval_resolved") logLine("human approval", `${event.stepId}: ${event.decision} by ${event.approvedBy}`);
  if (event.kind === "robot_routine" && ["job_complete", "job_failed", "job_cancelled"].includes(event.type)) state.robotRunning = false;
  state.executionUI?.event(event);
}

function watchJob(jobId, endpoint) {
  state.sources.get(jobId)?.close();
  const source = new EventSource(endpoint);
  state.sources.set(jobId, source);
  let lastSequence = 0;
  source.onmessage = (event) => consumeEvent(JSON.parse(event.data));
  ["job_started", "service_start", "service_complete", "arrival", "transfer", "entity_complete", "audit_breach", "audit_pass", "monte_carlo_run", "simulation_complete", "job_complete", "job_failed", "connection_decision", "orchestrator_analysis", "specialist_launched", "provider_status", "robot_routine_started", "grafcet_step_active", "sensor_sample", "robot_command", "grafcet_transition_fired", "robot_routine_complete"].forEach((type) => {
    source.addEventListener(type, (event) => {
      const payload = JSON.parse(event.data);
      if (payload.sequence && payload.sequence <= lastSequence) return;
      lastSequence = payload.sequence || lastSequence;
      consumeEvent(payload);
      if (type === "job_complete" || type === "job_failed") { source.close(); state.sources.delete(jobId); }
      if (type === "connection_decision") showToast(payload.decision.allowed ? "Dry-run adapter permitted." : "Adapter denied by safety policy.");
    });
  });
  for (const type of ["routine_transfer", "approval_required", "approval_resolved", "approval_expired", "job_cancelled", "shelf_exception", "resource_proposal", "guardrail_override"]) source.addEventListener(type, (event) => {
    const payload = JSON.parse(event.data); if (payload.sequence <= lastSequence) return; lastSequence = payload.sequence;
    consumeEvent(payload);
    if (type === "job_cancelled") { source.close(); state.sources.delete(jobId); }
  });
  source.onerror = () => { if (state.robotRunning) $("#mission-detail").textContent = "Event stream interrupted; reconnecting. Server approvals remain enforced."; };
  state.currentJob = jobId;
}

async function runSimulation() {
  if (state.robotRunning) return showToast("Finish or stop the robot routine before running a DES experiment in the same twin.");
  if (!state.model) return;
  const button = $("#run-simulation"); button.disabled = true; state.events = 0; $("#event-count").textContent = "0 events"; $("#timeline-fill").style.width = "0%"; $("#model-status").textContent = "Experiment queued";
  const payload = { mode: $("#simulation-mode").value, entities: Number($("#entity-count").value), runs: 5, seed: 42 };
  state.meshWorld?.setFlowState({ running: true, queues: {} });
  logLine("local DES", `queued ${payload.mode}; ${payload.entities} entities`);
  try {
    const job = await api("/api/simulations", { method: "POST", body: JSON.stringify(payload) });
    logLine("worker", `${job.jobId} accepted as background job`); watchJob(job.jobId, job.events);
  } catch (error) {
    button.disabled = false; $("#model-status").textContent = "Experiment not started";
    state.meshWorld?.setFlowState({ running: false }); showToast(error.message); logLine("local DES", error.message, true);
  }
}

async function runAgentTask() {
  if ($("#run-agent-task").disabled) return;
  const goal = $("#agent-goal").value.trim();
  if (!goal) return showToast("Describe a bounded goal first.");
  const button = $("#run-agent-task"); button.disabled = true; button.textContent = "Planning locally…";
  state.agentPlan = null;
  if ($("#workspace-agent-plan")) $("#workspace-agent-plan").textContent = "Local mock plan pending. Joule NOT CONNECTED.";
  try {
    const job = await api("/api/agent/tasks", { method: "POST", body: JSON.stringify({ goal }) });
    logLine("local mock planner", `queued as ${job.jobId}; Joule NOT CONNECTED`);
    watchJob(job.jobId, job.events);
  } catch (error) {
    button.disabled = false; button.textContent = "Start local plan";
    logLine("local mock planner", error.message, true); showToast(error.message);
    if ($("#workspace-agent-plan")) $("#workspace-agent-plan").textContent = `Plan failed: ${error.message}`;
  }
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
  if (state.robotRunning) return showToast("Finish or stop the routine before changing the showcase.");
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
  let kpiPanel = $("#routine-kpi-profile");
  if (!kpiPanel) { kpiPanel = document.createElement("details"); kpiPanel.id = "routine-kpi-profile"; kpiPanel.className = "operations-scope"; $("#grafcet-detail").after(kpiPanel); }
  kpiPanel.innerHTML = `<summary>KPI instrumentation · ${escapeHtml(scenario.domain)}</summary><p>Required inputs, not measured results. Use Industrial timing experiments for calculations supported by supplied data.</p><ul>${(scenario.kpiProfile?.metrics || []).map(metric => `<li><strong>${escapeHtml(metric.name)}</strong>: ${escapeHtml(metric.definition)}<br><small>Requires: ${escapeHtml(metric.requiredInputs)}</small></li>`).join("")}</ul>`;
  let governance = $("#routine-governance-profile");
  if (!governance) { governance = document.createElement("details"); governance.id = "routine-governance-profile"; governance.className = "operations-scope"; kpiPanel.after(governance); }
  governance.innerHTML = `<summary>Safety & governance · reference mapping, NOT certification</summary><p>${escapeHtml(scenario.governance?.robotBoundary)}</p><p>${escapeHtml(scenario.governance?.transportBoundary)}</p><ul>${(scenario.governance?.standards || []).map(ref => `<li>${escapeHtml(ref.code)} — ${escapeHtml(ref.purpose)} <a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer">Official scope</a></li>`).join("")}</ul><p>Live commands remain blocked. Qualified integrator review and local safety controls are required.</p>`;
  setGrafcetActive(scenario.grafcet.initial);
  $("#robot-sensor").textContent = scenario.sensors.slice(0, 2).join(" + ");
  $("#robot-command").textContent = "routine ready";
  state.executionUI?.select(id);
  state.jouleChat?.refreshSelection();
}

function renderRobotLab(scenarios) {
  state.robotScenarios = scenarios;
  $("#robot-scenario-tabs").innerHTML = scenarios.map((scenario) => `<button class="robot-scenario-card" data-scenario-id="${scenario.id}"><small>${scenario.domain.toUpperCase()}</small><strong>${scenario.name}</strong><span>${scenario.robot}</span></button>`).join("");
  const preferred = scenarios.find((scenario) => scenario.id === state.model?.activeScenarioId) || scenarios.find((scenario) => scenario.id === "autonomous-inspection") || scenarios[0];
  if (preferred) selectRobotScenario(preferred.id);
  state.executionUI?.scenario(scenarios);
}

async function loadRobotCell() {
  if (state.robotRunning) return showToast("Stop the active routine before changing its model.");
  const scenario = state.activeRobotScenario;
  if (!scenario) return showToast("Choose a robot scenario first.");
  if (state.model) state.history.push(snapshotModel());
  state.future = [];
  try {
    const result = await api(`/api/robot-scenarios/${scenario.id}/compose`, { method: "POST", body: "{}" });
    state.model = result.model;
    state.selectedId = scenario.grafcet.steps[0]?.nodeId || scenario.model.nodes[0]?.id || null;
    renderModel(); renderInspector(); changeView("3d");
    $("#model-status").textContent = `${scenario.domain} local workcell composed with governed operations context`;
    state.meshWorld?.setFlowState({ running: false, queues: {} });
    document.querySelector(".model-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    const summary = result.composition;
    logLine("digital twin", `${summary.platformObjects} operations context objects + ${summary.robotObjects} robot assets connected by ${summary.connections} routes`);
    showToast(`${scenario.name} connected to the SAP-to-physical 3D model.`);
  } catch (error) {
    state.history.pop();
    logLine("robot lab", `Unified model load failed: ${error.message}`, true);
    showToast(`Could not combine the workcell: ${error.message}`);
  }
}

function advanceRobotRoutine() {
  if (state.robotRunning) return;
  const scenario = state.activeRobotScenario;
  if (!scenario) return;
  const steps = scenario.grafcet.steps, current = steps[state.robotManualIndex % steps.length], transition = scenario.grafcet.transitions.find((item) => item.from === current.id);
  setGrafcetActive(current.id, transition?.id || null);
  $("#robot-sensor").textContent = `${current.sensor}: ${current.expected}`;
  $("#robot-command").textContent = current.command;
  state.robotManualIndex = (state.robotManualIndex + 1) % steps.length;
  changeView("3d");
  state.meshWorld?.focusNode?.(current.nodeId);
  showToast("Step preview only — use Run in twin to execute with approval and evidence.");
  logLine("GRAFCET preview", `${current.id} ${current.label} · not executed`);
}

async function runRobotRoutine() {
  if (state.robotRunning) return;
  const scenario = state.activeRobotScenario;
  if (!scenario) return;
  const caseContext = { sku: $("#case-sku").value, rfidEpc: $("#case-rfid").value, quantity: Number($("#case-quantity").value), destination: $("#case-destination").value, rackState: $("#case-rack-state").value };
  const guardrails = { allowZoneC: $("#guardrail-zone-c").checked, allowHeavyLift: $("#guardrail-heavy-lift").checked };
  const button = $("#run-robot-routine"), payload = { scenarioId: scenario.id, mode: $("#robot-mode").value, autonomy: $("#robot-autonomy").value, guardrails, cycles: Number($("#robot-cycles").value), speed: Number($("#robot-speed").value), caseContext };
  button.disabled = true; button.textContent = "Routine running…";
  state.grafcetVisited = new Set(); state.activeGrafcetTransition = null;
  try {
    if (state.model.activeScenarioId !== scenario.id || !state.model.nodes.some((node) => node.id === scenario.grafcet.steps[0].nodeId)) await loadRobotCell();
    if (state.model.activeScenarioId !== scenario.id) throw new Error("The selected scenario could not be loaded into the twin.");
    for (const node of state.model.nodes.filter(node => node.visual === "rack")) Object.assign(node, caseContext);
    renderModel();
    const job = await api("/api/robot-routines", { method: "POST", body: JSON.stringify(payload) });
    state.robotRunning = true;
    state.executionUI?.started(job.jobId);
    $("#interior-dive").classList.add("hidden"); $("#object-submenu").classList.add("hidden");
    changeView("3d");
    document.querySelector(".workspace-grid").classList.add("twin-focused");
    $("#mission-focus").textContent = "Show panels";
    state.meshWorld?.fit?.();
    $(".model-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    logLine("robot lab", `${scenario.name} queued in ${payload.mode} mode as ${job.jobId}`);
    watchJob(job.jobId, job.events);
    return job;
  } catch (error) {
    button.disabled = false; button.textContent = "Run routine";
    state.meshWorld?.setFlowState({ running: false });
    state.executionUI?.failed(error.message);
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
    model: [["select", "↖", "Select"], ["connect", "＋", "BDC Connect"], ["context", "◈", "Operations Context"], ["physical", "▣", "Workcell"], ["approval", "⌑", "Approval"], ["save", "▣", "Save Snapshot"], ["undo", "↶", "Undo"], ["redo", "↷", "Redo"]],
    simulate: [["select", "↖", "Select"], ["run", "▶", "Run"], ["realtime", "◉", "Real-time"], ["monte", "∿", "Monte Carlo"], ["rewind", "↺", "Reset clock"], ["save", "▣", "Save Snapshot"]],
    integrate: [["connections", "⌘", "Connection Settings"], ["connect", "◈", "SAP BDC Connect"], ["agent", "✦", "Joule"]],
    audit: [["approval", "⌑", "Human Approval"], ["evidence", "▤", "Evidence & Audit"], ["save", "▣", "Save Snapshot"]],
    agent: [["agent", "✦", "Joule · Local Mock"], ["trace", "⇄", "Recorded Trace"], ["connections", "⌘", "Connection Settings"]],
    robot: [["robotlab", "◇", "Open Embodied AI Lab"], ["loadcell", "▣", "Connect Workcell"], ["stepgrafcet", "↦", "Next GRAFCET"], ["runroutine", "▶", "Run Routine"], ["shadow", "◉", "Shadow Mode"], ["save", "▣", "Save Snapshot"]]
  };
  $("#ribbon-tools").replaceChildren(...sets[tab].map(([id, glyph, label]) => {
    const button = document.createElement("button"); button.className = "tool-button"; button.dataset.tool = (id === "select" || Boolean(objectDefinitions[id])) ? id : ""; button.dataset.command = button.dataset.tool ? "" : id; button.innerHTML = `${glyph}<span>${label}</span>`; return button;
  }));
}

function handleRibbonAction(button) {
  const tool = button.dataset.tool;
  const command = button.dataset.command;
  if (tool) return tool === "select" ? showToast("Selection mode active.") : openObjectSubmenu(tool);
  if (command === "run" || command === "realtime" || command === "monte") { $("#simulation-mode").value = command === "monte" ? "monte-carlo" : command === "run" ? "fast" : command; return runSimulation(); }
  if (command === "rewind") { $("#clock-label").textContent = "t = 0.00"; $("#timeline-fill").style.width = "0%"; showToast("Simulation clock reset."); return; }
  if (command === "connections" || command === "trace") return handleOperation(command);

  if (command === "robotlab") { document.querySelector("#robot-lab").scrollIntoView({ behavior: "smooth", block: "start" }); return showToast("Embodied AI Lab opened."); }
  if (command === "loadcell") return loadRobotCell();
  if (command === "stepgrafcet") return advanceRobotRoutine();
  if (command === "runroutine") return runRobotRoutine();
  if (command === "shadow") { if (state.robotRunning) return; $("#robot-mode").value = "shadow"; $("#mission-mode").value = "shadow"; document.querySelector("#robot-lab").scrollIntoView({ behavior: "smooth", block: "start" }); return showToast("Shadow mode selected: synthetic inputs only, physical commands blocked."); }
  if (command === "save") return saveModel(true);
  if (command === "undo") return undo();
  if (command === "redo") return redo();
}

function changeView(view) {
  state.mode = view;
  $$("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#model-canvas").classList.toggle("hidden", view !== "2d"); $("#scene-3d").classList.toggle("hidden", view !== "3d");
  $("#stage-hint-text").textContent = view === "2d" ? "SAP business context above · physical execution below · drag to rearrange" : state.model?.layout === "unified-campus" ? "Governed context → local mock plan → simulated physical routine → evidence" : "Rendered local workcells · click any object to open its operations workspace";
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
  state.executionUI = createExecutionUI({ api, getModel: () => state.model, getWorld: () => state.meshWorld, getScenario: () => state.activeRobotScenario, run: runRobotRoutine, selectScenario: selectRobotScenario, inspectNode: node => openObjectSubmenu(toolForNode(node), node), canApprove: state.session.permissions.approve });
  state.meshWorld = createMeshWorld($("#webgl-world"), { onFrame: (frame) => state.executionUI.frame(frame), onSelect: (id) => { const node = nodeById(id); state.selectedId = id; renderModel(); renderInspector(); if (node) openObjectSubmenu(toolForNode(node), node); } });
  state.interiorWorld = createMeshWorld($("#interior-canvas"), { deepDive: true });
  renderModel(); renderInspector();
  renderRobotLab(await api("/api/robot-scenarios"));
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
    if (stepId && !state.robotRunning) {
      setGrafcetActive(stepId);
      state.executionUI?.inspectStep?.(state.activeRobotScenario.grafcet.steps.find(step => step.id === stepId));
    }
    const transitionId = event.target.closest("[data-transition-id]")?.dataset.transitionId;
    if (transitionId && !state.robotRunning) {
      const transition = state.activeRobotScenario.grafcet.transitions.find(item => item.id === transitionId);
      if (transition) state.executionUI?.inspectTransition?.(transition, state.activeRobotScenario.grafcet.steps.find(step => step.id === transition.from));
    }
  });
  $(".routine-tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-routine-tab]")?.dataset.routineTab;
    if (tab) renderRoutineTab(tab);
  });
  $("#agent-goal").addEventListener("keydown", (event) => { if (event.key === "Enter") runAgentTask(); });
  $("#guide-close").addEventListener("click", () => $("#guide-panel").classList.add("hidden"));
  $("#example-runbook-close").addEventListener("click", () => $("#example-runbook").classList.add("hidden"));
  $("#runbook-steps").addEventListener("click", (event) => { const action = event.target.closest("[data-runbook-action]")?.dataset.runbookAction; if (action) runExampleAction(action); });
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => changeView(button.dataset.view)));
  $("#ribbon-tools").addEventListener("click", (event) => { const button = event.target.closest("button"); if (button) handleRibbonAction(button); });
  $("#submenu-close").addEventListener("click", () => $("#object-submenu").classList.add("hidden"));
  $("#submenu-place").addEventListener("click", () => { const tool = state.pendingTool; if (tool) { addObject(tool); $("#submenu-place").textContent = "Place another"; showToast("Mesh placed on the shared 3D plane."); } });
  $("#submenu-inspect").addEventListener("click", () => { $(".inspector-panel").scrollIntoView({ behavior: "smooth", block: "nearest" }); showToast("Inspector opened while the deep-dive scene remains active."); });
  $("#interior-back").addEventListener("click", () => { $("#interior-dive").classList.add("hidden"); changeView(state.previousView || "2d"); });
  $("#interior-close").addEventListener("click", () => { $("#interior-dive").classList.add("hidden"); changeView(state.previousView || "2d"); });
  $("#interior-place").addEventListener("click", () => { if (state.interiorTool) { addObject(state.interiorTool); $("#interior-place").textContent = "Place another"; showToast("Mesh placed on the shared model plane."); } });
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-operation]")?.dataset.operation;
    if (action) handleOperation(action).catch((error) => { showToast(error.message); if ($("#workspace-error")) $("#workspace-error").textContent = error.message; });
  });
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
  $$("[data-zoom]").forEach((button) => button.addEventListener("click", () => { const action = button.dataset.zoom; if (state.mode === "3d") { if (action === "fit") state.meshWorld?.fit?.(); else state.meshWorld?.setCamera({ zoom: action === "in" ? 1.15 : 1 / 1.15 }); return; } state.zoom = action === "in" ? Math.min(1.3, state.zoom + .1) : action === "out" ? Math.max(.7, state.zoom - .1) : 1; $("#zoom-label").textContent = `${Math.round(state.zoom * 100)}%`; $("#model-canvas").style.transform = `scale(${state.zoom})`; }));
  $("#palette-search").addEventListener("input", (event) => $$(".library-item").forEach((item) => item.classList.toggle("hidden", !item.textContent.toLowerCase().includes(event.target.value.toLowerCase()))));
  const deepLink = new URLSearchParams(location.search);
  changeView(deepLink.get("view") === "2d" ? "2d" : "3d");
  const activeJobs = await api("/api/robot-routines/active");
  for (const job of activeJobs) { state.executionUI.started(job.id); watchJob(job.id, `/api/jobs/${job.id}/events`); }
  try {
    state.operationsScope = await api("/api/operations-scope");
    $("#operations-scope").textContent = JSON.stringify(state.operationsScope, null, 2);
  } catch (error) { $("#operations-scope").textContent = `Scope status unavailable: ${error.message}`; }
  try { await initConnectionsUI({ api }); }
  catch (error) { $("#connections-settings").textContent = `Connection settings unavailable: ${error.message}`; }
  try { await initExperimentsUI({ api, getModel: () => state.model }); }
  catch (error) { $("#industrial-experiments").textContent = `Industrial experiments unavailable: ${error.message}`; }
  state.jouleChat = initJouleChat({ api, getScenario: () => state.activeRobotScenario, runRecipe: async workflow => {
    if (state.robotRunning) throw new Error("Finish or stop the current routine.");
    selectRobotScenario(workflow.scenarioId);
    $("#robot-mode").value = workflow.mode; $("#robot-cycles").value = workflow.cycles; $("#robot-speed").value = workflow.speed;
    for (const [key, id] of Object.entries({ sku: "case-sku", rfidEpc: "case-rfid", quantity: "case-quantity", destination: "case-destination", rackState: "case-rack-state" })) $("#" + id).value = workflow.caseContext[key];
    const job = await runRobotRoutine(); if (!job) throw new Error("Routine was not queued.");
  } });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

boot().catch((error) => { showToast(error.message); logLine("system", error.message, true); });
