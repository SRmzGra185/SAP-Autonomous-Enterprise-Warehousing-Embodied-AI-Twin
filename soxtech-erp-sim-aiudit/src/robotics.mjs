const VERSION = "0.5.0-embodied-ai";

function node(id, kind, visual, name, subtitle, x, y, z, capacity, service, color, deviceClass, protocols) {
  return { id, kind, visual, name, subtitle, x, y, z, capacity, service, color, deviceClass, protocols, visibility: "tenant" };
}

function step(id, label, action, nodeId, command, sensor, expected, duration = 1) {
  return { id, label, action, nodeId, command, sensor, expected, duration };
}

function transition(id, from, to, receptivity) {
  return { id, from, to, receptivity };
}

export const robotScenarios = [
  {
    id: "retail-replenishment",
    domain: "Retail",
    name: "SAP Retail Autonomous Shelf Replenishment",
    objective: "Detect a shelf gap, retrieve the correct SKU, replenish safely around shoppers, and reconcile inventory.",
    robot: "Mobile manipulator",
    controller: "ROS 2 behavior tree + navigation + grasp planner",
    protocols: ["ROS 2", "MQTT", "REST/JSON", "RFID"],
    sensors: ["RGB-D", "2D LiDAR", "RFID", "Shelf weight", "Safety scanner"],
    model: {
      id: "robot-retail-demo", name: "Retail Shelf-to-Replenishment Routine", version: VERSION,
      nodes: [
        node("retail-demand", "source", "posTerminal", "SAP S/4HANA Retail Inventory", "Stock signal, product master, and replenishment request", 55, 120, 0, 2, 1, "#385b78", "application", ["REST/JSON"]),
        node("retail-shelf", "data", "retailShelf", "Smart Shelf", "Planogram, camera, RFID and weight sensing", 250, 120, 1, 4, 2, "#8b6f47", "sensor", ["MQTT", "RFID"]),
        node("retail-backroom", "source", "rack", "Backroom Storage", "Reserved SKU and tote location", 250, 390, 1, 3, 2, "#506a78", "storage", ["REST/JSON", "RFID"]),
        node("retail-robot", "agent", "mobileManipulator", "Replenishment Robot", "AMR navigation plus 6-axis picking arm", 485, 250, 2, 1, 4, "#2d6f68", "robot", ["ROS 2", "MQTT"]),
        node("retail-zone", "audit", "safetyZone", "Customer Safety Zone", "Human detection, speed limit and stop field", 720, 250, 3, 1, 1, "#9b643e", "safety", ["OPC UA", "ROS 2"]),
        node("retail-evidence", "audit", "sensorMast", "Inventory Evidence", "Image, weight and stock reconciliation", 920, 250, 4, 2, 2, "#705783", "inspection", ["REST/JSON"])
      ],
      edges: [["retail-demand", "retail-shelf"], ["retail-shelf", "retail-robot"], ["retail-backroom", "retail-robot"], ["retail-robot", "retail-zone"], ["retail-zone", "retail-evidence"], ["retail-evidence", "retail-demand"]]
    },
    grafcet: {
      initial: "S0",
      steps: [
        step("S0", "Await shortage", "Subscribe to shelf-gap and inventory events.", "retail-demand", "inventory.watch()", "shelf_weight", "gap > 2 units"),
        step("S1", "Validate SKU", "Match planogram position to product master and stock.", "retail-shelf", "vision.identify_sku()", "rgbd + rfid", "confidence >= 0.95"),
        step("S2", "Reserve stock", "Reserve one replenishment tote in the backroom.", "retail-backroom", "erp.reserve_stock()", "rfid", "reservation accepted"),
        step("S3", "Pick product", "Navigate, localize tote, grasp SKU, and verify grip.", "retail-robot", "arm.pick_verified()", "rgbd + gripper_force", "grip && sku match", 2),
        step("S4", "Enter aisle", "Request aisle access and apply human-aware speed.", "retail-zone", "nav.enter_slow_zone()", "lidar + safety_scan", "zone clear"),
        step("S5", "Replenish shelf", "Place product in the assigned planogram slot.", "retail-robot", "arm.place_to_pose()", "rgbd + force", "placement stable", 2),
        step("S6", "Reconcile evidence", "Confirm weight delta, image, RFID, and inventory.", "retail-evidence", "audit.commit_evidence()", "weight + rgbd + rfid", "all evidence agrees")
      ],
      transitions: [
        transition("T0", "S0", "S1", "shelf_gap = TRUE"),
        transition("T1", "S1", "S2", "sku_confidence >= 0.95"),
        transition("T2", "S2", "S3", "reservation = ACCEPTED"),
        transition("T3", "S3", "S4", "grip_verified = TRUE"),
        transition("T4", "S4", "S5", "protective_field = CLEAR"),
        transition("T5", "S5", "S6", "placement_complete = TRUE"),
        transition("T6", "S6", "S0", "inventory_reconciled = TRUE")
      ]
    }
  },
  {
    id: "warehouse-fulfillment",
    domain: "Warehousing",
    name: "SAP EWM Multi-Robot Order Fulfillment",
    objective: "Allocate an order, dispatch an AMR, pick a tote, verify weight, and release the shipment without congestion.",
    robot: "AMR fleet + picking arm",
    controller: "Joule dispatch + SAP Warehouse Robotics + PLC handshake",
    protocols: ["ROS 2", "OPC UA", "MQTT", "REST/JSON"],
    sensors: ["LiDAR", "Barcode", "RFID", "Scale", "Photoelectric", "Encoders"],
    model: {
      id: "robot-warehouse-demo", name: "Warehouse Order-to-Dispatch Routine", version: VERSION,
      nodes: [
        node("wh-order", "source", "posTerminal", "SAP EWM Order Wave", "Warehouse order, priority, SKU, quantity, and cut-off", 45, 210, 0, 4, 1, "#385b78", "application", ["REST/JSON"]),
        node("wh-rack", "source", "rack", "AS/RS Rack", "Reserved tote and storage coordinates", 240, 100, 1, 6, 2, "#506a78", "storage", ["OPC UA", "RFID"]),
        node("wh-amr", "agent", "amr", "AMR Fleet", "Traffic-aware tote transportation", 430, 210, 2, 4, 3, "#2c6b73", "robot", ["ROS 2", "MQTT"]),
        node("wh-pick", "agent", "cobotCell", "Robotic Pick Cell", "Vision-guided bin picking and sortation", 630, 100, 3, 2, 4, "#4c6078", "robot", ["ROS 2", "OPC UA"]),
        node("wh-conveyor", "bdc", "conveyor", "Conveyor Merge", "PLC-controlled material flow and routing", 630, 390, 3, 3, 2, "#6c6554", "machine", ["OPC UA"]),
        node("wh-scale", "audit", "inspectionCell", "Weight / Scan Gate", "Barcode, mass and exception decision", 835, 210, 4, 2, 2, "#77526b", "inspection", ["OPC UA", "REST/JSON"]),
        node("wh-dock", "consume", "loadingDock", "SAP EWM Goods Issue", "Handling unit, dock, and shipment confirmation", 1010, 210, 5, 2, 2, "#386b64", "machine", ["REST/JSON"])
      ],
      edges: [["wh-order", "wh-rack"], ["wh-rack", "wh-amr"], ["wh-amr", "wh-pick"], ["wh-pick", "wh-conveyor"], ["wh-conveyor", "wh-scale"], ["wh-scale", "wh-dock"]]
    },
    grafcet: {
      initial: "S0",
      steps: [
        step("S0", "Await order", "Validate order priority, stock, and cut-off.", "wh-order", "wms.accept_wave()", "order_event", "order released"),
        step("S1", "Reserve tote", "Lock inventory row and request AS/RS extraction.", "wh-rack", "asrs.retrieve_tote()", "rfid + slot_sensor", "tote at pickup"),
        step("S2", "Dispatch AMR", "Assign nearest charged AMR and collision-free route.", "wh-amr", "fleet.dispatch()", "lidar + odometry", "robot docked", 2),
        step("S3", "Pick and sort", "Identify SKU, grasp quantity, and place on conveyor.", "wh-pick", "picker.execute_recipe()", "rgbd + vacuum", "quantity confirmed", 2),
        step("S4", "Convey package", "Handshake with PLC and merge into outbound lane.", "wh-conveyor", "plc.route_lane()", "photoeye + encoder", "lane clear"),
        step("S5", "Verify package", "Compare barcode and measured mass against order.", "wh-scale", "quality.verify_package()", "barcode + scale", "mass within tolerance"),
        step("S6", "Release shipment", "Post handling unit, dock assignment, and evidence.", "wh-dock", "erp.confirm_dispatch()", "dock_presence", "shipment confirmed")
      ],
      transitions: [
        transition("T0", "S0", "S1", "order_released = TRUE"),
        transition("T1", "S1", "S2", "tote_ready = TRUE"),
        transition("T2", "S2", "S3", "amr_docked = TRUE"),
        transition("T3", "S3", "S4", "pick_complete = TRUE"),
        transition("T4", "S4", "S5", "package_at_scale = TRUE"),
        transition("T5", "S5", "S6", "weight_check = PASS"),
        transition("T6", "S6", "S0", "dispatch_confirmed = TRUE")
      ]
    }
  },
  {
    id: "adaptive-assembly",
    domain: "Assembly",
    name: "SAP Digital Manufacturing Adaptive Cobot Assembly",
    objective: "Read the production variant, select a tool, assemble with force control, verify torque, and route defects to rework.",
    robot: "6-axis collaborative robot",
    controller: "Skill graph + trajectory planner + PLC state machine",
    protocols: ["ROS 2", "OPC UA", "PROFINET", "REST/JSON"],
    sensors: ["RGB-D", "Force/torque", "Torque controller", "Presence", "Tool ID"],
    model: {
      id: "robot-assembly-demo", name: "Variant-to-Assembly Routine", version: VERSION,
      nodes: [
        node("asm-order", "source", "posTerminal", "SAP Digital Manufacturing Order", "Variant, BOM, routing, recipe, and serial number", 45, 210, 0, 2, 1, "#385b78", "application", ["REST/JSON"]),
        node("asm-feeder", "source", "partsFeeder", "Flexible Parts Feeder", "Vision-localized parts and availability", 250, 100, 1, 4, 2, "#6e6654", "machine", ["OPC UA"]),
        node("asm-cobot", "agent", "cobotCell", "Cobot Workcell", "Tool change, pick, insert and fastening", 470, 210, 2, 1, 5, "#3b6475", "robot", ["ROS 2", "PROFINET"]),
        node("asm-fixture", "bdc", "assemblyFixture", "Smart Fixture", "Clamp, presence and datum verification", 680, 100, 3, 1, 2, "#655b78", "device", ["OPC UA"]),
        node("asm-torque", "bdc", "torqueStation", "Torque Controller", "Fastening recipe and curve capture", 680, 390, 3, 1, 2, "#866a45", "device", ["PROFINET", "OPC UA"]),
        node("asm-inspect", "audit", "inspectionCell", "Vision Quality Gate", "Geometry, presence and traceability inspection", 885, 210, 4, 2, 3, "#77526b", "inspection", ["ROS 2", "REST/JSON"]),
        node("asm-rework", "audit", "safetyZone", "SAP Quality Management Gate", "Usage decision, release, or controlled rework", 1030, 210, 5, 1, 1, "#9b643e", "safety", ["OPC UA"])
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
    domain: "Inspection",
    name: "SAP Asset Management Autonomous Inspection",
    objective: "Plan a safe mission, collect multimodal sensor evidence, detect an anomaly, and create a governed maintenance action.",
    robot: "Quadruped inspection robot",
    controller: "Mission planner + autonomy stack + anomaly models",
    protocols: ["ROS 2", "MQTT", "OPC UA", "REST/JSON"],
    sensors: ["Thermal", "RGB-D", "Acoustic", "Vibration", "Gas", "SLAM"],
    model: {
      id: "robot-inspection-demo", name: "Mission-to-Maintenance Routine", version: VERSION,
      nodes: [
        node("insp-plan", "source", "posTerminal", "SAP Asset Management Inspection Plan", "Asset route, checkpoints, condition limits, and work context", 45, 210, 0, 2, 1, "#385b78", "application", ["REST/JSON"]),
        node("insp-dock", "bdc", "robotDock", "Robot Dock", "Charge, calibration and mission handoff", 240, 390, 1, 1, 2, "#536b73", "device", ["OPC UA", "ROS 2"]),
        node("insp-robot", "agent", "quadruped", "Inspection Robot", "Autonomous navigation and sensor positioning", 430, 210, 2, 1, 4, "#386b64", "robot", ["ROS 2", "MQTT"]),
        node("insp-machine", "bdc", "processMachine", "Critical Machine", "Motor, pump, gearbox and process condition", 640, 210, 3, 2, 3, "#5c6574", "machine", ["OPC UA"]),
        node("insp-sensors", "data", "sensorMast", "Sensor Fusion", "Thermal, acoustic, vibration, gas and RGB evidence", 820, 100, 4, 4, 2, "#705783", "sensor", ["MQTT", "JSON"]),
        node("insp-ai", "data", "inspectionCell", "Anomaly Workbench", "Vector similarity and condition classification", 820, 390, 4, 2, 3, "#68598b", "analytics", ["REST/JSON"]),
        node("insp-workorder", "audit", "safetyZone", "SAP S/4HANA Maintenance Gate", "Human review, evidence package, and maintenance order", 1010, 210, 5, 1, 2, "#9b643e", "safety", ["REST/JSON"])
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

export const robotScenarioIds = robotScenarios.map((scenario) => scenario.id);

const platformLayout = {
  "source-s4": [24, 48],
  "source-file": [24, 142],
  "source-external": [24, 236],
  cockpit: [192, 142],
  datasphere: [360, 48],
  bw: [360, 142],
  connect: [360, 236],
  objectstore: [528, 94],
  ecosystem: [528, 236],
  dataproduct: [696, 142],
  sac: [864, 48],
  intelligentapps: [864, 142],
  joule: [864, 236],
  aIudit: [864, 330]
};

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
    const existing = currentById.get(entry.id) || {}, position = platformLayout[entry.id] || [entry.x, entry.y];
    return { ...entry, ...existing, x: position[0], y: position[1], zone: "platform", layer: "data-fabric" };
  });
  const customNodes = (currentModel?.nodes || []).filter((entry) => !foundationIds.has(entry.id) && !allRobotIds.has(entry.id) && entry.layer !== "robotics");
  const sourceXs = scenario.model.nodes.map((entry) => Number(entry.x || 0)), sourceYs = scenario.model.nodes.map((entry) => Number(entry.y || 0));
  const minX = Math.min(...sourceXs), maxX = Math.max(...sourceXs), minY = Math.min(...sourceYs), maxY = Math.max(...sourceYs);
  const robotNodes = scenario.model.nodes.map((entry) => ({
    ...entry,
    x: 30 + ((Number(entry.x || 0) - minX) / Math.max(1, maxX - minX)) * 900,
    y: 424 + ((Number(entry.y || 0) - minY) / Math.max(1, maxY - minY)) * 132,
    zone: "operations",
    layer: "robotics",
    scenarioId: scenario.id
  }));
  const nodes = [...platformNodes, ...customNodes, ...robotNodes], ids = new Set(nodes.map((entry) => entry.id));
  const platformEdges = [...foundationModel.edges, ...(currentModel?.edges || []).filter(([from, to]) => !allRobotIds.has(from) && !allRobotIds.has(to))];
  const entryId = scenario.grafcet.steps[0]?.nodeId || robotNodes[0]?.id;
  const agentId = robotNodes.find((entry) => entry.kind === "agent")?.id || entryId;
  const dataId = robotNodes.find((entry) => entry.kind === "data")?.id;
  const evidenceId = [...robotNodes].reverse().find((entry) => entry.kind === "audit")?.id || scenario.grafcet.steps.at(-1)?.nodeId;
  const crossEdges = [
    ["source-s4", entryId],
    ["cockpit", entryId],
    ["dataproduct", agentId],
    ["joule", agentId],
    dataId ? [dataId, "datasphere"] : null,
    evidenceId ? [evidenceId, "aIudit"] : null
  ].filter(Boolean);
  const edges = uniqueEdges([...platformEdges, ...scenario.model.edges, ...crossEdges], ids);
  return {
    ...foundationModel,
    id: `unified-${scenario.id}`,
    name: `SAP Autonomous Enterprise + ${scenario.domain} Embodied AI Twin`,
    version: "0.5.0-embodied-ai",
    layout: "unified-campus",
    activeScenarioId: scenario.id,
    nodes,
    edges
  };
}

export function robotScenarioById(id) {
  return robotScenarios.find((scenario) => scenario.id === id) || null;
}

export async function runRobotRoutine(scenario, input, emit) {
  if (!scenario) throw new Error("Robot scenario not found.");
  if (input.mode === "live") throw new Error("Live robot commands are disabled. Use simulation, shadow, or assisted mode.");
  const started = Date.now(), cycles = input.cycles, steps = scenario.grafcet.steps, transitions = scenario.grafcet.transitions;
  await emit({ type: "robot_routine_started", scenarioId: scenario.id, scenarioName: scenario.name, mode: input.mode, cycles, initialStep: scenario.grafcet.initial, productionCommands: false });
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    for (let index = 0; index < steps.length; index += 1) {
      const current = steps[index], nextTransition = transitions.find((item) => item.from === current.id);
      await emit({ type: "grafcet_step_active", scenarioId: scenario.id, cycle, stepId: current.id, nodeId: current.nodeId, label: current.label, action: current.action, sensor: current.sensor, expected: current.expected });
      await emit({ type: "sensor_sample", scenarioId: scenario.id, cycle, stepId: current.id, source: current.sensor, value: current.expected, quality: 0.97 });
      await emit({
        type: "robot_command",
        scenarioId: scenario.id,
        cycle,
        stepId: current.id,
        command: current.command,
        mode: input.mode,
        dispatched: false,
        disposition: input.mode === "assisted" ? "approval_required" : input.mode === "shadow" ? "shadow_only" : "simulated"
      });
      await new Promise((resolve) => setTimeout(resolve, Math.max(30, Math.round((current.duration * 90) / input.speed))));
      if (nextTransition) await emit({ type: "grafcet_transition_fired", scenarioId: scenario.id, cycle, transitionId: nextTransition.id, from: nextTransition.from, to: nextTransition.to, receptivity: nextTransition.receptivity });
    }
  }
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
    evidence: ["commands", "sensor samples", "transition receptivities", "active steps", "tenant audit trace"]
  };
}
