import { complete, extractText, extractJson, usageSummary } from "../orchestrator.mjs";
import { validateCaseContext, rackStates } from "./routine-context.mjs";
import { safetyIdentifier } from "../auth.mjs";

const SCENARIO_IDS = ["autonomous-inspection", "adaptive-assembly", "autonomous-orchestration", "warehouse-fulfillment"];
const MODES = ["assisted", "simulation"];

const SYSTEM = [
  "You are Joule, the assistant of the SAP Autonomous Operations Twin (SAP Embodied AI Simulation Lab), running on SAP AI Core.",
  "The user states a goal in natural language. A deterministic local planner has ALREADY selected one of four predefined routines from explicit UI fields and built a recipe; you cannot change the recipe directly, only explain it and suggest field values the user may apply.",
  "Always answer in English, regardless of the goal's language. Tasks: (1) Explain what the selected routine will do step by step and whether it matches the goal; be concrete about robots, sensors and evidence. (2) If the goal explicitly states case values (SKU, RFID EPC hex, quantity, destination, rack state) or clearly asks for a different scenario or replay mode, return them as fieldSuggestions; never invent identifiers, and omit fields the goal does not state. (3) List up to 3 risks and up to 3 next actions.",
  "Hard rules: nothing executes from this conversation; no live robot commands; no production writes; assisted mode pauses for human approval in the app; never ask for credentials or URLs.",
  "Respond ONLY with a JSON object: {\"answer\": string (max 130 words), \"fieldSuggestions\": {\"scenarioId\"?: one of " + JSON.stringify(SCENARIO_IDS) + ", \"mode\"?: \"assisted\"|\"simulation\", \"sku\"?: string, \"rfidEpc\"?: hex string, \"quantity\"?: integer, \"destination\"?: string, \"rackState\"?: one of " + JSON.stringify(rackStates) + "} or null, \"risks\": string[], \"nextActions\": string[]}. No prose outside the JSON."
].join("\n");

const list = (value, max) => (Array.isArray(value) ? value : []).filter((item) => typeof item === "string" && item.trim()).slice(0, max).map((item) => item.trim().slice(0, 300));

function sanitizeSuggestions(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const out = {};
  if (SCENARIO_IDS.includes(input.scenarioId)) out.scenarioId = input.scenarioId;
  if (MODES.includes(input.mode)) out.mode = input.mode;
  const partial = {};
  for (const key of ["sku", "rfidEpc", "quantity", "destination", "rackState"]) {
    if (input[key] === undefined || input[key] === null || input[key] === "") continue;
    partial[key] = key === "quantity" ? Number(input[key]) : String(input[key]).trim();
  }
  if (Object.keys(partial).length) {
    try { const valid = validateCaseContext(partial); for (const key of Object.keys(partial)) out[key] = valid[key]; }
    catch { /* invalid case suggestions are dropped; the deterministic recipe is never touched */ }
  }
  return Object.keys(out).length ? out : null;
}

export async function jouleAssist(config, { request, plan, principal, emit }) {
  if (!config.orchestrator.enabled) return null;
  const model = config.orchestrator.primaryModel;
  await emit({ type: "planner_progress", stage: "aicore", model });
  const turn = {
    goal: request.goal,
    selected: { scenarioId: request.scenarioId, mode: request.mode, caseContext: request.caseContext },
    routineSteps: plan.expectedResult.steps, exceptionContext: plan.expectedResult.exceptionContext,
    availableScenarios: SCENARIO_IDS, replayModes: MODES, rackStates
  };
  try {
    const response = await complete(config, { system: SYSTEM, messages: [{ role: "user", content: JSON.stringify(turn) }], maxTokens: 1200, model, effort: config.orchestrator.effort, safetyId: safetyIdentifier(principal) });
    const parsed = extractJson(extractText(response)) || {};
    const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim().slice(0, 3500) : null;
    if (!answer) throw new Error("Joule returned no answer.");
    await emit({ type: "provider_status", providerId: response.id, status: response.stop_reason, usage: usageSummary(response) });
    return { provider: config.orchestrator.provider, model: response.model || model, usage: usageSummary(response), answer, fieldSuggestions: sanitizeSuggestions(parsed.fieldSuggestions), risks: list(parsed.risks, 3), nextActions: list(parsed.nextActions, 3) };
  } catch (error) {
    await emit({ type: "fallback_activated", from: model, to: "local deterministic answer", reason: "provider_unavailable", safetyMode: "continuation", detail: String(error.message || error).slice(0, 200) });
    return null;
  }
}

export function jouleDescriptor(config, base) {
  if (!config.orchestrator.enabled) return base;
  return { ...base, connected: true, status: "CONNECTED", llmCalls: true, assistant: "aicore", provider: "SAP AI Core · Generative AI Hub", model: config.orchestrator.primaryModel, fallbackModel: config.orchestrator.fallbackModel };
}
