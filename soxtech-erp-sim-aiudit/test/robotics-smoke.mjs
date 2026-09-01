import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const port = 4299;
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port), APP_ORIGINS: origin, OPENAI_ENABLED: "false" },
  stdio: ["ignore", "pipe", "pipe"]
});

let diagnostics = "";
server.stdout.on("data", (chunk) => { diagnostics += chunk; });
server.stderr.on("data", (chunk) => { diagnostics += chunk; });

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options,
    headers: { Origin: origin, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const body = await response.json();
  return { response, body };
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const { response } = await request("/api/health");
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error(`Server did not become ready.\n${diagnostics}`);
}

async function waitForJob(jobId) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const { response, body } = await request(`/api/jobs/${jobId}`);
    assert.equal(response.status, 200);
    if (body.status === "complete" || body.status === "failed") return body;
    await delay(50);
  }
  throw new Error(`Job ${jobId} did not finish.`);
}

try {
  await waitForServer();

  const scenariosResult = await request("/api/robot-scenarios");
  assert.equal(scenariosResult.response.status, 200);
  assert.equal(scenariosResult.body.length, 4);
  assert.deepEqual(scenariosResult.body.map((item) => item.domain), ["Retail", "Warehousing", "Assembly", "Inspection"]);

  const initialModel = await request("/api/model");
  assert.equal(initialModel.response.status, 200);
  assert.equal(initialModel.body.activeScenarioId, "warehouse-fulfillment");
  assert.ok(initialModel.body.nodes.some((item) => item.id === "wh-amr" && item.layer === "robotics"));
  assert.ok(initialModel.body.nodes.some((item) => item.name === "SAP BDC Cockpit"));
  assert.ok(initialModel.body.nodes.some((item) => item.name === "Joule Agents"));

  const phygitalSimulation = await request("/api/simulations", {
    method: "POST",
    body: JSON.stringify({ mode: "fast", entities: 8, seed: 42 })
  });
  assert.equal(phygitalSimulation.response.status, 202);
  const phygitalJob = await waitForJob(phygitalSimulation.body.jobId);
  assert.equal(phygitalJob.status, "complete");
  assert.ok(Object.hasOwn(phygitalJob.result.utilization, "joule"));
  assert.ok(Object.hasOwn(phygitalJob.result.utilization, "wh-amr"));
  assert.ok(Object.hasOwn(phygitalJob.result.utilization, "wh-pick"));

  const scenario = scenariosResult.body[2];
  assert.ok(scenario.model.nodes.every((item) => item.visual && item.deviceClass && item.protocols.length));
  assert.ok(scenario.grafcet.steps.length >= 7);
  assert.equal(scenario.grafcet.transitions.length, scenario.grafcet.steps.length);

  const modelSave = await request("/api/model", { method: "POST", body: JSON.stringify(scenario.model) });
  assert.equal(modelSave.response.status, 202);
  assert.equal(modelSave.body.model.nodes.length, scenario.model.nodes.length);

  const composition = await request(`/api/robot-scenarios/${scenario.id}/compose`, { method: "POST", body: "{}" });
  assert.equal(composition.response.status, 202);
  assert.equal(composition.body.model.layout, "unified-campus");
  assert.ok(composition.body.model.nodes.some((item) => item.id === "cockpit" && item.zone === "platform"));
  assert.ok(composition.body.model.nodes.some((item) => item.id === "datasphere" && item.zone === "platform"));
  assert.ok(composition.body.model.nodes.some((item) => item.id === "asm-cobot" && item.layer === "robotics"));
  assert.ok(composition.body.model.edges.some(([from, to]) => from === "cockpit" && to === "asm-order"));
  assert.ok(composition.body.model.edges.some(([from, to]) => from === "asm-rework" && to === "aIudit"));
  assert.equal(composition.body.composition.platformObjects, 14);
  assert.equal(composition.body.composition.robotObjects, scenario.model.nodes.length);

  const routineStart = await request("/api/robot-routines", {
    method: "POST",
    body: JSON.stringify({ scenarioId: scenario.id, mode: "simulation", cycles: 1, speed: 4 })
  });
  assert.equal(routineStart.response.status, 202);

  const job = await waitForJob(routineStart.body.jobId);
  assert.equal(job.status, "complete");
  assert.equal(job.result.productionCommands, false);
  assert.equal(job.result.stepsExecuted, scenario.grafcet.steps.length);
  const eventTypes = new Set(job.events.map((event) => event.type));
  for (const type of ["robot_routine_started", "grafcet_step_active", "sensor_sample", "robot_command", "grafcet_transition_fired", "robot_routine_complete"]) assert.ok(eventTypes.has(type), `Missing ${type}`);
  assert.ok(job.events.filter((event) => event.type === "robot_command").every((event) => event.dispatched === false));

  const denied = await request("/api/robot-routines", {
    method: "POST",
    body: JSON.stringify({ scenarioId: scenario.id, mode: "live", cycles: 1, speed: 1 })
  });
  assert.equal(denied.response.status, 403);
  assert.equal(denied.body.code, "robot_live_denied");

  console.log(`PASS unified twin: ${composition.body.composition.platformObjects} platform + ${composition.body.composition.robotObjects} robot objects, ${job.result.stepsExecuted} GRAFCET steps, live route denied`);
} finally {
  server.kill();
}
