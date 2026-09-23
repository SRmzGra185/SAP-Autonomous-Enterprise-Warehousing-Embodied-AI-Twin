import { runSimulation } from "./engine.mjs";
import { defaultModel } from "./domain.mjs";
import { composeRobotTwin, robotScenarios } from "./robotics.mjs";
import { experimentRoute } from "./industrial-timing.mjs";
import { complete, extractText, extractJson, usageSummary } from "../orchestrator.mjs";
import { safetyIdentifier } from "../auth.mjs";

const TTL_MS = 10 * 60 * 1000;
const cache = new Map();
const round = (value, digits = 2) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
const clamp01 = (value) => Math.max(0, Math.min(1, value));

async function simulateScenario(scenario, { entities, seed, runs }) {
  const model = composeRobotTwin(defaultModel, defaultModel, scenario);
  const summary = await runSimulation(model, { mode: "monte-carlo", runs, entities, seed, detail: false });
  const byId = new Map(model.nodes.map((node) => [node.id, node]));
  const route = experimentRoute(model);
  const nodes = [...new Set(route)].map((id) => ({ id, name: byId.get(id)?.name || id, capacity: byId.get(id)?.capacity ?? null, service: byId.get(id)?.service ?? null, utilization: round(summary.utilization?.[id] ?? 0, 3), queuedSeconds: round(summary.nodeMetrics?.[id]?.queuedSeconds ?? 0, 1) }));
  const utilizations = nodes.map((node) => node.utilization || 0);
  const mean = utilizations.reduce((sum, value) => sum + value, 0) / Math.max(1, utilizations.length);
  const std = Math.sqrt(utilizations.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, utilizations.length));
  const bottleneck = nodes.reduce((best, node) => (node.utilization > (best?.utilization ?? -1) ? node : best), null);
  return {
    id: scenario.id, domain: scenario.domain, name: scenario.name, objective: scenario.objective, robot: scenario.robot,
    steps: scenario.grafcet?.steps?.length ?? null, routeVisits: route.length, distinctNodes: nodes.length,
    kpis: {
      throughputPerHour: round(summary.throughputPerHour, 1), averageCycle: round(summary.averageCycle, 1), p95Cycle: round(summary.p95Cycle, 1),
      averageQueuedSeconds: round(summary.averageQueuedSeconds, 1), completed: summary.completed, horizonSeconds: round(summary.horizon, 1),
      meanUtilization: round(mean, 3), maxUtilization: round(bottleneck?.utilization ?? 0, 3), balance: round(clamp01(1 - (mean ? std / mean : 0)), 3),
      cycleCi95: summary.replicationMeanCycleSeconds?.ci95 ? { lower: round(summary.replicationMeanCycleSeconds.ci95.lower, 1), upper: round(summary.replicationMeanCycleSeconds.ci95.upper, 1) } : null
    },
    bottleneck: bottleneck ? { id: bottleneck.id, name: bottleneck.name, utilization: bottleneck.utilization } : null,
    nodes,
    kpiProfile: { status: scenario.kpiProfile?.status || null, metrics: (scenario.kpiProfile?.metrics || []).map((metric) => metric.name).slice(0, 8) }
  };
}

function scoreScenarios(scenarios) {
  const maxThroughput = Math.max(...scenarios.map((item) => item.kpis.throughputPerHour || 0), 1);
  const minP95 = Math.min(...scenarios.map((item) => item.kpis.p95Cycle || Infinity));
  return scenarios.map((item) => {
    const throughput = (item.kpis.throughputPerHour || 0) / maxThroughput;
    const cycle = Number.isFinite(minP95) && item.kpis.p95Cycle ? minP95 / item.kpis.p95Cycle : 0;
    const balance = item.kpis.balance || 0;
    const headroom = clamp01(1 - (item.kpis.maxUtilization || 0));
    const score = Math.round((throughput * 0.4 + cycle * 0.3 + balance * 0.2 + headroom * 0.1) * 100);
    return { scenarioId: item.id, score, components: { throughput: round(throughput * 100, 0), cycle: round(cycle * 100, 0), balance: round(balance * 100, 0), headroom: round(headroom * 100, 0) } };
  }).sort((a, b) => b.score - a.score);
}

const SYSTEM = [
  "You are Joule, analytics advisor for the SAP Autonomous Operations Twin (SAP BDC Connect · SAP AI Core). You receive deterministic discrete-event simulation KPIs for four autonomous-operations scenarios (asset inspection, adaptive assembly, full-circle orchestration, warehouse fulfillment).",
  "Interpret the KPIs like an operations executive: throughput per hour (higher is better), average and P95 order cycle in seconds (lower is better), mean and max resource utilization (0..1; above ~0.85 is a bottleneck risk, far below ~0.4 is idle capacity), utilization balance (1 = evenly loaded), queued seconds (lower is better), route visits and GRAFCET steps (complexity).",
  "Always write in English. Be specific: cite scenario names and numbers. Nothing you say executes anything; these are simulated results.",
  "Respond ONLY with a JSON object: {\"executiveSummary\": string (max 120 words), \"ranking\": [{\"scenarioId\": string, \"score\": integer 0..100, \"rationale\": string (max 40 words)}] covering all four scenarios ordered best first, \"recommendations\": [{\"scenarioId\": string|null, \"title\": string (max 10 words), \"detail\": string (max 50 words)}] (3 to 5 items), \"risks\": string[] (max 3)}."
].join("\n");

async function jouleAnalytics(config, principal, payload) {
  if (!config.orchestrator.enabled) return null;
  const compact = payload.scenarios.map((item) => ({ scenarioId: item.id, name: item.name, domain: item.domain, robot: item.robot, kpis: item.kpis, bottleneck: item.bottleneck, routeVisits: item.routeVisits, steps: item.steps, deterministicScore: payload.ranking.find((entry) => entry.scenarioId === item.id)?.score ?? null }));
  const response = await complete(config, { system: SYSTEM, messages: [{ role: "user", content: JSON.stringify({ entities: payload.entities, replications: payload.replications, seed: payload.seed, scenarios: compact }) }], maxTokens: 1600, model: config.orchestrator.primaryModel, effort: config.orchestrator.effort, safetyId: safetyIdentifier(principal) });
  const parsed = extractJson(extractText(response)) || {};
  const ids = new Set(payload.scenarios.map((item) => item.id));
  const text = (value, max) => (typeof value === "string" ? value.trim().slice(0, max) : "");
  return {
    provider: config.orchestrator.provider, model: response.model, usage: usageSummary(response),
    executiveSummary: text(parsed.executiveSummary, 1200) || null,
    ranking: (Array.isArray(parsed.ranking) ? parsed.ranking : []).filter((item) => item && ids.has(item.scenarioId)).slice(0, 4).map((item) => ({ scenarioId: item.scenarioId, score: Math.max(0, Math.min(100, Math.round(Number(item.score) || 0))), rationale: text(item.rationale, 400) })),
    recommendations: (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).filter((item) => item && typeof item === "object").slice(0, 5).map((item) => ({ scenarioId: ids.has(item.scenarioId) ? item.scenarioId : null, title: text(item.title, 80), detail: text(item.detail, 500) })).filter((item) => item.title),
    risks: (Array.isArray(parsed.risks) ? parsed.risks : []).filter((item) => typeof item === "string").slice(0, 3).map((item) => item.trim().slice(0, 300))
  };
}

export async function buildScenarioAnalytics(config, principal, options = {}) {
  const entities = Math.max(8, Math.min(80, Math.floor(Number(options.entities) || 24)));
  const seed = Math.max(0, Math.min(4294967295, Math.floor(Number(options.seed) || 42)));
  const runs = Math.max(2, Math.min(20, Math.floor(Number(options.runs) || 5)));
  const key = `${entities}:${seed}:${runs}:${config.orchestrator.enabled ? config.orchestrator.provider : "mock"}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now() && !options.refresh) return { ...cached.value, cached: true };
  const scenarios = [];
  for (const scenario of robotScenarios) scenarios.push(await simulateScenario(scenario, { entities, seed, runs }));
  const ranking = scoreScenarios(scenarios);
  const payload = { generatedAt: new Date().toISOString(), entities, seed, replications: runs, timeUnit: "seconds", scenarios, ranking, provider: config.orchestrator.enabled ? config.orchestrator.provider : "mock", joule: null, jouleError: null };
  try { payload.joule = await jouleAnalytics(config, principal, payload); }
  catch (error) { payload.jouleError = String(error.message || error).slice(0, 200); }
  cache.set(key, { value: payload, expires: Date.now() + TTL_MS });
  return { ...payload, cached: false };
}
