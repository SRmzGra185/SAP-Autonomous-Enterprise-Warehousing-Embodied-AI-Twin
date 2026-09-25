(() => {
  const $ = (selector) => document.querySelector(selector);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (value, digits = 1) => (Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "—");
  const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—");
  const el = (tag, className, text) => { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; };
  const charts = {};
  const ch = (id) => (charts[id] ||= echarts.init(document.getElementById(id), null, { renderer: "canvas" }));
  const state = { data: null, busy: false };

  function kpiCard(label, value, unit, delta, deltaTone, caption) {
    const card = el("div", "kpi");
    card.append(el("div", "k-l", label));
    const v = el("div", "k-v", value); if (unit) v.append(el("small", null, unit)); card.append(v);
    if (delta) card.append(el("div", `k-d ${deltaTone || ""}`, delta));
    card.append(el("div", "k-c", caption || ""));
    return card;
  }

  function renderKpis() {
    const { result, meanUtilization, bottleneck, joule, jouleError } = state.data;
    const ci = result.replicationMeanCycleSeconds?.ci95;
    const kpis = $("#kpis"); kpis.replaceChildren(
      kpiCard("Throughput", fmt(result.throughputPerHour, 0), "orders/h", null, "", `${result.entities} orders · ${result.runs} replications`),
      kpiCard("Avg cycle", fmt(result.averageCycle, 0), "s", null, "", `seed ${result.seed}`),
      kpiCard("P95 cycle", fmt(result.p95Cycle, 0), "s", null, "", ci ? `CI95 ${fmt(ci.lower, 0)}–${fmt(ci.upper, 0)} s` : ""),
      kpiCard("Mean utilization", pct(meanUtilization), "", bottleneck && bottleneck.utilization > 0.85 ? "bottleneck risk" : "", bottleneck && bottleneck.utilization > 0.85 ? "neg" : "pos", bottleneck ? `top node: ${bottleneck.name}` : "no nodes"),
      kpiCard("Joule", joule ? "Live" : "Offline", "", joule ? String(joule.model || "").replace(/^anthropic--/, "") : "local scoring only", joule ? "pos" : "amber", joule?.usage ? `${joule.usage.input + joule.usage.output} tokens` : (jouleError || "SAP AI Core not bound"))
    );
  }

  function renderUtilization() {
    const { nodes, bottleneck, result } = state.data;
    $("#utilSub").textContent = `bottleneck ${bottleneck ? `${bottleneck.name} at ${pct(bottleneck.utilization)}` : "none"} · avg queue ${fmt(result.averageQueuedSeconds, 0)} s/order`;
    ch("utilization").setOption({
      animationDuration: 600, grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, formatter: (items) => { const node = nodes[items[0].dataIndex]; return `<b>${node.name}</b><br/>utilization ${pct(node.utilization)}<br/>capacity ${node.capacity} · service ${node.service ?? "—"} s<br/>queued ${fmt(node.queuedSeconds, 0)} s`; } },
      xAxis: { type: "value", max: 1, axisLabel: { color: css("--muted"), fontSize: 10, formatter: (value) => `${Math.round(value * 100)}%` }, splitLine: { lineStyle: { color: css("--line") } } },
      yAxis: { type: "category", inverse: true, data: nodes.map((node) => node.name), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: css("--ink-2"), fontSize: 10, width: 150, overflow: "truncate" } },
      series: [{ type: "bar", data: nodes.map((node) => ({ value: node.utilization, itemStyle: { color: node.utilization > 0.85 ? css("--neg") : node.utilization < 0.4 ? css("--comp") : css("--pos"), borderRadius: [0, 4, 4, 0] } })), barWidth: 14, label: { show: true, position: "right", color: css("--ink"), fontSize: 10, formatter: (params) => pct(params.value) }, markLine: { silent: true, symbol: "none", lineStyle: { color: css("--neg"), type: "dashed" }, data: [{ xAxis: 0.85, label: { formatter: "85% risk", color: css("--neg"), fontSize: 10 } }] } }]
    }, true);
  }

  function renderTable() {
    $("#pTable").querySelector(".ph h2").textContent = "Node detail";
    $("#pTable").querySelector(".sub").textContent = "This run · seconds · replication means";
    $("#detail thead tr").innerHTML = "<th>Node</th><th>Kind</th><th class=\"num\">Capacity</th><th class=\"num\">Utilization</th><th class=\"num\">Queued s</th><th class=\"num\">Busy s</th>";
    const body = $("#detail tbody"); body.replaceChildren();
    for (const node of state.data.nodes) {
      const row = el("tr");
      const cells = [node.name, node.kind || "—", String(node.capacity ?? "—"), pct(node.utilization), fmt(node.queuedSeconds, 0), fmt(node.busySeconds, 0)];
      cells.forEach((text, index) => { const cell = el("td", index >= 2 ? "num" : null, text); row.append(cell); });
      body.append(row);
    }
  }

  function renderJoule() {
    const { joule, jouleError, nodes } = state.data;
    const summary = $("#jouleSummary"), recs = $("#jouleRecs"), risks = $("#jouleRisks");
    recs.replaceChildren(); risks.replaceChildren();
    if (!joule) {
      summary.className = "joule-summary dim"; summary.textContent = jouleError ? `Joule unavailable: ${jouleError}. Showing the deterministic result only.` : "Joule is not connected (no SAP AI Core binding). Showing the deterministic result only.";
      $("#jouleSub").textContent = "Offline"; $("#jouleTag").textContent = "Joule offline"; $("#jouleTag").className = "tag off"; $("#jouleFoot").textContent = "";
      return;
    }
    summary.className = "joule-summary"; summary.textContent = joule.executiveSummary || "Joule returned no summary.";
    $("#jouleSub").textContent = `Executive summary · ${String(joule.model || "").replace(/^anthropic--/, "")} on SAP AI Core`;
    for (const rec of joule.recommendations) {
      const card = el("div", "rec"); card.append(el("b", null, rec.title), el("span", null, rec.detail));
      const node = rec.nodeId && nodes ? nodes.find((item) => item.id === rec.nodeId) : null;
      if (node) card.append(el("small", null, node.name));
      recs.append(card);
    }
    for (const risk of joule.risks) risks.append(el("li", null, risk));
    $("#jouleFoot").textContent = `${joule.usage ? `${joule.usage.input + joule.usage.output} tokens · ` : ""}Recommendations are advisory; nothing executes from this page.`;
  }

  function renderRoutineView() {
    const { scenario, mode, cycles, kpis, unmeasuredKpis, joule, jouleError } = state.data;
    const picking = kpis?.pickingAndOrderCycle, dwell = kpis?.queueAndDockDwell;
    $("#kpis").replaceChildren(
      kpiCard("Task → picking", picking ? `${fmt(picking.taskToPickingSeconds, 1)}` : "—", "s", null, "", `${cycles} cycle${cycles === 1 ? "" : "s"} · ${mode}`),
      kpiCard("Order → dispatch", picking ? `${fmt(picking.orderToDispatchSeconds, 1)}` : "—", "s", null, "", scenario ? scenario.name : ""),
      kpiCard("Rack dwell", dwell ? `${fmt(dwell.rackDwellSeconds, 1)}` : "—", "s", null, "", "wait at AS/RS rack"),
      kpiCard("Dock dwell", dwell ? `${fmt(dwell.dockDwellSeconds, 1)}` : "—", "s", null, "", "wait at dispatch dock"),
      kpiCard("Joule", joule ? "Live" : "Offline", "", joule ? String(joule.model || "").replace(/^anthropic--/, "") : "local scoring only", joule ? "pos" : "amber", joule?.usage ? `${joule.usage.input + joule.usage.output} tokens` : (jouleError || "SAP AI Core not bound"))
    );
    $("#pUtil").hidden = true;
    $("#pTable").querySelector(".ph h2").textContent = "Not yet measured";
    $("#pTable").querySelector(".sub").textContent = "These KPIs need data this routine doesn't produce today (load state, map/shifts, deadlines, battery).";
    const body = $("#detail tbody"); body.replaceChildren();
    $("#detail thead tr").innerHTML = "<th>KPI</th>";
    for (const name of unmeasuredKpis || []) { const row = el("tr"); row.append(el("td", null, name)); body.append(row); }
  }

  function renderAll() {
    const data = state.data;
    if (data.kind === "robot_routine") {
      $("#mainSub").textContent = `Reflecting your most recent Workcell routine · ${data.scenario?.domain || ""} · ${data.cycles} cycle${data.cycles === 1 ? "" : "s"}`;
      $("#genAt").textContent = data.runAt ? `Run ${new Date(data.runAt).toLocaleString("en-US")}` : "";
      renderRoutineView(); renderJoule();
    } else {
      $("#pUtil").hidden = false;
      $("#mainSub").textContent = `Reflecting your most recent completed simulation · ${data.parameters.entities} orders · ${data.parameters.runs} replications · seed ${data.parameters.seed}`;
      $("#genAt").textContent = data.runAt ? `Run ${new Date(data.runAt).toLocaleString("en-US")}` : "";
      renderKpis(); renderUtilization(); renderTable(); renderJoule();
    }
    requestAnimationFrame(() => Object.values(charts).forEach((chart) => chart.resize()));
  }

  async function load() {
    if (state.busy) return; state.busy = true; $("#refresh").disabled = true; $("#error").hidden = true;
    $("#mainSub").textContent = "Loading the most recent simulation…";
    try {
      const response = await fetch("/api/analytics/last-run", { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (response.status === 404 && data.code === "no_simulation_run") {
        $("#empty").hidden = false; $("#layout").hidden = true; $("#mainSub").textContent = "No simulation yet."; $("#genAt").textContent = "";
        return;
      }
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      $("#empty").hidden = true; $("#layout").hidden = false;
      state.data = data; renderAll();
    } catch (error) {
      $("#error").hidden = false; $("#error").textContent = `Analytics unavailable: ${error.message}`; $("#mainSub").textContent = "Failed to load.";
    } finally { state.busy = false; $("#refresh").disabled = false; }
  }

  window.addEventListener("resize", () => Object.values(charts).forEach((chart) => chart.resize()));
  document.addEventListener("DOMContentLoaded", () => { $("#refresh").addEventListener("click", load); load(); });
})();
