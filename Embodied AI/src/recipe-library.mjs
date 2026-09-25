// Recipe library: every routine planned in the Joule chat is kept as a reusable recipe
// (the same data the BAT + JSON export carries). Runs started from a recipe record their
// outcome, so the library learns which recipes move units fastest.
//
// Token budget, by design:
//   - ranking, the "best option" and all run metrics are computed locally (no model call);
//   - Joule is asked only for pattern-finding, with a compact per-recipe summary, low effort,
//     and the answer is cached by the library's state: same library, no new call;
//   - chat answers are cached per recipe and goal (see server.mjs): same question, no new call.

import crypto from "node:crypto";
import { complete, extractText, extractJson, usageSummary } from "../orchestrator.mjs";
import { safetyIdentifier } from "../auth.mjs";
import { validateRecipe } from "./routine-library.mjs";

export const SCENARIO_NAMES = {
  "autonomous-inspection": "Autonomous inspection",
  "adaptive-assembly": "Adaptive assembly",
  "autonomous-orchestration": "Autonomous orchestration",
  "warehouse-fulfillment": "Warehouse fulfillment"
};
const MAX_RUNS = 20;
const round = (value, digits = 1) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);

export const hash = (value) => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

// Record the outcome of a routine started from a recipe (newest first, capped).
export function recordRun(saved, { jobId, cycles = 1, result = null, error = null, cancelled = false, kpis = null }) {
  const units = (Number(saved.recipe.caseContext?.quantity) || 1) * cycles;
  const elapsedMs = Number(result?.elapsedMs) || null;
  const run = {
    jobId, at: new Date().toISOString(), status: result ? "complete" : cancelled ? "cancelled" : "failed",
    mode: saved.recipe.mode, cycles, units, elapsedMs,
    unitsPerHour: result && elapsedMs ? round(units / (elapsedMs / 3_600_000), 1) : null,
    orderToDispatchSeconds: kpis?.pickingAndOrderCycle?.orderToDispatchSeconds ?? null,
    error: error ? String(error).slice(0, 160) : null
  };
  saved.runs = [run, ...(saved.runs || [])].slice(0, MAX_RUNS);
  return run;
}

// Per-recipe stats computed locally (no tokens).
export function recipeStats(saved) {
  const runs = saved.runs || [], done = runs.filter((run) => run.status === "complete" && run.unitsPerHour != null);
  const rates = done.map((run) => run.unitsPerHour);
  return {
    runs: runs.length, completed: done.length, failed: runs.filter((run) => run.status === "failed").length, cancelled: runs.filter((run) => run.status === "cancelled").length,
    bestUnitsPerHour: rates.length ? Math.max(...rates) : null,
    avgUnitsPerHour: rates.length ? round(rates.reduce((a, b) => a + b, 0) / rates.length, 1) : null,
    lastStatus: runs[0]?.status || null, lastAt: runs[0]?.at || null
  };
}

export function listing(saved) {
  return {
    id: saved.id, source: saved.source || "chat", createdAt: saved.createdAt || null, uses: saved.uses || 1,
    scenarioName: SCENARIO_NAMES[saved.recipe.scenarioId] || saved.recipe.scenarioId,
    recipe: saved.recipe, stats: recipeStats(saved), runs: (saved.runs || []).slice(0, 5)
  };
}

// Deterministic ranking: fastest proven unit flow first, then fewer failures, then most used.
export function rankRecipes(items) {
  return [...items].sort((a, b) => (b.stats.bestUnitsPerHour ?? -1) - (a.stats.bestUnitsPerHour ?? -1)
    || a.stats.failed - b.stats.failed || (b.uses || 0) - (a.uses || 0)).map((item) => item.id);
}

// Compact summary for Joule: a few numbers per recipe, no free text from users.
export function compactSummary(items) {
  return items.slice(0, 24).map((item) => ({
    id: item.id, scenario: item.recipe.scenarioId, mode: item.recipe.mode, units: item.recipe.caseContext.quantity, rack: item.recipe.caseContext.rackState,
    uses: item.uses, runs: item.stats.runs, ok: item.stats.completed, failed: item.stats.failed, cancelled: item.stats.cancelled,
    bestUph: item.stats.bestUnitsPerHour, avgUph: item.stats.avgUnitsPerHour,
    dispatchS: item.runs.find((run) => run.orderToDispatchSeconds != null)?.orderToDispatchSeconds ?? null
  }));
}

// A Joule suggestion may only tweak recipe fields the planner already allows (mode, quantity)
// plus run options (cycles). Anything else is dropped.
export function applyVariant(recipe, variant = {}) {
  const next = { schemaVersion: 1, scenarioId: recipe.scenarioId, mode: recipe.mode, caseContext: { ...recipe.caseContext } };
  if (["assisted", "simulation"].includes(variant?.mode)) next.mode = variant.mode;
  const quantity = Number(variant?.quantity);
  if (Number.isInteger(quantity) && quantity >= 1 && quantity <= 10000) next.caseContext.quantity = quantity;
  const cycles = Number(variant?.cycles);
  return { recipe: validateRecipe(next), cycles: Number.isInteger(cycles) && cycles >= 1 && cycles <= 20 ? cycles : 1 };
}

const SYSTEM = [
  "You are Joule in the SAP Autonomous Operations Twin. You receive a compact library of reusable routine recipes and the measured outcome of their runs.",
  "Goal: find patterns that increase unit flow (units per hour, 'bestUph'/'avgUph') and pick the best options to run next. Consider mode (assisted pauses for human approval, simulation does not), units per run, failures and cancellations.",
  "Use ONLY the recipe ids given. A recommendation may propose a variant of that recipe changing only: mode ('assisted'|'simulation'), quantity (1-10000 units), cycles (1-20). If a recipe has no runs yet, say it needs a baseline run rather than guessing numbers.",
  "Never claim results that are not in the data. Nothing executes from your answer; a person starts each run.",
  "Respond ONLY with JSON: {\"summary\": string (max 50 words), \"patterns\": [string, max 4, each max 30 words], \"recommendations\": [{\"recipeId\": string, \"why\": string (max 30 words), \"variant\"?: {\"mode\"?: string, \"quantity\"?: integer, \"cycles\"?: integer}}] (max 3, best first)}. English only."
].join("\n");

const text = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

export async function jouleRecipeInsights(config, { items, principal, cache }) {
  const summary = compactSummary(items);
  const key = hash(summary);
  if (cache.has(key)) return { ...cache.get(key), cached: true };
  const ids = new Set(summary.map((item) => item.id));
  if (!config.orchestrator.enabled) return null;
  const model = config.orchestrator.primaryModel;
  const response = await complete(config, { system: SYSTEM, messages: [{ role: "user", content: JSON.stringify({ recipes: summary }) }], maxTokens: 700, model, effort: "low", safetyId: safetyIdentifier(principal) });
  const parsed = extractJson(extractText(response)) || {};
  const recommendations = (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).filter((rec) => ids.has(rec?.recipeId)).slice(0, 3).map((rec) => {
    const variant = {};
    if (["assisted", "simulation"].includes(rec.variant?.mode)) variant.mode = rec.variant.mode;
    if (Number.isInteger(rec.variant?.quantity) && rec.variant.quantity >= 1 && rec.variant.quantity <= 10000) variant.quantity = rec.variant.quantity;
    if (Number.isInteger(rec.variant?.cycles) && rec.variant.cycles >= 1 && rec.variant.cycles <= 20) variant.cycles = rec.variant.cycles;
    return { recipeId: rec.recipeId, why: text(rec.why, 240) || "Recommended by Joule.", variant: Object.keys(variant).length ? variant : null };
  });
  const out = {
    provider: config.orchestrator.provider, usage: usageSummary(response),
    summary: text(parsed.summary, 400) || "Joule reviewed the recipe library.",
    patterns: (Array.isArray(parsed.patterns) ? parsed.patterns : []).map((item) => text(item, 240)).filter(Boolean).slice(0, 4),
    recommendations, at: new Date().toISOString(), libraryKey: key
  };
  cache.clear(); cache.set(key, out); // only the latest library state is worth keeping
  return { ...out, cached: false };
}
