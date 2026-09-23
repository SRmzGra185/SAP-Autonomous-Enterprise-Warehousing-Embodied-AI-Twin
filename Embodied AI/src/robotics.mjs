import { MODEL_VERSION, retiredPlatformIds } from "./domain.mjs";
import { routineKpis } from "./industrial-kpis.mjs";
import { governanceFor } from "./routine-governance.mjs";
import { defaultCaseContext } from "./routine-context.mjs";
import { proposalForStep } from "./resource-selection.mjs";
const VERSION = MODEL_VERSION;

function node(id, kind, visual, name, subtitle, x, y, z, capacity, service, color, deviceClass, protocols) {
  return { id, kind, visual, name, subtitle, x, y, z, capacity, service, color, deviceClass, protocols, visibility: "tenant" };
}

function step(id, label, action, nodeId, command, sensor, expected, duration = 1) {
  return { id, label, action, nodeId, command, sensor, expected, duration };
}

// Risk tier drives how autonomy level gates approval.
// "critical": physical grasp/lift of goods — always requires approval.
// "risky": material movement/dispatch — approval unless autonomy is high.
// "routine": data/validation steps — approval only when autonomy is low.
function stepRisk(step) {
  const text = `${step.command || ""} ${step.label || ""}`.toLowerCase();
  if (/pick|grasp|lift|insert|fasten|place/.test(text)) return "critical";
  if (/dispatch|convey|route|retrieve|navigate|move|allocate/.test(text)) return "risky";
  return "routine";
}

// Given the operator's autonomy level, decide if a step needs human approval.
function stepNeedsApproval(risk, autonomy) {
  if (autonomy === "low") return true;
  if (autonomy === "medium") return risk === "critical" || risk === "risky";
  return risk === "critical"; // high
}

function transition(id, from, to, receptivity) {
  return { id, from, to, receptivity };
}

export const robotScenarios = [
  {
    id: "autonomous-orchestration", domain: "Orchestration", name: "Power the Operations · Inspection-to-Fulfillment",
    workspaceId: "orchestration",
    assistants: ["Asset and Service Assistant", "Manufacturing Assistant", "Planning Assistant", "Logistics Assistant"],
    objective: "One full-circle demo: asset inspection, qualified technician review, approved part demand, line selection, UR5 assembly, packaging, warehouse allocation, transport and receipt verification.",
    robot: "Unitree inspection quadruped + UR5 assembly cell",
    controller: "Joule Work-inspired local coordination; humans authorize business and physical decisions",
    protocols: ["Simulated device events"], sensors: ["Condition evidence", "RFID EPC", "SKU and quantity", "Quality", "Receipt confirmation"],
    model: {
      id: "operations-full-circle-demo", name: "Asset-to-Production-to-Delivery", version: VERSION,
      nodes: [
        node("orch-asset", "source", "posTerminal", "Asset Operator", "Assign an on-site inspection; no repair is inferred", 0, 0, 0, 1, 2, "#49756e", "application", ["Simulation"]),
        node("orch-dog", "agent", "unitree", "Unitree On-site Inspector", "Model pending confirmation; sensing mission, not material transport", 1, 0, 0, 1, 3, "#53616c", "robot", ["Simulation"]),
        node("orch-work", "consume", "pavilion", "Joule Work · Technician Dispatch", "Match required skill, availability and permitted access; simulated assignment", 2, 0, 0, 1, 2, "#9364c4", "application", ["Simulation"]),
        node("orch-tech", "source", "posTerminal", "Qualified Technician", "Confirm finding and identify required part SKU", 3, 0, 0, 1, 4, "#52756e", "application", ["Simulation"]),
        node("orch-demand", "source", "posTerminal", "Executive Demand Approval", "Approve material order and any upsell; never assume customer consent", 4, 0, 0, 1, 2, "#586c83", "application", ["Simulation"]),
        node("orch-line", "bdc", "processMachine", "Production Line Allocation", "Compare feasible capacity, setup and due date with DES", 5, 0, 0, 2, 3, "#576b83", "machine", ["Simulation"]),
        node("orch-cell", "agent", "cobotCell", "UR5 Assembly Cell", "Existing arm mesh retained; illustrative UR5, not validated kinematics", 6, 0, 0, 1, 5, "#4d657a", "robot", ["Simulation"]),
        node("orch-quality", "audit", "inspectionCell", "Part Quality Check", "Verify SKU, revision, quantity and assembly evidence", 7, 0, 0, 2, 2, "#786481", "inspection", ["Simulation"]),
        node("orch-pack", "bdc", "conveyor", "Manufacturing Operator · Packaging", "Package accepted parts; bind RFID EPC to handling unit and SKU", 8, 0, 0, 1, 3, "#7c7458", "machine", ["Simulation"]),
        node("orch-rack", "source", "rack", "Warehouse Operator · Rack", "Available / empty / blocked / replenishment delayed", 9, 0, 0, 2, 2, "#526b79", "storage", ["Simulation", "RFID"]),
        node("orch-transport", "consume", "loadingDock", "Transport & Route Selection", "Compare available approved carriers, capacity, ETA and cost; no dog cargo", 10, 0, 0, 2, 3, "#52736b", "application", ["Simulation"]),
        node("orch-delivery", "audit", "inspectionCell", "Delivery & Asset Follow-up", "Verify receipt; asset cause remains open until installation/retest evidence", 11, 0, 0, 1, 2, "#786481", "inspection", ["Simulation"])
      ], edges: []
    },
    grafcet: { initial: "S0", steps: [
      step("S0", "Assign inspection", "Asset operator releases a scoped inspection mission.", "orch-asset", "asset.assign_inspection()", "asset_event", "inspection scope approved"),
      step("S1", "Inspect on-site", "Unitree acquires simulated condition observations without manipulating the asset.", "orch-dog", "inspection.observe_asset()", "condition_bundle", "observations recorded", 2),
      step("S2", "Assign technician", "Match approved skill, availability and access constraints in a local Joule Work-style task.", "orch-work", "work.match_technician()", "qualification + availability", "qualified technician proposed"),
      step("S3", "Validate part need", "Technician validates the diagnosis, part revision and required SKU.", "orch-tech", "technician.confirm_part_need()", "inspection_review", "part requirement confirmed"),
      step("S4", "Approve demand", "Executive confirms demand, order and optional upsell before manufacture.", "orch-demand", "demand.approve_order()", "business_approval", "demand explicitly approved"),
      step("S5", "Allocate line", "Manufacturing operator compares feasible line capacities and setup times; optimization requires measured profiles.", "orch-line", "manufacturing.allocate_line()", "capacity_snapshot", "feasible line reserved"),
      step("S6", "Assemble part", "UR5 runs the simulated approved assembly recipe; actual robot disconnected.", "orch-cell", "ur5.simulate_assembly()", "torque + presence", "assembly complete", 2),
      step("S7", "Verify quality", "Verify part identity, revision, quantity and quality before packaging.", "orch-quality", "quality.verify_part()", "sku + quality_evidence", "part accepted"),
      step("S8", "Package & tag", "Manufacturing operator packages accepted units and associates EPC with handling unit.", "orch-pack", "packaging.bind_epc()", "rfid + weight", "packaged quantity verified"),
      step("S9", "Allocate warehouse", "Warehouse operator checks shelf occupancy, obstruction and replenishment status.", "orch-rack", "warehouse.verify_shelf()", "shelf_state + rfid", "shelf available and unit located"),
      step("S10", "Plan dispatch", "Warehouse operator selects a feasible carrier and route from currently available demo options.", "orch-transport", "logistics.propose_dispatch()", "carrier_quote + route_eta", "dispatch proposal reviewed"),
      step("S11", "Verify outcome", "Check receipt, physical presence and originating exception separately; delivery alone never proves asset repair.", "orch-delivery", "evidence.verify_fulfillment()", "receipt + followup", "delivery evidence recorded; resolution requires proof")
    ], transitions: [] }
  },
  {
    id: "warehouse-fulfillment",
    domain: "Logistics",
    name: "Autonomous Logistics",
    workspaceId: "logistics",
    assistants: ["Logistics Assistant"],
    objective: "Allocate an order, inspect the tote with a Unitree quadruped, pick with the UR5, verify weight, and release the shipment without congestion.",
    robot: "Unitree inspection quadruped + UR5 picking arm",
    controller: "Local Unitree inspection and UR5 routine; material movement remains assigned to handling equipment",
    protocols: ["ROS 2", "OPC UA", "MQTT", "REST/JSON"],
    sensors: ["LiDAR", "Barcode", "RFID", "Scale", "Photoelectric", "Encoders"],
    model: {
      id: "robot-warehouse-demo", name: "Warehouse Order-to-Dispatch Routine", version: VERSION,
      nodes: [
        node("wh-order", "source", "posTerminal", "Warehouse Order Context", "Warehouse order, priority, SKU, quantity, and cut-off", 45, 210, 0, 4, 1, "#385b78", "application", ["REST/JSON"]),
        node("wh-rack", "source", "rack", "AS/RS Rack", "Reserved tote and storage coordinates", 240, 100, 1, 6, 2, "#506a78", "storage", ["OPC UA", "RFID"]),
        node("wh-amr", "agent", "unitree", "Unitree Tote Inspector", "Inspect identity and access; not a cargo AGV", 430, 210, 2, 4, 3, "#2c6b73", "robot", ["ROS 2", "MQTT"]),
        node("wh-pick", "agent", "cobotCell", "UR5 Pick Cell", "UR5 illustration; existing arm geometry retained", 630, 100, 3, 2, 4, "#4c6078", "robot", ["ROS 2", "OPC UA"]),
        node("wh-conveyor", "bdc", "conveyor", "Conveyor Merge", "PLC-controlled material flow and routing", 630, 390, 3, 3, 2, "#6c6554", "machine", ["OPC UA"]),
        node("wh-scale", "audit", "inspectionCell", "Weight / Scan Gate", "Barcode, mass and exception decision", 835, 210, 4, 2, 2, "#77526b", "inspection", ["OPC UA", "REST/JSON"]),
        node("wh-dock", "consume", "loadingDock", "Dispatch Evidence", "Handling unit, dock, and shipment confirmation", 1010, 210, 5, 2, 2, "#386b64", "machine", ["REST/JSON"])
      ],
      edges: [["wh-order", "wh-rack"], ["wh-rack", "wh-amr"], ["wh-amr", "wh-pick"], ["wh-pick", "wh-conveyor"], ["wh-conveyor", "wh-scale"], ["wh-scale", "wh-dock"]]
    },
    grafcet: {
      initial: "S0",
      steps: [
        step("S0", "Await order", "Validate order priority, stock, and cut-off.", "wh-order", "wms.accept_wave()", "order_event", "order released"),
        step("S1", "Reserve tote", "Lock inventory row and request AS/RS extraction.", "wh-rack", "asrs.retrieve_tote()", "rfid + slot_sensor", "tote at pickup"),
        step("S2", "Inspect tote", "Unitree verifies access and tote identity; AS/RS and conveyor handle the material.", "wh-amr", "inspection.verify_tote()", "lidar + external_rfid", "identity and access verified", 2),
        step("S3", "Pick and sort", "Identify SKU, grasp quantity, and place on conveyor.", "wh-pick", "picker.execute_recipe()", "rgbd + vacuum", "quantity confirmed", 2),
        step("S4", "Convey package", "Handshake with PLC and merge into outbound lane.", "wh-conveyor", "plc.route_lane()", "photoeye + encoder", "lane clear"),
        step("S5", "Verify package", "Compare barcode and measured mass against order.", "wh-scale", "quality.verify_package()", "barcode + scale", "mass within tolerance"),
        step("S6", "Release shipment", "Post handling unit, dock assignment, and evidence.", "wh-dock", "erp.confirm_dispatch()", "dock_presence", "shipment confirmed")
      ],
      transitions: [
        transition("T0", "S0", "S1", "order_released = TRUE"),
        transition("T1", "S1", "S2", "tote_ready = TRUE"),
        transition("T2", "S2", "S3", "identity_access_verified = TRUE"),
        transition("T3", "S3", "S4", "pick_complete = TRUE"),
        transition("T4", "S4", "S5", "package_at_scale = TRUE"),
        transition("T5", "S5", "S6", "weight_check = PASS"),
        transition("T6", "S6", "S0", "dispatch_confirmed = TRUE")
      ]
    }
  },
  {
    id: "adaptive-assembly",
    domain: "Manufacturing",
    name: "Autonomous Manufacturing",
    workspaceId: "manufacturing",
    assistants: ["Manufacturing Assistant", "Product Design Assistant"],
    objective: "Read the production variant, select a tool, assemble with force control, verify torque, and route defects to rework.",
    robot: "Universal Robots UR5 · illustrative existing mesh",
    controller: "Skill graph + trajectory planner + PLC state machine",
    protocols: ["ROS 2", "OPC UA", "PROFINET", "REST/JSON"],
    sensors: ["RGB-D", "Force/torque", "Torque controller", "Presence", "Tool ID"],
    model: {
      id: "robot-assembly-demo", name: "Variant-to-Assembly Routine", version: VERSION,
      nodes: [
        node("asm-order", "source", "posTerminal", "Production Order Context", "Variant, BOM, routing, recipe, and serial number", 45, 210, 0, 2, 1, "#385b78", "application", ["REST/JSON"]),
        node("asm-feeder", "source", "partsFeeder", "Flexible Parts Feeder", "Vision-localized parts and availability", 250, 100, 1, 4, 2, "#6e6654", "machine", ["OPC UA"]),
        node("asm-cobot", "agent", "cobotCell", "UR5 Workcell", "UR5 description; existing 6-axis arm geometry unchanged", 470, 210, 2, 1, 5, "#3b6475", "robot", ["ROS 2", "PROFINET"]),
        node("asm-fixture", "bdc", "assemblyFixture", "Smart Fixture", "Clamp, presence and datum verification", 680, 100, 3, 1, 2, "#655b78", "device", ["OPC UA"]),
        node("asm-torque", "bdc", "torqueStation", "Torque Controller", "Fastening recipe and curve capture", 680, 390, 3, 1, 2, "#866a45", "device", ["PROFINET", "OPC UA"]),
        node("asm-inspect", "audit", "inspectionCell", "Vision Quality Gate", "Geometry, presence and traceability inspection", 885, 210, 4, 2, 3, "#77526b", "inspection", ["ROS 2", "REST/JSON"]),
        node("asm-rework", "audit", "safetyZone", "Quality Release Gate", "Usage decision, release, or controlled rework", 1030, 210, 5, 1, 1, "#9b643e", "safety", ["OPC UA"])
      ],
      edges: [["asm-order", "asm-feeder"], ["asm-order", "asm-cobot"], ["asm-feeder", "asm-cobot"], ["asm-cobot", "asm-fixture"], ["asm-fixture", "asm-torque"], ["asm-torque", "asm-inspect"], ["asm-inspect", "asm-rework"]]
    },
    grafcet: {
      initial: "S0",
      steps: [
        step("S0", "Read variant", "Load BOM, routing, tool, and torque recipe.", "asm-order", "mes.load_recipe()", "order_event", "recipe valid"),
        step("S1", "Present component", "Singulate and localize the correct component.", "asm-feeder", "feeder.present_part()", "rgbd + presence", "part pose valid"),
        step("S2", "Prepare tool", "Validate tool ID and perform automatic tool change.", "asm-cobot", "robot.change_tool()", "tool_id", "tool locked"),
        step("S3", "Pick and align", "Pick part and align to fixture datum.", "asm-cobot", "robot.pick_align()", "rgbd + force_torque", "alignment < 0.4 mm", 2),
        step("S4", "Clamp assembly", "Close fixture and validate all presence sensors.", "asm-fixture", "fixture.clamp()", "presence + clamp_pressure", "fixture safe"),
        step("S5", "Fasten to torque", "Execute recipe and capture angle/torque curve.", "asm-torque", "tool.fastening_cycle()", "torque + angle", "curve within envelope", 2),
        step("S6", "Inspect result", "Check geometry, components, label, and serial.", "asm-inspect", "vision.inspect_variant()", "rgbd + barcode", "inspection complete"),
        step("S7", "Release or rework", "Post confirmation or create controlled rework task.", "asm-rework", "quality.route_result()", "gate_state", "route acknowledged")
      ],
      transitions: [
        transition("T0", "S0", "S1", "recipe_valid = TRUE"),
        transition("T1", "S1", "S2", "part_pose_valid = TRUE"),
        transition("T2", "S2", "S3", "tool_locked = TRUE"),
        transition("T3", "S3", "S4", "alignment_ok = TRUE"),
        transition("T4", "S4", "S5", "fixture_safe = TRUE"),
        transition("T5", "S5", "S6", "torque_curve = PASS"),
        transition("T6", "S6", "S7", "inspection_complete = TRUE"),
        transition("T7", "S7", "S0", "result_posted = TRUE")
      ]
    }
  },
  {
    id: "autonomous-inspection",
    domain: "Asset Management",
    name: "Autonomous Asset Management",
    workspaceId: "asset-management",
    assistants: ["Asset and Service Assistant"],
    objective: "Plan a safe mission, collect multimodal sensor evidence, detect an anomaly, and create a governed maintenance action.",
    robot: "Unitree inspection quadruped · model to confirm",
    controller: "Mission planner + autonomy stack + anomaly models",
    protocols: ["ROS 2", "MQTT", "OPC UA", "REST/JSON"],
    sensors: ["Thermal", "RGB-D", "Acoustic", "Vibration", "Gas", "SLAM"],
    model: {
      id: "robot-inspection-demo", name: "Mission-to-Maintenance Routine", version: VERSION,
      nodes: [
        node("insp-plan", "source", "posTerminal", "Asset Inspection Context", "Asset route, checkpoints, condition limits, and work context", 45, 210, 0, 2, 1, "#385b78", "application", ["REST/JSON"]),
        node("insp-dock", "bdc", "robotDock", "Robot Dock", "Charge, calibration and mission handoff", 240, 390, 1, 1, 2, "#536b73", "device", ["OPC UA", "ROS 2"]),
        node("insp-robot", "agent", "unitree", "Unitree Inspection Robot", "Autonomous navigation and sensor positioning", 430, 210, 2, 1, 4, "#386b64", "robot", ["ROS 2", "MQTT"]),
        node("insp-machine", "bdc", "processMachine", "Critical Machine", "Motor, pump, gearbox and process condition", 640, 210, 3, 2, 3, "#5c6574", "machine", ["OPC UA"]),
        node("insp-sensors", "data", "sensorMast", "Sensor Fusion", "Thermal, acoustic, vibration, gas and RGB evidence", 820, 100, 4, 4, 2, "#705783", "sensor", ["MQTT", "JSON"]),
        node("insp-ai", "data", "inspectionCell", "Anomaly Workbench", "Vector similarity and condition classification", 820, 390, 4, 2, 3, "#68598b", "analytics", ["REST/JSON"]),
        node("insp-workorder", "audit", "safetyZone", "Maintenance Review Gate", "Human review, evidence package, and maintenance order", 1010, 210, 5, 1, 2, "#9b643e", "safety", ["REST/JSON"])
      ],
      edges: [["insp-plan", "insp-dock"], ["insp-dock", "insp-robot"], ["insp-robot", "insp-machine"], ["insp-machine", "insp-sensors"], ["insp-sensors", "insp-ai"], ["insp-ai", "insp-workorder"]]
    },
    grafcet: {
      initial: "S0",
      steps: [
        step("S0", "Load mission", "Load asset route, checkpoints, and limits.", "insp-plan", "mission.load()", "plan_event", "mission valid"),
        step("S1", "Preflight robot", "Check battery, sensors, calibration, and stop channel.", "insp-dock", "robot.preflight()", "battery + calibration", "all checks pass"),
        step("S2", "Navigate waypoint", "Localize and move to the guarded inspection pose.", "insp-robot", "nav.goto_checkpoint()", "slam + lidar", "pose tolerance met", 2),
        step("S3", "Stabilize asset", "Read machine state and verify measurement conditions.", "insp-machine", "asset.read_state()", "opcua_tags", "machine state valid"),
        step("S4", "Capture evidence", "Acquire thermal, RGB, acoustic, vibration, and gas data.", "insp-sensors", "sensor.capture_bundle()", "multimodal_bundle", "quality score >= 0.9", 2),
        step("S5", "Classify anomaly", "Compare vectors and rules against known failure modes.", "insp-ai", "ai.classify_condition()", "vector + knowledge_graph", "decision explainable"),
        step("S6", "Govern action", "Create review package and simulated maintenance work order.", "insp-workorder", "audit.propose_work_order()", "approval_state", "human review queued")
      ],
      transitions: [
        transition("T0", "S0", "S1", "mission_valid = TRUE"),
        transition("T1", "S1", "S2", "preflight = PASS"),
        transition("T2", "S2", "S3", "pose_reached = TRUE"),
        transition("T3", "S3", "S4", "measurement_window = OPEN"),
        transition("T4", "S4", "S5", "evidence_quality >= 0.90"),
        transition("T5", "S5", "S6", "classification_explainable = TRUE"),
        transition("T6", "S6", "S0", "review_queued = TRUE")
      ]
    }
  }
];

const fullCircle = robotScenarios.find(scenario => scenario.id === "autonomous-orchestration");
const fullCircleActors = ["Asset operator", "Unitree inspection mission", "Joule Work dispatch reviewer", "Qualified technician", "Executive requester", "Manufacturing planner", "Manufacturing operator", "Quality reviewer", "Manufacturing operator", "Warehouse operator", "Warehouse transport planner", "Receiving / asset owner"];
fullCircle.grafcet.steps.forEach((current, index) => {
  current.actor = fullCircleActors[index];
  current.domainWorkspace = index < 4 ? "asset-management" : index < 9 ? "manufacturing" : "orchestration";
});
fullCircle.grafcet.transitions = fullCircle.grafcet.steps.map((current, index, steps) => transition("T" + index, current.id, steps[(index + 1) % steps.length].id, current.expected + " = VERIFIED_IN_SIMULATION"));
fullCircle.model.edges = fullCircle.model.nodes.slice(1).map((current, index) => [fullCircle.model.nodes[index].id, current.id]);

export const robotScenarioIds = robotScenarios.map((scenario) => scenario.id);

// Keep domain cards in an intentional order; IDs remain stable for existing saved scenarios.
const scenarioOrder = ["autonomous-inspection", "adaptive-assembly", "autonomous-orchestration", "warehouse-fulfillment"];
robotScenarios.sort((a, b) => scenarioOrder.indexOf(a.id) - scenarioOrder.indexOf(b.id));
for (const scenario of robotScenarios) scenario.kpiProfile = {
  status: "instrumentation plan; not measured results",
  metrics: (routineKpis[scenario.id] || []).map(([name, definition, requiredInputs]) => ({ name, definition, requiredInputs }))
};
for (const scenario of robotScenarios) {
  scenario.governance = governanceFor(scenario.id);
  scenario.caseContext = structuredClone(defaultCaseContext);
  for (const object of scenario.model.nodes) if (object.visual === "rack") Object.assign(object, { rackState: "available", sku: defaultCaseContext.sku, rfidEpc: defaultCaseContext.rfidEpc });
}

export function routineRoute(scenario) {
  const path = ["connect", "operation-context", "joule", "approval"];
  let domain = null;
  for (const current of scenario.grafcet.steps) {
    const nextDomain = current.domainWorkspace || scenario.workspaceId;
    if (nextDomain !== domain) { path.push(nextDomain); domain = nextDomain; }
    path.push(current.nodeId);
  }
  return [...path, "evidence"];
}

function uniqueEdges(edges, ids) {
  const seen = new Set();
  return edges.filter(([from, to]) => {
    const key = `${from}->${to}`;
    if (!ids.has(from) || !ids.has(to) || from === to || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function composeRobotTwin(currentModel, foundationModel, scenario) {
  if (!scenario) throw new Error("Robot scenario not found.");
  const allRobotIds = new Set(robotScenarios.flatMap((item) => item.model.nodes.map((entry) => entry.id)));
  const foundationIds = new Set(foundationModel.nodes.map((entry) => entry.id));
  const currentById = new Map((currentModel?.nodes || []).map((entry) => [entry.id, entry]));
  const platformNodes = foundationModel.nodes.map((entry) => {
    const existing = currentById.get(entry.id) || {};
    return { ...existing, ...entry, capacity: existing.capacity || entry.capacity, service: existing.service || entry.service, zone: "platform", layer: "data-fabric" };
  });
  const customNodes = (currentModel?.nodes || []).filter((entry) => !foundationIds.has(entry.id) && !allRobotIds.has(entry.id) && entry.layer !== "robotics" && !retiredPlatformIds.has(entry.id) && !entry.id.startsWith("retail-"));
  const sourceXs = scenario.model.nodes.map((entry) => Number(entry.x || 0)), sourceYs = scenario.model.nodes.map((entry) => Number(entry.y || 0));
  const minX = Math.min(...sourceXs), maxX = Math.max(...sourceXs), minY = Math.min(...sourceYs), maxY = Math.max(...sourceYs);
  const robotNodes = scenario.model.nodes.map((entry, index) => ({
    ...entry,
    x: scenario.model.nodes.length > 8 ? 35 + (index % 4) * 285 : 30 + ((Number(entry.x || 0) - minX) / Math.max(1, maxX - minX)) * 900,
    y: scenario.model.nodes.length > 8 ? 470 + Math.floor(index / 4) * 160 : 470 + ((Number(entry.y || 0) - minY) / Math.max(1, maxY - minY)) * 132,
    zone: "operations",
    layer: "robotics",
    scenarioId: scenario.id
  }));
  const nodes = [...platformNodes, ...customNodes, ...robotNodes], ids = new Set(nodes.map((entry) => entry.id));
  const platformEdges = [...foundationModel.edges, ...(currentModel?.edges || []).filter(([from, to]) => !allRobotIds.has(from) && !allRobotIds.has(to))];
  const flow = routineRoute(scenario);
  const crossEdges = [...flow.slice(1).map((id, index) => [flow[index], id]),
    [scenario.grafcet.steps.at(-1).nodeId, scenario.grafcet.steps[0].nodeId]];
  const edges = uniqueEdges([...platformEdges, ...scenario.model.edges, ...crossEdges], ids);
  return {
    ...foundationModel,
    id: `unified-${scenario.id}`,
    name: `SAP Autonomous Operations · ${scenario.domain} Twin`,
    version: VERSION,
    layout: "unified-campus",
    activeScenarioId: scenario.id,
    executionRoute: flow,
    nodes,
    edges
  };
}

export function robotScenarioById(id) {
  return robotScenarios.find((scenario) => scenario.id === id) || null;
}

export async function runRobotRoutine(scenario, input, emit, controls = {}) {
  if (!scenario) throw new Error("Robot scenario not found.");
  if (input.mode === "live") throw new Error("Live robot commands are disabled. Use simulation, shadow, or assisted mode.");
  if (input.mode === "assisted" && typeof controls.requestApproval !== "function") throw new Error("Assisted execution requires a real approval controller.");
  const caseContext = input.caseContext || defaultCaseContext, resourceProposals = [];
  const wait = (ms) => new Promise((resolve, reject) => {
    if (controls.signal?.aborted) return reject(new Error("Routine cancelled."));
    const abort = () => { clearTimeout(timer); reject(new Error("Routine cancelled.")); };
    const timer = setTimeout(() => { controls.signal?.removeEventListener("abort", abort); resolve(); }, ms);
    controls.signal?.addEventListener("abort", abort, { once: true });
  });
  // Keep each simulated action visible in the twin without making smoke tests
  // wait on a full wall-clock production cycle.
  const duration = (units = 1) => Math.round(units * 1100 / input.speed);
  const transfer = async (fromNodeId, toNodeId, label, durationMs = duration()) => {
    await emit({ type: "routine_transfer", scenarioId: scenario.id, fromNodeId, toNodeId, nodeId: toNodeId, label, durationMs, simulated: true });
    await wait(durationMs);
  };
  const started = Date.now(), cycles = input.cycles, steps = scenario.grafcet.steps, transitions = scenario.grafcet.transitions;
  await emit({ type: "robot_routine_started", scenarioId: scenario.id, scenarioName: scenario.name, mode: input.mode, cycles, initialStep: scenario.grafcet.initial, caseContext, productionCommands: false });
  const guardrails = input.guardrails || {};
  const guardrailLabels = { allowZoneC: "Entry to restricted Zone C", allowHeavyLift: "Lift greater than 10 kg" };
  for (const [key, label] of Object.entries(guardrailLabels)) {
    if (guardrails[key]) await emit({ type: "guardrail_override", scenarioId: scenario.id, guardrail: key, label, at: new Date().toISOString(), audited: true, simulated: true });
  }
  await transfer("connect", "operation-context", "Shared data sample → governed operations context");
  await transfer("operation-context", "joule", "Context → simulated assistant plan");
  await transfer("joule", "approval", "Plan → local execution policy");
  let activeDomain = scenario.grafcet.steps[0].domainWorkspace || scenario.workspaceId;
  await transfer("approval", activeDomain, "Simulation policy → domain routine (assisted approval occurs before each command)");
  let previousNodeId = activeDomain;
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    for (let index = 0; index < steps.length; index += 1) {
      const current = steps[index], nextTransition = transitions.find((item) => item.from === current.id);
      const risk = stepRisk(current);
      const needsApproval = input.mode === "assisted" && stepNeedsApproval(risk, input.autonomy || "low");
      const domain = current.domainWorkspace || scenario.workspaceId;
      if (domain !== activeDomain) { await transfer(previousNodeId, domain, "Human-reviewed handoff → " + domain); activeDomain = domain; previousNodeId = domain; }
      const durationMs = duration(current.duration);
      const proposal = proposalForStep(current.nodeId);
      if (proposal) {
        resourceProposals.push({ stepId: current.id, cycle, ...proposal });
        await emit({ type: "resource_proposal", stepId: current.id, nodeId: current.nodeId, proposal });
        if (!proposal.selected) throw new Error("No eligible resource. Human review required.");
      }
      if (scenario.model.nodes.find(node => node.id === current.nodeId)?.visual === "rack" && caseContext.rackState !== "available") {
        await emit({ type: "shelf_exception", nodeId: current.nodeId, rackState: caseContext.rackState, caseContext, simulated: true, resolved: false });
        throw new Error("Shelf " + caseContext.rackState + ": routine stopped. Resolve the shelf exception and review a new run; no automatic material movement.");
      }
      await emit({ type: "grafcet_step_active", scenarioId: scenario.id, cycle, stepId: current.id, nodeId: current.nodeId, fromNodeId: previousNodeId, durationMs, index, totalSteps: steps.length, label: current.label, action: current.action, sensor: current.sensor, expected: current.expected, risk, autonomy: input.autonomy || "low", awaitingApproval: needsApproval });
      if (needsApproval) await controls.requestApproval({ scenarioId: scenario.id, cycle, stepId: current.id, transitionId: nextTransition?.id, nextStepId: nextTransition?.to, nodeId: current.nodeId, label: current.label, command: current.command, action: current.action, expected: current.expected, risk, intendedActor: current.actor || "Authorized operator", caseContext, ...(proposal ? { resourceProposal: proposal } : {}) });
      if (controls.signal?.aborted) throw new Error("Routine cancelled.");
      await emit({ type: "routine_transfer", scenarioId: scenario.id, fromNodeId: previousNodeId, toNodeId: current.nodeId, nodeId: current.nodeId, stepId: current.id, label: current.label, durationMs, simulated: true });
      await emit({
        type: "robot_command",
        scenarioId: scenario.id,
        cycle,
        stepId: current.id,
        command: current.command,
        mode: input.mode,
        dispatched: false,
        disposition: input.mode === "assisted" ? "approved_simulation" : input.mode === "shadow" ? "shadow_mock" : "simulated"
      });
      await wait(durationMs);
      await emit({ type: "sensor_sample", scenarioId: scenario.id, cycle, stepId: current.id, nodeId: current.nodeId, source: current.sensor, value: current.expected, caseContext, quality: 0.97, simulated: true });
      if (nextTransition) await emit({ type: "grafcet_transition_fired", scenarioId: scenario.id, cycle, nodeId: current.nodeId, transitionId: nextTransition.id, from: nextTransition.from, to: nextTransition.to, receptivity: nextTransition.receptivity, simulated: true });
      previousNodeId = current.nodeId;
    }
  }
  await transfer(previousNodeId, "evidence", "Simulated physical outcome → local execution evidence");
  const elapsedMs = Date.now() - started;
  await emit({ type: "robot_routine_complete", scenarioId: scenario.id, cycles, elapsedMs, finalStep: scenario.grafcet.initial, productionCommands: false });
  return {
    scenarioId: scenario.id,
    mode: input.mode,
    cycles,
    stepsExecuted: steps.length * cycles,
    transitionsEvaluated: transitions.length * cycles,
    elapsedMs,
    productionCommands: false,
    resolutionStatus: "awaiting_evidence",
    timingBasis: "Animation playback only; not measured machine time. Calibrated DES experiments use a separate seconds-based profile.",
    caseContext,
    resourceProposals,
    evidence: ["commands", "sensor samples", "transition receptivities", "active steps", "tenant audit trace"]
  };
}
