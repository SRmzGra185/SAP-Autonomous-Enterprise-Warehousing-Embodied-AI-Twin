import assert from "node:assert/strict";
import { test } from "node:test";
import { recordRun, recipeStats, listing, rankRecipes, applyVariant, compactSummary, jouleRecipeInsights } from "../src/recipe-library.mjs";

const recipe = (mode, quantity) => ({ schemaVersion: 1, scenarioId: "warehouse-fulfillment", mode, caseContext: { sku: "DEMO-PUMP-KIT", rfidEpc: "3034257BF400B78000000001", quantity, destination: "DEMO-RECEIVING-01", rackState: "available" } });
const saved = (id, mode, quantity) => ({ id, recipe: recipe(mode, quantity), uses: 1, runs: [], source: "chat" });

test("runs record units per hour from the real elapsed time; failures carry no rate", () => {
  const item = saved("r1", "simulation", 4);
  recordRun(item, { jobId: "j1", cycles: 2, result: { elapsedMs: 36_000 } });
  recordRun(item, { jobId: "j2", cycles: 1, error: "stopped", cancelled: true });
  assert.equal(item.runs[0].status, "cancelled"); assert.equal(item.runs[0].unitsPerHour, null);
  assert.equal(item.runs[1].units, 8); assert.equal(item.runs[1].unitsPerHour, 800);
  const stats = recipeStats(item);
  assert.deepEqual([stats.runs, stats.completed, stats.cancelled, stats.bestUnitsPerHour], [2, 1, 1, 800]);
});

test("ranking puts the fastest proven unit flow first, untested recipes last", () => {
  const fast = saved("fast", "simulation", 4), slow = saved("slow", "assisted", 4), fresh = saved("fresh", "simulation", 10);
  recordRun(fast, { jobId: "a", cycles: 1, result: { elapsedMs: 10_000 } });
  recordRun(slow, { jobId: "b", cycles: 1, result: { elapsedMs: 120_000 } });
  assert.deepEqual(rankRecipes([fresh, slow, fast].map(listing)), ["fast", "slow", "fresh"]);
});

test("variants only change mode, quantity and cycles, and stay valid recipes", () => {
  const base = recipe("assisted", 4);
  const out = applyVariant(base, { mode: "simulation", quantity: 12, cycles: 3, scenarioId: "adaptive-assembly", sku: "HACK" });
  assert.equal(out.recipe.mode, "simulation"); assert.equal(out.recipe.caseContext.quantity, 12); assert.equal(out.cycles, 3);
  assert.equal(out.recipe.scenarioId, "warehouse-fulfillment"); assert.equal(out.recipe.caseContext.sku, "DEMO-PUMP-KIT");
  assert.equal(applyVariant(base, { quantity: 0, cycles: 99, mode: "live" }).recipe.mode, "assisted");
});

test("Joule sees only a compact numeric summary, and is not called without AI Core or for a cached library", async () => {
  const item = listing(saved("r1", "simulation", 4));
  assert.deepEqual(Object.keys(compactSummary([item])[0]).sort(), ["avgUph", "bestUph", "cancelled", "dispatchS", "failed", "id", "mode", "ok", "rack", "runs", "scenario", "units", "uses"].sort());
  assert.equal(await jouleRecipeInsights({ orchestrator: { enabled: false } }, { items: [item], principal: {}, cache: new Map() }), null);
  const cache = new Map(); const { hash } = await import("../src/recipe-library.mjs");
  cache.set(hash(compactSummary([item])), { summary: "cached", patterns: [], recommendations: [] });
  const cached = await jouleRecipeInsights({ orchestrator: { enabled: true } }, { items: [item], principal: {}, cache });
  assert.equal(cached.cached, true); assert.equal(cached.summary, "cached");
});
