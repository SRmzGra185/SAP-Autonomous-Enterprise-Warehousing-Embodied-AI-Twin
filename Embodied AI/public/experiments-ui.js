// Independent job subscription: never calls app.consumeEvent or controls the twin.
export function initExperimentsUI({ api, getModel }) {
  const root = document.querySelector("#industrial-experiments");
  if (!root) return { destroy() {} };
  root.innerHTML = `<h2>Industrial timing experiments</h2>
    <p>Seconds per declared handling unit. Templates are synthetic DEMO data. “Observed” means user-declared, not verified. Animation playback is separate from machine time.</p>
    <p>Process distributions: fixed {type,value}, triangular {type,min,mode,max}, empirical {type,samples}. All values are seconds. Optional capacity: 1–32.</p>
    <p>setupOncePerResource=true charges setup on first use of each resource in each replication; false charges every entity on every visit. Handling, travel and approval occupy that same resource per entity per visit. Repeated visits share the resource pool and timing profile. Do not add queue delays: DES measures them.</p>
    <div class="ix-controls"><button type="button" data-action="template">Load current model template</button><label>Import baseline JSON <input type="file" accept=".json,application/json" data-input="file"></label></div>
    <div class="ix-editors"><label>Baseline profile JSON<textarea data-input="baseline" spellcheck="false" rows="14" aria-label="Baseline experiment JSON"></textarea></label>
    <label>Candidate profile JSON (optional)<textarea data-input="candidate" spellcheck="false" rows="14" aria-label="Candidate experiment JSON" placeholder="Paste a modified baseline to compare capacity or process seconds using paired seeds."></textarea></label></div>
    <div class="ix-controls"><label>Entities <input data-input="entities" type="number" min="1" max="80" value="24"></label><label>Replications <input data-input="runs" type="number" min="1" max="200" value="20"></label><label>Seed <input data-input="seed" type="number" min="0" max="4294967295" value="42"></label><button type="button" data-action="run">Validate & run</button></div>
    <p data-output="status" role="status" aria-live="polite">Load a template to begin. Validation occurs on Run; no production commands.</p><div data-output="results"></div>`;
  const input = name => root.querySelector(`[data-input="${name}"]`), status = root.querySelector('[data-output="status"]'), output = root.querySelector('[data-output="results"]');
  const streams = new Set(); let disposed = false, running = false;
  const setStatus = text => { if (!disposed) status.textContent = text; };
  const lock = value => { running = value; root.querySelectorAll("button,input,textarea").forEach(el => { el.disabled = value; }); };
  const num = v => Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "—";
  const add = (parent, tag, text) => { const el = document.createElement(tag); el.textContent = text; parent.append(el); return el; };
  function render(title, s) {
    if (disposed) return;
    const section = document.createElement("section"); output.append(section); add(section, "h3", title);
    add(section, "p", `${s.timing?.source ?? "unknown"} (unverified) · ${s.timing?.entityUnit ?? "entity"} · seconds · ${s.runs} replications · ${s.timing?.nodeCount} unique nodes / ${s.timing?.routeVisitCount} route visits · ${s.timing?.empiricalSampleCount} empirical samples. Source: ${s.timing?.sourceReference ?? "none"}`);
    const table = document.createElement("table"); section.append(table);
    const row = (label, value) => { const tr = document.createElement("tr"); add(tr, "th", label).scope = "row"; add(tr, "td", value); table.append(tr); };
    row("Completed entities / replication", num(s.completed)); row("Mean elapsed seconds", num(s.elapsedSeconds)); row("Mean throughput / hour", num(s.throughputPerHour));
    row("Mean of replication mean cycles (s)", num(s.averageCycle)); row("P50 / P95 of replication mean cycles (s)", `${num(s.replicationMeanCycleSeconds?.p50)} / ${num(s.replicationMeanCycleSeconds?.p95)}`);
    const ci = s.replicationMeanCycleSeconds?.ci95; row("95% CI for expected mean cycle (s)", `${num(ci?.lower)} – ${num(ci?.upper)}`); add(section, "p", ci?.method ?? "CI unavailable");
    row(`Order P95 (s): ${s.orderP95Scope}`, num(s.orderP95CycleSeconds)); row("Mean total queue seconds / replication", num(s.queuedSeconds)); row("Mean queue seconds / entity", num(s.averageQueuedSeconds));
    for (const [id, n] of Object.entries(s.nodeMetrics || {})) row(`${id}: capacity / occupied utilization / total queued s`, `${n.capacity} / ${num(n.utilization * 100)}% / ${num(n.queuedSeconds)}`);
    add(section, "p", `Setup: ${s.timing?.setupPolicy}. Performance observations below are separate from DES and never inferred from simulated counts.`);
    for (const field of ["availability", "performance", "quality", "oee", "mtbfSeconds", "mttrSeconds"]) {
      const value = s.observedKpis?.[field]; row(`User-entered ${field}${field.endsWith("Seconds") ? " (s)" : " (fraction)"}`, num(value));
    }
    for (const warning of [...(s.timing?.warnings || []), ...(s.observedKpis?.warnings || [])]) add(section, "p", warning).className = "ix-warning";
  }
  async function load() {
    if (running) return;
    lock(true); setStatus("Loading current scoped-model template…");
    try { const data = await api("/api/experiment-template"); if (!disposed) { input("baseline").value = JSON.stringify(data, null, 2); setStatus(`Synthetic template loaded for ${getModel?.()?.name ?? "current model"}. Replace illustrative times before declaring observations.`); } }
    catch (e) { setStatus(e.message); } finally { if (!disposed) lock(false); }
  }
  function watch(job, label) {
    return new Promise((resolve, reject) => {
      const source = new EventSource(job.events); streams.add(source);
      const finish = (error, result) => { clearTimeout(timer); source.close(); streams.delete(source); error ? reject(error) : resolve(result); };
      const timer = setTimeout(() => finish(new Error(`${label}: stream timed out; server job may still be running (${job.jobId}).`)), 300000);
      const handle = event => {
        try {
          const p = JSON.parse(event.data);
          if (p.type === "monte_carlo_run") setStatus(`${label}: ${p.run}/${p.runs} replications`);
          if (p.type === "simulation_complete") finish(null, p.summary);
          if (p.type === "job_complete") finish(null, p.result);
          if (["job_failed", "job_cancelled"].includes(p.type)) finish(new Error(p.error || p.type));
        } catch (e) { finish(e); }
      };
      for (const type of ["monte_carlo_run", "simulation_complete", "job_complete", "job_failed", "job_cancelled"]) source.addEventListener(type, handle);
      source.onmessage = handle;
      source.onerror = () => setStatus(`${label}: event stream interrupted; reconnecting to ${job.jobId}. Do not submit a duplicate.`);
    });
  }
  root.querySelector('[data-action="template"]').onclick = load;
  input("file").onchange = async () => {
    const file = input("file").files[0]; if (!file) return;
    try { if (file.size > 1024 * 1024) throw new Error("JSON import exceeds 1 MiB."); const value = JSON.parse(await file.text()); input("baseline").value = JSON.stringify(value, null, 2); setStatus("Imported locally. Run validates against the current server model."); } catch (e) { setStatus(e.message); }
  };
  root.querySelector('[data-action="run"]').onclick = async () => {
    if (running) return;
    lock(true); output.replaceChildren();
    try {
      const baseline = JSON.parse(input("baseline").value), candidate = input("candidate").value.trim() ? JSON.parse(input("candidate").value) : null;
      const settings = { mode: "monte-carlo", entities: Number(input("entities").value), runs: Number(input("runs").value), seed: Number(input("seed").value), detail: false };
      for (const [field, min, max] of [["entities",1,80],["runs",1,200],["seed",0,4294967295]]) if (!Number.isInteger(settings[field]) || settings[field] < min || settings[field] > max) throw new Error(`${field} must be an integer ${min}..${max}.`);
      const results = [];
      for (const [label, experiment] of [["Baseline",baseline], ...(candidate ? [["Candidate",candidate]] : [])]) {
        if (disposed) break; setStatus(`${label}: validating and submitting…`);
        const job = await api("/api/simulations", { method: "POST", body: JSON.stringify({ ...settings, experiment }) });
        if (disposed) break;
        const result = await watch(job,label); results.push(result); render(label,result);
      }
      if (results.length === 2) {
        const [a,b] = results;
        const paired = a.replications?.length === b.replications?.length && a.replications.every((r,i) => r.seed === b.replications[i].seed);
        add(output,"p", paired ? `Paired candidate − baseline mean-cycle difference: ${num(b.averageCycle - a.averageCycle)} seconds. Same seeds and requested entity count; compare the same route and handling unit. Negative means faster. No significance claim.` : "Pairing unavailable; do not interpret this as a paired comparison.");
      }
      setStatus("Complete. Simulated results and user-entered observations are separate; no production execution.");
    } catch (e) { setStatus(e.message); } finally { if (!disposed) lock(false); }
  };
  return { loadTemplate: load, destroy() { disposed = true; for (const source of streams) source.close(); streams.clear(); root.replaceChildren(); } };
}
