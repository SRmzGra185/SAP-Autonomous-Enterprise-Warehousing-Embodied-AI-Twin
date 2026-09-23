// Digital Twin Robotics · Unitree H1 humanoid module.
// Modeled on NVIDIA "Digital Twin Robotics" (Isaac Lab locomotion policy + Isaac Sim SIL).
// Three job kinds, all executed by the same Isaac bridge executor that runs in Brev:
//   - train:   launch an Isaac Lab locomotion run, stream reward/iteration curves
//   - deploy:  load a policy checkpoint (trained or pretrained) and stand the H1 up
//   - teleop:  drive the H1 with velocity commands (from the UI or Joule)
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
    terrain: ["flat", "rough"].includes(body.terrain) ? body.terrain : "flat"
  };
}

export function validateTeleopInput(body = {}) {
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
      return { robot: H1, pretrained: PRETRAINED, connected: isaac.connected(), executor: isaac.descriptor().executor };
    },
    runTrain: (input, emit, controls, job) => withIsaac("train", { task: input.task, iterations: input.iterations, numEnvs: input.numEnvs, seed: input.seed }, input, emit, controls, job, simulateTraining),
    runDeploy: (input, emit, controls, job) => withIsaac("deploy", input, input, emit, controls, job, simulateDeploy),
    runTeleop: (input, emit, controls, job) => withIsaac("teleop", input, input, emit, controls, job, simulateTeleop)
  };
}

export { H1, PRETRAINED };
