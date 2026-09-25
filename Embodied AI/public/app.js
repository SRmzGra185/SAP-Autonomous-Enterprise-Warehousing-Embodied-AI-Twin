import { createMeshWorld } from "./webgl-world.js";
import { createExecutionUI } from "./execution-ui.js";
import { initExperimentsUI } from "./experiments-ui.js";
import { rememberEdit, travelHistory, moveObject, setObjectCapacity, addTrail, buildObjectCatalog } from "./editor-core.js";
import { UNITREE_MODELS, isUnitree, unitreeModelKey, setRobotRepresentation } from "./robot-models.js";

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
  editTool: "select",
  trailStart: null,
  dragBefore: null,
  simulationRunning: false,
  experimentRunning: false,
  saveQueue: Promise.resolve(),
  camera: { x: -12, y: -18, zoom: 1 },
  operationsScope: null,
  agentPlan: null,
  pendingTool: null,
  meshWorld: null,
  deepDiveWorld: null,
  interiorWorld: null,
  session: null,
  interiorTool: null,
  interiorNodeId: null,
  interiorDraft: null,
  previousView: "2d",
  robotScenarios: [],
  activeRobotScenario: null,
  activeGrafcetStep: null,
  activeGrafcetTransition: null,
  grafcetVisited: new Set(),
  robotManualIndex: 0,
  measuredKpis: null
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

function canEditModel() { return state.editMode && !state.robotRunning && !state.simulationRunning && !state.experimentRunning; }
function syncEditorControls() {
  const enabled=canEditModel(), node=state.model?.nodes.find(n=>n.id===state.selectedId);
  for (const button of $$('[data-command="undo"]')) button.disabled=!enabled || !state.history.length;
  for (const button of $$('[data-command="redo"]')) button.disabled=!enabled || !state.future.length;
  for (const button of $$('[data-editor-tool]')) { button.classList.toggle("active",button.dataset.editorTool===state.editTool); button.setAttribute("aria-pressed",String(button.dataset.editorTool===state.editTool)); }
  for(const input of $$('[data-capacity-input]')) { input.disabled=!enabled || !node; input.value=node?.capacity ?? ""; }
  for(const button of $$('[data-capacity-delta]')) button.disabled=!enabled || !node;
  for(const select of $$('[data-robot-model]')) select.disabled=!enabled;
  if($("#selected-resource")) $("#selected-resource").textContent=node?.name || "Select an object";
  document.body.dataset.editorTool=state.editTool;
  $("#stage-hint-text").textContent=state.editTool==="trail" ? (state.trailStart ? "Trail: choose the destination · Esc cancels" : "Trail: click the source, then the destination · does not rewrite GRAFCET") : "Select: drag an object to move · double-click to open · drag empty floor to orbit · Shift + drag to pan";
}
function persistEdit() { void saveModel(false).catch(error=>{showToast("Not saved: "+error.message);logLine("model",error.message,true);}); }
function finishEdit(before) {
  if (!rememberEdit(state,before)) { syncEditorControls(); return false; }
  renderModel(); renderInspector(); persistEdit(); return true;
}
function selectObject(id) {
  if(!nodeById(id)) return;
  state.selectedId=id;
  if(state.editTool==="trail" && canEditModel()) {
    if(!state.trailStart) { state.trailStart=id; showToast("Trail source selected. Click a destination."); }
    else {
      try { const before=snapshotModel(); addTrail(state.model,state.trailStart,id); state.trailStart=null; finishEdit(before); showToast("Trail created. GRAFCET execution order is unchanged."); }
      catch(error) { showToast(error.message); }
    }
  }
  state.meshWorld?.setSelected(id); renderInspector(); syncEditorControls();
  for(const item of $$(".node-group")) item.classList.toggle("selected",item.dataset.id===id);
}
function changeCapacity(value) {
  if(!canEditModel()) return showToast("Enable Edit Mode and finish active runs before editing capacity.");
  try { const before=snapshotModel(); setObjectCapacity(state.model,state.selectedId,value); finishEdit(before); }
  catch(error) { showToast(error.message); syncEditorControls(); }
}
function beginMove(id) { state.dragBefore=snapshotModel(); selectObject(id); }
function endMove(cancelled=false) {
  const before=state.dragBefore; state.dragBefore=null;
  if(!before) return;
  if(cancelled) { state.model=before; renderModel(); renderInspector(); }
  // Keep the clicked SVG element alive on no-op pointerup so dblclick can fire.
  else if(!finishEdit(before)) { renderInspector(); }
}

function nodeById(id) {
  return state.model.nodes.find((node) => node.id === id);
}

function robotModelControl(node, target) {
  if (!isUnitree(node)) return "";
  return `<section class="robot-model-control"><h3>Unitree model</h3>
    <label>Robot representation <select data-robot-model="${escapeHtml(target)}" ${canEditModel() ? "" : "disabled"}>
      ${Object.entries(UNITREE_MODELS).map(([key,model])=>`<option value="${key}" ${unitreeModelKey(node)===key ? "selected" : ""}>${escapeHtml(model.label)}</option>`).join("")}
    </select></label><p>H1 is the humanoid; the quadruped model is not yet specified. Changes the 3D mesh only: role, routes, capacity and demo timing stay unchanged. No hardware is connected.</p></section>`;
}
function refreshInteriorRobot() {
  const node=state.interiorNodeId ? nodeById(state.interiorNodeId) : state.interiorDraft;
  if (!node) { $("#interior-dive").classList.add("hidden"); return; }
  $("#interior-title").textContent=node.name;
  $("#interior-description").textContent=node.subtitle;
  $("#interior-capacity").textContent=`${node.capacity} resources`;
  $("#interior-service").textContent=`${node.service} units`;
  state.interiorWorld?.setModel({nodes:[{...node,id:"interior",x:550,y:325,z:0}],edges:[]});
  positionInteriorCamera(node);
  renderInterfaceTab(state.interiorTool); syncEditorControls();
}
function positionInteriorCamera(node) {
  const humanoid=node.visual==="unitreeHumanoid";
  state.interiorWorld?.setCamera(isUnitree(node)
    ? {azimuth:1.03,elevation:.27,distance:humanoid?3.8:3.2,target:[0,humanoid ? .92 : .47,0]}
    : {azimuth:-.62,elevation:.34,distance:6,target:[0,.65,0]});
}
function changeRobotRepresentation(target, visual) {
  if(!canEditModel()) return showToast("Enable Edit Mode and finish active runs before changing a robot.");
  try {
    if(target==="preview") {
      if(!state.interiorDraft || !isUnitree(state.interiorDraft)) return;
      setRobotRepresentation({nodes:[{...state.interiorDraft,id:"preview"}]},"preview",visual);
      state.interiorDraft.visual=visual;
      // Palette prototypes use the chosen model's name; existing workcell roles are preserved.
      state.interiorDraft.name=UNITREE_MODELS[visual].label;
      state.interiorDraft.subtitle=UNITREE_MODELS[visual].description;
      refreshInteriorRobot(); return;
    }
    const before=snapshotModel();
    setRobotRepresentation(state.model,target,visual); finishEdit(before);
    if(state.interiorNodeId===target && !$("#interior-dive").classList.contains("hidden")) refreshInteriorRobot();
    showToast(UNITREE_MODELS[visual].label+" applied. Undo available; hardware and demo timing unchanged.");
  } catch(error) { showToast(error.message); renderInspector(); }
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
  const minX=Math.min(0,...state.model.nodes.map(n=>n.x-30)), minY=Math.min(0,...state.model.nodes.map(n=>n.y-30));
  svg.setAttribute("viewBox", state.dragViewBox || `${minX} ${minY} ${Math.max(1120,...state.model.nodes.map(n=>n.x+nodeWidth+30))-minX} ${Math.max(650,...state.model.nodes.map(n=>n.y+115))-minY}`);
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
    group.addEventListener("click", (event) => { event.stopPropagation(); selectObject(node.id); });
    group.addEventListener("dblclick", () => openObjectSubmenu(toolForNode(node), node));
    svg.appendChild(group);
  }

  render3d();
  syncEditorControls();
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
  syncEditorControls();
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
      <div class="inspector-section"><h3>External connection scope</h3><p>SAP BDC Connect · Joule</p><p>Local mock runtime. Joule NOT CONNECTED.</p></div>
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
    ${robotModelControl(target,target.id)}
    <div class="inspector-section"><h3>DES behavior</h3>
      <label class="capacity-field">Parallel capacity <input data-capacity-input type="number" min="1" max="32" step="1" value="${target.capacity}" ${canEditModel() ? "" : "disabled"} /></label><p>How many items this resource can handle at once. Model change; Undo is available.</p>
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
  if (state.editTool!=="select" || !canEditModel()) return;
  state.dragId = id;
  state.dragPointerOrigin={x:event.clientX,y:event.clientY};
  state.dragMoved=false;
  beginMove(id);
  state.dragViewBox=$("#model-canvas").getAttribute("viewBox");
  const point=new DOMPoint(event.clientX,event.clientY).matrixTransform($("#model-canvas").getScreenCTM().inverse()), node=nodeById(id);
  state.dragOffset={x:point.x-node.x,y:point.y-node.y};
  event.preventDefault();
  document.addEventListener("pointermove", dragMove);
  document.addEventListener("pointerup", endDrag, { once: true });
  document.addEventListener("pointercancel", cancelDrag, { once: true });
}

function dragMove(event) {
  if (!state.dragId) return;
  if (!state.dragMoved && Math.hypot(event.clientX-state.dragPointerOrigin.x,event.clientY-state.dragPointerOrigin.y)<4) return;
  state.dragMoved=true;
  const svg = $("#model-canvas");
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.getScreenCTM().inverse());
  moveObject(state.model,state.dragId,point.x-state.dragOffset.x,point.y-state.dragOffset.y);
  renderModel();
}

async function endDrag() {
  document.removeEventListener("pointermove", dragMove);
  document.removeEventListener("pointercancel",cancelDrag);
  if (!state.dragId) return;
  state.dragId = null;
  state.dragViewBox=null; endMove();
}
function cancelDrag() { document.removeEventListener("pointermove",dragMove); document.removeEventListener("pointerup",endDrag); document.removeEventListener("pointercancel",cancelDrag); state.dragId=null; state.dragViewBox=null; endMove(true); }

const domainScenarios = {
  "asset-management": "autonomous-inspection",
  manufacturing: "adaptive-assembly",
  orchestration: "autonomous-orchestration",
  logistics: "warehouse-fulfillment"
};

let objectDefinitions = Object.fromEntries([
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
].map(([workspace, name, subtitle, kind, visual, color]) => [workspace, { workspace, name, subtitle, kind:kind==="process"?"bdc":kind, visual, color, capacity: 2, service: 3 }]));

function renderPalette() {
  const query=$("#palette-search").value.trim().toLowerCase(), list=$("#library-list"); list.replaceChildren();
  const groups=new Map();
  for(const [key,definition] of Object.entries(objectDefinitions)) {
    if(![definition.name,definition.subtitle,definition.catalogGroup].join(" ").toLowerCase().includes(query)) continue;
    const group=definition.catalogGroup || "Operations";
    if(!groups.has(group)) { const details=document.createElement("details"), summary=document.createElement("summary"); summary.textContent=group; details.open=Boolean(query)||group==="Operations"; details.append(summary); list.append(details); groups.set(group,details); }
    const button=document.createElement("button"); button.className="library-item"; button.dataset.tool=key;
    button.innerHTML=`<span class="object-icon"><span class="icon-model ${escapeHtml(definition.visual)}"></span></span><span><strong>${escapeHtml(definition.name)}</strong><small>${escapeHtml(definition.subtitle)}</small></span>`;
    groups.get(group).append(button);
  }
  if(!groups.size) list.textContent="No objects match your search.";
}

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
    <div class="operations-actions">${tool === "connect" ? operationButton("analytics", '<i class="joule-icon" aria-hidden="true"></i>Joule analytics · scenario insights') : ""}${operationButton("grafcet", "Inspect current routine")}</div>`;
  if (tool === "agent") content = `
    <h4 class="workspace-joule-title"><i class="joule-icon" aria-hidden="true"></i>Joule · NOT CONNECTED</h4><p>This action starts a bounded local mock plan. It does not call Joule or execute its recommendations.</p>
    <label for="workspace-agent-goal">Operations goal</label><textarea id="workspace-agent-goal" maxlength="2000" rows="3">${escapeHtml($("#agent-goal").value)}</textarea>
    <div class="operations-actions">${operationButton("joule-chat", '<i class="joule-icon" aria-hidden="true"></i>Open Joule planner & recipes')}${operationButton("agent-start", "Start local mock plan")}${operationButton("trace", "Open recorded trace")}</div>
    <h4>Latest local plan</h4><pre id="workspace-agent-plan">${escapeHtml(state.agentPlan ? JSON.stringify(state.agentPlan, null, 2) : "No completed local plan yet.")}</pre>`;
  if (tool === "approval") content = `
    <h4>Assisted execution</h4><p>Assisted mode pauses before each simulated action. Approve or reject the actual pending request in the twin. Live execution remains locked; shadow uses synthetic inputs.</p>
    <div class="operations-actions">${operationButton("assisted", "Select assisted mode")}${operationButton("approval", "View pending approval")}${operationButton("runroutine", "Run selected routine")}</div>`;
  if (tool === "evidence") content = `
    <h4>Recorded evidence</h4><p>${state.events} received events in this session. Export contains the routine events and approvals captured by the execution controls.</p>
    <div class="operations-actions">${operationButton("timeline", "View event timeline")}${operationButton("export", "Export routine evidence")}${operationButton("audit", "Load audit trail")}</div>
    <pre id="workspace-audit">Load the tenant-scoped audit trail to inspect actual server records.</pre>`;
  const robot=state.interiorNodeId ? nodeById(state.interiorNodeId) : state.interiorDraft;
  return `<div class="operations-workspace">${notice}${robotModelControl(robot,state.interiorNodeId || "preview")}${content}<p class="operations-error" role="status" id="workspace-error"></p></div>`;
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
  state.interiorNodeId=sourceNode?.id || null; state.interiorDraft=structuredClone(definition);
  $("#interior-dive").classList.remove("hidden");
  $("#interior-title").textContent = definition.name;
  $("#interior-type").textContent = profile.role;
  $("#interior-description").textContent = definition.subtitle;
  $("#interior-capacity").textContent = `${definition.capacity} resources`;
  $("#interior-service").textContent = `${definition.service} units`;
  $("#interior-role").textContent = profile.role;
  $("#interior-place").disabled = !canEditModel() || Boolean(sourceNode);
  $("#interior-place").textContent = sourceNode ? "Already in model" : "Place in model";
  $("#interface-tabs").replaceChildren();
  renderInterfaceTab(tool);
  if (state.interiorWorld) { state.interiorWorld.setModel({ nodes: [{ ...definition, id: "interior", x: 550, y: 325, z: 0 }], edges: [] }); state.interiorWorld.setSelected("interior"); positionInteriorCamera(definition); }
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
  if (action === "grafcet") reveal("#robot-lab");
  if (action === "runroutine") await runRobotRoutine();
  if (action === "agent-start") {
    $("#agent-goal").value = $("#workspace-agent-goal").value;
    await runAgentTask();
  }
  if (action === "trace") reveal(".console-panel");
  if (action === "joule-chat") { window.location.assign("/analytics.html#joule-planner"); return; }
  if (action === "analytics") { window.location.assign("/analytics.html"); return; }
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

function addObject(tool, preview = null) {
  if (!canEditModel()) { showToast("Enable Edit Mode and finish active runs before adding objects."); return; }
  const definition = preview || objectDefinitions[tool];
  if (!definition) return;
  if(state.model.nodes.length>=250) return showToast("The model supports at most 250 objects.");
  const before=snapshotModel(), id="custom-"+crypto.randomUUID();
  state.model.nodes.push({ ...structuredClone(definition), id, layer:"custom", x:420+(state.model.nodes.length%4)*90, y:750+Math.floor(state.model.nodes.length/4)*35, z:2 });
  state.selectedId=id; finishEdit(before); showToast(`${definition.name} added. Select + drag to position it; connect with Trail. Routine bindings are unchanged.`);
}

async function saveModel(show = true) {
  if(!state.session?.permissions.editModel) throw new Error("Editor permission is required to save.");
  const body=JSON.stringify(state.model);
  const request=state.saveQueue.catch(()=>{}).then(()=>api("/api/model",{method:"POST",body}));
  state.saveQueue=request;
  const saved=await request;
  if(JSON.stringify(state.model)===body) state.model=saved.model;
  if(show) showToast("Model snapshot saved.");
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
  if (!canEditModel()) return showToast("Enable Edit Mode and finish active runs before loading an example.");
  if (button) { button.disabled = true; button.setAttribute("aria-busy", "true"); }
  try {
    const example = await api("/api/model/example");
    if (!example || !Array.isArray(example.nodes) || !Array.isArray(example.edges)) throw new Error("The example model payload is incomplete.");
    const before=state.model ? snapshotModel() : null;
    state.model = example;
    rememberEdit(state,before);
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
  $$(".metric-cards .metric-card").forEach((card) => { card.classList.remove("flash"); void card.offsetWidth; card.classList.add("flash"); });
}

const aiCoreConnected = () => state.runtime?.providerId === "aicore" || state.runtime?.providerId === "anthropic";
const plannerLabel = () => aiCoreConnected() ? "Joule · AI Core" : "local mock planner";
const agentButtonLabel = () => aiCoreConnected() ? "Delegate to Joule" : "Start local plan";
const optEsc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
const OPTIMIZER_LABELS = { throughput: "Throughput", p95Cycle: "P95 cycle", averageCycle: "Avg cycle" };
const optFmt = (objective, metrics) => { if (!metrics) return "—"; if (objective === "throughput") return `${Math.round((metrics.throughputPerHour ?? metrics.throughput * 3600) || 0)}/h`; const value = metrics[objective]; return Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} s` : "—"; };

async function runOptimization() {
  if (state.robotRunning) return showToast("Finish or stop the robot routine before optimizing the same twin.");
  if (!state.model) return;
  const objective = $("#optimizer-objective").value, iterations = Number($("#optimizer-iterations").value || 3);
  state.optimizerObjective = objective; state.optimizerProposal = null; state.optimizerApplied = null;
  $("#optimizer-result").classList.add("hidden");
  const button = $("#run-optimizer"); button.disabled = true; button.textContent = "Optimizing…";
  logLine("optimizer", `propose → simulate → score loop queued for ${OPTIMIZER_LABELS[objective]} (${iterations} iterations · ${aiCoreConnected() ? "SAP AI Core" : "heuristic"})`);
  try {
    const job = await api("/api/optimizations", { method: "POST", body: JSON.stringify({ objective, iterations, candidates: 2, entities: Number($("#entity-count").value || 24), seed: 42 }) });
    logLine("worker", `${job.jobId} accepted as background job`); watchJob(job.jobId, job.events);
  } catch (error) { button.disabled = false; button.textContent = "✦ Optimize with AI"; showToast(error.message || "Optimization could not start."); }
}

function renderOptimizerResult(result) {
  state.optimizerLast = result; state.optimizerApplied = null;
  const button = $("#run-optimizer"); button.disabled = false; button.textContent = "✦ Optimize with AI";
  state.optimizerProposal = result.proposedModel || null;
  const label = OPTIMIZER_LABELS[result.objective] || result.objective, gain = result.improvementPct;
  const applied = (result.applied || []).map((item) => `<li><b>${optEsc(item.label)}</b><span>${item.ops.map((op) => optEsc(op.op === "set_capacity" ? `${op.nodeId} capacity → ${op.value}` : op.op === "set_service" ? `${op.nodeId} service → ${op.value} s` : `${op.nodeId} ⇄ ${op.otherNodeId}`)).join(" · ")}</span></li>`).join("");
  $("#optimizer-result").innerHTML = `
    <div class="optimizer-summary"><div><span class="eyebrow">${result.source === "llm" ? "LLM-PROPOSED · SAP AI CORE" : "HEURISTIC"} · ${result.evaluated} SIMULATIONS</span><strong>${label}: ${optFmt(result.objective, result.baseline)} → ${optFmt(result.objective, result.best)}</strong><small>seed-fixed DES · ${result.iterations} iteration${result.iterations === 1 ? "" : "s"}</small></div><b class="${gain > 0 ? "gain" : "flat"}">${gain > 0 ? "+" : ""}${optEsc(gain)}%</b></div>
    ${applied ? `<ul class="optimizer-ops">${applied}</ul>` : `<p class="optimizer-empty">No candidate beat the baseline within the budget. Raise iterations or the capacity budget.</p>`}
    <div class="optimizer-actions">${result.proposedModel ? `<button id="optimizer-apply" class="primary-button">Apply proposal to model</button>` : ""}<button id="optimizer-dismiss" class="secondary-button">Dismiss</button></div>`;
  $("#optimizer-result").classList.remove("hidden");
  $("#optimizer-apply")?.addEventListener("click", applyOptimizerProposal);
  $("#optimizer-dismiss").addEventListener("click", () => { $("#optimizer-result").classList.add("hidden"); state.optimizerProposal = null; });
  logLine("optimizer", gain > 0 ? `best ${label} ${optFmt(result.objective, result.best)} (+${gain}%) with ${result.applied.length} change${result.applied.length === 1 ? "" : "s"}; awaiting your approval to apply` : "no improvement found within budget");
}

async function applyOptimizerProposal() {
  if (!state.optimizerProposal) return;
  const button = $("#optimizer-apply"); button.disabled = true; button.textContent = "Applying…";
  try {
    const response = await api("/api/model", { method: "POST", body: JSON.stringify(state.optimizerProposal) });
    state.model = response.model; renderModel(); renderInspector(); render3d();
    state.optimizerProposal = null;
    const objective = state.optimizerLast?.objective || state.optimizerObjective || "throughput";
    state.optimizerApplied = { objective, predicted: state.optimizerLast?.best ?? null };
    const actions = $("#optimizer-result .optimizer-actions");
    if (actions) actions.innerHTML = `<span class="optimizer-status running">✓ Applied · running confirmation experiment…</span><button id="optimizer-dismiss" class="secondary-button">Dismiss</button>`;
    $("#optimizer-dismiss")?.addEventListener("click", () => { $("#optimizer-result").classList.add("hidden"); state.optimizerApplied = null; });
    logLine("optimizer", "proposal applied to the tenant model; running confirmation experiment");
    showToast("Optimized layout applied. Confirming with an experiment…");
    runSimulation();
  } catch (error) { button.disabled = false; button.textContent = "Apply proposal to model"; showToast(error.message || "Could not apply the proposal."); }
}

function confirmOptimizerResult(summary) {
  const applied = state.optimizerApplied; if (!applied) return;
  state.optimizerApplied = null;
  const status = $("#optimizer-result .optimizer-status"); if (!status) return;
  const label = OPTIMIZER_LABELS[applied.objective] || applied.objective, actual = optFmt(applied.objective, summary), predicted = applied.predicted ? optFmt(applied.objective, applied.predicted) : null;
  status.className = "optimizer-status done";
  status.textContent = `✓ Confirmed by simulation · ${label} ${actual}${predicted ? ` (predicted ${predicted})` : ""}`;
  logLine("optimizer", `confirmation experiment: ${label} ${actual}${predicted ? ` vs predicted ${predicted}` : ""}`);
}

// ---- Digital Twin Robotics · Unitree H1 / Go2 module ---------------------------------------
// Self-contained: its own status poll, SSE watcher, reward chart and warehouse map. Reuses the
// same Isaac executor/bridge as the warehouse Routine Lab but never touches state.robotRunning or
// the GRAFCET/mesh-world state, so the two labs cannot interfere with each other.
const h1 = { source: null, trainPoints: [], running: false, pose: null, path: null, map: null, mapVersion: 0, robot: "h1", view: "chase", plan: [] };
const h1$ = (selector) => document.querySelector(selector) || h1.pip?.document.querySelector(selector) || null;
const H1_ROBOT_LABEL = { h1: "Unitree H1", go2: "Unitree Go2" };
const H1_TASK = { h1: "Isaac-Velocity-Flat-H1-v0", go2: "Isaac-Velocity-Flat-Unitree-Go2-v0" };

function h1Log(caption) { h1$("#h1-snapshot-caption").textContent = caption; }

function h1SetGait(label) { h1$("#h1-gait-badge").textContent = label; }

function h1DrawReward() {
  const svg = h1$("#h1-reward-chart"), pts = h1.trainPoints;
  if (!svg) return;
  if (!pts.length) { svg.innerHTML = ""; return; }
  const W = 560, H = 160, pad = 26, maxIt = Math.max(...pts.map((p) => p.iteration), 1);
  const lo = Math.min(-5, ...pts.map((p) => p.reward)), hi = Math.max(22, ...pts.map((p) => p.reward));
  const x = (it) => pad + (it / maxIt) * (W - pad * 2), y = (r) => H - pad - ((r - lo) / (hi - lo)) * (H - pad * 2);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.iteration).toFixed(1)},${y(p.reward).toFixed(1)}`).join(" ");
  svg.innerHTML = `<line x1="${pad}" y1="${y(0)}" x2="${W - pad}" y2="${y(0)}" stroke="#dbe6ee"/><path d="${line}" fill="none" stroke="#5b3fd6" stroke-width="2"/><text x="${pad}" y="14" font-size="9" fill="#718391">reward</text><text x="${W - pad}" y="${H - 6}" font-size="9" fill="#718391" text-anchor="end">iteration ${maxIt}</text>`;
}

// ---- warehouse map (occupancy PNG from the executor's PhysX scan + live pose + route) ----------
function h1DrawMap() {
  const svg = h1$("#h1-map"), map = h1.map;
  if (!svg) return;
  if (!map) { svg.innerHTML = ""; h1$("#h1-map-wrap").classList.add("empty"); return; }
  h1$("#h1-map-wrap").classList.remove("empty");
  const { minX, minY, maxX, maxY } = map.bounds, W = maxX - minX, H = maxY - minY;
  const u = (x) => (x - minX).toFixed(2), v = (y) => (maxY - y).toFixed(2), unit = Math.max(W, H) / 60;
  svg.setAttribute("viewBox", `0 0 ${W.toFixed(2)} ${H.toFixed(2)}`);
  const places = map.places.map((p) => {
    const color = p.kind === "start" ? "#16a34a" : p.kind === "rack" ? "#5b3fd6" : "#1565c0";
    return `<g class="h1-map-place" data-place="${escapeHtml(p.id)}" tabindex="0" role="button" aria-label="Go to ${escapeHtml(p.name)}"><circle cx="${u(p.x)}" cy="${v(p.y)}" r="${(unit * 0.9).toFixed(2)}" fill="${color}" stroke="#fff" stroke-width="${(unit * 0.25).toFixed(2)}"/><text x="${u(p.x)}" y="${(maxY - p.y - unit * 1.5).toFixed(2)}" font-size="${(unit * 1.6).toFixed(2)}" text-anchor="middle">${escapeHtml(p.name)}</text></g>`;
  }).join("");
  const path = h1.path?.length ? `<polyline points="${h1.path.map(([x, y]) => `${u(x)},${v(y)}`).join(" ")}" fill="none" stroke="#9333ea" stroke-width="${(unit * 0.45).toFixed(2)}" stroke-dasharray="${(unit * 1.2).toFixed(2)} ${(unit * 0.8).toFixed(2)}" stroke-linecap="round"/>` : "";
  const pose = h1.pose;
  const robot = pose ? `<g transform="translate(${u(pose.x)} ${v(pose.y)}) rotate(${(-pose.heading * 180 / Math.PI).toFixed(1)})"><circle r="${(unit * 2.4).toFixed(2)}" fill="rgba(147,51,234,.18)"/><path d="M ${(unit * 2).toFixed(2)} 0 L ${(-unit * 1.3).toFixed(2)} ${(unit * 1.3).toFixed(2)} L ${(-unit * 0.6).toFixed(2)} 0 L ${(-unit * 1.3).toFixed(2)} ${(-unit * 1.3).toFixed(2)} Z" fill="#1a0f5e" stroke="#fff" stroke-width="${(unit * 0.25).toFixed(2)}"/></g>` : "";
  svg.innerHTML = `<rect width="${W.toFixed(2)}" height="${H.toFixed(2)}" fill="#faf8ff"/><image href="${map.image}" x="0" y="0" width="${W.toFixed(2)}" height="${H.toFixed(2)}" preserveAspectRatio="none" style="image-rendering:pixelated"/>${path}${places}${robot}`;
}

function h1RenderPlaces() {
  const wrap = h1$("#h1-places"), places = h1.map?.places || [];
  if (!places.length) { wrap.innerHTML = "<em>Destinations appear when Isaac Sim maps the warehouse.</em>"; return; }
  wrap.innerHTML = places.map((p) => `<button type="button" class="h1-place kind-${escapeHtml(p.kind)}" data-place="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`).join("");
}

async function h1LoadMap() {
  try {
    h1.map = await api("/api/humanoid/map");
    h1$("#h1-map-meta").textContent = `${h1.map.environmentLabel || h1.map.environment} · ${h1.map.places.length} destinations · ${(h1.map.bounds.maxX - h1.map.bounds.minX).toFixed(0)} × ${(h1.map.bounds.maxY - h1.map.bounds.minY).toFixed(0)} m`;
  } catch { h1.map = null; h1$("#h1-map-meta").textContent = "No map yet · deploy a robot with Isaac Sim connected"; }
  h1RenderPlaces(); h1DrawMap(); h1LoadPrompts();
}

function h1LoadPrompts() {
  api("/api/humanoid/joule/prompts").then((data) => {
    const wrap = h1$("#h1-joule-presets"); wrap.innerHTML = "";
    for (const prompt of data.prompts || []) {
      const button = document.createElement("button");
      button.type = "button"; button.textContent = prompt;
      button.addEventListener("click", () => { h1$("#h1-joule-goal").value = prompt; runH1Joule(prompt); });
      wrap.appendChild(button);
    }
  }).catch(() => { /* presets are a convenience; the free-text input still works */ });
}

function h1RenderPlan() {
  const list = h1$("#h1-plan");
  list.hidden = !h1.plan.length;
  list.innerHTML = h1.plan.map((step) => `<li class="${step.status || "pending"}"><span>${escapeHtml(step.label)}</span>${step.detail ? `<em>${escapeHtml(step.detail)}</em>` : ""}</li>`).join("");
}

function h1SetRobot(robot, environment) {
  if (!robot || !H1_ROBOT_LABEL[robot]) return;
  h1.robot = robot;
  // selectors follow what is actually loaded in Isaac Sim, unless the user is choosing a new one
  if (!h1.selectTouched) { h1$("#h1-robot").value = robot; if (environment && h1$(`#h1-environment option[value="${environment}"]`)) h1$("#h1-environment").value = environment; }
  const name = H1_ROBOT_LABEL[robot];
  h1$("#h1-stage-eyebrow").textContent = `${name.toUpperCase()} VIEW`;
  h1$("#h1-drive-title").textContent = `Drive the ${name}`;
  h1$("#h1-train-task").value = H1_TASK[robot];
}

function h1SetView(view) {
  h1.view = view;
  $$("[data-h1-view]").forEach((b) => b.classList.toggle("active", b.dataset.h1View === view));
}

function h1Watch(jobId) {
  h1.source?.close();
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  h1.source = source; h1.running = true;
  let lastSequence = 0;
  const types = ["job_started", "job_complete", "job_failed", "job_cancelled", "fallback_activated", "planner_progress", "h1_train_started", "h1_train_metric", "h1_train_complete", "h1_deploy_started", "h1_deploy_phase", "h1_deploy_ready", "h1_deploy_complete", "h1_teleop_started", "h1_teleop_step", "h1_teleop_complete", "h1_log", "h1_snapshot", "h1_nav_path", "h1_plan_step", "h1_navigate_complete", "h1_camera_complete", "h1_plan_complete", "h1_joule_answer"];
  const terminal = ["job_complete", "job_failed", "job_cancelled"];
  for (const type of types) source.addEventListener(type, (event) => {
    const payload = JSON.parse(event.data);
    if (payload.sequence && payload.sequence <= lastSequence) return;
    lastSequence = payload.sequence || lastSequence;
    h1Consume(payload);
    if (terminal.includes(type)) { source.close(); h1.source = null; h1.running = false; }
  });
  source.onerror = () => { if (h1.running) h1Log("Event stream interrupted; reconnecting…"); };
}

function h1Consume(event) {
  if (event.type === "h1_train_started") { h1.trainPoints = []; h1DrawReward(); h1$("#h1-train-status").textContent = `Training · 0 / ${event.iterations} iterations${event.executor ? "" : " (local simulation)"}`; h1SetGait("TRAINING"); h1Log(`Isaac Lab · ${event.task} · ${event.numEnvs} parallel envs`); }
  if (event.type === "h1_train_metric") { h1.trainPoints.push({ iteration: event.iteration, reward: event.reward }); h1DrawReward(); h1$("#h1-train-status").textContent = `Training · ${event.iteration} / ${event.totalIterations} iterations`; h1$("#h1-train-metric").textContent = `reward ${event.reward} · episode length ${event.episodeLength}`; }
  if (event.type === "h1_train_complete") { h1$("#h1-train-status").textContent = "Training complete"; h1$("#h1-checkpoint").textContent = event.checkpoint?.label || "trained checkpoint"; h1SetGait("STANDBY"); showToast(`Policy trained · reward ${event.reward}`); }
  if (event.type === "h1_deploy_started") { h1SetGait("DEPLOYING"); h1Log(`Loading ${event.checkpoint?.label || "checkpoint"}`); h1$("#h1-checkpoint").textContent = event.checkpoint?.label || "—"; }
  if (event.type === "h1_deploy_phase") { h1SetGait(event.phase === "map" ? "MAPPING" : "DEPLOYING"); h1Log(event.label); }
  if (event.type === "h1_deploy_ready" || event.type === "h1_deploy_complete") {
    h1SetGait("READY"); h1.path = null; h1.plan = []; h1RenderPlan();
    h1.selectTouched = false;
    if (event.robot) h1SetRobot(event.robot, event.environment);
    if (event.checkpoint?.label) h1$("#h1-checkpoint").textContent = event.checkpoint.label;
    h1Log(`${event.robotLabel || H1_ROBOT_LABEL[h1.robot]} standing${event.environmentLabel ? ` · ${event.environmentLabel}` : ""}`);
    showToast(`${event.robotLabel || "Robot"} deployed and balancing.`); h1LoadMap();
  }
  if (event.type === "h1_teleop_started") h1SetGait("WALKING");
  if (event.type === "h1_teleop_step") {
    h1.pose = event.pose;
    h1$("#h1-pose").textContent = `x ${event.pose.x} · y ${event.pose.y} · heading ${Math.round((event.pose.heading * 180) / Math.PI)}°`;
    h1SetGait(event.gait === "walk" ? "WALKING" : event.gait === "turn" ? "TURNING" : "STANDING"); h1DrawMap();
  }
  if (event.type === "h1_teleop_complete") h1SetGait("READY");
  if (event.type === "h1_nav_path") { h1.path = event.points; h1SetGait("NAVIGATING"); h1Log(`Route to ${event.target?.name || "destination"} · ${event.points.length} waypoints`); h1DrawMap(); }
  if (event.type === "h1_navigate_complete") { h1SetGait(event.reached ? "ARRIVED" : "READY"); showToast(event.reached ? `Arrived at ${event.place}.` : `Could not reach ${event.place}: ${event.reason || "unknown"}`); }
  if (event.type === "h1_camera_complete") { h1SetView(event.view); h1SetGait("READY"); }
  if (event.type === "h1_plan_step") {
    const step = h1.plan[event.index - 1] || (h1.plan[event.index - 1] = { label: event.label });
    Object.assign(step, { status: event.status, detail: event.detail || "" }); h1RenderPlan();
    if (event.status === "running") h1Log(`Step ${event.index}/${event.total} · ${event.label}`);
  }
  if (event.type === "h1_plan_complete") { h1SetGait("READY"); showToast(`Mission finished · ${event.completed}/${event.total} steps.`); }
  if (event.type === "h1_snapshot") { const fig = h1$("#h1-snapshot"); fig.classList.add("has-frame"); h1$("#h1-snapshot-img").src = event.image; h1Log(event.caption || "Robot camera"); }
  if (event.type === "h1_log") h1Log(event.message);
  if (event.type === "planner_progress") { h1$("#h1-joule-answer").textContent = "Joule is planning the mission on SAP AI Core…"; }
  if (event.type === "fallback_activated") h1Log(event.message || event.detail || "Fallback activated");
  if (event.type === "job_failed") { h1SetGait("ERROR"); showToast(event.error || "Robot job failed."); }
  if (event.type === "h1_joule_answer") {
    const el = h1$("#h1-joule-answer"); el.classList.remove("pending");
    el.textContent = event.provider && event.provider !== "mock" ? `Joule: ${event.answer}` : `Joule (local): ${event.answer}`;
    h1.plan = (event.steps || []).map((step) => ({ label: step.label, status: "pending" })); h1RenderPlan();
  }
}

async function h1RunJob(path, body, button) {
  if (h1.running) return showToast("Finish or stop the active robot job first.");
  if (button) { button.disabled = true; }
  try {
    const job = await api(path, { method: "POST", body: JSON.stringify(body) });
    h1Watch(job.jobId);
  } catch (error) {
    showToast(error.message || "Could not start the robot job.");
  } finally {
    if (button) setTimeout(() => { button.disabled = false; }, 800);
  }
}

function runH1Train() { return h1RunJob("/api/humanoid/train", { iterations: Number(h1$("#h1-train-iterations").value || 300), numEnvs: Number(h1$("#h1-train-envs").value || 2048) }, h1$("#h1-train-run")); }
function runH1Deploy() { return h1RunJob("/api/humanoid/deploy", { checkpoint: h1$("#h1-deploy-checkpoint").value, terrain: h1$("#h1-deploy-terrain").value, robot: h1$("#h1-robot").value, environment: h1$("#h1-environment").value }, h1$("#h1-deploy-run")); }
function runH1Teleop(command) { return h1RunJob("/api/humanoid/teleop", command, null); }
function runH1Navigate(place) { h1.path = null; return h1RunJob("/api/humanoid/navigate", { place }, null); }
function runH1Camera(view) { return h1RunJob("/api/humanoid/camera", { view }, null); }
function runH1Joule(goal) {
  const trimmed = goal.trim();
  if (!trimmed) return showToast("Tell the robot what to do first.");
  const answerEl = h1$("#h1-joule-answer"); answerEl.classList.add("pending"); answerEl.textContent = "Joule is thinking…";
  h1.plan = []; h1RenderPlan();
  return h1RunJob("/api/humanoid/joule", { goal: trimmed }, h1$("#h1-joule-run"));
}

async function h1RefreshStatus() {
  try {
    const status = await api("/api/humanoid/descriptor");
    const ex = status.executor;
    h1$("#h1-isaac-strip").classList.toggle("connected", Boolean(status.connected));
    h1$("#h1-isaac-status").textContent = `Isaac Sim · ${status.connected ? "CONNECTED" : "OFFLINE"}`;
    h1$("#h1-isaac-executor").textContent = status.connected ? `${ex.robotLabel || ex.name}${ex.environment ? ` · ${status.environments?.[ex.environment] || ex.environment}` : ""}${ex.dryRun ? " · dry run" : ""}` : "no executor connected";
    if (status.connected && ex?.robot) { h1SetRobot(ex.robot, ex.environment); if (ex.view && !h1.running) h1SetView(ex.view); }
    if (status.connected && ex?.pose && !h1.running) { h1.pose = ex.pose; h1$("#h1-pose").textContent = `x ${ex.pose.x} · y ${ex.pose.y} · heading ${Math.round((ex.pose.heading * 180) / Math.PI)}°`; h1DrawMap(); }
    if (status.frameAt && status.frameAt !== h1.frameAt && !h1.running) {
      h1.frameAt = status.frameAt;
      api("/api/humanoid/frame").then((frame) => { h1$("#h1-snapshot").classList.add("has-frame"); h1$("#h1-snapshot-img").src = frame.image; h1Log(frame.caption || "Robot camera · live"); }).catch(() => {});
    }
    const version = status.map?.version || 0;
    if (version !== h1.mapVersion) { h1.mapVersion = version; h1LoadMap(); }
    if (!h1.running) {
      const active = await api("/api/humanoid/active");
      if (active.length) h1Watch(active[0].id);
    }
  } catch { /* informational */ }
}

// Mission view: the whole screen becomes the robot view; Joule, the map and the controls float on top.
function h1ToggleMission(force) {
  const lab = h1$("#humanoid-lab"), on = typeof force === "boolean" ? force : !lab.classList.contains("mission");
  lab.classList.toggle("mission", on);
  document.body.classList.toggle("h1-mission-open", on);
  h1$("#h1-mission-toggle").textContent = on ? "✕ Exit mission view" : "⤢ Mission view";
  if (on && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => { /* fixed overlay still covers the window */ });
  if (!on && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  if (on) h1$("#h1-joule-goal")?.focus({ preventScroll: true });
  requestAnimationFrame(h1DrawMap);
}

// Joule floating over the Isaac Sim viewer: Document Picture-in-Picture keeps a small always-on-top
// window (Chrome / Edge 116+). The Joule block and the destinations move into it and back on close,
// so every listener keeps working.
async function h1FloatJoule() {
  if (h1.pip) { h1.pip.close(); return; }
  if (!("documentPictureInPicture" in window)) return showToast("Floating Joule needs Chrome or Edge on desktop. Mission view works everywhere.");
  const pip = await documentPictureInPicture.requestWindow({ width: 420, height: 640 });
  for (const sheet of document.styleSheets) {
    try { const style = pip.document.createElement("style"); style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join("\n"); pip.document.head.appendChild(style); }
    catch { if (sheet.href) { const link = pip.document.createElement("link"); link.rel = "stylesheet"; link.href = sheet.href; pip.document.head.appendChild(link); } }
  }
  pip.document.title = "Joule · robot mission";
  pip.document.body.className = "h1-pip";
  const moved = [document.querySelector(".h1-joule"), document.querySelector(".h1-places-wrap")].filter(Boolean).map((el) => [el, el.parentNode, el.nextSibling]);
  const card = pip.document.createElement("div"); card.className = "h1-pip-card";
  for (const [el] of moved) card.append(el);
  pip.document.body.append(card);
  h1.pip = pip; h1$("#h1-joule-float").textContent = "◱ Dock Joule";
  pip.addEventListener("pagehide", () => {
    for (const [el, parent, next] of moved.reverse()) parent.insertBefore(el, next);
    h1.pip = null; h1$("#h1-joule-float").textContent = "◳ Float over viewer";
  });
}

function initHumanoidLab() {
  h1$("#h1-train-run").addEventListener("click", runH1Train);
  h1$("#h1-deploy-run").addEventListener("click", runH1Deploy);
  h1$("#h1-robot").addEventListener("change", (event) => { h1.selectTouched = true; h1$("#h1-train-task").value = H1_TASK[event.target.value] || H1_TASK.h1; });
  h1$("#h1-environment").addEventListener("change", () => { h1.selectTouched = true; });
  // Walk ≈ 4.5 m per press (0.9 m/s, inside the H1/Go2 training range); turns ≈ 90°.
  const MOVES = { forward: { vx: 0.9, vy: 0, yaw: 0, durationMs: 5000 }, backward: { vx: -0.4, vy: 0, yaw: 0, durationMs: 3000 }, left: { vx: 0, vy: 0, yaw: 0.8, durationMs: 2000 }, right: { vx: 0, vy: 0, yaw: -0.8, durationMs: 2000 }, stop: { vx: 0, vy: 0, yaw: 0, durationMs: 500 } };
  $$("[data-h1-move]").forEach((button) => button.addEventListener("click", () => runH1Teleop({ ...MOVES[button.dataset.h1Move] })));
  $$("[data-h1-view]").forEach((button) => button.addEventListener("click", () => runH1Camera(button.dataset.h1View)));
  h1$("#h1-find-robot").addEventListener("click", () => runH1Camera(h1.view || "chase"));
  h1$("#h1-mission-toggle").addEventListener("click", () => h1ToggleMission());
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && $("#humanoid-lab").classList.contains("mission")) h1ToggleMission(false); });
  const goTo = (event) => { const target = event.target.closest("[data-place]"); if (target) runH1Navigate(target.dataset.place); };
  h1$("#h1-places").addEventListener("click", goTo);
  h1$("#h1-map").addEventListener("click", goTo);
  h1$("#h1-map").addEventListener("keydown", (event) => { if (event.key === "Enter") goTo(event); });
  // Remembered per-browser only (localStorage): the Brev "/viewer" URL for this session's Isaac Sim instance.
  const urlInput = h1$("#h1-viewer-url"), link = h1$("#h1-viewer-link");
  const syncViewerLink = () => {
    const url = urlInput.value.trim();
    if (url) { link.href = url; link.classList.remove("disabled"); } else { link.href = "#"; link.classList.add("disabled"); }
  };
  try { urlInput.value = localStorage.getItem("h1-isaac-viewer-url") || ""; } catch { /* private mode */ }
  syncViewerLink();
  urlInput.addEventListener("input", () => { try { localStorage.setItem("h1-isaac-viewer-url", urlInput.value.trim()); } catch { /* private mode */ } syncViewerLink(); });

  const goalInput = h1$("#h1-joule-goal");
  h1$("#h1-joule-run").addEventListener("click", () => runH1Joule(goalInput.value));
  goalInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); runH1Joule(goalInput.value); } });
  // the map is fetched by h1RefreshStatus only once the executor has uploaded one (no 404 noise offline)
  h1LoadPrompts(); h1RenderPlaces(); h1DrawMap();
  // faster refresh in Mission view (live frame + robot marker), slower otherwise
  let tick = 0;
  h1RefreshStatus(); setInterval(() => { tick += 1; if (h1$("#humanoid-lab").classList.contains("mission") || h1.pip || tick % 2 === 0) h1RefreshStatus(); }, 1500);
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
    state.simulationRunning=false;
    if (!state.robotRunning) state.meshWorld?.setFlowState({ running: false });
    updateMetrics(event.summary); $("#model-status").textContent = "Experiment complete"; $("#run-simulation").disabled = false;
    logLine("orchestrator", `completed ${event.summary.completed} entities; p95 cycle ${event.summary.p95Cycle}`);
    confirmOptimizerResult(event.summary);
    setAnalyticsReady(true);
    // Auto-open the dashboard once the numbers are in: only for runs started
    // from this tab (state.currentJob), so a reload that re-attaches to an
    // old stream never bounces the user away from the twin.
    if (state.currentJob === event.id) { logLine("analytics", "opening Joule analytics for this run…"); setTimeout(() => { window.location.assign("/analytics.html"); }, 900); }
  }
  if (event.type === "orchestrator_analysis") logLine(plannerLabel(), event.provider && event.provider !== "mock" ? "Joule is analyzing the goal" : (event.analysis || event.message || "Preparing a bounded operations plan; Joule NOT CONNECTED"));
  if (event.type === "fallback_activated") logLine("fallback", `${event.from} → ${event.to}: ${event.reason}${event.detail ? ` (${event.detail})` : ""}`, true);
  if (event.type === "optimizer_baseline") logLine("optimizer", `baseline ${OPTIMIZER_LABELS[event.objective]}: ${optFmt(event.objective, event.metrics)} · ${event.source} proposals · seed ${event.seed}`);
  if (event.type === "optimizer_iteration") logLine("optimizer", `iteration ${event.iteration}/${event.iterations}: ${event.candidates} candidate${event.candidates === 1 ? "" : "s"} (${event.source})`);
  if (event.type === "optimizer_candidate") {
    const objective = state.optimizerObjective || "throughput";
    if (event.reason) logLine("optimizer ✗", `${event.label}: rejected — ${event.reason}`, true);
    else logLine(event.accepted ? "optimizer ✓" : "optimizer ·", `${event.label}: ${OPTIMIZER_LABELS[objective]} ${optFmt(objective, event.metrics)} (${event.improvementPct > 0 ? "+" : ""}${event.improvementPct}% vs baseline)${event.accepted ? " → new best" : ""}`);
  }
  if (event.type === "optimizer_complete") renderOptimizerResult(event);
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
    if (state.currentJob) refreshMeasuredKpis(state.currentJob);
  }


  if (event.type === "job_complete" && event.result?.plan) {
    state.agentPlan = event.result;
    if ($("#workspace-agent-plan")) $("#workspace-agent-plan").textContent = JSON.stringify(state.agentPlan, null, 2);
    logLine(plannerLabel(), event.result.summary || `${event.result.plan.length} local plan steps recorded. Joule NOT CONNECTED.`);
    for (const risk of event.result.risks || []) logLine("risk", risk, true);
    for (const action of event.result.nextActions || []) logLine("next action", action);
    const button = $("#run-agent-task"); button.disabled = false; button.textContent = agentButtonLabel();
  }
  if (event.type === "job_failed") { if (state.currentJobKind === "simulation") { $("#model-status").textContent = "Experiment failed"; $("#run-simulation").disabled = false; } logLine("system", event.error, true); }
  if (event.type === "job_failed") {
    const agent = $("#run-agent-task"), robot = $("#run-robot-routine"), optimizer = $("#run-optimizer");
    if (agent) { agent.disabled = false; agent.textContent = agentButtonLabel(); }
    if (optimizer) { optimizer.disabled = false; optimizer.textContent = "✦ Optimize with AI"; }
    if (robot && state.currentJobKind === "robot_routine") { robot.disabled = false; robot.textContent = "Run routine"; state.meshWorld?.setFlowState({ running: false }); }
  }
  if (event.type === "approval_required") logLine("human approval", `${event.stepId}: waiting for an explicit operator decision`, true);
  if (event.type === "approval_resolved") logLine("human approval", `${event.stepId}: ${event.decision} by ${event.approvedBy}`);
  if (event.kind === "robot_routine" && ["job_complete", "job_failed", "job_cancelled"].includes(event.type)) state.robotRunning = false;
  if(event.kind==="simulation" && ["job_complete","job_failed","job_cancelled"].includes(event.type)) state.simulationRunning=false;
  syncEditorControls();
  state.executionUI?.event(event);
}

function watchJob(jobId, endpoint) {
  state.sources.get(jobId)?.close();
  const source = new EventSource(endpoint);
  state.sources.set(jobId, source);
  let lastSequence = 0;
  source.onmessage = (event) => consumeEvent(JSON.parse(event.data));
  ["job_started", "service_start", "service_complete", "arrival", "transfer", "entity_complete", "audit_breach", "audit_pass", "monte_carlo_run", "simulation_complete", "job_complete", "job_failed", "connection_decision", "orchestrator_analysis", "specialist_launched", "provider_status", "robot_routine_started", "grafcet_step_active", "sensor_sample", "robot_command", "grafcet_transition_fired", "robot_routine_complete", "fallback_activated", "optimizer_baseline", "optimizer_iteration", "optimizer_candidate", "optimizer_complete"].forEach((type) => {
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

// The analytics page reads the tenant's most recent completed run from the
// server, so the link only makes sense once one exists: disabled while a run
// is in flight, enabled on completion, and re-checked on page load so a prior
// run survives a refresh.
function setAnalyticsReady(ready) {
  const link = $("#analytics-link"); if (!link) return;
  link.setAttribute("aria-disabled", ready ? "false" : "true");
  link.title = ready ? "Open Joule analytics for the most recent run" : "Run an experiment first";
}

async function checkAnalyticsReady() {
  try { const status = await api("/api/analytics/last-run/status"); setAnalyticsReady(Boolean(status.available)); }
  catch { setAnalyticsReady(false); }
}

async function runSimulation() {
  if(state.simulationRunning || state.experimentRunning) return showToast("An experiment is already running.");
  if (state.robotRunning) return showToast("Finish or stop the robot routine before running a DES experiment in the same twin.");
  if (!state.model) return;
  setAnalyticsReady(false);
  const button = $("#run-simulation"); button.disabled = true; state.events = 0; $("#event-count").textContent = "0 events"; $("#timeline-fill").style.width = "0%"; $("#model-status").textContent = "Experiment queued";
  const payload = { mode: $("#simulation-mode").value, entities: Number($("#entity-count").value), runs: 5, seed: 42 };
  state.simulationRunning=true; syncEditorControls();
  state.meshWorld?.setFlowState({ running: true, queues: {} });
  logLine("local DES", `queued ${payload.mode}; ${payload.entities} entities`);
  try {
    await state.saveQueue;
    const job = await api("/api/simulations", { method: "POST", body: JSON.stringify(payload) });
    logLine("worker", `${job.jobId} accepted as background job`); watchJob(job.jobId, job.events);
  } catch (error) {
    state.simulationRunning=false; syncEditorControls(); button.disabled = false; $("#model-status").textContent = "Experiment not started";
    state.meshWorld?.setFlowState({ running: false }); showToast(error.message); logLine("local DES", error.message, true);
  }
}

async function runAgentTask() {
  if ($("#run-agent-task").disabled) return;
  const goal = $("#agent-goal").value.trim();
  if (!goal) return showToast("Describe a bounded goal first.");
  const button = $("#run-agent-task"); button.disabled = true; button.textContent = "Planning locally…";
  state.agentPlan = null;
  if ($("#workspace-agent-plan")) $("#workspace-agent-plan").textContent = aiCoreConnected() ? "Joule plan pending · SAP AI Core." : "Local mock plan pending. Joule NOT CONNECTED.";
  try {
    const job = await api("/api/agent/tasks", { method: "POST", body: JSON.stringify({ goal }) });
    logLine(plannerLabel(), aiCoreConnected() ? `queued as ${job.jobId} · ${state.runtime.orchestrator} on SAP AI Core` : `queued as ${job.jobId}; Joule NOT CONNECTED`);
    watchJob(job.jobId, job.events);
  } catch (error) {
    button.disabled = false; button.textContent = agentButtonLabel();
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

const MEASURED_KPI_LABEL = {
  "Picking and order cycle": (kpis) => kpis.pickingAndOrderCycle && `task→picking ${kpis.pickingAndOrderCycle.taskToPickingSeconds ?? "—"}s · order→dispatch ${kpis.pickingAndOrderCycle.orderToDispatchSeconds ?? "—"}s`,
  "Queue and dock dwell": (kpis) => kpis.queueAndDockDwell && `rack dwell ${kpis.queueAndDockDwell.rackDwellSeconds ?? "—"}s · dock dwell ${kpis.queueAndDockDwell.dockDwellSeconds ?? "—"}s`
};

function renderKpiPanel(scenario) {
  let kpiPanel = $("#routine-kpi-profile");
  if (!kpiPanel) { kpiPanel = document.createElement("details"); kpiPanel.id = "routine-kpi-profile"; kpiPanel.className = "operations-scope"; $("#grafcet-detail").after(kpiPanel); }
  const kpis = state.measuredKpis?.scenarioId === scenario.id ? state.measuredKpis : null;
  kpiPanel.innerHTML = `<summary>KPI instrumentation · ${escapeHtml(scenario.domain)}</summary><p>Required inputs, not measured results. Use Industrial timing experiments for calculations supported by supplied data.</p><ul>${(scenario.kpiProfile?.metrics || []).map((metric) => {
    const measured = kpis && MEASURED_KPI_LABEL[metric.name]?.(kpis);
    return `<li><strong>${escapeHtml(metric.name)}</strong>: ${escapeHtml(metric.definition)}<br><small>Requires: ${escapeHtml(metric.requiredInputs)}</small>${measured ? `<br><strong class="measured">Measured: ${escapeHtml(measured)}</strong>` : ""}</li>`;
  }).join("")}</ul>`;
  return kpiPanel;
}

async function refreshMeasuredKpis(jobId) {
  try {
    state.measuredKpis = await api(`/api/robot-routines/${jobId}/kpis`);
  } catch {
    state.measuredKpis = null; // 404 = this scenario has no measurable KPIs yet; not an error
  }
  if (state.activeRobotScenario) renderKpiPanel(state.activeRobotScenario);
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
  const kpiPanel = renderKpiPanel(scenario);
  let governance = $("#routine-governance-profile");
  if (!governance) { governance = document.createElement("details"); governance.id = "routine-governance-profile"; governance.className = "operations-scope"; kpiPanel.after(governance); }
  governance.innerHTML = `<summary>Safety & governance · reference mapping, NOT certification</summary><p>${escapeHtml(scenario.governance?.robotBoundary)}</p><p>${escapeHtml(scenario.governance?.transportBoundary)}</p><ul>${(scenario.governance?.standards || []).map(ref => `<li>${escapeHtml(ref.code)} — ${escapeHtml(ref.purpose)} <a href="${escapeHtml(ref.url)}" target="_blank" rel="noopener noreferrer">Official scope</a></li>`).join("")}</ul><p>Live commands remain blocked. Qualified integrator review and local safety controls are required.</p>`;
  setGrafcetActive(scenario.grafcet.initial);
  $("#robot-sensor").textContent = scenario.sensors.slice(0, 2).join(" + ");
  $("#robot-command").textContent = "routine ready";
  state.executionUI?.select(id);
}

function renderRobotLab(scenarios) {
  state.robotScenarios = scenarios;
  $("#robot-scenario-tabs").innerHTML = scenarios.map((scenario) => `<button class="robot-scenario-card" data-scenario-id="${scenario.id}"><small>${scenario.domain.toUpperCase()}</small><strong>${scenario.name}</strong><span>${scenario.robot}</span></button>`).join("");
  const preferred = scenarios.find((scenario) => scenario.id === state.model?.activeScenarioId) || scenarios.find((scenario) => scenario.id === "autonomous-inspection") || scenarios[0];
  if (preferred) selectRobotScenario(preferred.id);
  state.executionUI?.scenario(scenarios);
}

async function loadRobotCell() {
  if (!canEditModel()) return showToast("Enable Edit Mode and finish active runs before changing the model.");
  const scenario = state.activeRobotScenario;
  if (!scenario) return showToast("Choose a robot scenario first.");
  const before=state.model ? snapshotModel() : null;
  try {
    await state.saveQueue;
    const result = await api(`/api/robot-scenarios/${scenario.id}/compose`, { method: "POST", body: "{}" });
    state.model = result.model;
    rememberEdit(state,before);
    state.selectedId = scenario.grafcet.steps[0]?.nodeId || scenario.model.nodes[0]?.id || null;
    renderModel(); renderInspector(); changeView("3d");
    $("#model-status").textContent = `${scenario.domain} local workcell composed with governed operations context`;
    state.meshWorld?.setFlowState({ running: false, queues: {} });
    document.querySelector(".model-panel")?.scrollIntoView({ behavior: "smooth", block: "center" });
    const summary = result.composition;
    logLine("digital twin", `${summary.platformObjects} operations context objects + ${summary.robotObjects} robot assets connected by ${summary.connections} routes`);
    showToast(`${scenario.name} connected to the SAP-to-physical 3D model.`);
  } catch (error) {
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
  if (state.robotRunning || state.simulationRunning || state.experimentRunning) return showToast("Finish the current run first.");
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
    model: [["select", "↖", "Select"], ["trail", "⌁", "Trail"]],
    simulate: [["run", "▶", "Run"], ["realtime", "◉", "Paced playback"], ["monte", "∿", "Monte Carlo"], ["rewind", "↺", "Reset clock"], ["save", "▣", "Save Snapshot"]],
    integrate: [["connect", "◈", "SAP BDC Connect"], ["agent", "joule", "Joule"], ["analytics", "joule", "Joule Analytics"]],
    audit: [["approval", "⌑", "Human Approval"], ["evidence", "▤", "Evidence & Audit"], ["save", "▣", "Save Snapshot"]],
    agent: [["agent", "joule", "Joule · Local Mock"], ["planner", "joule", "Planner & recipes"], ["trace", "⇄", "Recorded Trace"]],
    robot: [["robotlab", "◇", "Open Embodied AI Lab"], ["loadcell", "▣", "Connect Workcell"], ["stepgrafcet", "↦", "Next GRAFCET"], ["runroutine", "▶", "Run Routine"], ["shadow", "◉", "Shadow Mode"], ["save", "▣", "Save Snapshot"]],
    humanoid: [["humanoidlab", "◇", "Open Digital Twin Robotics"], ["h1train", "∿", "Train Policy"], ["h1deploy", "▶", "Deploy & Stand Up"], ["h1teleop", "↦", "Walk Forward"]]
  };
  $("#ribbon-tools").replaceChildren(...sets[tab].map(([id, glyph, label]) => {
    const button = document.createElement("button"); button.className = "tool-button";
    if(["select","trail"].includes(id)) button.dataset.editorTool=id;
    else { button.dataset.tool=Boolean(objectDefinitions[id])?id:""; button.dataset.command=button.dataset.tool?"":id; }
    button.innerHTML = `${glyph === "joule" ? '<i class="joule-icon" aria-hidden="true"></i>' : glyph}<span>${label}</span>`; return button;
  }));
  if(tab==="model") {
    const controls=document.createElement("div"); controls.className="model-capacity-controls";
    controls.innerHTML='<span id="selected-resource">Select an object</span><label>Parallel capacity <input aria-label="Selected object capacity" data-capacity-input type="number" min="1" max="32" step="1"></label><button type="button" data-capacity-delta="-1" aria-label="Decrease capacity">−</button><button type="button" data-capacity-delta="1" aria-label="Increase capacity">+</button><small>Items handled at the same time</small>';
    $("#ribbon-tools").append(controls);
  }
  syncEditorControls();
}

function handleRibbonAction(button) {
  if(button.disabled) return;
  if(button.dataset.editorTool) { state.editTool=button.dataset.editorTool; state.trailStart=null; syncEditorControls(); return showToast(state.editTool==="select"?"Select: drag objects on the floor. Double-click opens the workspace.":"Trail: click source, then destination. Esc cancels."); }
  if(button.dataset.capacityDelta) return changeCapacity(Number(nodeById(state.selectedId)?.capacity)+Number(button.dataset.capacityDelta));
  const tool = button.dataset.tool;
  const command = button.dataset.command;
  if (tool) return tool === "select" ? showToast("Selection mode active.") : openObjectSubmenu(tool);
  if (command === "run" || command === "realtime" || command === "monte") { $("#simulation-mode").value = command === "monte" ? "monte-carlo" : command === "run" ? "fast" : command; return runSimulation(); }
  if (command === "rewind") { if(state.robotRunning || state.simulationRunning) return showToast("Finish the active run before resetting the display."); $("#clock-label").textContent = "t = 0.00 s"; $("#timeline-fill").style.width = "0%"; state.meshWorld?.setFlowState({running:false,queues:{},completedNodeIds:[]}); showToast("Playback display reset. Saved results and evidence are unchanged."); return; }
  if (command === "trace") return handleOperation(command);

  if (command === "analytics") { window.location.assign("/analytics.html"); return; }
  if (command === "planner") { window.location.assign("/analytics.html#joule-planner"); return; }
  if (command === "robotlab") { document.querySelector("#robot-lab").scrollIntoView({ behavior: "smooth", block: "start" }); return showToast("Embodied AI Lab opened."); }
  if (command === "loadcell") return loadRobotCell();
  if (command === "stepgrafcet") return advanceRobotRoutine();
  if (command === "runroutine") return runRobotRoutine();
  if (command === "shadow") { if (state.robotRunning) return; $("#robot-mode").value = "shadow"; $("#mission-mode").value = "shadow"; document.querySelector("#robot-lab").scrollIntoView({ behavior: "smooth", block: "start" }); return showToast("Shadow mode selected: synthetic inputs only, physical commands blocked."); }
  if (command === "humanoidlab") { $("#humanoid-lab").classList.remove("hidden"); document.querySelector("#humanoid-lab").scrollIntoView({ behavior: "smooth", block: "start" }); return showToast("Digital Twin Robotics opened."); }
  if (command === "h1train") { $("#humanoid-lab").classList.remove("hidden"); document.querySelector("#humanoid-lab").scrollIntoView({ behavior: "smooth", block: "start" }); return runH1Train(); }
  if (command === "h1deploy") { $("#humanoid-lab").classList.remove("hidden"); document.querySelector("#humanoid-lab").scrollIntoView({ behavior: "smooth", block: "start" }); return runH1Deploy(); }
  if (command === "h1teleop") { $("#humanoid-lab").classList.remove("hidden"); document.querySelector("#humanoid-lab").scrollIntoView({ behavior: "smooth", block: "start" }); return runH1Teleop({ vx: 0.6, vy: 0, yaw: 0, durationMs: 4000 }); }
  if (command === "save") return saveModel(true).catch(error=>showToast(error.message));
  if (command === "undo") return undo();
  if (command === "redo") return redo();
}

function changeView(view) {
  state.mode = view;
  $$("[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  $("#model-canvas").classList.toggle("hidden", view !== "2d"); $("#scene-3d").classList.toggle("hidden", view !== "3d");
  syncEditorControls();
}

function attachOrbitControls() {
  // Orbiting is owned by the WebGL canvas. Keeping this hook preserves the app lifecycle seam.
}

function undo() {
  if(!canEditModel()) return showToast("Finish active runs and enable Edit Mode before Undo.");
  if(!travelHistory(state,"undo")) return showToast("Nothing to undo yet.");
  restoreHistoryView(); showToast("Undo applied.");
}

function redo() {
  if(!canEditModel()) return showToast("Finish active runs and enable Edit Mode before Redo.");
  if(!travelHistory(state,"redo")) return showToast("Nothing to redo yet.");
  restoreHistoryView(); showToast("Redo applied.");
}
function restoreHistoryView() { state.trailStart=null; if(state.model.activeScenarioId) selectRobotScenario(state.model.activeScenarioId); renderModel(); renderInspector(); if(state.interiorNodeId && !$("#interior-dive").classList.contains("hidden")) refreshInteriorRobot(); persistEdit(); }

async function boot() {
  state.session = await api("/api/session");
  state.editMode = state.session.permissions.editModel;
  $("#identity-pill").textContent = `${state.session.tenantId} · ${state.session.roles.join("/")}`;
  $("#edit-toggle").classList.toggle("active", state.editMode);
  $("#edit-toggle").innerHTML = `<span></span> ${state.editMode ? "EDIT MODE" : "VIEW MODE"}`;
  state.model = await api("/api/model");
  state.executionUI = createExecutionUI({ api, getModel: () => state.model, getWorld: () => state.meshWorld, getScenario: () => state.activeRobotScenario, run: runRobotRoutine, selectScenario: selectRobotScenario, selectNode: selectObject, dragNode: (id,event)=>state.meshWorld?.beginNodeDrag(id,event), inspectNode: node => node && openObjectSubmenu(toolForNode(node), node), canApprove: state.session.permissions.approve });
  state.meshWorld = createMeshWorld($("#webgl-world"), {
    onFrame: frame => state.executionUI.frame(frame), getTool:()=>state.editTool, canMove:()=>canEditModel() && state.editTool==="select",
    onSelect:selectObject, onInspect:id=>openObjectSubmenu(toolForNode(nodeById(id)),nodeById(id)),
    onMoveStart:beginMove, onMove:(id,point)=>{moveObject(state.model,id,point.x,point.y);state.meshWorld.setModel(state.model);},
    onMoveEnd:(id,cancelled)=>endMove(cancelled)
  });
  state.interiorWorld = createMeshWorld($("#interior-canvas"), { deepDive: true });
  renderModel(); renderInspector();
  renderRobotLab(await api("/api/robot-scenarios"));
  objectDefinitions=buildObjectCatalog(objectDefinitions,state.robotScenarios); renderPalette();
  renderRibbon("model"); attachOrbitControls();
  $("#run-simulation").addEventListener("click", runSimulation);
  $("#run-agent-task").addEventListener("click", runAgentTask);
  $("#run-optimizer")?.addEventListener("click", runOptimization);
  try { state.runtime = await api("/api/runtime"); } catch { state.runtime = null; }
  $("#run-agent-task").textContent = agentButtonLabel();
  if (aiCoreConnected()) logLine("system", `Joule connected: ${state.runtime.provider} · ${state.runtime.orchestrator}`);
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
  const introPanel = $("#intro-panel"), introVideo = $("#intro-video");
  const openIntro = () => { introPanel.classList.remove("hidden"); try { localStorage.setItem("twin-intro-seen", "1"); } catch {} };
  const closeIntro = () => { introPanel.classList.add("hidden"); introVideo.pause(); };
  $("#intro-close").addEventListener("click", closeIntro);
  $("#intro-skip").addEventListener("click", closeIntro);
  $("#intro-start").addEventListener("click", () => introVideo.play().catch(() => {}));
  introVideo.addEventListener("play", () => introPanel.classList.add("playing"));
  introVideo.addEventListener("ended", () => setTimeout(closeIntro, 900));
  document.addEventListener("keydown", (event) => { if (event.key === "Escape" && !introPanel.classList.contains("hidden")) closeIntro(); });
  window.openIntro = openIntro;
  let introSeen = true; try { introSeen = localStorage.getItem("twin-intro-seen") === "1"; } catch {}
  if (!introSeen && !new URLSearchParams(location.search).has("nointro")) openIntro();
  $("#example-runbook-close").addEventListener("click", () => $("#example-runbook").classList.add("hidden"));
  $("#runbook-steps").addEventListener("click", (event) => { const action = event.target.closest("[data-runbook-action]")?.dataset.runbookAction; if (action) runExampleAction(action); });
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => changeView(button.dataset.view)));
  $("#ribbon-tools").addEventListener("click", (event) => { const button = event.target.closest("button"); if (button) handleRibbonAction(button); });
  $("#submenu-close").addEventListener("click", () => $("#object-submenu").classList.add("hidden"));
  $("#submenu-place").addEventListener("click", () => { const tool = state.pendingTool; if (tool) { addObject(tool); $("#submenu-place").textContent = "Place another"; showToast("Mesh placed on the shared 3D plane."); } });
  $("#submenu-inspect").addEventListener("click", () => { $(".inspector-panel").scrollIntoView({ behavior: "smooth", block: "nearest" }); showToast("Inspector opened while the deep-dive scene remains active."); });
  $("#interior-back").addEventListener("click", () => { $("#interior-dive").classList.add("hidden"); changeView(state.previousView || "2d"); });
  $("#interior-close").addEventListener("click", () => { $("#interior-dive").classList.add("hidden"); changeView(state.previousView || "2d"); });
  $("#interior-place").addEventListener("click", () => { if (state.interiorTool && !state.interiorNodeId) { addObject(state.interiorTool,state.interiorDraft); $("#interior-place").textContent = "Place another"; } });
  document.addEventListener("click", (event) => {
    const action = event.target.closest("[data-operation]")?.dataset.operation;
    if (action) handleOperation(action).catch((error) => { showToast(error.message); if ($("#workspace-error")) $("#workspace-error").textContent = error.message; });
  });
  $("#edit-toggle").addEventListener("click", () => { if (!state.session.permissions.editModel) return showToast("Your role is view-only."); if(state.dragId) cancelDrag(); state.trailStart=null; state.editMode = !state.editMode; $("#edit-toggle").classList.toggle("active", state.editMode); $("#edit-toggle").innerHTML = `<span></span> ${state.editMode ? "EDIT MODE" : "VIEW MODE"}`; renderInspector(); showToast(state.editMode ? "Edition mode enabled." : "View mode enabled; model structure is locked."); });
  $("#library-list").addEventListener("click",event=>{const tool=event.target.closest("[data-tool]")?.dataset.tool;if(tool) openObjectSubmenu(tool);});
  $("#editor-history").addEventListener("click",event=>{const button=event.target.closest("[data-command]");if(button&&!button.disabled) handleRibbonAction(button);});
  document.addEventListener("change",event=>{if(event.target.matches("[data-capacity-input]")) changeCapacity(event.target.value); if(event.target.matches("[data-robot-model]")) changeRobotRepresentation(event.target.dataset.robotModel,event.target.value);});
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape") { state.trailStart=null; if(state.dragId) cancelDrag(); syncEditorControls(); }
    if(!(event.ctrlKey||event.metaKey) || event.target.closest("input,textarea,select,[contenteditable=true]")) return;
    if(event.key.toLowerCase()==="z") { event.preventDefault(); event.shiftKey?redo():undo(); }
    if(event.key.toLowerCase()==="y") { event.preventDefault(); redo(); }
    if(event.key.toLowerCase()==="s") { event.preventDefault(); saveModel(true).catch(error=>showToast(error.message)); }
  });
  $$(".top-actions [data-command]").forEach((button) => button.addEventListener("click", async () => {
    const command = button.dataset.command;
    if (command === "save") return saveModel(true);
    if (command === "undo") return undo(); if (command === "redo") return redo();
    if (command === "load") return loadExample(button);
    if (command === "new") { if(!canEditModel()) return showToast("Enable Edit Mode and finish active runs first."); const before=snapshotModel(); state.model = { id: `model-${Date.now()}`, name: "Untitled SAP Embodied AI Scenario", version: before.version, nodes: [], edges: [] }; state.selectedId = null; state.trailStart=null; finishEdit(before); return showToast("New editable model created. Undo restores the previous model."); }
    if (command === "open") { if(!canEditModel()) return showToast("Enable Edit Mode and finish active runs first."); try { await state.saveQueue; const before=snapshotModel(); state.model = await api("/api/model"); rememberEdit(state,before); state.selectedId=null; state.trailStart=null; if(state.model.activeScenarioId) selectRobotScenario(state.model.activeScenarioId); renderModel(); renderInspector(); return showToast("Current model snapshot opened."); } catch(error) { showToast(error.message); } }
    if (command === "getting-started") { $("#guide-panel").classList.remove("hidden"); return; }
    if (command === "intro") { openIntro(); return; }
  }));
  $$("[data-ribbon]").forEach((button) => button.addEventListener("click", () => { $$("[data-ribbon]").forEach((item) => item.classList.toggle("active", item === button)); renderRibbon(button.dataset.ribbon); showToast(`${button.textContent} ribbon selected.`); }));
  $$("[data-zoom]").forEach((button) => button.addEventListener("click", () => { const action = button.dataset.zoom; if (state.mode === "3d") { if (action === "fit") state.meshWorld?.fit?.(); else state.meshWorld?.setCamera({ zoom: action === "in" ? 1.15 : 1 / 1.15 }); return; } state.zoom = action === "in" ? Math.min(1.3, state.zoom + .1) : action === "out" ? Math.max(.7, state.zoom - .1) : 1; $("#zoom-label").textContent = `${Math.round(state.zoom * 100)}%`; $("#model-canvas").style.transform = `scale(${state.zoom})`; }));
  $("#palette-search").addEventListener("input",renderPalette);
  const deepLink = new URLSearchParams(location.search);
  changeView(deepLink.get("view") === "2d" ? "2d" : "3d");
  initHumanoidLab();
  checkAnalyticsReady();
  const activeJobs = await api("/api/robot-routines/active");
  for (const job of activeJobs) { state.executionUI.started(job.id); watchJob(job.id, `/api/jobs/${job.id}/events`); }
  try { state.experimentsUI = initExperimentsUI({
    api:async(path,options)=>{if(path==="/api/experiment-template") await state.saveQueue;return api(path,options);},
    getModel:()=>state.model,
    beforeRun:async()=>{if(state.robotRunning||state.simulationRunning) throw new Error("Finish the active twin run first.");await state.saveQueue;},
    onRunningChange:running=>{state.experimentRunning=running;syncEditorControls();}
  }); }
  catch (error) { $("#industrial-experiments").textContent = `Industrial experiments unavailable: ${error.message}`; }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

boot().catch((error) => { showToast(error.message); logLine("system", error.message, true); });
