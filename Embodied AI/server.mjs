import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { adapters } from "./src/adapters.mjs";
import { defaultModel, operationsScope, MODEL_VERSION } from "./src/domain.mjs";
import { runSimulation } from "./src/engine.mjs";
import { auditEntry, policy, safeConnectionRequest } from "./src/safety.mjs";
import { config, assertSecureConfiguration, publicConfig } from "./config.mjs";
import { authenticate } from "./auth.mjs";
import { HttpError, applyHeaders, assertAllowedOrigin, createRateLimiter, rateKey, readJson } from "./http-utils.mjs";
import { applyModelWrite, assertTenantResource, canEdit, scopeModel, seedTenantModel } from "./row-policy.mjs";
import { validateAgentTask, validateConnectionInput, validateModelInput, validateRobotRoutineInput, validateSimulationInput } from "./validation.mjs";
import { runOperationsPlan, operationsRuntimeDescriptor } from "./src/operations-runtime.mjs";
import { sapConnectionDescriptor, validateSapProfile, dryRunSapConnection } from "./src/sap-connections.mjs";
import { composeRobotTwin, robotScenarios, robotScenarioById, robotScenarioIds, runRobotRoutine, computeLogisticsKpis } from "./src/robotics.mjs";
import { createApprovalGate } from "./src/approvals.mjs";
import { describeExceptionControls, validateResolutionProof } from "./src/exception-resolution.mjs";
import { experimentTemplate, validateExperimentProfile } from "./src/industrial-timing.mjs";
import { descriptor as recipeDescriptor, validateRequest as validateChatRequest, buildPlan, buildRecipe, exportBat, validateRecipe } from "./src/routine-library.mjs";
import { recordRun, listing, rankRecipes, applyVariant, jouleRecipeInsights, hash as recipeHash } from "./src/recipe-library.mjs";
import { validateOptimizationInput } from "./validation.mjs";
import { runAgentTask, runtimeDescriptor } from "./orchestrator.mjs";
import { runLayoutOptimization } from "./src/optimizer.mjs";
import { jouleAssist, jouleDescriptor } from "./src/joule-assistant.mjs";
import { buildLastRunAnalytics, buildLastRoutineAnalytics, buildJouleForJob } from "./src/run-analytics.mjs";
import { createIsaacBridge } from "./src/isaac-bridge.mjs";
import { createHumanoidLab, validateTrainInput, validateDeployInput, validateTeleopInput, validateNavigateInput, validateCameraInput, validatePlan } from "./src/humanoid-lab.mjs";
import { createOrderBook, publicOrder, missionFor, stage as orderStage, jouleVerifyBin, decide as decideOrder, closeOrder } from "./src/sap-orders.mjs";
import { jouleMissionPlan, presetPrompts as h1JoulePrompts } from "./src/humanoid-joule.mjs";

assertSecureConfiguration();
const __dirname = path.dirname(fileURLToPath(import.meta.url)), publicDir = path.join(__dirname, "public");
const jobs = new Map(), tenantModels = new Map(), tenantProfiles = new Map(), auditTrail = [auditEntry("server_started", { result: "desktop-safe", productionWrites: false })];
const lastSimulationByTenant = new Map(); // tenantId -> job (kind "simulation", status "complete")
const lastRoutineByTenant = new Map(); // tenantId -> job (kind "robot_routine", status "complete")
const limit = createRateLimiter(config.rateLimit), adapterIds = adapters.map((adapter) => adapter.id);
const isaac = createIsaacBridge(config);
const humanoidLab = createHumanoidLab(isaac);
const orderBook = createOrderBook(), visionCache = new Map(); // simulated SAP EWM tasks; Joule vision answers by photo
const runtime = config.orchestrator.enabled ? runtimeDescriptor(config) : operationsRuntimeDescriptor(config);
const recipes = new Map();
// Per-tenant counters that show how many Joule calls the recipe cache avoided, and the cached insights.
const recipeUsage = new Map(), recipeInsightsCache = new Map();
const usageOf = (tenantId) => { if (!recipeUsage.has(tenantId)) recipeUsage.set(tenantId, { jouleCalls: 0, jouleReused: 0, localPlans: 0, insightCalls: 0, insightReused: 0 }); return recipeUsage.get(tenantId); };
function tenantLibrary(tenantId) { if (!recipes.has(tenantId)) recipes.set(tenantId, new Map()); return recipes.get(tenantId); }
// Store a recipe once per tenant (same content = same entry), counting reuses.
function saveRecipe(principal, recipe, source) {
  const library = tenantLibrary(principal.tenantId);
  const cacheKey = crypto.createHash("sha256").update(MODEL_VERSION + JSON.stringify(recipe)).digest("hex");
  let saved = [...library.values()].find((item) => item.cacheKey === cacheKey);
  const reused = Boolean(saved);
  if (saved) saved.uses = (saved.uses || 1) + 1;
  else {
    saved = { id: "recipe_" + crypto.randomUUID(), tenantId: principal.tenantId, ownerId: principal.userId, cacheKey, recipe, bat: exportBat(), source, createdAt: new Date().toISOString(), uses: 1, runs: [], answers: new Map() };
    if (library.size >= 128) library.delete(library.keys().next().value);
    library.set(saved.id, saved);
  }
  return { saved, reused };
}
// Start a robot routine; when it comes from a recipe, its outcome is recorded on that recipe.
function startRobotRoutine(principal, input, saved = null) {
  const scenario = robotScenarioById(input.scenarioId);
  if (input.mode === "live") {
    record("robot_live_route_denied", { scenarioId: input.scenarioId, mode: input.mode, result: "denied" }, principal);
    throw new HttpError(403, "Live robot commands are disabled. Use simulation, shadow, or assisted mode.", "robot_live_denied");
  }
  if ([...jobs.values()].some((job) => job.tenantId === principal.tenantId && job.kind === "robot_routine" && ["queued", "running", "awaiting_approval"].includes(job.status))) throw new HttpError(409, "Stop or finish the active routine before starting another.", "routine_busy");
  const job = launchJob("robot_routine", principal, async (emit, controls, current) => {
    try {
      const result = await runRobotRoutine(scenario, input, emit, controls);
      if (saved) recordRun(saved, { jobId: current.id, cycles: input.cycles, result, kpis: computeLogisticsKpis({ ...current, result }) });
      return result;
    } catch (error) {
      if (saved) recordRun(saved, { jobId: current.id, cycles: input.cycles, error: error.message, cancelled: current.controller.signal.aborted });
      throw error;
    }
  });
  record("robot_routine_queued", { jobId: job.id, scenarioId: input.scenarioId, mode: input.mode, cycles: input.cycles, recipeId: saved?.id || null, result: "queued" }, principal);
  return job;
}
// SAP EWM task → robot mission → Joule checks the photo → confirmation or exception back to EWM (simulated).
async function runOrderMission(order, steps, principal, emit, controls, job) {
  const update = () => emit({ type: "h1_order_update", order: publicOrder(order) });
  const inspectStep = steps.findIndex((step) => step.type === "view" && step.view === "inspect") + 1;
  Object.assign(order, { status: "in_progress", jobId: job.id, evidence: null, verdict: null, confirmation: null, timeline: order.timeline.filter((entry) => entry.stage === "created") });
  orderStage(order, "planned", steps.map((step) => step.label).join(" → "));
  await update();
  await emit({ type: "h1_joule_answer", goal: `${order.id} · ${order.type} at ${order.storageBin}`, answer: `SAP EWM task ${order.id}: walk to ${order.storageBin}, photograph the bin with the inspect camera, let Joule check the photo, then return to the start. The mission is compiled from the task, so no planning call is needed.`, steps, provider: "sap-order", model: null });
  let current = null, pose = null, failure = null, verification = null;
  const verify = async () => {
    let verdict;
    try { verdict = await jouleVerifyBin(config, { image: order.evidence.image, order, principal, cache: visionCache }); }
    catch (error) { verdict = { rackState: "unclear", confidence: 0, summary: `Joule could not check the photo (${String(error.message || error).slice(0, 120)}).`, observations: [], provider: config.orchestrator.provider, model: null, usage: null, cached: false }; }
    order.verdict = verdict;
    const outcome = decideOrder(verdict);
    orderStage(order, "verified", `${verdict.rackState} · ${Math.round(verdict.confidence * 100)}% confidence${verdict.cached ? " · same photo, answer reused" : ""}`, outcome.decision === "confirm" ? "ok" : "warn");
    if (outcome.decision === "review") { order.status = "review"; orderStage(order, "closed", "Joule is not confident enough to post to SAP: a person confirms the task or raises an exception.", "warn", "Needs a person"); }
    else closeOrder(order, { ...outcome, by: "Joule + robot evidence" });
    record(`sap_order_${order.status}`, { orderId: order.id, jobId: job.id, rackState: verdict.rackState, confidence: verdict.confidence, simulated: true, result: order.status }, principal);
    await update();
  };
  const tap = async (event) => {
    if (event.type === "h1_teleop_step") pose = event.pose;
    if (event.type === "h1_plan_step") {
      current = event;
      if (event.status === "failed") failure = event.detail || event.label;
      if (event.index === 1 && event.status === "running") { order.status = "en_route"; orderStage(order, "at_bin", `Walking to ${order.storageBin}`, "active", "Robot en route"); await update(); }
      if (event.index === 1 && event.status === "done") { order.status = "at_bin"; orderStage(order, "at_bin", `${order.storageBin} · ${event.detail}`); await update(); }
    }
    if (event.type === "h1_snapshot" && current?.index === inspectStep && current.status === "running" && !order.evidence) {
      order.evidence = { image: event.image, caption: event.caption, capturedAt: new Date().toISOString(), pose };
      order.status = "verifying";
      orderStage(order, "evidence", `Inspect camera at ${order.storageBin}${pose ? ` · x ${pose.x}, y ${pose.y}` : ""}`);
      await update();
      verification = verify(); // Joule checks the photo while the robot walks back
    }
    await emit(event);
  };
  const reopen = async (why) => { order.status = "open"; orderStage(order, "at_bin", `${why} The task stays open in SAP EWM.`, "fail", "Mission stopped"); await update(); };
  let result;
  try { result = await humanoidLab.runPlan({ steps }, tap, controls, job); }
  catch (error) { if (!order.evidence) await reopen(`${error.message}.`); throw error; }
  if (verification) await verification;
  else await reopen(result ? `The robot did not reach ${order.storageBin}${failure ? ` (${failure})` : ""}.` : "The Isaac Sim executor did not pick up the mission.");
  return { ...(result || {}), order: publicOrder(order) };
}

const challengeScenario = robotScenarioById("autonomous-inspection");
const challengeModel = composeRobotTwin(defaultModel, defaultModel, challengeScenario);

function json(res, status, payload, origin = null, rate = null) {
  applyHeaders(res, origin);
  if (rate) { res.setHeader("RateLimit-Limit", rate.limit); res.setHeader("RateLimit-Remaining", rate.remaining); res.setHeader("RateLimit-Reset", Math.ceil(rate.resetAt / 1000)); }
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, origin, req) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".mp4": "video/mp4" };
  const extension = path.extname(filePath), executable = [".html", ".js", ".mjs", ".css", ".webmanifest"].includes(extension);
  applyHeaders(res, origin);
  const headers = { "Content-Type": types[extension] || "application/octet-stream", "Cache-Control": executable ? "no-store" : "private, max-age=300" };
  if (extension === ".mp4") {
    // Byte-range support so the intro video can seek and stream in <video>.
    const { size } = fs.statSync(filePath), range = /^bytes=(\d*)-(\d*)$/.exec(req?.headers?.range || "");
    headers["Accept-Ranges"] = "bytes";
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (Number.isNaN(start) || Number.isNaN(end) || start >= size || start > end) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      if (req?.method === "HEAD") return res.end();
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
    headers["Content-Length"] = size;
  }
  res.writeHead(200, headers);
  if (req?.method === "HEAD") return res.end();
  fs.createReadStream(filePath).pipe(res);
}

function tenantModel(principal) {
  if (!tenantModels.has(principal.tenantId)) tenantModels.set(principal.tenantId, seedTenantModel(challengeModel, principal));
  return tenantModels.get(principal.tenantId);
}

function record(action, details, principal) { const entry = auditEntry(action, details, principal); auditTrail.push(entry); if (auditTrail.length > 5000) auditTrail.splice(0, 1000); return entry; }

function appendJobEvent(job, event) {
  const payload = { id: job.id, kind: job.kind, sequence: ++job.sequence, at: new Date().toISOString(), ...event };
  if (event.type === "approval_required") job.status = "awaiting_approval";
  if (event.type === "approval_resolved") job.status = "running";
  job.events.push(payload);
  if (job.events.length > 1000) job.events.shift();
  for (const client of job.clients) client.write(`id: ${payload.sequence}\nevent: ${payload.type || "message"}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function launchJob(kind, principal, task) {
  const job = { id: `job_${crypto.randomUUID()}`, tenantId: principal.tenantId, ownerId: principal.userId, kind, status: "queued", sequence: 0, events: [], clients: new Set(), result: null, error: null, controller: new AbortController() };
  job.approvals = createApprovalGate({ emit: (event) => appendJobEvent(job, event), signal: job.controller.signal });
  jobs.set(job.id, job);
  setImmediate(async () => {
    job.status = "running"; appendJobEvent(job, { type: "job_started", kind });
    try {
      job.result = await task((event) => appendJobEvent(job, event), { requestApproval: (action) => job.approvals.request(action), signal: job.controller.signal }, job); job.status = "complete";
      if (kind === "simulation") lastSimulationByTenant.set(principal.tenantId, job);
      if (kind === "robot_routine") lastRoutineByTenant.set(principal.tenantId, job);
      record(`${kind}_complete`, { jobId: job.id, result: "complete" }, principal); appendJobEvent(job, { type: "job_complete", result: job.result });
    } catch (error) {
      job.status = job.controller.signal.aborted ? "cancelled" : "failed"; job.error = error.message;
      record(`${kind}_${job.status}`, { jobId: job.id, result: job.status, error: error.message }, principal); appendJobEvent(job, { type: job.status === "cancelled" ? "job_cancelled" : "job_failed", error: error.message });
    } finally { job.approvals.dispose(); }
  });
  return job;
}

function jobEnvelope(job) { return { id: job.id, kind: job.kind, status: job.status, pendingApproval: job.approvals.pending, result: job.result, error: job.error, events: job.events.slice(-100) }; }

function lastSimulationJob(principal) {
  const job = lastSimulationByTenant.get(principal.tenantId);
  return job && job.tenantId === principal.tenantId ? job : null;
}

function lastRoutineJob(principal) {
  const job = lastRoutineByTenant.get(principal.tenantId);
  return job && job.tenantId === principal.tenantId ? job : null;
}

function handleEvents(req, res, job, origin) {
  applyHeaders(res, origin);
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("retry: 1000\n\n");
  const lastId = Number(req.headers["last-event-id"] || 0);
  for (const event of job.events.filter((event) => event.sequence > lastId)) res.write(`id: ${event.sequence}\nevent: ${event.type || "message"}\ndata: ${JSON.stringify(event)}\n\n`);
  job.clients.add(res); req.on("close", () => job.clients.delete(res));
}

async function routeRequest(req, res) {
  const origin = assertAllowedOrigin(req, config), url = new URL(req.url, `http://${req.headers.host || "localhost"}`), pathname = url.pathname;
  if (req.method === "OPTIONS") { applyHeaders(res, origin); res.writeHead(204); return res.end(); }
  if (req.method === "GET" && pathname === "/api/health") return json(res, 200, { ok: true, app: operationsScope.name, version: MODEL_VERSION, authMode: config.auth.mode }, origin);
  if (req.method === "GET" && pathname === "/api/config") return json(res, 200, publicConfig(), origin);

  // Isaac Sim executor routes: authenticated by the shared executor token, not by a user session.
  if (pathname.startsWith("/api/isaac/executor/")) {
    isaac.authorize(req);
    const rate = limit(`isaac:${req.socket.remoteAddress || "unknown"}`, config.rateLimit.max * 10);
    if (req.method === "POST" && pathname === "/api/isaac/executor/next") { const body = await readJson(req, config); const next = isaac.nextMission(body.executor || {}); return json(res, 200, { ...(next?.humanoidJob ? { humanoidJob: next.humanoidJob } : {}), needMap: Boolean(next?.needMap), serverTime: Date.now() }, origin, rate); }
    if (req.method === "POST" && pathname === "/api/isaac/executor/frame") { const body = await readJson(req, { ...config, bodyLimitBytes: Math.max(config.bodyLimitBytes, 600_000) }); return json(res, 202, isaac.setFrame(body), origin, rate); }
    if (req.method === "POST" && pathname === "/api/isaac/executor/map") { const body = await readJson(req, { ...config, bodyLimitBytes: Math.max(config.bodyLimitBytes, 1_000_000) }); return json(res, 202, isaac.setMap(body), origin, rate); }
    if (req.method === "POST" && pathname === "/api/isaac/executor/events") { const body = await readJson(req, { ...config, bodyLimitBytes: Math.max(config.bodyLimitBytes, 1_000_000) }); return json(res, 202, isaac.pushEvents(String(body.jobId || ""), Array.isArray(body.events) ? body.events : []), origin, rate); }
    throw new HttpError(404, "Isaac executor route not found.", "not_found");
  }

  if (pathname.startsWith("/api/")) {
    const principal = await authenticate(req, config), agentRoute = ["/api/agent/tasks", "/api/joule/chat", "/api/optimizations", "/api/analytics/last-run/joule", "/api/recipes/insights"].includes(pathname), rate = limit(`${rateKey(req, principal)}:${agentRoute ? "agent" : "api"}`, agentRoute ? config.rateLimit.agentMax : config.rateLimit.max);
    if (req.method === "GET" && pathname === "/api/joule/descriptor") return json(res, 200, jouleDescriptor(config, recipeDescriptor()), origin, rate);
    if (req.method === "POST" && pathname === "/api/joule/chat") {
      if (!canEdit(principal)) throw new HttpError(403, "Editor or administrator role required.", "role_denied");
      // assistant: "joule" (default, SAP AI Core when bound) or "local" (deterministic planner only, no model call)
      const { assistant = "joule", ...chatBody } = (await readJson(req, config)) || {};
      if (!["joule", "local"].includes(assistant)) throw new HttpError(400, "assistant must be joule or local.", "validation_error");
      const input = validateChatRequest(chatBody);
      const job = launchJob("local_recipe_plan", principal, async emit => {
        const plan = buildPlan(input), recipe = buildRecipe(input);
        const { saved, reused } = saveRecipe(principal, recipe, "chat");
        const usage = usageOf(principal.tenantId), goalKey = recipeHash(input.goal.trim().toLowerCase().replace(/\s+/g, " "));
        let joule = null, jouleReused = false;
        if (assistant === "local") { usage.localPlans += 1; plan.answer = plan.answer.replace("NOT_CONNECTED to Joule", "Joule not called (local planner chosen)"); }
        else if (saved.answers?.has(goalKey)) { joule = saved.answers.get(goalKey); jouleReused = true; usage.jouleReused += 1; }
        else {
          joule = await jouleAssist(config, { request: input, plan, principal, emit });
          if (joule) { usage.jouleCalls += 1; saved.answers ||= new Map(); saved.answers.set(goalKey, joule); if (saved.answers.size > 8) saved.answers.delete(saved.answers.keys().next().value); }
          else usage.localPlans += 1;
        }
        const modelCalls = joule && !jouleReused ? 1 : 0;
        await emit({ type: "recipe_prepared", recipeId: saved.id, reused, jouleReused, modelCalls, executed: false });
        record("recipe_prepared", { recipeId: saved.id, scenarioId: input.scenarioId, reused, jouleReused, assistant: joule ? "aicore" : "local", productionCommands: false }, principal);
        return { answer: joule?.answer || plan.answer, plan: { ...plan, connected: Boolean(joule), assistant: joule ? "aicore" : "local" }, joule, jouleReused, recipe: { id: saved.id, recipe: saved.recipe, bat: saved.bat }, modelCalls, reused, storage: "tenant memory; export BAT + JSON to keep it" };
      });
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
    if (req.method === "GET" && pathname === "/api/recipes") {
      const items = [...tenantLibrary(principal.tenantId).values()].map(listing);
      return json(res, 200, { recipes: items, ranking: rankRecipes(items), usage: usageOf(principal.tenantId), bat: exportBat(), insights: [...(recipeInsightsCache.get(principal.tenantId)?.values() || [])][0] || null, storage: "tenant memory; export BAT + JSON to keep recipes across restarts" }, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/recipes/import") {
      if (!canEdit(principal)) throw new HttpError(403, "Editor or administrator role required.", "role_denied");
      const body = await readJson(req, config);
      let recipe;
      try { recipe = validateRecipe(body?.recipe); } catch (error) { throw new HttpError(400, `Not a valid routine.recipe.json: ${error.message}`, "validation_error"); }
      const { saved, reused } = saveRecipe(principal, recipe, "import");
      record("recipe_imported", { recipeId: saved.id, reused }, principal);
      return json(res, 200, { recipe: listing(saved), reused }, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/recipes/insights") {
      if (!canEdit(principal)) throw new HttpError(403, "Editor or administrator role required.", "role_denied");
      const items = [...tenantLibrary(principal.tenantId).values()].map(listing);
      if (!items.length) throw new HttpError(400, "No recipes yet. Plan a routine in the Joule chat first.", "validation_error");
      if (!recipeInsightsCache.has(principal.tenantId)) recipeInsightsCache.set(principal.tenantId, new Map());
      const usage = usageOf(principal.tenantId);
      let insights = null, error = null;
      try { insights = await jouleRecipeInsights(config, { items, principal, cache: recipeInsightsCache.get(principal.tenantId) }); }
      catch (failure) { error = String(failure.message || failure).slice(0, 200); }
      if (insights?.cached) usage.insightReused += 1; else if (insights) usage.insightCalls += 1;
      record("recipe_insights", { recipes: items.length, cached: Boolean(insights?.cached), joule: Boolean(insights), result: insights ? "generated" : "local_only" }, principal);
      return json(res, 200, { insights, error, ranking: rankRecipes(items), usage }, origin, rate);
    }
    const recipeRunMatch = pathname.match(/^\/api\/recipes\/([A-Za-z0-9_-]+)\/run$/);
    if (req.method === "POST" && recipeRunMatch) {
      if (!canEdit(principal)) throw new HttpError(403, "Editor or administrator role required to start a routine.", "role_denied");
      const base = tenantLibrary(principal.tenantId).get(recipeRunMatch[1]); assertTenantResource(base, principal);
      const body = await readJson(req, config);
      const { recipe, cycles } = applyVariant(base.recipe, body?.variant || {});
      const target = JSON.stringify(recipe) === JSON.stringify(base.recipe) ? base : saveRecipe(principal, recipe, "joule").saved;
      const input = validateRobotRoutineInput({ scenarioId: recipe.scenarioId, mode: recipe.mode, cycles, speed: 1, caseContext: recipe.caseContext }, robotScenarioIds);
      const job = startRobotRoutine(principal, input, target);
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status, recipeId: target.id, mode: recipe.mode }, origin, rate);
    }
    const recipeMatch = pathname.match(/^\/api\/recipes\/([A-Za-z0-9_-]+)$/);
    if (req.method === "GET" && recipeMatch) {
      const saved = recipes.get(principal.tenantId)?.get(recipeMatch[1]); assertTenantResource(saved, principal);
      return json(res, 200, { id: saved.id, recipe: saved.recipe, bat: saved.bat }, origin, rate);
    }
    if (req.method === "GET" && pathname === "/api/session") return json(res, 200, { ...principal, permissions: { editModel: canEdit(principal), approve: principal.roles.some((role) => ["admin", "approver"].includes(role)), productionWrite: false } }, origin, rate);
    if (req.method === "GET" && pathname === "/api/model") return json(res, 200, scopeModel(tenantModel(principal), principal), origin, rate);
    if (req.method === "GET" && pathname === "/api/model/example") return json(res, 200, scopeModel(seedTenantModel(challengeModel, principal), principal), origin, rate);
    if (req.method === "GET" && pathname === "/api/adapters") return json(res, 200, adapters, origin, rate);
    if (req.method === "GET" && pathname === "/api/operations-scope") return json(res, 200, operationsScope, origin, rate);
    if (req.method === "GET" && pathname === "/api/exception-controls") return json(res, 200, describeExceptionControls(), origin, rate);
    if (req.method === "GET" && pathname === "/api/experiment-template") return json(res, 200, experimentTemplate(scopeModel(tenantModel(principal), principal)), origin, rate);
    if (["/api/hana-capabilities", "/api/lenses/query"].includes(pathname)) throw new HttpError(410, "Standalone HANA tools were retired. Use BDC Connect and Joule operations workspaces.", "scope_retired");
    if (req.method === "GET" && pathname === "/api/sap-connections") return json(res, 200, {
      descriptor: sapConnectionDescriptor(), profiles: [...(tenantProfiles.get(principal.tenantId)?.values() || [])], storage: "tenant memory; session-only"
    }, origin, rate);
    if (req.method === "PUT" && pathname === "/api/sap-connections") {
      if (!canEdit(principal)) throw new HttpError(403, "Editor or administrator role required.", "role_denied");
      const result = validateSapProfile(await readJson(req, config));
      if (!result.valid) return json(res, 400, { ...result, error: "Connection metadata is invalid." }, origin, rate);
      if (!["BDC_CONNECT", "JOULE"].includes(result.profile.role)) throw new HttpError(400, "Choose BDC_CONNECT or JOULE.", "validation_error");
      if (!tenantProfiles.has(principal.tenantId)) tenantProfiles.set(principal.tenantId, new Map());
      tenantProfiles.get(principal.tenantId).set(result.profile.role, result.profile);
      record("connection_draft_saved", { role: result.profile.role, complete: result.complete, connected: false }, principal);
      return json(res, 200, { ...result, storage: "tenant memory; session-only", connected: false }, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/sap-connections/check") {
      const result = validateSapProfile(await readJson(req, config));
      if (!result.valid) return json(res, 400, { ...result, error: "Connection metadata is invalid." }, origin, rate);
      const job = launchJob("connection_metadata_check", principal, async (emit) => {
        const check = dryRunSapConnection(result.profile);
        await emit({ type: "connection_metadata_checked", connected: false, status: check.status });
        return check;
      });
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
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
      const body = await readJson(req, config), input = validateSimulationInput(body), model = scopeModel(tenantModel(principal), principal);
      if (body.experiment !== undefined) input.experiment = validateExperimentProfile(body.experiment, model);
      const job = launchJob("simulation", principal, (emit) => runSimulation(model, input, emit));
      record("simulation_queued", { jobId: job.id, mode: input.mode, result: "queued" }, principal);
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/connections/test") {
      const input = validateConnectionInput(await readJson(req, config), adapterIds), job = launchJob("connection_test", principal, async (emit) => { const decision = safeConnectionRequest(input); await emit({ type: "connection_decision", adapter: input.adapter, decision }); return decision; });
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/agent/tasks") {
      const task = validateAgentTask(await readJson(req, config), runtime.limits), scenario = robotScenarioById(tenantModel(principal).activeScenarioId) || challengeScenario;
      const job = launchJob("agent_task", principal, (emit) => config.orchestrator.enabled
        ? runAgentTask(config, task, principal, emit, { model: scopeModel(tenantModel(principal), principal), scenario })
        : runOperationsPlan(task, principal, scenario, emit));
      record("agent_task_queued", { jobId: job.id, goal: task.goal.slice(0, 120), provider: config.orchestrator.provider, result: "queued" }, principal);
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
    // Cheap existence check for the UI: reads the in-memory index only, never
    // calls AI Core (the full /last-run does, and takes seconds).
    if (req.method === "GET" && pathname === "/api/analytics/last-run/status") {
      const has = Boolean(lastSimulationJob(principal) || lastRoutineJob(principal));
      return json(res, 200, { available: has }, origin, rate);
    }
    if (req.method === "GET" && (pathname === "/api/analytics/last-run" || pathname === "/api/analytics/last-run/joule")) {
      const simJob = lastSimulationJob(principal), routineJob = lastRoutineJob(principal);
      const simAt = simJob ? simJob.events.find((event) => event.type === "job_complete")?.at : null;
      const routineAt = routineJob ? routineJob.events.find((event) => event.type === "job_complete")?.at : null;
      if (!simAt && !routineAt) return json(res, 404, { error: "No completed run yet for this tenant.", code: "no_simulation_run", hint: "Run a simulation or a routine from the Routine Lab first." }, origin, rate);
      const useRoutine = Boolean(routineAt) && (!simAt || routineAt > simAt);
      const target = useRoutine
        ? { job: routineJob, kind: "robot_routine", scenario: robotScenarioById(routineJob.result?.scenarioId), kpis: computeLogisticsKpis(routineJob) }
        : { job: simJob, kind: "simulation", model: scopeModel(tenantModel(principal), principal) };
      // /joule is the slow half (AI Core call, cached per jobId); /last-run paints the KPIs instantly.
      if (pathname.endsWith("/joule")) {
        const out = await buildJouleForJob(config, principal, target);
        if (!out.cached) record("last_run_joule_generated", { jobId: target.job.id, kind: target.kind, joule: Boolean(out.joule), result: out.joule ? "generated" : "unavailable" }, principal);
        return json(res, 200, { jobId: target.job.id, kind: target.kind, ...out }, origin, rate);
      }
      const analytics = useRoutine
        ? await buildLastRoutineAnalytics(config, principal, target)
        : await buildLastRunAnalytics(config, principal, target);
      record("last_run_analytics_generated", { jobId: analytics.jobId, kind: analytics.kind, result: "generated" }, principal);
      return json(res, 200, analytics, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/optimizations") {
      const input = validateOptimizationInput(await readJson(req, config)), model = scopeModel(tenantModel(principal), principal);
      if ([...jobs.values()].some((job) => job.tenantId === principal.tenantId && job.kind === "layout_optimization" && ["queued", "running"].includes(job.status))) throw new HttpError(409, "An optimization is already running for this tenant.", "optimization_busy");
      const job = launchJob("layout_optimization", principal, (emit, controls) => runLayoutOptimization(config, model, input, principal, emit, controls));
      record("optimization_queued", { jobId: job.id, objective: input.objective, iterations: input.iterations, provider: config.orchestrator.provider, result: "queued" }, principal);
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
    if (req.method === "POST" && pathname === "/api/robot-routines") {
      if (!canEdit(principal)) throw new HttpError(403, "Editor or administrator role required to start a routine.", "role_denied");
      const body = await readJson(req, config);
      const input = validateRobotRoutineInput(body, robotScenarioIds);
      // optional link to the recipe it came from (Queue in local app), so the run is recorded there
      const linked = typeof body?.recipeId === "string" ? tenantLibrary(principal.tenantId).get(body.recipeId) || null : null;
      const job = startRobotRoutine(principal, input, linked && linked.tenantId === principal.tenantId ? linked : null);
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    }
    if (req.method === "GET" && pathname === "/api/robot-routines/active") return json(res, 200, [...jobs.values()].filter((job) => job.tenantId === principal.tenantId && job.kind === "robot_routine" && ["queued", "running", "awaiting_approval"].includes(job.status)).map(jobEnvelope), origin, rate);
    const routineKpisMatch = pathname.match(/^\/api\/robot-routines\/([^/]+)\/kpis$/);
    if (req.method === "GET" && routineKpisMatch) {
      const job = jobs.get(routineKpisMatch[1]); assertTenantResource(job, principal);
      if (job.kind !== "robot_routine") throw new HttpError(400, "Not a robot routine job.", "validation_error");
      const kpis = computeLogisticsKpis(job);
      if (!kpis) return json(res, 404, { error: "No measurable KPIs for this job/scenario.", code: "no_kpis" }, origin, rate);
      return json(res, 200, kpis, origin, rate);
    }

    // Digital Twin Robotics · Unitree H1 humanoid module (separate lane from warehouse routines).
    if (req.method === "GET" && pathname === "/api/humanoid/descriptor") return json(res, 200, humanoidLab.descriptor(), origin, rate);
    if (req.method === "GET" && pathname === "/api/humanoid/joule/prompts") { const ex = isaac.executorState(); return json(res, 200, { prompts: h1JoulePrompts(isaac.mapPlaces(), ex?.robot || "h1") }, origin, rate); }
    if (req.method === "GET" && pathname === "/api/humanoid/frame") { const frame = isaac.getFrame(); if (!frame) return json(res, 404, { error: "No robot frame yet.", code: "no_frame" }, origin, rate); return json(res, 200, frame, origin, rate); }
    if (req.method === "GET" && pathname === "/api/humanoid/map") { const map = isaac.getMap(); if (!map) return json(res, 404, { error: "No warehouse map yet: connect Isaac Sim and deploy a robot.", code: "no_map" }, origin, rate); return json(res, 200, map, origin, rate); }
    const humanoidBusy = () => [...jobs.values()].some((job) => job.tenantId === principal.tenantId && job.kind === "humanoid" && ["queued", "running"].includes(job.status));
    const launchHumanoid = (kind, runner) => {
      const job = launchJob("humanoid", principal, runner);
      record(`humanoid_${kind}_queued`, { jobId: job.id, result: "queued" }, principal);
      return json(res, 202, { jobId: job.id, events: `/api/jobs/${job.id}/events`, status: job.status }, origin, rate);
    };
    if (req.method === "POST" && ["/api/humanoid/train", "/api/humanoid/deploy", "/api/humanoid/teleop", "/api/humanoid/navigate", "/api/humanoid/camera"].includes(pathname)) {
      if (!canEdit(principal)) throw new HttpError(403, "Editor or administrator role required.", "role_denied");
      const kind = pathname.split("/").pop();
      if (humanoidBusy()) throw new HttpError(409, "Stop or finish the active robot job before starting another.", "routine_busy");
      const body = await readJson(req, config), robot = isaac.executorState()?.robot || "h1";
      let input;
      try {
        input = kind === "train" ? validateTrainInput(body) : kind === "deploy" ? validateDeployInput(body) : kind === "teleop" ? validateTeleopInput(body, robot) : kind === "navigate" ? validateNavigateInput(body, isaac.mapPlaces()) : validateCameraInput(body);
      } catch (error) { throw new HttpError(error.status || 400, error.message, "validation_error"); }
      const runner = { train: humanoidLab.runTrain, deploy: humanoidLab.runDeploy, teleop: humanoidLab.runTeleop, navigate: humanoidLab.runNavigate, camera: humanoidLab.runCamera }[kind];
      return launchHumanoid(kind, (emit, controls, job) => runner(input, emit, controls, job));
    }
    if (req.method === "POST" && pathname === "/api/humanoid/joule") {
      if (!canEdit(principal)) throw new HttpError(403, "Editor or administrator role required.", "role_denied");
      if (humanoidBusy()) throw new HttpError(409, "Stop or finish the active robot job before starting another.", "routine_busy");
      const body = await readJson(req, config);
      const goal = typeof body?.goal === "string" ? body.goal.trim().slice(0, 300) : "";
      if (!goal) throw new HttpError(400, "Describe what the robot should do.", "validation_error");
      return launchHumanoid("joule", async (emit, controls, job) => {
        const ex = isaac.executorState();
        const joule = await jouleMissionPlan(config, { goal, principal, emit, places: isaac.mapPlaces(), robot: ex?.robot || "h1", pose: ex?.pose || null });
        await emit({ type: "h1_joule_answer", goal, answer: joule.answer, steps: joule.steps, provider: joule.provider, model: joule.model });
        return humanoidLab.runPlan({ steps: joule.steps }, emit, controls, job);
      });
    }
    // SAP EWM warehouse tasks (simulated) the robot can execute; confirmations are simulated too.
    if (req.method === "GET" && pathname === "/api/humanoid/orders") return json(res, 200, { orders: orderBook.list(principal.tenantId, isaac.mapPlaces()).map(publicOrder), source: "SAP EWM · simulated", productionWrites: false }, origin, rate);
    if (req.method === "POST" && pathname === "/api/humanoid/orders/reset") {
      if (!canEdit(principal)) throw new HttpError(403, "Editor or administrator role required.", "role_denied");
      if (humanoidBusy()) throw new HttpError(409, "Stop or finish the active robot job first.", "routine_busy");
      const orders = orderBook.reset(principal.tenantId, isaac.mapPlaces());
      record("sap_orders_reset", { count: orders.length, result: "reset" }, principal);
      return json(res, 200, { orders: orders.map(publicOrder) }, origin, rate);
    }
    const orderMatch = pathname.match(/^\/api\/humanoid\/orders\/([A-Za-z0-9-]+)\/(dispatch|decision|evidence)$/);
    if (orderMatch) {
      const order = orderBook.get(principal.tenantId, orderMatch[1], isaac.mapPlaces()), action = orderMatch[2];
      if (!order) throw new HttpError(404, "Unknown warehouse task.", "not_found");
      if (req.method === "GET" && action === "evidence") {
        if (!order.evidence) return json(res, 404, { error: "No photo for this task yet.", code: "no_evidence" }, origin, rate);
        return json(res, 200, { image: order.evidence.image, caption: order.evidence.caption, capturedAt: order.evidence.capturedAt }, origin, rate);
      }
      if (req.method === "POST" && action === "dispatch") {
        if (!canEdit(principal)) throw new HttpError(403, "Editor or administrator role required.", "role_denied");
        if (humanoidBusy()) throw new HttpError(409, "Stop or finish the active robot job before starting another.", "routine_busy");
        if (order.status !== "open") throw new HttpError(409, `Task ${order.id} is ${order.status.replace("_", " ")}; reset the demo tasks to run it again.`, "order_closed");
        if (!isaac.connected()) throw new HttpError(409, "Connect the Isaac Sim executor and deploy a robot: the task needs the warehouse map and the robot camera.", "isaac_offline");
        const places = isaac.mapPlaces(), place = places.find((p) => p.id === order.placeId) || places.find((p) => p.name.toLowerCase() === order.storageBin.toLowerCase());
        if (!place) throw new HttpError(409, `${order.storageBin} is not on the current warehouse map. Reset the demo tasks to use this warehouse's racks.`, "bin_not_on_map");
        order.placeId = place.id;
        let steps;
        try { steps = validatePlan(missionFor(order), places, isaac.executorState()?.robot || "h1"); } catch (error) { throw new HttpError(409, error.message, "validation_error"); }
        return launchHumanoid("order", (emit, controls, job) => runOrderMission(order, steps, principal, emit, controls, job));
      }
      if (req.method === "POST" && action === "decision") {
        if (!principal.roles.some((role) => ["admin", "approver"].includes(role))) throw new HttpError(403, "An approver or administrator role is required.", "role_denied");
        if (order.status !== "review") throw new HttpError(409, `Task ${order.id} is not waiting for a person.`, "order_not_in_review");
        const body = await readJson(req, config);
        if (!["confirm", "exception"].includes(body?.decision)) throw new HttpError(400, "Decision must be confirm or exception.", "validation_error");
        closeOrder(order, body.decision === "confirm" ? { decision: "confirm", by: `reviewed by ${principal.userId}` } : { decision: "exception", code: "CHCK", label: "Recount requested", followUp: "Physical inventory recount requested for the bin (simulated).", by: `reviewed by ${principal.userId}` });
        record(`sap_order_${order.status}`, { orderId: order.id, reviewer: principal.userId, simulated: true, result: order.status }, principal);
        return json(res, 200, { order: publicOrder(order) }, origin, rate);
      }
    }
    if (req.method === "GET" && pathname === "/api/humanoid/active") return json(res, 200, [...jobs.values()].filter((job) => job.tenantId === principal.tenantId && job.kind === "humanoid" && ["queued", "running"].includes(job.status)).map(jobEnvelope), origin, rate);
    const resolutionMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/resolution$/);
    if (resolutionMatch && ["GET", "POST"].includes(req.method)) {
      const job = jobs.get(resolutionMatch[1]); assertTenantResource(job, principal);
      if (job.kind !== "robot_routine") throw new HttpError(400, "Resolution applies only to operations routines.", "validation_error");
      if (req.method === "GET") return json(res, 200, job.resolution || { status: "awaiting_evidence", jobStatus: job.status, simulated: true }, origin, rate);
      if (!principal.roles.some(role => ["admin", "approver"].includes(role))) throw new HttpError(403, "An approver or administrator role is required.", "role_denied");
      if ((job.resolutionHistory?.length || 0) >= 64) throw new HttpError(409, "Resolution revision limit reached.", "resolution_limit");
      const actionKind = job.result?.scenarioId === "autonomous-inspection" ? "inspection" : "material_move";
      const proof = validateResolutionProof(await readJson(req, config), { jobId: job.id, jobStatus: job.status, actionKind });
      const recordData = { ...proof, scenarioId: job.result.scenarioId, tenantId: principal.tenantId, reviewedBy: principal.userId,
        recordedAt: new Date().toISOString(), revision: (job.resolutionHistory?.length || 0) + 1,
        reviewHashes: job.events.filter(event => event.type === "approval_resolved" && event.reviewHash).map(event => event.reviewHash),
        evidenceVerification: "User-attested local simulation references; no independent sensor or SAP verification" };
      recordData.recordHash = crypto.createHash("sha256").update(JSON.stringify(recordData)).digest("hex");
      job.resolution = recordData; (job.resolutionHistory ||= []).push(recordData);
      job.result = { ...job.result, resolutionStatus: recordData.status };
      appendJobEvent(job, { type: "resolution_recorded", result: recordData });
      record("exception_resolution_recorded", { jobId: job.id, status: proof.status, recordHash: recordData.recordHash, revision: recordData.revision }, principal);
      return json(res, 200, recordData, origin, rate);
    }
    const actionMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/(approval|cancel)$/);
    if (req.method === "POST" && actionMatch) {
      const job = jobs.get(actionMatch[1]); assertTenantResource(job, principal);
      if (actionMatch[2] === "approval") {
        const decision = job.approvals.decide(await readJson(req, config), principal);
        record("routine_approval", { jobId: job.id, ...decision }, principal);
        return json(res, 200, { accepted: true, decision }, origin, rate);
      }
      if (!canEdit(principal)) throw new HttpError(403, "Editor or administrator role required.", "role_denied");
      if (["complete", "failed", "cancelled"].includes(job.status)) throw new HttpError(409, "Job already ended.", "job_ended");
      job.controller.abort(); record("routine_cancel_requested", { jobId: job.id }, principal);
      return json(res, 202, { accepted: true }, origin, rate);
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
  return sendFile(res, safePath, origin, req);
}

const server = http.createServer((req, res) => routeRequest(req, res).catch((error) => {
  const status = Number(error.status) || 500, origin = req.headers.origin && config.appOrigins.includes(req.headers.origin) ? req.headers.origin : null;
  if (status >= 500) console.error(error);
  json(res, status, { error: status >= 500 ? "Internal server error." : error.message, code: error.code || "server_error" }, origin);
}));

server.listen(config.port, config.host, () => console.log(`SAP Embodied AI Simulation Lab listening on http://${config.host}:${config.port}`));
export { server };
