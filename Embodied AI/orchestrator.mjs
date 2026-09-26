import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { OrchestrationClient } from "@sap-ai-sdk/orchestration";
import { safetyIdentifier } from "./auth.mjs";

let anthropicClient = null;
const anthropic = (config) => (anthropicClient ||= new Anthropic({ apiKey: config.orchestrator.apiKey, baseURL: config.orchestrator.baseUrl, timeout: config.orchestrator.timeoutMs, maxRetries: 1 }));

export function runtimeDescriptor(config) {
  const o = config.orchestrator;
  const provider = o.provider === "aicore" ? `SAP AI Core · Generative AI Hub orchestration · resource group ${o.resourceGroup}` : o.provider === "anthropic" ? `Anthropic Messages API via ${new URL(o.baseUrl).host}` : "realistic mock";
  return {
    provider: o.enabled ? provider : "realistic mock",
    providerId: o.enabled ? o.provider : "mock",
    orchestrator: o.primaryModel,
    reasoningEffort: o.effort,
    fallback: o.fallbackModel,
    fallbackTrigger: ["safeguard", "provider_unavailable", "token_budget_exceeded", "step_limit_exceeded"],
    limits: { maxTokens: o.maxTokens, maxSteps: o.maxSteps, maxDelegations: o.maxDelegations },
    promptCaching: { enabled: true, key: o.promptCachePrefix, mode: "ephemeral", layout: "stable system prompt first; scenario and tenant context last" },
    transport: o.provider === "aicore" ? "local async job + SSE; AI Core orchestration /completion when enabled" : "local async job + SSE; Anthropic Messages API when enabled",
    liveTenantAccess: "disabled"
  };
}

const errorStatus = (error) => Number(error?.status ?? error?.cause?.response?.status ?? error?.response?.status ?? 0);
const errorDetail = (error) => error?.cause?.response?.data?.error?.message || error?.response?.data?.error?.message || error?.message || String(error);
export const isAuthError = (error) => error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError || [401, 403].includes(errorStatus(error));

export function detectFallbackReason({ response, error, usage, steps, limits, forced }) {
  if (forced) return forced;
  if (response?.stop_reason === "refusal") return "safeguard";
  if (error) {
    const status = errorStatus(error);
    if (error instanceof Anthropic.PermissionDeniedError || (status === 400 && /filter|blocked|policy/i.test(errorDetail(error)))) return "safeguard";
    if (error instanceof Anthropic.RateLimitError || error instanceof Anthropic.APIConnectionError || status === 0 || status >= 500 || [408, 409, 429].includes(status)) return "provider_unavailable";
  }
  if (response?.stop_reason === "max_tokens" || Number(usage?.output ?? usage?.output_tokens ?? 0) > limits.maxTokens) return "token_budget_exceeded";
  if (Number(steps || 0) > limits.maxSteps) return "step_limit_exceeded";
  return null;
}

const compatibilityError = (error) => error instanceof Anthropic.BadRequestError && /thinking|output_config|effort|cache_control|metadata/i.test(error.message);

// Message content is a string, or an array of { type: "text", text } and { type: "image", url }
// (url = "data:image/jpeg;base64,…") for vision requests; each provider gets its own shape.
const contentParts = (content) => (Array.isArray(content) ? content : [{ type: "text", text: String(content ?? "") }]);
function anthropicContent(content) {
  if (!Array.isArray(content)) return content;
  return content.map((part) => {
    if (part.type !== "image") return { type: "text", text: String(part.text ?? "") };
    const [, mediaType, data] = String(part.url).match(/^data:(image\/[a-z]+);base64,(.+)$/) || [];
    if (!data) throw new Error("Images must be base64 data URIs.");
    return { type: "image", source: { type: "base64", media_type: mediaType, data } };
  });
}

async function completeAnthropic(config, { system, messages, maxTokens, model, effort, safetyId }) {
  const base = { model, max_tokens: maxTokens, messages: messages.map((message) => ({ role: message.role, content: anthropicContent(message.content) })) };
  const request = { ...base, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], metadata: { user_id: safetyId }, ...(config.orchestrator.thinking ? { thinking: { type: "adaptive" }, output_config: { effort } } : {}) };
  let response;
  try { response = await anthropic(config).messages.create(request); }
  catch (error) { if (!compatibilityError(error)) throw error; response = await anthropic(config).messages.create({ ...base, system }); }
  const usage = response.usage || {};
  return { id: response.id, provider: "anthropic", model: response.model || model, stop_reason: response.stop_reason, text: (response.content || []).filter((block) => block.type === "text").map((block) => block.text).join("\n").trim(), usage: { input: usage.input_tokens || 0, output: usage.output_tokens || 0, cacheRead: usage.cache_read_input_tokens || 0, cacheWrite: usage.cache_creation_input_tokens || 0 } };
}

const finishReasonMap = { stop: "end_turn", length: "max_tokens", content_filter: "refusal" };

async function completeAiCore(config, { system, messages, maxTokens, model }) {
  const client = new OrchestrationClient({ promptTemplating: { model: { name: model, params: { max_tokens: maxTokens } } } }, { resourceGroup: config.orchestrator.resourceGroup });
  // Content travels through placeholders so JSON braces never collide with the {{?placeholder}} templating syntax.
  // Images go as image_url parts (data URIs never contain braces); their text parts still use placeholders.
  const placeholderValues = { sys: system };
  const templated = messages.map((message, index) => {
    if (!Array.isArray(message.content)) { placeholderValues[`m${index}`] = String(message.content); return { role: message.role, content: `{{?m${index}}}` }; }
    return { role: message.role, content: contentParts(message.content).map((part, n) => {
      if (part.type === "image") return { type: "image_url", image_url: { url: String(part.url) } };
      placeholderValues[`m${index}_${n}`] = String(part.text ?? ""); return { type: "text", text: `{{?m${index}_${n}}}` };
    }) };
  });
  const response = await client.chatCompletion({ messages: [{ role: "system", content: "{{?sys}}" }, ...templated], placeholderValues });
  const usage = response.getTokenUsage?.() || {}, finish = response.getFinishReason?.() || "stop";
  return { id: `aicore_${response.rawResponse?.data?.request_id || crypto.randomUUID()}`, provider: "aicore", model, stop_reason: finishReasonMap[finish] || finish, text: (response.getContent?.() || "").trim(), usage: { input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0, cacheRead: usage.prompt_tokens_details?.cached_tokens || 0, cacheWrite: usage.prompt_tokens_details?.cache_creation_tokens || 0 } };
}

export async function complete(config, request) {
  return config.orchestrator.provider === "aicore" ? completeAiCore(config, request) : completeAnthropic(config, request);
}

export function extractText(response) { return response?.text || ""; }
export function usageSummary(response) { return response?.usage || null; }

export function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through to substring scan */ }
  const start = cleaned.indexOf("{"), end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
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

const ORCHESTRATOR_SYSTEM = [
  "You are Joule, the orchestrator of the SAP Embodied AI Simulation Lab: a bounded, auditable discrete-event simulation (DES) and robot-orchestration workbench for SAP Business Data Cloud, S/4HANA and Extended Warehouse Management scenarios.",
  "Hard rules: never access live tenants, never perform production writes, never issue live robot commands. Only simulation, shadow and assisted modes exist. Delegate only to the named specialists you are given and consolidate their evidence.",
  "Respond ONLY with a JSON object, no prose before or after, with this shape:",
  "Always write in English, regardless of the goal's language.",
  "{\"summary\": string (max 80 words), \"risks\": string[] (max 4), \"specialists\": [{\"agent\": string (exact name from the plan), \"findings\": string (max 60 words), \"status\": \"complete\" | \"blocked\"}], \"nextActions\": string[] (max 5)}"
].join("\n");

function modelContext(model) {
  if (!model?.nodes?.length) return null;
  return { id: model.id, name: model.name, layout: model.layout, nodes: model.nodes.map((node) => ({ id: node.id, name: node.name, kind: node.kind, layer: node.layer || "platform", capacity: node.capacity, service: node.service })), edges: (model.edges || []).length };
}

function userTurn(task, plan, context, fallbackReason) {
  const budgets = `Budgets: ${task.maxTokens} output tokens, ${task.maxSteps} steps, ${task.maxDelegations} delegations.`;
  if (fallbackReason === "safeguard") return `A safeguard interrupted the primary route for this goal: ${task.goal}\n${budgets}\nProduce only a safe risk classification and a compliant alternative plan; do not attempt to bypass the safeguard.\nSpecialist plan: ${JSON.stringify(plan)}`;
  const scenario = context.scenario ? { id: context.scenario.id, name: context.scenario.name, domain: context.scenario.domain, objective: context.scenario.objective } : null;
  return `Goal: ${task.goal}\n${budgets}\nSpecialist plan: ${JSON.stringify(plan)}\nActive scenario: ${JSON.stringify(scenario)}\nTwin model: ${JSON.stringify(modelContext(context.model))}`;
}

function mergeFindings(plan, parsed) {
  const byAgent = new Map((parsed?.specialists || []).filter((item) => item && typeof item.agent === "string").map((item) => [item.agent.toLowerCase(), item]));
  for (const item of plan) {
    const finding = byAgent.get(item.agent.toLowerCase());
    item.status = finding?.status === "blocked" ? "blocked" : "complete";
    if (finding?.findings) item.findings = String(finding.findings).slice(0, 600);
  }
}

export async function runAgentTask(config, task, principal, emit, context = {}) {
  const plan = planFor(task);
  await emit({ type: "orchestrator_analysis", model: config.orchestrator.primaryModel, effort: config.orchestrator.effort, provider: config.orchestrator.provider, goal: task.goal });
  for (const item of plan) { item.status = "launched"; await emit({ type: "specialist_launched", specialist: item.agent, step: item.step, objective: item.objective }); }
  if (!config.orchestrator.enabled) {
    const routeReason = detectFallbackReason({ forced: task.fallbackTest, limits: task, steps: plan.length, usage: { output: 0 } });
    if (routeReason) await emit({ type: "fallback_activated", from: config.orchestrator.primaryModel, to: config.orchestrator.fallbackModel, reason: routeReason, safetyMode: routeReason === "safeguard" ? "safe-review-only" : "continuation" });
    plan.forEach((item) => { item.status = "complete"; });
    return { mode: "mock", model: routeReason ? config.orchestrator.fallbackModel : config.orchestrator.primaryModel, fallbackReason: routeReason, plan, summary: `Bounded ${plan.length}-specialist plan consolidated for: ${task.goal}`, budgets: { tokens: task.maxTokens, steps: task.maxSteps, delegations: task.maxDelegations } };
  }

  const safetyId = safetyIdentifier(principal);
  const call = (model, effort, fallbackReason = null) => complete(config, { system: ORCHESTRATOR_SYSTEM, messages: [{ role: "user", content: userTurn(task, plan, context, fallbackReason) }], maxTokens: task.maxTokens, model, effort, safetyId });

  let primary = null, providerError = null, fallbackReason = task.fallbackTest || null;
  if (!fallbackReason) {
    try { primary = await call(config.orchestrator.primaryModel, config.orchestrator.effort); await emit({ type: "provider_status", providerId: primary.id, status: primary.stop_reason, usage: primary.usage }); }
    catch (error) { providerError = error; }
  }
  fallbackReason ||= detectFallbackReason({ response: primary, error: providerError, usage: primary?.usage, steps: plan.length, limits: task });
  if (providerError && !fallbackReason) throw new Error(`LLM provider error: ${errorDetail(providerError).slice(0, 300)}`);

  let final = primary, model = config.orchestrator.primaryModel;
  if (fallbackReason) {
    model = config.orchestrator.fallbackModel;
    await emit({ type: "fallback_activated", from: config.orchestrator.primaryModel, to: model, reason: fallbackReason, safetyMode: fallbackReason === "safeguard" ? "safe-review-only" : "continuation", detail: providerError ? errorDetail(providerError).slice(0, 200) : undefined });
    final = await call(model, "medium", fallbackReason);
    await emit({ type: "provider_status", providerId: final.id, status: final.stop_reason, usage: final.usage });
  }

  const output = extractText(final), parsed = extractJson(output);
  mergeFindings(plan, parsed);
  return {
    mode: "provider", provider: config.orchestrator.provider, model, fallbackReason, providerId: final?.id, status: final?.stop_reason, output, usage: final?.usage || null, plan,
    summary: typeof parsed?.summary === "string" ? parsed.summary : output.slice(0, 400),
    risks: Array.isArray(parsed?.risks) ? parsed.risks.slice(0, 4).map(String) : [],
    nextActions: Array.isArray(parsed?.nextActions) ? parsed.nextActions.slice(0, 5).map(String) : []
  };
}
