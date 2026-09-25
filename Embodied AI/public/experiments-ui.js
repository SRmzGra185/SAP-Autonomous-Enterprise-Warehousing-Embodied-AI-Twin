// Independent subscription: never changes the twin or consumes its events.
export function modelSignature(model) {
  return JSON.stringify({ id: model?.id, name: model?.name, version: model?.version,
    scenario: model?.activeScenarioId, route: model?.executionRoute,
    nodes: model?.nodes?.map(({ id, name, capacity, service, kind, layer, visual }) =>
      ({ id, name, capacity, service, kind, layer, visual })) });
}
export function effectiveCapacity(profile, model, nodeId) {
  const entry = profile?.nodes?.find(node => node.nodeId === nodeId);
  return entry?.capacity !== undefined ? entry.capacity : model?.nodes?.find(node => node.id === nodeId)?.capacity;
}
export function withCapacity(profile, nodeId, capacity) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 32) throw new Error("Candidate capacity must be a whole number from 1 to 32.");
  if (!Array.isArray(profile?.nodes) || !profile.nodes.some(node => node.nodeId === nodeId)) throw new Error("Selected resource is missing from the candidate profile. Review its JSON.");
  const copy = structuredClone(profile);
  copy.nodes.find(node => node.nodeId === nodeId).capacity = capacity;
  return copy;
}
export function isPaired(a, b) {
  return Array.isArray(a.replications) && a.replications.length > 0 &&
    a.replications.length === b.replications?.length && a.timing?.entityUnit === b.timing?.entityUnit &&
    a.replications.every((r, i) => Number.isInteger(r.seed) && r.seed === b.replications[i].seed &&
      Number.isFinite(r.completed) && r.completed === b.replications[i].completed);
}

// getModel returns the saved server model. The optional callback receives a
// detached scenario profile, not a reference to the model or an instruction to save.
export function initExperimentsUI({ api, getModel, onCapacityChange, beforeRun = async () => {}, onRunningChange = () => {} } = {}) {
  const root = document.querySelector("#industrial-experiments");
  if (!root) return { loadTemplate() {}, refreshModel() {}, destroy() {} };
  root.innerHTML = `<div class="ix-heading"><div><span class="ix-eyebrow">Scenario planning</span><h2>Industrial timing experiments</h2></div><span class="ix-badge">Simulation only</span></div>
    <p>Would more capacity reduce waiting? Compare today’s setup with a candidate, without changing the saved model or running equipment.</p>
    <div class="ix-controls"><button type="button" data-action="template">Load current model template</button><span data-output="profile-source">Start with a template or import a timing profile below.</span></div>
    <div class="ix-notice" data-output="stale" hidden><p>The model changed. Your profiles are preserved. Reload a template, or explicitly keep these profiles for the current model; the server will validate them.</p><button type="button" data-action="keep">Keep profiles for current model</button></div>
    <div class="ix-notice" data-output="confirm" hidden><p>Replace both profile drafts with a fresh baseline template? Candidate edits will be cleared.</p><div class="ix-controls"><button type="button" data-action="replace">Replace drafts</button><button type="button" data-action="cancel">Keep editing</button></div></div>
    <div class="ix-scenario"><label>Resource to test<select data-input="resource" aria-describedby="ix-capacity-help"><option value="">Load a profile first</option></select></label><div class="ix-baseline"><span>Baseline capacity</span><strong data-output="baseline-capacity">—</strong><small data-output="capacity-source">Saved model unless the profile overrides it</small></div><label>Candidate capacity<input data-input="capacity" type="number" min="1" max="32" step="1" aria-describedby="ix-capacity-help" placeholder="1–32"></label></div>
    <p id="ix-capacity-help" class="ix-help">Capacity = how many units this resource can handle at once (1–32). Changing it creates or updates the candidate JSON only. Other profile overrides stay intact.</p>
    <div class="ix-controls ix-run-controls"><label>Units per test<input data-input="entities" type="number" min="1" max="80" step="1" value="24"></label><label>Repeated tests<input data-input="runs" type="number" min="1" max="200" step="1" value="20"></label><button type="button" data-action="run">Validate & run comparison</button></div>
    <details class="ix-details"><summary>Timing profiles & advanced settings</summary><p>Templates contain synthetic DEMO times. “Observed” means user-declared, not verified. All times are seconds per declared handling unit; animation speed is separate.</p>
      <div class="ix-controls"><label>Import baseline JSON<input type="file" accept=".json,application/json" data-input="file"></label><label>Random seed<input data-input="seed" type="number" min="0" max="4294967295" step="1" value="42"></label><button type="button" data-action="clear">Remove candidate</button></div>
      <div class="ix-editors"><label>Baseline profile JSON<textarea data-input="baseline" spellcheck="false" rows="12" aria-label="Baseline experiment JSON"></textarea></label><label>Candidate profile JSON (optional)<textarea data-input="candidate" spellcheck="false" rows="12" aria-label="Candidate experiment JSON" placeholder="Use the capacity field above, or paste a modified baseline."></textarea></label></div>
      <details><summary>How timing is calculated</summary><p>Process distributions: fixed {type,value}, triangular {type,min,mode,max}, empirical {type,samples}. Optional capacity: 1–32. setupOncePerResource=true charges setup on first use of each resource in each repeated test; false charges every unit on every visit. Handling, travel and approval occupy that same resource per unit per visit. Repeated visits share the resource pool and timing profile. Do not add queue delays: the simulation measures them.</p></details>
    </details><p data-output="status" role="status" aria-live="polite">Load a template to begin. Both profiles are validated by the server when run.</p><div data-output="results" aria-label="Experiment results"></div>`;
  const input = name => root.querySelector(`[data-input="${name}"]`), out = name => root.querySelector(`[data-output="${name}"]`), action = name => root.querySelector(`[data-action="${name}"]`);
  const streams = new Map();
  let disposed = false, running = false, signature = modelSignature(getModel?.()), stale = false;
  const setStatus = text => { if (!disposed) out("status").textContent = text; };
  const num = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—";
  const add = (parent, tag, text, className) => { const el = document.createElement(tag); el.textContent = text ?? ""; if (className) el.className = className; parent.append(el); return el; };
  const parse = name => {
    try { return JSON.parse(input(name).value); }
    catch { throw new Error(`${name === "baseline" ? "Baseline" : "Candidate"} JSON is invalid. Open Timing profiles & advanced settings to review it.`); }
  };
  function lock(value) {
    running = value; root.querySelectorAll("button,input,textarea,select").forEach(el => { el.disabled = value; });
    if (!value) syncCapacity();
  }
  function syncCapacity() {
    if (disposed) return;
    let baseline, candidate;
    try { baseline = parse("baseline"); candidate = input("candidate").value.trim() ? parse("candidate") : null; }
    catch { input("capacity").disabled = true; out("baseline-capacity").textContent = "—"; out("capacity-source").textContent = "Review profile JSON to edit capacity"; return; }
    if (!Array.isArray(baseline?.nodes) || baseline.nodes.some(n => !n || typeof n !== "object") || (candidate && (!Array.isArray(candidate.nodes) || candidate.nodes.some(n => !n || typeof n !== "object")))) { input("capacity").disabled = true; out("baseline-capacity").textContent = "—"; return; }
    const model = getModel?.(), previous = input("resource").value;
    input("resource").replaceChildren();
    for (const node of baseline.nodes) {
      if (!node || typeof node.nodeId !== "string") continue;
      const named = model?.nodes?.find(n => n.id === node.nodeId);
      const option = add(input("resource"), "option", named?.name ? `${named.name} (${node.nodeId})` : node.nodeId); option.value = node.nodeId;
    }
    if ([...input("resource").options].some(option => option.value === previous)) input("resource").value = previous;
    const id = input("resource").value;
    out("baseline-capacity").textContent = num(effectiveCapacity(baseline, model, id));
    out("capacity-source").textContent = baseline.nodes.find(n => n?.nodeId === id)?.capacity !== undefined ? "Baseline profile override" : "From the currently saved model";
    input("capacity").value = effectiveCapacity(candidate || baseline, model, id) ?? "";
    input("capacity").disabled = running || stale || !id;
    out("profile-source").textContent = `${baseline.source === "observed" ? "User-declared observations · unverified" : "Synthetic DEMO timing · not measured"} · ${baseline.entityUnit || "handling unit not declared"}`;
  }
  function refreshModel() {
    if (disposed) return false;
    const next = modelSignature(getModel?.());
    if (next !== signature) {
      if (input("baseline").value.trim() || input("candidate").value.trim()) stale = true; else signature = next;
      out("stale").hidden = !stale; syncCapacity();
    }
    return stale;
  }
  function acknowledgeModel() { signature = modelSignature(getModel?.()); stale = false; out("stale").hidden = true; syncCapacity(); }
  async function load(replace = false) {
    if (running || disposed) return;
    refreshModel();
    if (!replace && (input("baseline").value.trim() || input("candidate").value.trim())) { out("confirm").hidden = false; return; }
    const requestedSignature = modelSignature(getModel?.());
    out("confirm").hidden = true; lock(true); setStatus("Loading current model template…");
    try {
      const data = await api("/api/experiment-template"); if (disposed) return;
      if (requestedSignature !== modelSignature(getModel?.())) throw new Error("Model changed while loading. Drafts preserved; load the template again.");
      input("baseline").value = JSON.stringify(data, null, 2); input("candidate").value = "";
      acknowledgeModel(); out("results").replaceChildren();
      setStatus(`Synthetic template loaded for ${getModel?.()?.name ?? "current model"}. Choose a resource and candidate capacity, or run the baseline alone.`);
    } catch (e) { setStatus(e.message); }
    finally { if (!disposed) { refreshModel(); lock(false); } }
  }
  function render(title, s) {
    if (disposed) return;
    const section = add(out("results"), "section", "", "ix-result"); add(section, "h3", title);
    add(section, "p", `${s.timing?.source === "observed" ? "User-declared observations (unverified)" : "Synthetic DEMO assumptions"} · ${s.runs ?? "—"} repeated tests · per ${s.timing?.entityUnit ?? "unit"}`, "ix-help");
    const cards = add(section, "div", "", "ix-summary-grid");
    for (const [label, value, note] of [["Average time per unit", `${num(s.averageCycle)} s`, "Processing and waiting; average across tests"], ["Output per hour", num(s.throughputPerHour), "Simulated units/hour; average across tests"], ["Average waiting per unit", `${num(s.averageQueuedSeconds)} s`, "Time spent in resource queues"], ["Units completed", num(s.completed), "Per repeated test"]]) {
      const card = add(cards, "div", "", "ix-card"); add(card, "span", label); add(card, "strong", value); add(card, "small", note);
    }
    const details = add(section, "details", "", "ix-details"); add(details, "summary", "Full results, assumptions & technical JSON");
    const table = add(details, "table", ""); add(table, "caption", `${title} — detailed simulation results`);
    const row = (label, value) => { const tr = add(table, "tr", ""); add(tr, "th", label).scope = "row"; add(tr, "td", value); };
    row("Average test duration (seconds)", num(s.elapsedSeconds));
    row("Median / 95th percentile of test-average times (seconds)", `${num(s.replicationMeanCycleSeconds?.p50)} / ${num(s.replicationMeanCycleSeconds?.p95)}`);
    const ci = s.replicationMeanCycleSeconds?.ci95;
    row("95% confidence interval for expected average time (seconds)", `${num(ci?.lower)} – ${num(ci?.upper)}`); add(details, "p", ci?.method ?? "Confidence interval unavailable");
    row(`Individual-unit 95th percentile (seconds): ${s.orderP95Scope ?? "scope unavailable"}`, num(s.orderP95CycleSeconds));
    row("Average total queue time per test (seconds)", num(s.queuedSeconds));
    for (const [id, n] of Object.entries(s.nodeMetrics || {})) row(`${id}: capacity / occupied utilization / total queued seconds`, `${num(n.capacity)} / ${num(Number.isFinite(n.utilization) ? n.utilization * 100 : null)}% / ${num(n.queuedSeconds)}`);
    add(details, "p", `${s.timing?.nodeCount ?? "—"} unique resources / ${s.timing?.routeVisitCount ?? "—"} route visits / ${s.timing?.empiricalSampleCount ?? "—"} empirical samples. Source: ${s.timing?.sourceReference ?? "none"}. Setup: ${s.timing?.setupPolicy ?? "not reported"}.`);
    add(details, "p", "User-entered performance observations are separate from simulation and never inferred from simulated counts.");
    for (const field of ["availability", "performance", "quality", "oee", "mtbfSeconds", "mttrSeconds"]) row(`User-entered ${field} (${field.endsWith("Seconds") ? "seconds" : "fraction"})`, num(s.observedKpis?.[field]));
    for (const warning of [...(s.timing?.warnings || []), ...(s.observedKpis?.warnings || [])]) add(details, "p", warning, "ix-warning");
    const raw = add(details, "details", ""); add(raw, "summary", "Raw result JSON"); add(raw, "pre", JSON.stringify(s, null, 2));
  }
  function compare(a, b) {
    const section = document.createElement("section"); section.className = "ix-comparison"; out("results").prepend(section); add(section, "h3", "What changed?");
    const paired = isPaired(a, b);
    add(section, "p", paired ? "Same seeds and completed unit counts. Change = candidate minus baseline; this does not establish statistical significance." : "Pairing unavailable or handling units differ. Review the profiles before drawing conclusions.");
    const table = add(section, "table", ""); add(table, "caption", "Baseline versus candidate");
    const header = add(table, "tr", ""); for (const label of ["Measure", "Baseline", "Candidate", "Change"]) add(header, "th", label).scope = "col";
    for (const [label, field] of [["Average time per unit (s)", "averageCycle"], ["Output per hour", "throughputPerHour"], ["Waiting per unit (s)", "averageQueuedSeconds"]]) {
      const row = add(table, "tr", ""); add(row, "th", label).scope = "row"; add(row, "td", num(a[field])); add(row, "td", num(b[field]));
      const delta = paired && Number.isFinite(a[field]) && Number.isFinite(b[field]) ? b[field] - a[field] : null; add(row, "td", `${delta > 0 ? "+" : ""}${num(delta)}`);
    }
    add(section, "p", "Lower time and waiting mean faster simulated flow; higher output means more simulated units/hour. Compare the same route and handling unit. Production capacity is unchanged.", "ix-help");
  }
  function watch(job, label) {
    return new Promise((resolve, reject) => {
      const source = new EventSource(job.events); let settled = false;
      const finish = (error, result) => { if (settled) return; settled = true; clearTimeout(timer); source.close(); streams.delete(source); error ? reject(error) : resolve(result); };
      const timer = setTimeout(() => finish(new Error(`${label}: stream timed out; server job may still be running (${job.jobId}).`)), 300000);
      streams.set(source, () => finish(new Error("Experiment panel closed; server job may still be running.")));
      const handle = event => {
        try {
          const p = JSON.parse(event.data);
          if (p.type === "monte_carlo_run") setStatus(`${label}: ${p.run}/${p.runs} repeated tests`);
          if (p.type === "simulation_complete") finish(null, p.summary);
          if (p.type === "job_complete") finish(null, p.result);
          if (["job_failed", "job_cancelled"].includes(p.type)) finish(new Error(p.error || p.type));
        } catch (e) { finish(e); }
      };
      for (const type of ["monte_carlo_run", "simulation_complete", "job_complete", "job_failed", "job_cancelled"]) source.addEventListener(type, handle);
      source.onmessage = handle; source.onerror = () => { if (!settled) setStatus(`${label}: event stream interrupted; reconnecting to ${job.jobId}. Do not submit a duplicate.`); };
    });
  }
  action("template").onclick = () => load(); action("replace").onclick = () => load(true);
  action("cancel").onclick = () => { out("confirm").hidden = true; };
  action("keep").onclick = () => { acknowledgeModel(); out("results").replaceChildren(); setStatus("Profiles retained for the current model. Review inherited capacities and timings; Run validates route coverage."); };
  action("clear").onclick = () => { input("candidate").value = ""; syncCapacity(); setStatus("Candidate removed. Next run tests the baseline only."); };
  input("resource").onchange = () => { refreshModel(); syncCapacity(); };
  for (const name of ["baseline", "candidate"]) input(name).oninput = () => { refreshModel(); syncCapacity(); setStatus("Profile edited. Run again to update results; previous results describe the previous run."); };
  input("capacity").oninput = () => {
    if (running || refreshModel()) return;
    try {
      const baseline = parse("baseline"), id = input("resource").value, capacity = Number(input("capacity").value);
      const candidate = withCapacity(input("candidate").value.trim() ? parse("candidate") : baseline, id, capacity);
      input("candidate").value = JSON.stringify(candidate, null, 2); setStatus("Candidate capacity updated for this experiment only. Run again to compare; saved model unchanged.");
      if (onCapacityChange) {
        try { onCapacityChange({ nodeId: id, capacity, baselineCapacity: effectiveCapacity(baseline, getModel?.(), id), candidate: structuredClone(candidate), experimentOnly: true }); }
        catch { setStatus("Candidate updated locally; optional capacity callback failed. This panel did not change the saved model."); }
      }
    } catch (e) { setStatus(e.message); }
  };
  input("file").onchange = async () => {
    const file = input("file").files[0]; if (!file || running) return;
    const before = modelSignature(getModel?.()); lock(true);
    try {
      if (file.size > 1024 * 1024) throw new Error("JSON import exceeds 1 MiB.");
      const value = JSON.parse(await file.text()); if (disposed) return;
      if (before !== modelSignature(getModel?.())) throw new Error("Model changed during import. Existing drafts preserved; import again.");
      input("baseline").value = JSON.stringify(value, null, 2);
      if (!input("candidate").value.trim()) acknowledgeModel(); else refreshModel();
      setStatus("Baseline imported locally; candidate retained. Run validates both against the current server model.");
    } catch (e) { setStatus(e.message); }
    finally { if (!disposed) { input("file").value = ""; lock(false); } }
  };
  action("run").onclick = async () => {
    if (running || disposed) return;
    if (refreshModel()) { setStatus("Model changed: reload a template or explicitly keep profiles before running."); return; }
    lock(true);
    try {
      // Freeze host edits before flushing its serialized save queue. A rejecting
      // guard (robot/basic DES active, failed save, etc.) prevents all submissions.
      onRunningChange(true);
      setStatus("Preparing experiment: waiting for saved model and run guards…");
      await beforeRun();
      if (disposed) return;
      if (refreshModel()) throw new Error("Model changed while preparing. Reload a template or explicitly keep profiles before running.");
      const runSignature = modelSignature(getModel?.());
      const baseline = parse("baseline"), candidate = input("candidate").value.trim() ? parse("candidate") : null;
      const settings = { mode: "monte-carlo", entities: Number(input("entities").value), runs: Number(input("runs").value), seed: Number(input("seed").value), detail: false };
      for (const [field, min, max] of [["entities", 1, 80], ["runs", 1, 200], ["seed", 0, 4294967295]]) if (!input(field).value.trim() || !Number.isInteger(settings[field]) || settings[field] < min || settings[field] > max) throw new Error(`${field} must be a whole number ${min}..${max}.`);
      if (input("resource").value && (!input("capacity").value || !Number.isInteger(Number(input("capacity").value)) || Number(input("capacity").value) < 1 || Number(input("capacity").value) > 32)) throw new Error("Candidate capacity must be a whole number from 1 to 32.");
      out("results").replaceChildren(); const results = [];
      for (const [label, experiment] of [["Baseline", baseline], ...(candidate ? [["Candidate", candidate]] : [])]) {
        if (disposed) return;
        if (modelSignature(getModel?.()) !== runSignature) throw new Error("Model changed during the run. Results are not a comparable pair; review and run again.");
        setStatus(`${label}: validating and submitting…`);
        const job = await api("/api/simulations", { method: "POST", body: JSON.stringify({ ...settings, experiment }) }); if (disposed) return;
        const result = await watch(job, label); if (disposed) return;
        if (modelSignature(getModel?.()) !== runSignature) throw new Error("Model changed during the run. Results are not a comparable pair; review and run again.");
        results.push(result); render(label, result);
      }
      if (results.length === 2) compare(...results);
      setStatus("Complete. Simulated results and user-entered observations are separate. Saved model unchanged; no production execution.");
    } catch (e) { setStatus(e.message); }
    finally {
      try { onRunningChange(false); } catch (e) { setStatus(`Run ended, but host edit-unlock callback failed: ${e.message}`); }
      if (!disposed) { refreshModel(); lock(false); }
    }
  };
  // No host wiring required; hosts may refresh immediately after save/load.
  const modelTimer = setInterval(refreshModel, 1000); syncCapacity();
  return { loadTemplate: () => load(), refreshModel, destroy() {
    disposed = true; clearInterval(modelTimer); for (const cancel of streams.values()) cancel(); streams.clear(); root.replaceChildren();
  } };
}
