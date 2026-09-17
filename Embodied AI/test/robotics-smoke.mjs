import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EXCEPTION_FIELDS, PHYSICAL_CHECKS, RESOLUTION_CHECKS } from "../src/exception-resolution.mjs";

const port = 4299, origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [...process.execArgv, "server.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", AUTH_MODE: "desktop", NODE_ENV: "development", DESKTOP_ROLE: "admin", APP_ORIGINS: origin, RATE_LIMIT_MAX: "3000", OPENAI_ENABLED: "false" },
  stdio: ["ignore", "pipe", "pipe"]
});
let diagnostics = "";
server.stdout.on("data", chunk => diagnostics += chunk);
server.stderr.on("data", chunk => diagnostics += chunk);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function request(path, body, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(origin + path, { method, headers: { Origin: origin, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
async function until(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  do { const value = await fn(); if (value) return value; await delay(60); } while (Date.now() < end);
  throw new Error("Timed out. " + diagnostics);
}
async function completed(id) {
  return until(async () => { const r = await request("/api/jobs/" + id); assert.equal(r.status, 200); if (r.body.status === "failed") throw new Error(r.body.error); return r.body.status === "complete" && r.body; });
}
const review = {
  exceptionFingerprint: Object.fromEntries(EXCEPTION_FIELDS.map(key => [key, "Synthetic test context: " + key])),
  physicalResolvability: Object.fromEntries(PHYSICAL_CHECKS.map(key => [key, "yes"]))
};
try {
  await until(async () => { try { return (await request("/api/health")).body.ok; } catch { return false; } }, 6000);
  const scenarios = (await request("/api/robot-scenarios")).body;
  assert.deepEqual(scenarios.map(s => s.domain), ["Asset Management", "Manufacturing", "Orchestration", "Logistics"]);
  assert.deepEqual((await request("/api/adapters")).body.map(a => a.id), ["bdc-connect", "joule"]);
  assert.equal((await request("/api/hana-capabilities")).status, 410);
  assert.equal((await request("/api/lenses/query", { lens: "vector", query: "old" })).status, 410);
  assert.equal((await request("/api/operations-scope")).body.productionCommands, false);
  const foreign = await fetch(origin + "/api/model", { headers: { Origin: "https://untrusted.example" } });
  assert.equal(foreign.status, 403);
  assert.equal((await request("/api/joule/descriptor")).body.connected, false);
  const chatInput = { goal: "Prepare an inspection-to-fulfillment demo", scenarioId: "autonomous-orchestration" };
  const chatJob = await request("/api/joule/chat", chatInput); assert.equal(chatJob.status, 202);
  const chat = (await completed(chatJob.body.jobId)).result;
  assert.equal(chat.modelCalls, 0); assert.equal(chat.plan.executed, false);
  const savedRecipe = await request("/api/recipes/" + chat.recipe.id); assert.equal(savedRecipe.status, 200);
  assert.equal(savedRecipe.body.recipe.mode, "assisted"); assert.ok(!savedRecipe.body.bat.includes(chatInput.goal));
  const reusedJob = await request("/api/joule/chat", chatInput);
  assert.equal((await completed(reusedJob.body.jobId)).result.reused, true);
  assert.equal((await request("/api/joule/chat", { ...chatInput, mode: "live" })).status, 400);
  assert.equal((await request("/api/joule/chat", { ...chatInput, goal: "password=private" })).status, 400);
  assert.equal((await request("/api/recipes/recipe_missing")).status, 404);

  for (const scenario of scenarios) {
    const composed = await request(`/api/robot-scenarios/${scenario.id}/compose`, {});
    assert.equal(composed.status, 202);
    const model = composed.body.model, ids = new Set(model.nodes.map(n => n.id));
    assert.equal(model.nodes.filter(n => n.zone === "platform").length, 9);
    for (const id of ["connect", "joule", "approval", "evidence", scenario.workspaceId]) assert.ok(ids.has(id));
    for (const id of ["datasphere", "bw", "sac", "cockpit", "source-s4"]) assert.equal(ids.has(id), false);
    assert.ok(model.executionRoute.every(id => ids.has(id)));
    const simulation = await request("/api/simulations", { mode: "fast", entities: 8, seed: 42 });
    assert.equal(simulation.status, 202);
    const result = (await completed(simulation.body.jobId)).result;
    assert.equal(result.completed, 8);
    assert.ok(Object.hasOwn(result.utilization, scenario.grafcet.steps[0].nodeId));
  }

  const profiles = await request("/api/sap-connections");
  assert.equal(profiles.status, 200);
  assert.equal((await request("/api/sap-connections", { role: "ERP", kind: "abap", environment: "" }, "PUT")).status, 400);
  const profile = { role: "BDC_CONNECT", kind: "cloud", environment: "sandbox", tenantUrl: "", destination: "DEMO_DESTINATION", readOnly: true, liveEnabled: false };
  assert.equal((await request("/api/sap-connections", profile, "PUT")).body.connected, false);
  const metadataJob = await request("/api/sap-connections/check", profile);
  assert.equal((await completed(metadataJob.body.jobId)).result.connected, false);

  const scenario = scenarios[0];
  await request(`/api/robot-scenarios/${scenario.id}/compose`, {});
  const template = (await request("/api/experiment-template")).body;
  assert.equal(template.unit, "seconds");
  const experiment = await request("/api/simulations", { mode: "monte-carlo", entities: 8, runs: 10, seed: 42, experiment: template });
  assert.equal(experiment.status, 202);
  assert.equal((await completed(experiment.body.jobId)).result.runs, 10);
  assert.equal((await request("/api/simulations", { mode: "fast", experiment: { ...template, unit: "minutes" } })).status, 400);
  const plan = await request("/api/agent/tasks", { goal: "Review an asset inspection", maxTokens: 512, maxSteps: 2, maxDelegations: 2 });
  assert.equal(plan.status, 202);
  const planning = (await completed(plan.body.jobId)).result;
  assert.equal(planning.usage.modelCalls, 0);
  assert.equal(planning.plan.length, 2);

  const start = await request("/api/robot-routines", { scenarioId: scenario.id, mode: "assisted", cycles: 1, speed: 4 });
  assert.equal(start.status, 202);
  const id = start.body.jobId;
  const unknownProof = { checks: Object.fromEntries(RESOLUTION_CHECKS.map(key => [key, { state: "unknown", evidenceReference: "", reason: "" }])) };
  assert.equal((await request(`/api/jobs/${id}/resolution`, unknownProof)).status, 409);
  let count = 0;
  const job = await until(async () => {
    const { body } = await request("/api/jobs/" + id);
    if (body.status === "failed") throw new Error(body.error);
    if (body.status === "complete") return body;
    if (!body.pendingApproval) return false;
    const approvalId = body.pendingApproval.approvalId;
    assert.ok(body.pendingApproval.transitionId);
    if (!count) {
      assert.equal(body.events.filter(e => e.type === "robot_command").length, 0);
      assert.equal((await request(`/api/jobs/${id}/approval`, { approvalId, decision: "approve" })).status, 400);
      const blocked = { ...review, physicalResolvability: { ...review.physicalResolvability, locationKnown: "unknown" } };
      assert.equal((await request(`/api/jobs/${id}/approval`, { approvalId, decision: "approve", ...blocked })).status, 409);
    }
    const approved = await request(`/api/jobs/${id}/approval`, { approvalId, decision: "approve", ...review });
    assert.equal(approved.status, 200);
    count++;
    assert.equal((await request(`/api/jobs/${id}/approval`, { approvalId, decision: "approve", ...review })).status, 409);
    return false;
  });
  assert.equal(count, scenario.grafcet.steps.length);
  assert.equal(job.result.resolutionStatus, "awaiting_evidence");
  assert.ok(job.events.filter(e => e.type === "robot_command").every(e => e.dispatched === false));
  assert.equal((await request(`/api/jobs/${id}/resolution`, unknownProof)).body.status, "awaiting_evidence");
  const proof = { checks: Object.fromEntries(RESOLUTION_CHECKS.map((key, i) => [key, { state: i < 3 ? "not_applicable" : "yes", evidenceReference: i < 3 ? "" : "synthetic-fixture:" + key, reason: i < 3 ? "Inspection only; no material was moved." : "" }])) };
  proof.checks.originatingExceptionCleared.state = "no";
  assert.equal((await request(`/api/jobs/${id}/resolution`, proof)).body.status, "blocked");
  proof.checks.originatingExceptionCleared.state = "yes";
  const resolved = await request(`/api/jobs/${id}/resolution`, proof);
  assert.equal(resolved.body.status, "resolved_simulated");
  assert.equal(resolved.body.productionCommands, false);
  assert.match(resolved.body.recordHash, /^[a-f0-9]{64}$/);
  assert.equal((await request(`/api/jobs/${id}/resolution`)).body.revision, 3);
  const denied = await request("/api/robot-routines", { scenarioId: scenario.id, mode: "live" });
  assert.equal(denied.status, 403);
  console.log("PASS API: four scoped models, 2 connection roles, calibrated Monte Carlo, zero model calls, CORS denial, " + count + " fingerprint-bound approvals, stale approval rejection, evidence-gated simulated resolution, live denial.");
} finally { server.kill(); }
