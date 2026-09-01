import { safetyIdentifier } from "./auth.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const terminal = new Set(["completed", "failed", "cancelled", "incomplete"]);

export function runtimeDescriptor(config) {
  return {
    orchestrator: config.orchestrator.primaryModel,
    reasoningEffort: config.orchestrator.reasoningEffort,
    fallback: config.orchestrator.fallbackModel,
    fallbackTrigger: ["safeguard", "provider_unavailable", "token_budget_exceeded", "step_limit_exceeded"],
    limits: { maxTokens: config.orchestrator.maxTokens, maxSteps: config.orchestrator.maxSteps, maxDelegations: config.orchestrator.maxDelegations },
    promptCaching: { enabled: true, key: config.orchestrator.promptCachePrefix, mode: "explicit", ttl: "30m", layout: "stable instructions first; dynamic scenario last" },
    transport: "local async job + SSE; OpenAI Responses background mode when enabled",
    liveTenantAccess: "disabled",
    provider: config.orchestrator.enabled ? "OpenAI Responses API" : "realistic mock"
  };
}

export function detectFallbackReason({ response, error, usage, steps, limits, forced }) {
  if (forced) return forced;
  const reason = response?.incomplete_details?.reason || response?.error?.code || error?.code;
  if (["content_filter", "safety", "identifier_blocked", "guardrail_triggered"].includes(reason)) return "safeguard";
  if (error && (Number(error.status) >= 500 || ["server_error", "service_unavailable", "timeout"].includes(error.code))) return "provider_unavailable";
  if (Number(usage?.total_tokens || 0) > limits.maxTokens) return "token_budget_exceeded";
  if (Number(steps || 0) > limits.maxSteps) return "step_limit_exceeded";
  return null;
}

function planFor(task) {
  const specialists = [
    ["goal-analyst", "Translate the goal into measurable DES and platform outcomes."],
    ["des-engine", "Design the event model, resources, queues, experiments, and reproducibility checks."],
    ["integration-mapper", "Map data products, adapters, schemas, and safe connection contracts."],
    ["governance-reviewer", "Check agent identity, human approvals, physical-action controls, evidence, and live-command denial."],
    ["ui-modeler", "Map the result into 2D/3D objects, cockpits, and operator interactions."]
  ];
  return specialists.slice(0, task.maxDelegations).map(([agent, objective], index) => ({ step: index + 1, agent, objective, status: "queued" }));
}

function promptInput(task, plan, fallbackReason = null) {
  const stable = `SAP Embodied AI simulation orchestrator. Analyze the business outcome, define bounded subtasks, delegate only to named specialists, and consolidate evidence. Never access live tenants or perform production writes. Respect ${task.maxTokens} output tokens, ${task.maxSteps} steps, and ${task.maxDelegations} delegations.`;
  const dynamic = fallbackReason === "safeguard"
    ? `A safeguard interrupted the primary route for this goal: ${task.goal}. Produce only a safe risk classification and compliant alternative plan; do not attempt to bypass the safeguard.`
    : `Current goal: ${task.goal}\nSpecialist plan: ${JSON.stringify(plan)}`;
  return [{ role: "system", content: [{ type: "input_text", text: stable, prompt_cache_breakpoint: { mode: "explicit" } }] }, { role: "user", content: [{ type: "input_text", text: dynamic }] }];
}

async function createBackgroundResponse(config, task, principal, plan, model, fallbackReason = null) {
  const response = await fetch(`${config.orchestrator.baseUrl}/responses`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.orchestrator.apiKey}` },
    body: JSON.stringify({
      model,
      reasoning: { effort: model === config.orchestrator.primaryModel ? config.orchestrator.reasoningEffort : "high" },
      input: promptInput(task, plan, fallbackReason),
      max_output_tokens: task.maxTokens,
      background: true,
      store: true,
      safety_identifier: safetyIdentifier(principal),
      prompt_cache_key: `${config.orchestrator.promptCachePrefix}:${principal.tenantId}`,
      prompt_cache_options: { mode: "explicit", ttl: "30m" }
    })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.error?.message || `OpenAI request failed: ${response.status}`); error.status = response.status; error.code = payload.error?.code || "provider_error"; throw error; }
  return payload;
}

async function pollResponse(config, response, emit) {
  const deadline = Date.now() + config.orchestrator.timeoutMs;
  let current = response;
  while (!terminal.has(current.status) && Date.now() < deadline) {
    await sleep(config.orchestrator.pollMs);
    const result = await fetch(`${config.orchestrator.baseUrl}/responses/${current.id}`, { headers: { Authorization: `Bearer ${config.orchestrator.apiKey}` } });
    current = await result.json();
    await emit({ type: "provider_status", providerId: current.id, status: current.status });
  }
  if (!terminal.has(current.status)) { const error = new Error("Provider timeout"); error.code = "timeout"; error.status = 504; throw error; }
  return current;
}

function textOutput(response) {
  return (response.output || []).flatMap((item) => item.content || []).filter((item) => item.type === "output_text").map((item) => item.text).join("\n");
}

export async function runAgentTask(config, task, principal, emit) {
  const plan = planFor(task);
  await emit({ type: "orchestrator_analysis", model: config.orchestrator.primaryModel, effort: config.orchestrator.reasoningEffort, goal: task.goal });
  for (const item of plan) { item.status = "launched"; await emit({ type: "specialist_launched", specialist: item.agent, step: item.step, objective: item.objective }); }
  if (!config.orchestrator.enabled) {
    const routeReason = detectFallbackReason({ forced: task.fallbackTest, limits: task, steps: plan.length, usage: { total_tokens: 0 } });
    if (routeReason) await emit({ type: "fallback_activated", from: config.orchestrator.primaryModel, to: config.orchestrator.fallbackModel, reason: routeReason, safetyMode: routeReason === "safeguard" ? "safe-review-only" : "continuation" });
    plan.forEach((item) => { item.status = "complete"; });
    return { mode: "mock", model: routeReason ? config.orchestrator.fallbackModel : config.orchestrator.primaryModel, fallbackReason: routeReason, plan, summary: `Bounded ${plan.length}-specialist plan consolidated for: ${task.goal}`, budgets: { tokens: task.maxTokens, steps: task.maxSteps, delegations: task.maxDelegations } };
  }
  let primary, fallbackReason = task.fallbackTest || null, providerError = null;
  try { primary = await pollResponse(config, await createBackgroundResponse(config, task, principal, plan, config.orchestrator.primaryModel), emit); }
  catch (error) { providerError = error; }
  fallbackReason ||= detectFallbackReason({ response: primary, error: providerError, usage: primary?.usage, steps: plan.length, limits: task });
  let final = primary, model = config.orchestrator.primaryModel;
  if (fallbackReason) {
    model = config.orchestrator.fallbackModel;
    await emit({ type: "fallback_activated", from: config.orchestrator.primaryModel, to: model, reason: fallbackReason, safetyMode: fallbackReason === "safeguard" ? "safe-review-only" : "continuation" });
    final = await pollResponse(config, await createBackgroundResponse(config, task, principal, plan, model, fallbackReason), emit);
  }
  plan.forEach((item) => { item.status = "complete"; });
  return { mode: "provider", model, fallbackReason, providerId: final?.id, status: final?.status, output: textOutput(final), usage: final?.usage || null, plan };
}
