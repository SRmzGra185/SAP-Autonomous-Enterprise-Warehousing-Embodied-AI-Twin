(() => {
  const $ = (selector) => document.querySelector(selector);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (value, digits = 1) => (Number.isFinite(value) ? value.toLocaleString("en-US", { maximumFractionDigits: digits }) : "—");
  const pct = (value) => (Number.isFinite(value) ? `${Math.round(value * 100)}%` : "—");
  const el = (tag, className, text) => { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; };
  const charts = {};
  const ch = (id) => (charts[id] ||= echarts.init(document.getElementById(id), null, { renderer: "canvas" }));
  const state = { data: null, busy: false };
  const DISPLAY = () => css("--font-medium");
  // Slide Design Reference palette: progress in Vivid Purple → Sky, zones only ever use the
  // three status colours (Green / Amber / Red) so a surface never exceeds 3 accents.
  const PAL = () => ({ navy: css("--navy"), violet: css("--electric"), vivid: css("--vivid"), lavender: css("--lavender"), sky: css("--sky"), ice: css("--ice"),
    mist: css("--mist"), green: css("--green"), amber: css("--amber"), red: css("--red"), ink: css("--ink"), muted: css("--muted"), ink2: css("--ink-2") });

  // ---- small pieces ------------------------------------------------------

  function spark(values, color) {
    if (!values || values.length < 2) return "";
    const width = 88, height = 30, min = Math.min(...values), max = Math.max(...values);
    const points = values.map((value, index) => [index / (values.length - 1) * width, height - 4 - ((value - min) / ((max - min) || 1)) * (height - 8)]);
    const path = points.map((point, index) => `${index ? "L" : "M"}${point[0].toFixed(1)},${point[1].toFixed(1)}`).join(" ");
    const last = points[points.length - 1];
    return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.5" fill="${color}"/></svg>`;
  }

  function kpiCard(label, value, unit, delta, deltaTone, caption, sparkValues, sparkColor) {
    const card = el("div", "kpi");
    card.append(el("div", "k-l", label));
    const v = el("div", "k-v", value); if (unit) v.append(el("small", null, unit)); card.append(v);
    if (delta) card.append(el("div", `k-d ${deltaTone || ""}`, delta));
    card.append(el("div", "k-c", caption || ""));
    if (sparkValues?.length > 1) card.insertAdjacentHTML("beforeend", spark(sparkValues, sparkColor || css("--electric")));
    return card;
  }

  function jouleCard() {
    const { joule, jouleError, joulePending } = state.data;
    if (joule) return kpiCard("Joule", "Live", "", String(joule.model || "").replace(/^anthropic--/, ""), "pos", joule.usage ? `${joule.usage.input + joule.usage.output} tokens` : "");
    if (joulePending) return kpiCard("Joule", "Thinking…", "", "SAP AI Core", "amber", "summary on its way");
    return kpiCard("Joule", "Offline", "", "local scoring only", "amber", jouleError || "SAP AI Core not bound");
  }

  // ---- gauges ------------------------------------------------------------
  // Shared visual language for every dial (SAP Slide Design Reference): ghost
  // track on the dark violet gradient, Sky→Vivid Purple progress arc, lavender
  // ticks, white pointer, value large in 72 Brand Medium. Colour zones are the
  // one thing that differs per KPI and only use the three status colours.

  // `radius` is a percentage of half the shorter side; ECharts takes a number
  // or a "N%" string only (no calc()), so the inner ring is derived numerically.
  function dial(id, { value, min, max, unit, zones, formatter, decimals = 0, radius = 88, center = ["50%", "62%"], fontSize = 34, startAngle = 210, endAngle = -30, title }) {
    const P = PAL(), ink = P.ink, muted = P.muted, face = P.navy;
    const track = css("--track"), tick = css("--tick"), split = css("--split");
    const outer = `${radius}%`, inner = `${Math.max(10, radius - 9)}%`;
    ch(id).setOption({
      backgroundColor: "transparent",
      animationDuration: 900, animationEasing: "cubicOut",
      series: [
        // colour zones (thin outer ring)
        { type: "gauge", startAngle, endAngle, min, max, radius: outer, center, splitNumber: 0,
          axisLine: { lineStyle: { width: 6, color: zones } }, axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false },
          pointer: { show: false }, detail: { show: false }, data: [{ value }] },
        // progress arc + pointer + detail (inner)
        { type: "gauge", startAngle, endAngle, min, max, radius: inner, center, splitNumber: 5,
          progress: { show: true, width: 12, roundCap: true, itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: P.sky }, { offset: 1, color: P.vivid }]), shadowBlur: 10, shadowColor: "rgba(147,51,234,0.45)" } },
          axisLine: { lineStyle: { width: 12, color: [[1, track]] } },
          axisTick: { distance: -22, length: 4, lineStyle: { color: tick, width: 1 } },
          splitLine: { distance: -26, length: 9, lineStyle: { color: split, width: 2 } },
          axisLabel: { distance: -8, color: muted, fontSize: 9, fontFamily: css("--font-mono"), formatter: (v) => formatter ? formatter(v, true) : `${Math.round(v)}` },
          pointer: { icon: "path://M2090.36389,615.30999 L2090.36389,615.30999 C2091.48372,615.30999 2092.40383,616.194028 2092.44859,617.312956 L2096.90698,728.755929 C2097.05155,732.369577 2094.2393,735.416212 2090.62566,735.56078 C2090.53845,735.564269 2090.45117,735.566014 2090.36389,735.566014 L2090.36389,735.566014 C2086.74736,735.566014 2083.81557,732.63423 2083.81557,729.017692 C2083.81557,728.930412 2083.81732,728.84314 2083.82081,728.755929 L2088.2792,617.312956 C2088.32396,616.194028 2089.24407,615.30999 2090.36389,615.30999 Z", length: "62%", width: 8, offsetCenter: [0, 0], itemStyle: { color: ink, shadowBlur: 6, shadowColor: "rgba(13,8,51,.5)" } },
          anchor: { show: true, size: 14, itemStyle: { color: face, borderColor: P.lavender, borderWidth: 2 } },
          // Value sits in the open mouth of the arc (below centre, like a car
          // dashboard) so it never collides with the arc or the card title.
          title: { show: Boolean(title), offsetCenter: [0, "62%"], color: muted, fontSize: 10, fontFamily: css("--font") },
          detail: { valueAnimation: true, offsetCenter: [0, "32%"], color: ink, fontSize, fontWeight: 500, fontFamily: DISPLAY(), formatter: (v) => formatter ? formatter(v, false) : `${v.toFixed(decimals)}${unit || ""}` },
          data: [{ value, name: title || "" }] }
      ]
    }, true);
  }

  function renderHero() {
    const { result, meanUtilization, maxUtilization, bottleneck } = state.data;
    const { green, amber, red } = PAL();
    // Main dial: utilization 0..100 %, amber under 40 (idle capital), green 40–85, red above 85 (bottleneck line the twin already uses)
    dial("gaugeMain", { value: (meanUtilization || 0) * 100, min: 0, max: 100, radius: 92, center: ["50%", "60%"], fontSize: 44,
      zones: [[0.4, amber], [0.85, green], [1, red]], formatter: (v, axis) => axis ? `${Math.round(v)}` : `${v.toFixed(1)}%`, title: "target ≤ 85 %" });
    $("#gaugeFootL").innerHTML = `max <b>${pct(maxUtilization)}</b> · ${bottleneck ? bottleneck.name : "—"}`;
    $("#gaugeFootR").innerHTML = `${state.data.nodes.length} nodes · <b>${result.completed}</b> orders`;

    // Three tachometers. Scales come from the run itself so the needle always
    // sits in a meaningful place: throughput vs its theoretical ceiling, cycles
    // vs the observed P95 range.
    const reps = result.replications || [];
    const maxThroughput = Math.max(result.throughputPerHour * 1.5, ...reps.map((r) => r.throughputPerHour || 0)) || 1;
    const cycleCeil = Math.max(result.p95Cycle * 1.25, ...reps.map((r) => r.orderP95CycleSeconds || 0)) || 1;
    const wrap = $("#tachos"); wrap.replaceChildren();
    const specs = [
      { id: "tachoThroughput", label: "Throughput", caption: `${fmt(result.entities, 0)} orders · ${reps.length || result.runs} reps`, value: result.throughputPerHour, min: 0, max: Math.ceil(maxThroughput / 50) * 50, unit: "/h", decimals: 0, zones: [[0.35, red], [0.65, amber], [1, green]] },
      { id: "tachoCycle", label: "Avg cycle", caption: `CI95 ${result.replicationMeanCycleSeconds?.ci95 ? `${fmt(result.replicationMeanCycleSeconds.ci95.lower, 0)}–${fmt(result.replicationMeanCycleSeconds.ci95.upper, 0)} s` : "—"}`, value: result.averageCycle, min: 0, max: Math.ceil(cycleCeil / 20) * 20, unit: "s", decimals: 0, zones: [[0.5, green], [0.8, amber], [1, red]] },
      { id: "tachoP95", label: "P95 cycle", caption: `avg queue ${fmt(result.averageQueuedSeconds, 0)} s/order`, value: result.p95Cycle, min: 0, max: Math.ceil(cycleCeil / 20) * 20, unit: "s", decimals: 0, zones: [[0.5, green], [0.8, amber], [1, red]] }
    ];
    for (const spec of specs) {
      const card = el("div", "tacho"); card.append(el("div", "t-l", spec.label));
      const chart = el("div", "t-chart"); chart.id = spec.id; card.append(chart);
      card.append(el("div", "t-c", spec.caption)); wrap.append(card);
    }
    for (const spec of specs) dial(spec.id, { ...spec, radius: 96, center: ["50%", "64%"], fontSize: 22, formatter: (v, axis) => axis ? `${Math.round(v)}` : `${v.toFixed(spec.decimals)}${spec.unit}` });
    $("#hero").hidden = false;
  }

  // ---- panels ------------------------------------------------------------

  function renderKpis() {
    const { result, meanUtilization, bottleneck } = state.data;
    const reps = result.replications || [];
    const ci = result.replicationMeanCycleSeconds?.ci95;
    const bottle = bottleneck && bottleneck.utilization > 0.85;
    $("#kpis").replaceChildren(
      kpiCard("Throughput", fmt(result.throughputPerHour, 0), "orders/h", null, "", `${result.entities} orders · ${result.runs} replications`, reps.map((r) => r.throughputPerHour)),
      kpiCard("Avg cycle", fmt(result.averageCycle, 0), "s", null, "", `seed ${result.seed}`, reps.map((r) => r.averageCycle), css("--sky")),
      kpiCard("P95 cycle", fmt(result.p95Cycle, 0), "s", null, "", ci ? `CI95 ${fmt(ci.lower, 0)}–${fmt(ci.upper, 0)} s` : "", reps.map((r) => r.orderP95CycleSeconds), css("--amber")),
      kpiCard("Mean utilization", pct(meanUtilization), "", bottle ? "▲ bottleneck risk" : "● healthy load", bottle ? "neg" : "pos", bottleneck ? `top node: ${bottleneck.name}` : "no nodes"),
      jouleCard()
    );
  }

  function renderUtilization() {
    const { nodes, bottleneck, result } = state.data;
    const { violet, sky, green, amber, red, muted, ink2, navy } = PAL(); const line = css("--grid");
    $("#utilSub").textContent = `bottleneck ${bottleneck ? `${bottleneck.name} at ${pct(bottleneck.utilization)}` : "none"} · avg queue ${fmt(result.averageQueuedSeconds, 0)} s/order`;
    ch("utilization").setOption({
      backgroundColor: "transparent", animationDuration: 700,
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "#ffffff", borderColor: css("--mist"), textStyle: { color: navy }, formatter: (items) => { const node = nodes[items[0].dataIndex]; return `<b>${node.name}</b><br/>utilization ${pct(node.utilization)}<br/>capacity ${node.capacity} · service ${node.service ?? "—"} s<br/>queued ${fmt(node.queuedSeconds, 0)} s`; } },
      xAxis: { type: "value", max: 1, axisLabel: { color: muted, fontSize: 10, formatter: (value) => `${Math.round(value * 100)}%` }, splitLine: { lineStyle: { color: line } } },
      yAxis: { type: "category", inverse: true, data: nodes.map((node) => node.name), axisTick: { show: false }, axisLine: { show: false }, axisLabel: { color: ink2, fontSize: 10, width: 150, overflow: "truncate" } },
      series: [{ type: "bar", data: nodes.map((node) => ({ value: node.utilization, itemStyle: { color: node.utilization > 0.85 ? red : node.utilization < 0.4 ? amber : new echarts.graphic.LinearGradient(0, 0, 1, 0, [{ offset: 0, color: sky }, { offset: 1, color: violet }]), borderRadius: [0, 4, 4, 0] } })), barWidth: 14, label: { show: true, position: "right", color: css("--ink"), fontSize: 10, fontFamily: css("--font-mono"), formatter: (params) => pct(params.value) }, markLine: { silent: true, symbol: "none", lineStyle: { color: red, type: "dashed" }, data: [{ xAxis: 0.85, label: { formatter: "85% risk", color: red, fontSize: 10 } }] } }]
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
    const { joule, jouleError, joulePending, nodes } = state.data;
    const summary = $("#jouleSummary"), recs = $("#jouleRecs"), risks = $("#jouleRisks");
    recs.replaceChildren(); risks.replaceChildren();
    if (!joule && joulePending) {
      summary.className = "joule-summary dim thinking"; summary.textContent = "Joule is analyzing this run on SAP AI Core…";
      $("#jouleSub").textContent = "Thinking…"; $("#jouleTag").textContent = "Joule thinking"; $("#jouleTag").className = "tag ai"; $("#jouleFoot").textContent = "";
      return;
    }
    if (!joule) {
      summary.className = "joule-summary dim"; summary.textContent = jouleError ? `Joule unavailable: ${jouleError}. Showing the deterministic result only.` : "Joule is not connected (no SAP AI Core binding). Showing the deterministic result only.";
      $("#jouleSub").textContent = "Offline"; $("#jouleTag").textContent = "Joule offline"; $("#jouleTag").className = "tag off"; $("#jouleFoot").textContent = "";
      return;
    }
    summary.className = "joule-summary"; summary.textContent = joule.executiveSummary || "Joule returned no summary.";
    $("#jouleSub").textContent = `Executive summary · ${String(joule.model || "").replace(/^anthropic--/, "")} on SAP AI Core`;
    $("#jouleTag").textContent = "Joule live"; $("#jouleTag").className = "tag ai live";
    for (const rec of joule.recommendations) {
      const card = el("div", "rec"); card.append(el("b", null, rec.title), el("span", null, rec.detail));
      const node = rec.nodeId && nodes ? nodes.find((item) => item.id === rec.nodeId) : null;
      if (node) card.append(el("small", null, node.name));
      recs.append(card);
    }
    for (const risk of joule.risks) risks.append(el("li", null, risk));
    $("#jouleFoot").textContent = `${joule.usage ? `${joule.usage.input + joule.usage.output} tokens · ` : ""}Recommendations are advisory; nothing executes from this page.`;
  }

  // Workcell routine: two measured Logistics KPIs on dials, the rest listed as not-yet-measured.
  function renderRoutineView() {
    const { scenario, mode, cycles, kpis, unmeasuredKpis } = state.data;
    const picking = kpis?.pickingAndOrderCycle, dwell = kpis?.queueAndDockDwell;
    const { green, amber, red } = PAL(); const none = css("--track");
    $("#gaugeLabel").textContent = "Order → dispatch"; $("#gaugeTitle").textContent = scenario?.name || "Routine";
    if (picking?.orderToDispatchSeconds != null) {
      const ceil = Math.max(10, Math.ceil(picking.orderToDispatchSeconds * 1.6 / 5) * 5);
      dial("gaugeMain", { value: picking.orderToDispatchSeconds, min: 0, max: ceil, radius: 92, center: ["50%", "60%"], fontSize: 44, zones: [[0.5, green], [0.8, amber], [1, red]], formatter: (v, axis) => axis ? `${Math.round(v)}` : `${v.toFixed(1)} s`, title: `${kpis.cyclesMeasured} cycle${kpis.cyclesMeasured === 1 ? "" : "s"} measured` });
      $("#gaugeFootL").innerHTML = `task → picking <b>${fmt(picking.taskToPickingSeconds, 1)} s</b>`;
      $("#gaugeFootR").innerHTML = `${mode} · ${cycles} cycle${cycles === 1 ? "" : "s"}`;
    } else {
      dial("gaugeMain", { value: 0, min: 0, max: 1, radius: 92, center: ["50%", "60%"], fontSize: 30, zones: [[1, none]], formatter: () => "—", title: "not measured for this scenario" });
      $("#gaugeFootL").innerHTML = `<b>${scenario?.domain || ""}</b>`; $("#gaugeFootR").innerHTML = `${mode} · ${cycles} cycle${cycles === 1 ? "" : "s"}`;
    }
    const wrap = $("#tachos"); wrap.replaceChildren();
    const specs = [
      { id: "tachoRack", label: "Rack dwell", caption: "wait at AS/RS rack", value: dwell?.rackDwellSeconds },
      { id: "tachoDock", label: "Dock dwell", caption: "wait at dispatch dock", value: dwell?.dockDwellSeconds },
      { id: "tachoPick", label: "Task → picking", caption: "reserve tote → pick done", value: picking?.taskToPickingSeconds }
    ];
    const ceil = Math.max(2, Math.ceil(Math.max(...specs.map((s) => s.value || 0)) * 1.6));
    for (const spec of specs) {
      const card = el("div", "tacho"); card.append(el("div", "t-l", spec.label));
      const chart = el("div", "t-chart"); chart.id = spec.id; card.append(chart);
      card.append(el("div", "t-c", spec.caption)); wrap.append(card);
    }
    for (const spec of specs) dial(spec.id, { value: spec.value ?? 0, min: 0, max: ceil, radius: 96, center: ["50%", "64%"], fontSize: 22, zones: spec.value == null ? [[1, none]] : [[0.5, green], [0.8, amber], [1, red]], formatter: (v, axis) => axis ? `${v.toFixed(1)}` : (spec.value == null ? "—" : `${v.toFixed(2)} s`) });
    $("#hero").hidden = false;
    $("#kpis").replaceChildren(
      kpiCard("Task → picking", picking ? fmt(picking.taskToPickingSeconds, 1) : "—", "s", null, "", `${cycles} cycle${cycles === 1 ? "" : "s"} · ${mode}`),
      kpiCard("Order → dispatch", picking ? fmt(picking.orderToDispatchSeconds, 1) : "—", "s", null, "", scenario ? scenario.name : ""),
      kpiCard("Rack dwell", dwell ? fmt(dwell.rackDwellSeconds, 1) : "—", "s", null, "", "wait at AS/RS rack"),
      kpiCard("Dock dwell", dwell ? fmt(dwell.dockDwellSeconds, 1) : "—", "s", null, "", "wait at dispatch dock"),
      jouleCard()
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
      $("#gaugeLabel").textContent = "Mean utilization"; $("#gaugeTitle").textContent = "Fleet load";
      $("#mainSub").textContent = `Reflecting your most recent completed simulation · ${data.parameters.entities} orders · ${data.parameters.runs} replications · seed ${data.parameters.seed}`;
      $("#genAt").textContent = data.runAt ? `Run ${new Date(data.runAt).toLocaleString("en-US")}` : "";
      renderHero(); renderKpis(); renderUtilization(); renderTable(); renderJoule();
    }
    requestAnimationFrame(() => Object.values(charts).forEach((chart) => chart.resize()));
  }

  async function load() {
    if (state.busy) return; state.busy = true; $("#refresh").disabled = true; $("#error").hidden = true;
    $("#mainSub").textContent = "Loading the most recent run…";
    try {
      const response = await fetch("/api/analytics/last-run", { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (response.status === 404 && data.code === "no_simulation_run") {
        $("#empty").hidden = false; $("#layout").hidden = true; $("#mainSub").textContent = "No run yet."; $("#genAt").textContent = "";
        return;
      }
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
      $("#empty").hidden = true; $("#layout").hidden = false;
      state.data = data; renderAll();
      if (data.joulePending) loadJoule(data.jobId);
    } catch (error) {
      $("#error").hidden = false; $("#error").textContent = `Analytics unavailable: ${error.message}`; $("#mainSub").textContent = "Failed to load.";
    } finally { state.busy = false; $("#refresh").disabled = false; }
  }

  // Second, slow request: the KPIs are already on screen. Ignore the answer if
  // the user refreshed onto a different run while this one was in flight.
  async function loadJoule(jobId) {
    try {
      const response = await fetch("/api/analytics/last-run/joule", { headers: { Accept: "application/json" } });
      const out = await response.json();
      if (!response.ok) throw new Error(out.error || `Request failed (${response.status})`);
      if (state.data?.jobId !== jobId) return;
      Object.assign(state.data, { joule: out.joule, jouleError: out.jouleError, joulePending: false });
    } catch (error) {
      if (state.data?.jobId !== jobId) return;
      Object.assign(state.data, { joule: null, jouleError: error.message, joulePending: false });
    }
    renderJoule();
    // refresh only the Joule card, without re-animating the dials
    const cards = $("#kpis"); if (cards.lastElementChild) cards.replaceChild(jouleCard(), cards.lastElementChild);
  }

  window.addEventListener("resize", () => Object.values(charts).forEach((chart) => chart.resize()));
  document.addEventListener("DOMContentLoaded", () => { $("#refresh").addEventListener("click", load); load(); });
})();
