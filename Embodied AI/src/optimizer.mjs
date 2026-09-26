import { runSimulation } from "./engine.mjs";
import { normalizeModel } from "./domain.mjs";
import { experimentRoute } from "./industrial-timing.mjs";
import { complete, extractText, extractJson, usageSummary, isAuthError } from "../orchestrator.mjs";
import { safetyIdentifier } from "../auth.mjs";

export const OBJECTIVES = {
  throughput: { label: "throughput", direction: 1, unit: "entities / second" },
  p95Cycle: { label: "P95 cycle", direction: -1, unit: "seconds" },
  averageCycle: { label: "average cycle", direction: -1, unit: "seconds" }
};

const round = (value, digits = 3) => Number(Number(value).toFixed(digits));
const score = (metrics, objective) => OBJECTIVES[objective].direction * Number(metrics?.[objective] || 0);
const improvement = (base, next, objective) => { const b = Number(base?.[objective] || 0), n = Number(next?.[objective] || 0); return b ? round(OBJECTIVES[objective].direction * ((n - b) / Math.abs(b)) * 100, 1) : 0; };
const pick = (metrics) => ({ throughput: round(metrics.throughput, 4), throughputPerHour: round(metrics.throughputPerHour, 1), averageCycle: round(metrics.averageCycle, 2), p95Cycle: round(metrics.p95Cycle, 2), completed: metrics.completed, horizon: round(metrics.horizon, 2) });
const routeOf = (model) => Array.isArray(model.executionRoute) ? model.executionRoute : experimentRoute(model);

async function evaluate(model, input) {
  const maxQueue = {};
  const summary = await runSimulation(model, { mode: "fast", seed: input.seed, entities: input.entities }, async (event) => {
    if (!event.snapshot?.queues) return;
    for (const [id, depth] of Object.entries(event.snapshot.queues)) maxQueue[id] = Math.max(maxQueue[id] || 0, depth);
  });
  return { ...summary, maxQueue };
}

function summarize(model, metrics) {
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  return experimentRoute(model).map((id, index) => byId.get(id) && ({ order: index + 1, id, name: byId.get(id).name, capacity: byId.get(id).capacity, service: byId.get(id).service, utilization: metrics?.utilization?.[id] == null ? null : round(metrics.utilization[id], 3), maxQueue: metrics?.maxQueue?.[id] ?? 0 })).filter(Boolean);
}

function budgetState(model, baselineModel, input) {
  const base = new Map(baselineModel.nodes.map((node) => [node.id, node]));
  let capacity = 0, service = 0;
  for (const node of model.nodes) {
    const original = base.get(node.id);
    if (!original) continue;
    capacity += node.capacity - original.capacity;
    service += Math.max(0, (original.service - node.service) / original.service);
  }
  return { capacityUsed: capacity, capacityBudget: input.capacityBudget, serviceUsed: round(service, 3), serviceBudget: input.serviceBudget };
}

export function applyCandidate(model, candidate, baselineModel, input) {
  const next = normalizeModel(model);
  if (Array.isArray(model.executionRoute)) next.executionRoute = [...model.executionRoute];
  const byId = new Map(next.nodes.map((node) => [node.id, node])), base = new Map(baselineModel.nodes.map((node) => [node.id, node]));
  const route = routeOf(next), violations = [], ops = Array.isArray(candidate?.ops) ? candidate.ops.slice(0, 4) : [];
  if (!ops.length) violations.push("candidate has no operations");
  for (const op of ops) {
    const node = byId.get(op?.nodeId);
    if (!node) { violations.push(`unknown node ${op?.nodeId}`); continue; }
    const original = base.get(node.id) || node;
    if (op.op === "set_capacity") {
      const value = Math.floor(Number(op.value));
      if (!Number.isFinite(value) || value < 1 || value > 12) violations.push(`capacity out of range for ${node.id}`); else node.capacity = value;
    } else if (op.op === "set_service") {
      const value = Number(op.value);
      if (!Number.isFinite(value) || value < original.service * 0.6 || value > original.service * 1.5) violations.push(`service must stay within 60%-150% of baseline for ${node.id}`); else node.service = round(value, 2);
    } else if (op.op === "swap_nodes") {
      const a = route.indexOf(node.id), b = route.indexOf(op.otherNodeId);
      if (!Array.isArray(next.executionRoute) || a < 0 || b < 0) violations.push("swap_nodes requires two nodes on the execution route");
      else if (a === 0 || b === 0 || a === route.length - 1 || b === route.length - 1) violations.push("swap_nodes cannot move the first or last route visit");
      else { [next.executionRoute[a], next.executionRoute[b]] = [next.executionRoute[b], next.executionRoute[a]]; }
    } else violations.push(`unsupported op ${op?.op}`);
  }
  const budget = budgetState(next, baselineModel, input);
  if (budget.capacityUsed > budget.capacityBudget) violations.push(`capacity budget exceeded (${budget.capacityUsed}/${budget.capacityBudget})`);
  if (budget.serviceUsed > budget.serviceBudget) violations.push(`service investment budget exceeded (${budget.serviceUsed}/${budget.serviceBudget})`);
  return { model: next, violations, budget };
}

function heuristicCandidates(model, metrics, baselineModel, input, history) {
  const ranked = summarize(model, metrics).sort((a, b) => (b.utilization ?? 0) - (a.utilization ?? 0) || b.maxQueue - a.maxQueue);
  const budget = budgetState(model, baselineModel, input), tried = new Set(history.map((item) => item.label));
  const [top, second] = ranked, out = [];
  if (top) {
    if (budget.capacityUsed < budget.capacityBudget) out.push({ label: `+1 capacity @ ${top.id}`, rationale: `Highest utilization ${top.utilization} with max queue ${top.maxQueue}.`, ops: [{ op: "set_capacity", nodeId: top.id, value: top.capacity + 1 }] });
    out.push({ label: `-15% service @ ${top.id}`, rationale: "Shorten service time at the bottleneck.", ops: [{ op: "set_service", nodeId: top.id, value: round(top.service * 0.85, 2) }] });
  }
  if (second) out.push({ label: `-10% service @ ${second.id}`, rationale: "Relieve the second bottleneck.", ops: [{ op: "set_service", nodeId: second.id, value: round(second.service * 0.9, 2) }] });
  const route = summarize(model, metrics), index = route.findIndex((node) => node.id === top?.id);
  if (Array.isArray(model.executionRoute) && index > 1 && index < route.length - 1) out.push({ label: `swap ${route[index - 1].id} ⇄ ${top.id}`, rationale: "Re-sequence the execution route around the bottleneck.", ops: [{ op: "swap_nodes", nodeId: route[index - 1].id, otherNodeId: top.id }] });
  return out.filter((candidate) => !tried.has(candidate.label)).slice(0, input.candidates);
}

const OPTIMIZER_SYSTEM = [
  "You are the layout optimizer of the SAP Embodied AI Simulation Lab. You improve an autonomous-operations twin evaluated by a deterministic discrete-event simulation (DES).",
  "DES mechanics: entities arrive at the first route visit and flow through the execution route in order. Each node has `capacity` (parallel resources) and `service` (mean service seconds; actual time is service x uniform(0.75, 1.65)). A node with utilization near 1.0 or a large maxQueue is a bottleneck. The route order can be changed by swapping two intermediate visits.",
  "Allowed operations (at most 4 per candidate): {\"op\":\"set_capacity\",\"nodeId\":string,\"value\":1..12}; {\"op\":\"set_service\",\"nodeId\":string,\"value\":number within 60%-150% of the baseline service}; {\"op\":\"swap_nodes\",\"nodeId\":string,\"otherNodeId\":string} (both must be intermediate route visits, never the first or last).",
  "Budgets are cumulative versus the baseline model: total added capacity must stay within capacityBudget, and the sum over nodes of (baselineService - newService) / baselineService must stay within serviceBudget. Prefer targeted changes at bottlenecks; learn from the history of accepted and rejected candidates and do not repeat them.",
  "Respond ONLY with a JSON object: {\"candidates\": [{\"label\": string (max 8 words), \"rationale\": string (max 40 words), \"ops\": [...]}]}. No prose."
].join("\n");

async function llmCandidates(config, state, messages, emit) {
  const { input, best, baselineMetrics, baselineModel, history, iteration, safetyId } = state;
  const turn = { objective: input.objective, direction: OBJECTIVES[input.objective].direction > 0 ? "maximize" : "minimize", iteration, budget: budgetState(best.model, baselineModel, input), baselineMetrics: pick(baselineMetrics), currentBestMetrics: pick(best.metrics), route: summarize(best.model, best.metrics), history: history.slice(-8).map((item) => ({ label: item.label, ops: item.ops, accepted: item.accepted, metric: item.metrics?.[input.objective] ?? null, violations: item.violations })), request: `Propose up to ${input.candidates} candidates that improve ${input.objective}.` };
  messages.push({ role: "user", content: JSON.stringify(turn) });
  const response = await complete(config, { system: OPTIMIZER_SYSTEM, messages, maxTokens: 1400, model: config.orchestrator.primaryModel, effort: config.orchestrator.effort, safetyId });
  const text = extractText(response);
  messages.push({ role: "assistant", content: text || "{\"candidates\":[]}" });
  await emit({ type: "provider_status", providerId: response.id, status: response.stop_reason, usage: usageSummary(response) });
  const parsed = extractJson(text);
  return (Array.isArray(parsed?.candidates) ? parsed.candidates : []).filter((candidate) => candidate && typeof candidate === "object").slice(0, input.candidates).map((candidate, index) => ({ label: String(candidate.label || `candidate ${index + 1}`).slice(0, 80), rationale: String(candidate.rationale || "").slice(0, 300), ops: Array.isArray(candidate.ops) ? candidate.ops : [] }));
}

export async function runLayoutOptimization(config, model, input, principal, emit, controls = {}) {
  const baselineModel = normalizeModel(model);
  if (Array.isArray(model.executionRoute)) baselineModel.executionRoute = [...model.executionRoute];
  const baselineMetrics = await evaluate(baselineModel, input);
  const state = { input, baselineModel, baselineMetrics, best: { model: baselineModel, metrics: baselineMetrics }, history: [], iteration: 0, safetyId: safetyIdentifier(principal) };
  const messages = [], applied = [];
  let source = config.orchestrator.enabled ? "llm" : "heuristic", evaluated = 0, llmProposals = 0;
  await emit({ type: "optimizer_baseline", objective: input.objective, unit: OBJECTIVES[input.objective].unit, metrics: pick(baselineMetrics), route: summarize(baselineModel, baselineMetrics), budget: budgetState(baselineModel, baselineModel, input), source, seed: input.seed, entities: input.entities });

  for (let iteration = 1; iteration <= input.iterations; iteration += 1) {
    if (controls.signal?.aborted) break;
    state.iteration = iteration;
    let candidates = [], iterationSource = source;
    if (source === "llm") {
      try { candidates = await llmCandidates(config, state, messages, emit); llmProposals += candidates.length; }
      catch (error) {
        iterationSource = "heuristic";
        if (isAuthError(error)) source = "heuristic";
        await emit({ type: "fallback_activated", from: config.orchestrator.primaryModel, to: "heuristic optimizer", reason: isAuthError(error) ? "safeguard" : "provider_unavailable", safetyMode: "continuation", detail: error.message, permanent: source === "heuristic" });
      }
    }
    if (!candidates.length) { iterationSource = "heuristic"; candidates = heuristicCandidates(state.best.model, state.best.metrics, baselineModel, input, state.history); }
    await emit({ type: "optimizer_iteration", iteration, iterations: input.iterations, candidates: candidates.length, source: iterationSource });
    if (!candidates.length) break;

    for (const candidate of candidates) {
      if (controls.signal?.aborted) break;
      const { model: trial, violations, budget } = applyCandidate(state.best.model, candidate, baselineModel, input);
      const record = { iteration, label: candidate.label, rationale: candidate.rationale, ops: candidate.ops, violations, source: iterationSource };
      if (violations.length) {
        record.accepted = false;
        await emit({ type: "optimizer_candidate", ...record, accepted: false, reason: violations.join("; ") });
        state.history.push(record);
        continue;
      }
      const metrics = await evaluate(trial, input); evaluated += 1;
      const delta = round(score(metrics, input.objective) - score(state.best.metrics, input.objective), 4), accepted = delta > 0;
      Object.assign(record, { metrics: pick(metrics), delta, improvementPct: improvement(baselineMetrics, metrics, input.objective), accepted, budget });
      await emit({ type: "optimizer_candidate", ...record, utilization: metrics.utilization });
      state.history.push(record);
      if (accepted) { state.best = { model: trial, metrics }; applied.push({ iteration, label: candidate.label, ops: candidate.ops }); }
    }
  }

  const result = {
    objective: input.objective, unit: OBJECTIVES[input.objective].unit, source: llmProposals ? "llm" : "heuristic", llmProposals, iterations: state.iteration, evaluated,
    baseline: pick(baselineMetrics), best: pick(state.best.metrics), improvementPct: improvement(baselineMetrics, state.best.metrics, input.objective),
    applied, budget: budgetState(state.best.model, baselineModel, input), route: summarize(state.best.model, state.best.metrics),
    proposedModel: applied.length ? state.best.model : null
  };
  await emit({ type: "optimizer_complete", ...result });
  return result;
}
