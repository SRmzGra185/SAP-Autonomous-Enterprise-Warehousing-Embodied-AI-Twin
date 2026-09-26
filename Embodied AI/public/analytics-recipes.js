// Recipe library in Joule Analytics: every routine planned in the Joule chat, with the outcome of
// its runs (units per hour). Ranking and "best option" are computed on the server without any
// model call; "Find patterns with Joule" sends one compact summary and is cached by library state.
// Runs in simulation stay here and refresh the dashboard; assisted runs hand over to the twin,
// where each step waits for human approval.

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (value, digits = 0) => (Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "—");
const state = { data: null, busy: false };

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", Accept: "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function setStatus(text, tone = "") { const el = $("#libFoot"); el.textContent = text; el.className = `foot ${tone}`; }

function download(item) {
  const files = [["run-routine.bat", state.data.bat, "application/octet-stream"], ["routine.recipe.json", JSON.stringify(item.recipe, null, 2) + "\n", "application/json"]];
  for (const [name, text, type] of files) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a"); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  setStatus("Two downloads requested: run-routine.bat and routine.recipe.json. Nothing was executed.");
}

function renderUsage(usage) {
  const avoided = usage.jouleReused + usage.localPlans + usage.insightReused;
  $("#libUsage").innerHTML = `<span><b>${fmt(usage.jouleCalls + usage.insightCalls)}</b> Joule calls</span><span><b>${fmt(avoided)}</b> answers without a new Joule call</span><span>${fmt(usage.jouleReused)} reused · ${fmt(usage.localPlans)} local plans · ${fmt(usage.insightReused)} cached analyses</span>`;
}

function renderInsights(insights, error) {
  const box = $("#libInsightsBox");
  const ranking = state.data?.ranking || [];
  const byId = new Map((state.data?.recipes || []).map((item) => [item.id, item]));
  const localBest = ranking.map((id) => byId.get(id)).find((item) => item?.stats.bestUnitsPerHour != null);
  if (!insights) {
    if (!error && !localBest) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="ins-head"><i class="joule-icon" aria-hidden="true"></i><strong>${error ? "Joule unavailable" : "Local ranking"}</strong></div>
      <p>${error ? esc(error) + ". " : ""}${localBest ? `Best proven unit flow: <b>${esc(localBest.scenarioName)}</b> · ${esc(localBest.recipe.mode)} · ${fmt(localBest.stats.bestUnitsPerHour, 1)} units/h.` : "Run a recipe once to get a baseline."}</p>
      ${localBest ? `<button class="btn" data-run="${esc(localBest.id)}">Run best option</button>` : ""}`;
    return;
  }
  box.hidden = false;
  const recs = insights.recommendations.map((rec, index) => {
    const item = byId.get(rec.recipeId);
    const variant = rec.variant ? Object.entries(rec.variant).map(([key, value]) => `${key} ${value}`).join(" · ") : "as saved";
    return `<li><div><b>${index + 1}. ${esc(item?.scenarioName || rec.recipeId)}</b> <em>${esc(variant)}</em><span>${esc(rec.why)}</span></div><button class="btn ghost" data-run="${esc(rec.recipeId)}" data-variant='${esc(JSON.stringify(rec.variant || {}))}'>Run</button></li>`;
  }).join("");
  const best = insights.recommendations[0];
  box.innerHTML = `<div class="ins-head"><i class="joule-icon" aria-hidden="true"></i><strong>Joule · patterns in your recipes</strong><span class="tag ai">${insights.cached ? "reused · no new call" : "fresh analysis"}</span></div>
    <p>${esc(insights.summary)}</p>
    ${insights.patterns.length ? `<ul class="ins-patterns">${insights.patterns.map((pattern) => `<li>${esc(pattern)}</li>`).join("")}</ul>` : ""}
    ${recs ? `<ol class="ins-recs">${recs}</ol>` : ""}
    ${best ? `<button class="btn" data-run="${esc(best.recipeId)}" data-variant='${esc(JSON.stringify(best.variant || {}))}'>Run best option</button>` : ""}`;
}

function render() {
  const { recipes, ranking, usage, insights } = state.data;
  const order = new Map(ranking.map((id, index) => [id, index]));
  const items = [...recipes].sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
  const bestId = items.find((item) => item.stats.bestUnitsPerHour != null)?.id;
  $("#libSub").textContent = recipes.length ? `${recipes.length} recipe${recipes.length === 1 ? "" : "s"} · ranked by proven unit flow (units per hour), computed without Joule` : "Empty";
  $("#libEmpty").hidden = recipes.length > 0;
  $("#libTable").hidden = !recipes.length;
  $("#libInsights").disabled = !recipes.length || state.busy;
  renderUsage(usage);
  $("#libTable tbody").innerHTML = items.map((item) => {
    const last = item.runs[0];
    const lastText = last ? `${esc(last.status)}${last.unitsPerHour != null ? ` · ${fmt(last.unitsPerHour, 1)} u/h` : ""}` : "not run yet";
    return `<tr${item.id === bestId ? ' class="best"' : ""}>
      <td><b>${esc(item.scenarioName)}</b>${item.id === bestId ? ' <span class="chip">★ best</span>' : ""}<small>${esc(item.recipe.caseContext.sku)} → ${esc(item.recipe.caseContext.destination)} · rack ${esc(item.recipe.caseContext.rackState)} · ${esc(item.source)}</small></td>
      <td>${esc(item.recipe.mode)}</td><td class="num">${fmt(item.recipe.caseContext.quantity)}</td><td class="num">${fmt(item.uses)}</td>
      <td class="num">${fmt(item.stats.runs)}</td><td class="num">${item.stats.bestUnitsPerHour != null ? fmt(item.stats.bestUnitsPerHour, 1) : "—"}</td>
      <td>${lastText}</td>
      <td class="actions"><button class="btn ghost" data-run="${esc(item.id)}">Run</button><button class="btn ghost" data-download="${esc(item.id)}">BAT + JSON</button></td></tr>`;
  }).join("");
  if (insights && !$("#libInsightsBox").dataset.shown) { renderInsights({ ...insights, cached: true }); $("#libInsightsBox").dataset.shown = "1"; }
  else if (!insights && $("#libInsightsBox").hidden) renderInsights(null, null);
}

async function load() {
  try { state.data = await api("/api/recipes"); render(); }
  catch (error) { setStatus(`Recipe library unavailable: ${error.message}`, "neg"); }
}

async function watchJob(jobId) {
  for (let i = 0; i < 240; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const job = await api(`/api/jobs/${jobId}`);
    if (["complete", "failed", "cancelled"].includes(job.status)) return job;
    if (job.status === "awaiting_approval") return job;
  }
  return null;
}

async function run(recipeId, variant) {
  if (state.busy) return;
  state.busy = true; document.querySelectorAll("#recipe-library [data-run]").forEach((b) => { b.disabled = true; });
  try {
    const job = await api(`/api/recipes/${recipeId}/run`, { method: "POST", body: JSON.stringify({ variant: variant || {} }) });
    if (job.mode === "assisted") {
      setStatus("Queued in assisted mode · each step waits for your approval in the twin. Opening it…");
      setTimeout(() => window.location.assign("/"), 900);
      return;
    }
    setStatus("Running in simulation · nothing is written to SAP or robots…");
    const done = await watchJob(job.jobId);
    setStatus(done?.status === "complete" ? "Run complete · its unit flow is now in the library and the dashboard above." : `Run ${done?.status || "did not finish"}.`, done?.status === "complete" ? "pos" : "neg");
    await load();
    document.dispatchEvent(new CustomEvent("analytics:refresh"));
  } catch (error) { setStatus(error.message, "neg"); }
  finally { state.busy = false; document.querySelectorAll("#recipe-library [data-run]").forEach((b) => { b.disabled = false; }); }
}

async function findPatterns() {
  const button = $("#libInsights");
  button.disabled = true; setStatus("Joule is looking for patterns in your recipes…");
  try {
    const out = await api("/api/recipes/insights", { method: "POST", body: "{}" });
    state.data.usage = out.usage; state.data.ranking = out.ranking; renderUsage(out.usage);
    renderInsights(out.insights, out.error || (out.insights ? null : "Joule is not connected; showing the local ranking"));
    setStatus(out.insights?.cached ? "Same library as the last analysis · Joule's answer was reused (no new call)." : out.insights ? "Analysis ready. Recommendations are advisory; you start each run." : "Local ranking only.");
  } catch (error) { setStatus(error.message, "neg"); }
  finally { button.disabled = false; }
}

async function importFile(file) {
  if (!file) return;
  try {
    const recipe = JSON.parse(await file.text());
    const out = await api("/api/recipes/import", { method: "POST", body: JSON.stringify({ recipe }) });
    setStatus(out.reused ? "That recipe was already in the library." : `Imported · ${out.recipe.scenarioName} (${out.recipe.recipe.mode}).`, "pos");
    await load();
  } catch (error) { setStatus(error instanceof SyntaxError ? "That file is not valid JSON." : error.message, "neg"); }
  finally { $("#libImport").value = ""; }
}

document.addEventListener("DOMContentLoaded", () => {
  $("#libRefresh").addEventListener("click", load);
  $("#libInsights").addEventListener("click", findPatterns);
  $("#libImport").addEventListener("change", (event) => importFile(event.target.files[0]));
  $("#recipe-library").addEventListener("click", (event) => {
    const runButton = event.target.closest("[data-run]");
    if (runButton) { let variant = {}; try { variant = JSON.parse(runButton.dataset.variant || "{}"); } catch { /* as saved */ } return run(runButton.dataset.run, variant); }
    const dl = event.target.closest("[data-download]");
    if (dl) { const item = state.data.recipes.find((recipe) => recipe.id === dl.dataset.download); if (item) download(item); }
  });
  load();
  document.addEventListener("joule:recipe", () => load()); // the planner just saved or reused a recipe
  // new recipes appear as the chat plans them (cheap GET, only while the page is visible)
  setInterval(() => { if (!document.hidden && !state.busy) load(); }, 10000);
});
