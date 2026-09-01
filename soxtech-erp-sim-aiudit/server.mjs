import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { adapters } from "./src/adapters.mjs";
import { defaultModel, hanaCapabilities } from "./src/domain.mjs";
import { runSimulation } from "./src/engine.mjs";
import { auditEntry, policy, safeConnectionRequest } from "./src/safety.mjs";
import { config, assertSecureConfiguration, publicConfig } from "./config.mjs";
import { authenticate } from "./auth.mjs";
import { HttpError, applyHeaders, assertAllowedOrigin, createRateLimiter, rateKey, readJson } from "./http-utils.mjs";
import { applyModelWrite, assertTenantResource, canEdit, scopeModel, seedTenantModel } from "./row-policy.mjs";
import { validateAgentTask, validateConnectionInput, validateModelInput, validateRobotRoutineInput, validateSimulationInput } from "./validation.mjs";
import { runAgentTask, runtimeDescriptor } from "./orchestrator.mjs";
import { composeRobotTwin, robotScenarios, robotScenarioById, robotScenarioIds, runRobotRoutine } from "./src/robotics.mjs";

assertSecureConfiguration();
const __dirname = path.dirname(fileURLToPath(import.meta.url)), publicDir = path.join(__dirname, "public");
const jobs = new Map(), tenantModels = new Map(), auditTrail = [auditEntry("server_started", { result: "desktop-safe", productionWrites: false })];
const limit = createRateLimiter(config.rateLimit), adapterIds = adapters.map((adapter) => adapter.id), lensIds = new Set(hanaCapabilities.map((lens) => lens.id));
const runtime = runtimeDescriptor(config);
const challengeScenario = robotScenarioById("warehouse-fulfillment");
const challengeModel = composeRobotTwin(defaultModel, defaultModel, challengeScenario);

function json(res, status, payload, origin = null, rate = null) {
  applyHeaders(res, origin);
  if (rate) { res.setHeader("RateLimit-Limit", rate.limit); res.setHeader("RateLimit-Remaining", rate.remaining); res.setHeader("RateLimit-Reset", Math.ceil(rate.resetAt / 1000)); }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, origin) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
  const extension = path.extname(filePath), executable = [".html", ".js", ".mjs", ".css", ".webmanifest"].includes(extension);
  applyHeaders(res, origin);
  res.writeHead(200, { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": executable ? "no-store" : "private, max-age=300" });
  fs.createReadStream(filePath).pipe(res);
}

function tenantModel(principal) {
  if (!tenantModels.has(principal.tenantId)) tenantModels.set(principal.tenantId, seedTenantModel(challengeModel, principal));
  return tenantModels.get(principal.tenantId);
}

function record(action, details, principal) { const entry = auditEntry(action, details, principal); auditTrail.push(entry); if (auditTrail.length > 5000) auditTrail.splice(0, 1000); return entry; }

function appendJobEvent(job, event) {
  const payload = { id: job.id, at: new Date().toISOString(), ...event };
  job.events.push(payload);
  if (job.events.length > 1000) job.events.shift();
  for (const client of job.clients) client.write(`event: ${payload.type || "message"}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function launchJob(kind, principal, task) {
  const job = { id: `job_${crypto.randomUUID()}`, tenantId: principal.tenantId, ownerId: principal.userId, kind, status: "queued", events: [], clients: new Set(), result: null, error: null };
  jobs.set(job.id, job);
  setImmediate(async () => {
    job.status = "running"; appendJobEvent(job, { type: "job_started", kind });
    try {
      job.result = await task((event) => appendJobEvent(job, event)); job.status = "complete";
      record(`${kind}_complete`, { jobId: job.id, result: "complete" }, principal); appendJobEvent(job, { type: "job_complete", result: job.result });
    } catch (error) {
      job.status = "failed"; job.error = error.message;
      record(`${kind}_failed`, { jobId: job.id, result: "failed", error: error.message }, principal); appendJobEvent(job, { type: "job_failed", error: error.message });
    }
  });
  return job;
}

function jobEnvelope(job) { return { id: job.id, kind: job.kind, status: job.status, result: job.result, error: job.error, events: job.events.slice(-100) }; }

function handleEvents(req, res, job, origin) {
  applyHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("retry: 1000\n\n");
  for (const event of job.events) res.write(`event: ${event.type || "message"}\ndata: ${JSON.stringify(event)}\n\n`);
  job.clients.add(res); req.on("close", () => job.clients.delete(res));
}

const lensData = {
  vector: { engine: "Vector similarity", rows: [["PRESS-03", "0.914", "bearing vibration"], ["LINE-07", "0.781", "thermal drift"], ["ROBOT-12", "0.643", "axis torque"]] },
  spatial: { engine: "Spatial proximity", rows: [["PRESS-03", "12.4 m", "MX-01"], ["LINE-07", "31.8 m", "MX-01"], ["ROBOT-12", "44.1 m", "MX-02"]] },
  "property-graph": { engine: "Property graph traversal", rows: [["ASSET", "WORK_ORDER", "hasOrder"], ["WORK_ORDER", "LOT", "affects"], ["LOT", "CONTROL", "requires"]] },
  "knowledge-graph": { engine: "Knowledge graph semantics", rows: [["Press", "isA", "ProductionAsset"], ["OEE", "measures", "Availability"], ["Control", "governs", "DataProduct"]] },
  json: { engine: "JSON document query", rows: [["LINE-07", "temperature", "72.4"], ["PRESS-03", "vibration", "4.8"], ["ROBOT-12", "torque", "18.1"]] }
};

async function runLensQuery(input, emit) {
  if (!lensIds.has(input.lens)) throw new HttpError(400, "Unknown data lens.", "validation_error");
  if (typeof input.query !== "string" || input.query.length > 500 || /[<>\u0000-\u001f]/.test(input.query)) throw new HttpError(400, "Lens query is invalid.", "validation_error");
  await emit({ type: "lens_query_started", lens: input.lens, readOnly: true });
  await new Promise((resolve) => setTimeout(resolve, 80));
  const result = lensData[input.lens];
  await emit({ type: "lens_query_complete", lens: input.lens, rows: result.rows.length });
  return { ...result, lens: input.lens, query: input.query, readOnly: true, executedAt: new Date().toISOString() };
}

async function routeRequest(req, res) {
  const origin = assertAllowedOrigin(req, config), url = new URL(req.url, `http://${req.headers.host || "localhost"}`), pathname = url.pathname;
  if (req.method === "OPTIONS") { applyHeaders(res, origin); res.writeHead(204); return res.end(); }
  if (req.method === "GET" && pathname === "/api/health") return json(res, 200, { ok: true, app: "SAP Embodied AI Simulation Lab", version: "0.5.0-embodied-ai", authMode: config.auth.mode }, origin);
  if (req.method === "GET" && pathname === "/api/config") return json(res, 200, publicConfig(), origin);

  if (pathname.startsWith("/api/")) {
    const principal = await authenticate(req, config), agentRoute = pathname === "/api/agent/tasks", rate = limit(rateKey(req, principal), agentRoute ? config.rateLimit.agentMax : config.rateLimit.max);
    if (req.method === "GET" && pathname === "/api/session") return json(res, 200, { ...principal, permissions: { editModel: canEdit(principal), productionWrite: false } }, origin, rate);
    if (req.method === "GET" && pathname === "/api/model") return json(res, 200, scopeModel(tenantModel(principal), principal), origin, rate);
    if (req.method === "GET" && pathname === "/api/model/example") return json(res, 200, scopeModel(seedTenantModel(challengeModel, principal), principal), origin, rate);
    if (req.method === "GET" && pathname === "/api/adapters") return json(res, 200, adapters, origin, rate);
    if (req.method === "GET" && pathname === "/api/hana-capabilities") return json(res, 200, hanaCapabilities, origin, rate);
    if (req.method === "GET" && pathname === "/api/runtime") return json(res, 200, runtime, origin, rate);
    if (req.method === "GET" && pathname === "/api/robot-scenarios") return json(res, 200, robotScenarios, origin, rate);
    const robotComposeMatch = pathname.match(/^\/api\/robot-scenarios\/([a-z0-9-]+)\/compose$/);
    if (req.method === "POST" && robotComposeMatch) {
      const scenario = robotScenarioById(robotComposeMatch[1]);
      if (!scenario) throw new HttpError(404, "Robot scenario not found.", "not_found");
      const current = tenantModel(principal), composed = composeRobotTwin(scopeModel(current, principal), defaultModel, scenario);
      const input = validateModelInput(composed), next = applyModelWrite(current, input, principal);
      tenantModels.set(principal.tenantId, next);
      const platformObjects = next.nodes.filter((node) => node.zone === "platform").length, robotObjects = next.nodes.filter((node) => node.layer === "robotics").length;
      record("robot_twin_composed", { scenarioId: scenario.id, platformObjects, robotObjects, connections: next.edges.length, result: "tenant-memory" }, principal);
      return json(res, 202, { accepted: true, model: scopeModel(next, principal), composition: { platformObjects, robotObjects, connections: next.edges.length, scenarioId: scenario.id } }, origin, rate);
    }
    const robotScenarioMatch = pathname.match(/^\/api\/robot-scenarios\/([a-z0-9-]+)$/);
    if (req.method === "GET" && robotScenarioMatch) {
      const scenario = robotScenarioById(robotScenarioMatch[1]);
      if (!scenario) throw new HttpError(404, "Robot scenario not found.", "not_found");
      return json(res, 200, scenario, origin, rate);
    }
    if (req.method === "GET" && pathname === "/api/policy") return json(res, 200, { ...policy, rowLevelSecurity: true, corsOrigins: config.appOrigins, authentication: config.auth.mode }, origin, rate);
    if (req.method === "GET" && pathname === "/api/audit") return json(res, 200, auditTrail.filter((entry) => entry.tenantId === principal.tenantId).slice(-100), origin, rate);

    if (req.method === "POST" && pathname === "/api/model") {
      const input = validateModelInput(await readJson(req, config)), next = applyModelWrite(tenantModel(principal), input, principal);
      tenantModels.set(principal.tenantId, next); record("model_saved", { version: next.version, rows: next.nodes.length, result: "tenant-memory" }, principal);
      return json(res, 202, { accepted: true, model: scopeModel(next, principal) }, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/simulations") {
      const input = validateSimulationInput(await readJson(req, config)), model = scopeModel(tenantModel(principal), principal), job = launchJob("simulation", principal, (emit) => runSimulation(model, input, emit));
      record("simulation_queued", { jobId: job.id, mode: input.mode, result: "queued" }, principal);
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/connections/test") {
      const input = validateConnectionInput(await readJson(req, config), adapterIds), job = launchJob("connection_test", principal, async (emit) => { const decision = safeConnectionRequest(input); await emit({ type: "connection_decision", adapter: input.adapter, decision }); return decision; });
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/lenses/query") {
      const input = await readJson(req, config), job = launchJob("lens_query", principal, (emit) => runLensQuery(input, emit));
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/agent/tasks") {
      const task = validateAgentTask(await readJson(req, config), runtime.limits), job = launchJob("agent_task", principal, (emit) => runAgentTask(config, task, principal, emit));
      record("agent_task_queued", { jobId: job.id, goal: task.goal.slice(0, 120), result: "queued" }, principal);
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/robot-routines") {
      const input = validateRobotRoutineInput(await readJson(req, config), robotScenarioIds), scenario = robotScenarioById(input.scenarioId);
      if (input.mode === "live") {
        record("robot_live_route_denied", { scenarioId: input.scenarioId, mode: input.mode, result: "denied" }, principal);
        throw new HttpError(403, "Live robot commands are disabled. Use simulation, shadow, or assisted mode.", "robot_live_denied");
      }
      const job = launchJob("robot_routine", principal, (emit) => runRobotRoutine(scenario, input, emit));
      record("robot_routine_queued", { jobId: job.id, scenarioId: input.scenarioId, mode: input.mode, cycles: input.cycles, result: "queued" }, principal);
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
    const eventMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
    if (req.method === "GET" && eventMatch) { const job = jobs.get(eventMatch[1]); assertTenantResource(job, principal); return handleEvents(req, res, job, origin); }
    const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === "GET" && jobMatch) { const job = jobs.get(jobMatch[1]); assertTenantResource(job, principal); return json(res, 200, jobEnvelope(job), origin, rate); }
    throw new HttpError(404, "API route not found.", "not_found");
  }

  if (req.method !== "GET" && req.method !== "HEAD") throw new HttpError(405, "Method not allowed.", "method_not_allowed");
  const requested = pathname === "/" ? "/index.html" : pathname, safePath = path.resolve(publicDir, `.${requested}`), relative = path.relative(publicDir, safePath);
  if (relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) throw new HttpError(404, "Not found.", "not_found");
  return sendFile(res, safePath, origin);
}

const server = http.createServer((req, res) => routeRequest(req, res).catch((error) => {
  const status = Number(error.status) || 500, origin = req.headers.origin && config.appOrigins.includes(req.headers.origin) ? req.headers.origin : null;
  if (status >= 500) console.error(error);
  json(res, status, { error: status >= 500 ? "Internal server error." : error.message, code: error.code || "server_error" }, origin);
}));

server.listen(config.port, config.host, () => console.log(`SAP Embodied AI Simulation Lab listening on http://${config.host}:${config.port}`));
export { server };
