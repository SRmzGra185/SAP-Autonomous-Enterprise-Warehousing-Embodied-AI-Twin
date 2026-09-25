// Joule Analytics for a single real simulation run: interprets the result the
// user already produced from the Routine Lab (POST /api/simulations), instead
// of generating synthetic scenarios. No ranking — there is only one run.

import { complete, extractText, extractJson, usageSummary } from "../orchestrator.mjs";
import { safetyIdentifier } from "../auth.mjs";

const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

export function resolveRunNodes(model, result) {
  const byId = new Map((model.nodes || []).map((node) => [node.id, node]));
  const nodes = Object.keys(result.nodeMetrics || {}).map((nodeId) => {
    const metrics = result.nodeMetrics[nodeId], node = byId.get(nodeId);
    return {
      id: nodeId, name: node?.name || nodeId, kind: node?.kind || null, layer: node?.layer || "platform",
      capacity: metrics.capacity ?? node?.capacity ?? null, service: node?.service ?? null,
      utilization: round(result.utilization?.[nodeId] ?? 0, 3),
      queuedSeconds: round(metrics.queuedSeconds, 1), busySeconds: round(metrics.busySeconds, 1), setupSeconds: round(metrics.setupSeconds, 1)
    };
  });
  return nodes.sort((a, b) => (b.utilization || 0) - (a.utilization || 0));
}

export function runSummary(model, result) {
  const nodes = resolveRunNodes(model, result);
  const utilizations = nodes.map((node) => node.utilization || 0);
  const meanUtilization = utilizations.length ? utilizations.reduce((sum, value) => sum + value, 0) / utilizations.length : 0;
  const maxUtilization = utilizations.length ? Math.max(...utilizations) : 0;
  return { nodes, meanUtilization: round(meanUtilization, 3), maxUtilization: round(maxUtilization, 3), bottleneck: nodes[0] || null };
}

const SYSTEM = [
  "You are Joule, analytics advisor for the SAP Autonomous Operations Twin (SAP BDC Connect · SAP AI Core). You receive the deterministic discrete-event simulation result of ONE run the user executed on their own editable twin model in the Routine Lab.",
  "Interpret the KPIs like an operations executive: throughput per hour (higher is better), average and P95 order cycle in seconds (lower is better), mean and max resource utilization (0..1; above ~0.85 is a bottleneck risk, far below ~0.4 is idle capacity), queued seconds (lower is better).",
  "Always write in English. Be specific: cite node names and numbers from THIS run. Nothing you say executes anything; this is a simulated result.",
  "Respond ONLY with a JSON object: {\"executiveSummary\": string (max 120 words), \"recommendations\": [{\"nodeId\": string|null, \"title\": string (max 10 words), \"detail\": string (max 50 words)}] (2 to 5 items), \"risks\": string[] (max 3)}."
].join("\n");

export async function jouleRunAnalysis(config, { result, nodes, principal }) {
  if (!config.orchestrator.enabled) return null;
  const compact = {
    entities: result.entities, runs: result.runs, seed: result.seed,
    throughputPerHour: round(result.throughputPerHour, 1), averageCycle: round(result.averageCycle, 1),
    p95Cycle: round(result.p95Cycle, 1), averageQueuedSeconds: round(result.averageQueuedSeconds, 1),
    completed: result.completed, horizonSeconds: round(result.horizon, 1),
    nodes: nodes.map((node) => ({ id: node.id, name: node.name, utilization: node.utilization, queuedSeconds: node.queuedSeconds, capacity: node.capacity })),
    bottleneck: nodes[0] ? { id: nodes[0].id, name: nodes[0].name, utilization: nodes[0].utilization } : null,
    replicationCi95: result.replicationMeanCycleSeconds?.ci95 ?? null
  };
  const response = await complete(config, { system: SYSTEM, messages: [{ role: "user", content: JSON.stringify(compact) }], maxTokens: 1400, model: config.orchestrator.primaryModel, effort: config.orchestrator.effort, safetyId: safetyIdentifier(principal) });
  const parsed = extractJson(extractText(response)) || {};
  const ids = new Set(nodes.map((node) => node.id));
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  return {
    provider: config.orchestrator.provider, model: response.model, usage: usageSummary(response),
    executiveSummary: text(parsed.executiveSummary, 1200) || null,
    recommendations: (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).slice(0, 5)
      .map((item) => ({ nodeId: ids.has(item?.nodeId) ? item.nodeId : null, title: text(item?.title, 80), detail: text(item?.detail, 500) }))
      .filter((item) => item.title),
    risks: (Array.isArray(parsed.risks) ? parsed.risks : []).filter((item) => typeof item === "string").slice(0, 3).map((item) => item.trim().slice(0, 300))
  };
}

export async function buildLastRunAnalytics(config, principal, { job, model }) {
  const result = job.result;
  const summary = runSummary(model, result);
  const payload = {
    kind: "simulation",
    jobId: job.id,
    runAt: job.events.find((event) => event.type === "job_complete")?.at ?? null,
    modelVersion: model.version ?? null,
    modelName: model.name ?? null,
    parameters: { mode: result.mode, entities: result.entities, seed: result.seed, runs: result.runs },
    result,
    nodes: summary.nodes,
    meanUtilization: summary.meanUtilization,
    maxUtilization: summary.maxUtilization,
    bottleneck: summary.bottleneck,
    provider: config.orchestrator.enabled ? config.orchestrator.provider : "mock",
    joule: null, jouleError: null
  };
  try { payload.joule = await jouleRunAnalysis(config, { result, nodes: summary.nodes, principal }); }
  catch (error) { payload.jouleError = String(error.message || error).slice(0, 200); }
  return payload;
}

// --- Workcell routines ("Run in twin") — a different data shape: no DES nodes/
// utilization, only the two Logistics KPIs measured from real event timestamps
// (computeLogisticsKpis, src/robotics.mjs) when the scenario is warehouse-fulfillment.

const ROUTINE_SYSTEM = [
  "You are Joule, analytics advisor for the SAP Autonomous Operations Twin (SAP BDC Connect · SAP AI Core). You receive the result of ONE Workcell routine run (a GRAFCET playback of a robot scenario), not a discrete-event simulation.",
  "Only some KPIs for this scenario have real measured values today (from correlated event timestamps); the rest are listed as not-yet-measured because the routine has no data for them (no AMR load state, no map/shifts, no order deadline, no battery/energy telemetry). Never claim a value for an unmeasured KPI.",
  "Always write in English. Be specific: cite the measured seconds you were given. Nothing you say executes anything; this is a simulated routine, not a live robot.",
  "Respond ONLY with a JSON object: {\"executiveSummary\": string (max 120 words), \"recommendations\": [{\"title\": string (max 10 words), \"detail\": string (max 50 words)}] (2 to 5 items), \"risks\": string[] (max 3)}."
].join("\n");

export async function jouleRoutineAnalysis(config, { scenario, kpis, job, principal }) {
  if (!config.orchestrator.enabled) return null;
  const compact = {
    scenario: { id: scenario?.id, domain: scenario?.domain, name: scenario?.name, robot: scenario?.robot },
    mode: job.result?.mode, cycles: job.result?.cycles, cyclesMeasured: kpis?.cyclesMeasured ?? 0,
    pickingAndOrderCycle: kpis?.pickingAndOrderCycle ?? null,
    queueAndDockDwell: kpis?.queueAndDockDwell ?? null,
    unmeasuredKpis: (scenario?.kpiProfile?.metrics || []).map((metric) => metric.name).filter((name) => !["Picking and order cycle", "Queue and dock dwell"].includes(name))
  };
  const response = await complete(config, { system: ROUTINE_SYSTEM, messages: [{ role: "user", content: JSON.stringify(compact) }], maxTokens: 1200, model: config.orchestrator.primaryModel, effort: config.orchestrator.effort, safetyId: safetyIdentifier(principal) });
  const parsed = extractJson(extractText(response)) || {};
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  return {
    provider: config.orchestrator.provider, model: response.model, usage: usageSummary(response),
    executiveSummary: text(parsed.executiveSummary, 1200) || null,
    recommendations: (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).slice(0, 5)
      .map((item) => ({ title: text(item?.title, 80), detail: text(item?.detail, 500) }))
      .filter((item) => item.title),
    risks: (Array.isArray(parsed.risks) ? parsed.risks : []).filter((item) => typeof item === "string").slice(0, 3).map((item) => item.trim().slice(0, 300))
  };
}

export async function buildLastRoutineAnalytics(config, principal, { job, scenario, kpis }) {
  const unmeasuredKpis = (scenario?.kpiProfile?.metrics || []).map((metric) => metric.name).filter((name) => !["Picking and order cycle", "Queue and dock dwell"].includes(name));
  const payload = {
    kind: "robot_routine",
    jobId: job.id,
    runAt: job.events.find((event) => event.type === "job_complete")?.at ?? null,
    scenario: scenario ? { id: scenario.id, domain: scenario.domain, name: scenario.name, robot: scenario.robot, objective: scenario.objective } : null,
    mode: job.result?.mode ?? null,
    cycles: job.result?.cycles ?? null,
    kpis,
    unmeasuredKpis,
    provider: config.orchestrator.enabled ? config.orchestrator.provider : "mock",
    joule: null, jouleError: null
  };
  try { payload.joule = await jouleRoutineAnalysis(config, { scenario, kpis, job, principal }); }
  catch (error) { payload.jouleError = String(error.message || error).slice(0, 200); }
  return payload;
}
