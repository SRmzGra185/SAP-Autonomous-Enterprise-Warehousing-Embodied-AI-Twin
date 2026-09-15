import crypto from "node:crypto";

const cache = new Map();
const ttlMs = 30 * 60 * 1000;
export function operationsRuntimeDescriptor(config) {
  return {
    provider: "Local deterministic planner; Joule not connected",
    orchestrator: "Joule coordination simulation", fallback: "Stop and request human review",
    transport: "background jobs + SSE", liveTenantAccess: "disabled",
    limits: { maxTokens: config.orchestrator.maxTokens, maxSteps: config.orchestrator.maxSteps, maxDelegations: config.orchestrator.maxDelegations },
    promptCaching: { enabled: false, reason: "No model API is called. A bounded tenant-scoped local plan cache is used; provider prompt caching requires a supported integration." },
    fallbackTrigger: ["policy_review_required", "budget_exceeded"]
  };
}

export async function runOperationsPlan(task, principal, scenario, emit) {
  await emit({ type: "orchestrator_analysis", model: "Local planner · Joule simulation", goal: task.goal, simulated: true });
  if (task.fallbackTest) {
    return { mode: "simulation", plan: [], summary: "Execution stopped for human review. No safety refusal is routed to another model.", productionCommands: false, reason: task.fallbackTest };
  }
  const key = crypto.createHash("sha256").update(JSON.stringify([principal.tenantId, principal.userId, scenario.id, task])).digest("hex");
  const cached = cache.get(key), cacheHit = Boolean(cached && cached.expires > Date.now());
  const templates = [
    ["BDC Connect contract review", "Inspect local sample product metadata and tenant scope; no data sharing is performed."],
    [scenario.assistants[0], scenario.objective],
    ["Routine controller", "Select the pre-established GRAFCET routine. Assisted mode must receive approval before every simulated command."],
    ["Evidence reviewer", "Review sensor samples and ordered events, then export the trace. Do not confirm any real business transaction."]
  ];
  const count = Math.min(task.maxSteps, task.maxDelegations, templates.length);
  const plan = cacheHit ? structuredClone(cached.plan) : templates.slice(0, count).map(([agent, objective], index) => ({ step: index + 1, agent, objective, status: "planned", simulated: true }));
  if (!cacheHit) {
    for (const [id, entry] of cache) if (entry.expires <= Date.now()) cache.delete(id);
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(key, { plan: structuredClone(plan), expires: Date.now() + ttlMs });
  }
  for (const item of plan) await emit({ type: "specialist_launched", specialist: item.agent, step: item.step, objective: item.objective, disposition: "local_plan_only", simulated: true });
  return {
    mode: "simulation", scenarioId: scenario.id, plan, cacheHit,
    summary: `Local plan for ${scenario.name}: ${plan.length} steps prepared, not executed. Use Run routine to simulate; Assisted pauses for approval. Joule is not connected.`,
    usage: { modelCalls: 0, tokens: 0 }, budgets: { tokens: task.maxTokens, steps: task.maxSteps, delegations: task.maxDelegations },
    productionCommands: false
  };
}
