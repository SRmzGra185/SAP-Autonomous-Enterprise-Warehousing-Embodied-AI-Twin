// Digital Twin Robotics · Unitree H1 humanoid / Unitree Go2 quadruped module.
// Modeled on NVIDIA "Digital Twin Robotics" (Isaac Lab locomotion policy + Isaac Sim SIL).
// Job kinds, all executed by the same Isaac bridge executor that runs in Brev:
//   - train:    launch an Isaac Lab locomotion run, stream reward/iteration curves
//   - deploy:   pick the robot (H1 | Go2) and the NVIDIA warehouse, stand the robot up
//   - teleop:   drive the robot with velocity commands (from the UI or Joule)
//   - navigate: walk to a named destination of the warehouse map ("Rack 3"), avoiding shelves
//   - camera:   chase / wide / top view, or recover the camera ("find robot")
//   - plan:     a sequence of the above that Joule builds from one sentence
// When no Isaac executor is connected, everything falls back to a deterministic
// local simulation so the panel is always demonstrable.

const H1 = {
  id: "unitree-h1",
  name: "Unitree H1",
  dof: 19,
  joints: [
    "left_hip_yaw", "left_hip_roll", "left_hip_pitch", "left_knee", "left_ankle",
    "right_hip_yaw", "right_hip_roll", "right_hip_pitch", "right_knee", "right_ankle",
    "torso",
    "left_shoulder_pitch", "left_shoulder_roll", "left_shoulder_yaw", "left_elbow",
    "right_shoulder_pitch", "right_shoulder_roll", "right_shoulder_yaw", "right_elbow"
  ],
  sensors: ["imu (base)", "joint encoders ×19", "feet contact ×2"],
  task: "Isaac-Velocity-Flat-H1-v0"
};

const GO2 = {
  id: "unitree-go2",
  name: "Unitree Go2",
  dof: 12,
  joints: ["FL_hip", "FL_thigh", "FL_calf", "FR_hip", "FR_thigh", "FR_calf", "RL_hip", "RL_thigh", "RL_calf", "RR_hip", "RR_thigh", "RR_calf"],
  sensors: ["imu (base)", "joint encoders ×12", "feet contact ×4"],
  task: "Isaac-Velocity-Flat-Unitree-Go2-v0"
};
export const ROBOTS = { h1: { ...H1, key: "h1", kind: "humanoid", label: "Unitree H1 · humanoid" }, go2: { ...GO2, key: "go2", kind: "quadruped", label: "Unitree Go2 · quadruped" } };
export const ENVIRONMENTS = {
  full_warehouse: "Full warehouse (racks, pallets, forklifts)",
  warehouse_shelves: "Warehouse · multiple shelves",
  warehouse_forklifts: "Warehouse · forklifts",
  warehouse: "Simple warehouse",
  grid: "Empty grid"
};
export const VIEWS = ["chase", "wide", "top"];
const LIMITS = { h1: { vx: [-0.6, 1.0], vy: [-0.4, 0.4], yaw: [-1.2, 1.2] }, go2: { vx: [-1.0, 1.2], vy: [-0.6, 0.6], yaw: [-1.2, 1.2] } };

const PRETRAINED = { id: "h1_flat_pretrained", label: "H1 flat-terrain (NVIDIA pretrained)", reward: 21.4, iterations: 1500, source: "Isaac Lab checkpoint" };

function clampInt(value, min, max, fallback) { const n = Math.floor(Number(value)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }
function clampNum(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; }

export function validateTrainInput(body = {}) {
  return {
    iterations: clampInt(body.iterations ?? 300, 20, 3000, 300),
    numEnvs: clampInt(body.numEnvs ?? 2048, 64, 8192, 2048),
    task: H1.task,
    seed: clampInt(body.seed ?? 42, 0, 100000, 42)
  };
}

export function validateDeployInput(body = {}) {
  return {
    checkpoint: ["latest", "pretrained"].includes(body.checkpoint) ? body.checkpoint : "pretrained",
    terrain: ["flat", "rough"].includes(body.terrain) ? body.terrain : "flat",
    robot: Object.hasOwn(ROBOTS, body.robot) ? body.robot : "h1",
    environment: Object.hasOwn(ENVIRONMENTS, body.environment) ? body.environment : "full_warehouse"
  };
}

export function validateNavigateInput(body = {}, places = []) {
  const key = String(body.place ?? "").trim().toLowerCase();
  const place = places.find((p) => p.id === key || p.name.toLowerCase() === key);
  if (!place) throw Object.assign(new Error(places.length ? `Unknown destination "${body.place}". Known: ${places.map((p) => p.name).join(", ")}.` : "No warehouse map yet: connect Isaac Sim and deploy a robot first."), { status: 400 });
  return { place: place.id, name: place.name, x: place.x, y: place.y };
}

export function validateCameraInput(body = {}) {
  return { view: VIEWS.includes(body.view) ? body.view : "chase" };
}

// Joule plans: at most 8 bounded steps; destinations must exist on the current map.
export function validatePlan(steps, places = [], robot = "h1") {
  if (!Array.isArray(steps) || !steps.length) throw new Error("The plan has no steps.");
  const lim = LIMITS[robot] || LIMITS.h1;
  const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Number.isFinite(Number(v)) ? Number(v) : 0));
  const out = [];
  for (const raw of steps.slice(0, 8)) {
    const type = raw?.type;
    if (type === "go_to") {
      const key = String(raw.place ?? "").trim().toLowerCase();
      const place = places.find((p) => p.id === key || p.name.toLowerCase() === key);
      if (!place) continue; // never invent destinations
      out.push({ type, place: place.id, label: `Go to ${place.name}` });
    } else if (type === "move") {
      const cmd = { vx: clamp(raw.vx, lim.vx), vy: clamp(raw.vy, lim.vy), yaw: clamp(raw.yaw, lim.yaw), durationMs: clampInt(raw.durationMs, 500, 15000, 3000) };
      const what = Math.abs(cmd.yaw) > 0.05 && Math.abs(cmd.vx) < 0.1 ? `Turn ${cmd.yaw > 0 ? "left" : "right"}` : cmd.vx < -0.05 ? "Back up" : Math.abs(cmd.vx) < 0.05 && Math.abs(cmd.vy) < 0.05 ? "Hold" : "Walk";
      out.push({ type, ...cmd, label: `${what} · ${(cmd.durationMs / 1000).toFixed(1)} s` });
    } else if (type === "view") {
      const view = VIEWS.includes(raw.view) ? raw.view : "chase";
      out.push({ type, view, label: `${view[0].toUpperCase()}${view.slice(1)} camera` });
    } else if (type === "wait") {
      const ms = clampInt(raw.ms, 200, 20000, 1500);
      out.push({ type, ms, label: `Hold ${(ms / 1000).toFixed(1)} s` });
    }
  }
  if (!out.length) throw new Error("None of the plan steps can run on the current map.");
  return out;
}

export function validateTeleopInput(body = {}, robot = "h1") {
  const lim = LIMITS[robot] || LIMITS.h1;
  if (robot !== "h1") {
    const clampR = (v, [lo, hi]) => clampNum(v ?? 0, lo, hi, 0);
    return { vx: clampR(body.vx, lim.vx), vy: clampR(body.vy, lim.vy), yaw: clampR(body.yaw, lim.yaw), durationMs: clampInt(body.durationMs ?? 4000, 500, 20000, 4000) };
  }
  return {
    vx: clampNum(body.vx ?? 0, -1.2, 1.2, 0),
    vy: clampNum(body.vy ?? 0, -0.6, 0.6, 0),
    yaw: clampNum(body.yaw ?? 0, -1.5, 1.5, 0),
    durationMs: clampInt(body.durationMs ?? 4000, 500, 20000, 4000)
  };
}

// --- local fallback simulation (no GPU): a plausible training curve + a walking H1 ---

const wait = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Cancelled.")); }, { once: true });
});

async function simulateTraining(input, emit, signal) {
  await emit({ type: "h1_train_started", task: input.task, iterations: input.iterations, numEnvs: input.numEnvs, executor: null, simulated: true });
  const points = Math.min(60, input.iterations), step = input.iterations / points;
  let reward = -4.5, episodeLen = 40;
  for (let i = 1; i <= points; i += 1) {
    if (signal?.aborted) throw new Error("Training cancelled.");
    const iteration = Math.round(i * step);
    // saturating learning curve toward the pretrained reward, with mild noise
    const progress = 1 - Math.exp(-3 * i / points);
    reward = -4.5 + (PRETRAINED.reward + 4.5) * progress + (Math.random() - 0.5) * 0.8;
    episodeLen = Math.min(1000, 40 + 960 * progress + (Math.random() - 0.5) * 20);
    await emit({ type: "h1_train_metric", iteration, totalIterations: input.iterations, reward: Math.round(reward * 100) / 100, episodeLength: Math.round(episodeLen), simulated: true });
    await wait(320, signal);
  }
  const checkpoint = { id: `h1_run_${Date.now()}`, label: "H1 flat-terrain (this run)", reward: Math.round(reward * 100) / 100, iterations: input.iterations, source: "local simulated run" };
  await emit({ type: "h1_train_complete", checkpoint, reward: checkpoint.reward, iterations: input.iterations, simulated: true });
  return { checkpoint, reward: checkpoint.reward, iterations: input.iterations, simulated: true };
}

async function simulateDeploy(input, emit, signal) {
  const cp = input.checkpoint === "pretrained" ? PRETRAINED : { ...PRETRAINED, id: "h1_latest", label: "H1 flat-terrain (latest run)" };
  await emit({ type: "h1_deploy_started", checkpoint: cp, terrain: input.terrain, simulated: true });
  for (const [phase, label] of [["load", "Loading policy weights"], ["stand", "Standing up · balancing"], ["ready", "Locomotion policy holding balance"]]) {
    if (signal?.aborted) throw new Error("Deploy cancelled.");
    await emit({ type: "h1_deploy_phase", phase, label, simulated: true });
    await wait(900, signal);
  }
  await emit({ type: "h1_deploy_ready", checkpoint: cp, terrain: input.terrain, simulated: true });
  return { checkpoint: cp, terrain: input.terrain, ready: true, simulated: true };
}

async function simulateTeleop(input, emit, signal) {
  await emit({ type: "h1_teleop_started", command: input, simulated: true });
  const steps = Math.max(4, Math.round(input.durationMs / 500));
  let x = 0, y = 0, heading = 0;
  for (let i = 1; i <= steps; i += 1) {
    if (signal?.aborted) throw new Error("Teleop cancelled.");
    heading += input.yaw * 0.5; x += input.vx * 0.5 * Math.cos(heading) - input.vy * 0.5 * Math.sin(heading); y += input.vx * 0.5 * Math.sin(heading) + input.vy * 0.5 * Math.cos(heading);
    await emit({ type: "h1_teleop_step", i, steps, pose: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, heading: Math.round(heading * 100) / 100 }, gait: input.vx > 0.1 ? "walk" : input.yaw ? "turn" : "stand", simulated: true });
    await wait(500, signal);
  }
  await emit({ type: "h1_teleop_complete", pose: { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100, heading: Math.round(heading * 100) / 100 }, simulated: true });
  return { pose: { x, y, heading }, simulated: true };
}

// Without Isaac there is no warehouse map to plan on: say so instead of pretending.
async function simulateNavigate(input, emit) {
  await emit({ type: "h1_log", message: `Navigation to ${input.name} needs the Isaac Sim executor (it plans on the PhysX map of the warehouse).`, simulated: true });
  await emit({ type: "h1_navigate_complete", reached: false, place: input.name, reason: "Isaac Sim not connected", simulated: true });
  return { reached: false, place: input.name, reason: "Isaac Sim not connected", simulated: true };
}

async function simulateCamera(input, emit) {
  await emit({ type: "h1_camera_complete", view: input.view, simulated: true });
  return { view: input.view, simulated: true };
}

async function simulatePlan(input, emit, signal) {
  let completed = 0;
  for (const [index, step] of input.steps.entries()) {
    await emit({ type: "h1_plan_step", index: index + 1, total: input.steps.length, label: step.label, status: "running", simulated: true });
    const ok = step.type === "move" || step.type === "wait" || step.type === "view";
    if (step.type === "move") await simulateTeleop(step, async (event) => { if (event.type !== "h1_teleop_complete" && event.type !== "h1_teleop_started") await emit(event); }, signal);
    else if (step.type === "wait") await wait(Math.min(step.ms, 5000), signal);
    await emit({ type: "h1_plan_step", index: index + 1, total: input.steps.length, label: step.label, status: ok ? "done" : "failed", detail: ok ? "local simulation" : "needs Isaac Sim (warehouse map)", simulated: true });
    if (!ok) break;
    completed += 1;
  }
  await emit({ type: "h1_plan_complete", completed, total: input.steps.length, simulated: true });
  return { completed, total: input.steps.length, simulated: true };
}

// --- dispatch: prefer the Isaac executor, else the local fallback ---

export function createHumanoidLab(isaac) {
  async function withIsaac(kind, payload, input, emit, controls, job, fallback) {
    if (!isaac.connected()) return fallback(input, emit, controls.signal);
    try {
      return await isaac.runHumanoidJob(kind, payload, input, emit, controls, job);
    } catch (error) {
      await emit({ type: "fallback_activated", reason: `h1_${kind}_isaac_error`, message: `Isaac Sim could not run the H1 ${kind} (${error.message}); continuing with the local simulation.` });
      return fallback(input, emit, controls.signal);
    }
  }
  return {
    descriptor() {
      const bridge = isaac.descriptor();
      const current = bridge.executor?.robot && ROBOTS[bridge.executor.robot] ? bridge.executor.robot : "h1";
      return { robot: ROBOTS[current], robots: ROBOTS, environments: ENVIRONMENTS, views: VIEWS, pretrained: PRETRAINED, connected: isaac.connected(), executor: bridge.executor, map: bridge.map, frameAt: bridge.frameAt };
    },
    runTrain: (input, emit, controls, job) => withIsaac("train", { task: input.task, iterations: input.iterations, numEnvs: input.numEnvs, seed: input.seed }, input, emit, controls, job, simulateTraining),
    runDeploy: (input, emit, controls, job) => withIsaac("deploy", input, input, emit, controls, job, simulateDeploy),
    runTeleop: (input, emit, controls, job) => withIsaac("teleop", input, input, emit, controls, job, simulateTeleop),
    runNavigate: (input, emit, controls, job) => withIsaac("navigate", { place: input.place }, input, emit, controls, job, simulateNavigate),
    runCamera: (input, emit, controls, job) => withIsaac("camera", input, input, emit, controls, job, simulateCamera),
    runPlan: (input, emit, controls, job) => withIsaac("plan", { steps: input.steps }, input, emit, controls, job, simulatePlan)
  };
}

export { H1, PRETRAINED };
