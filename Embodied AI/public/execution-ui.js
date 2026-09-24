import { createExceptionUI } from "./exception-ui.js";
import { createCameraFeed } from "./camera-feed.js";

export function createExecutionUI({ api, getModel, getWorld, getScenario, run, selectScenario, inspectNode, canApprove }) {
  const $ = (id) => document.getElementById(id), put = (id, value) => { $(id).textContent = value; };
  let jobId = null, pending = null, active = null, completed = new Set(), labels = new Map(), events = [];
  let approvalCamera = null;
  const draftHost = document.createElement("div"), proofHost = document.createElement("div");
  draftHost.id = "exception-draft-host"; proofHost.id = "exception-proof-host";
  $("approval-panel").after(draftHost, proofHost);
  const exceptionUI = createExceptionUI({ api, approvalHost: $("approval-panel"), draftHost, proofHost,
    onChange: () => { $("approval-approve").disabled = !canApprove || !exceptionUI.canApprove(); } });
  function selectExceptionAction(step) {
    const scenario = getScenario(), transition = scenario?.grafcet.transitions.find(item => item.from === step.id);
    return exceptionUI.selectAction({ ...step, scenarioId: scenario?.id, stepId: step.id, transitionId: transition?.id });
  }
  function lock(running) {
    exceptionUI.setRunning(running);
    for (const id of ["mission-run", "mission-scenario", "mission-mode", "run-robot-routine", "robot-mode", "robot-cycles", "robot-speed", "load-robot-cell", "step-robot-routine"]) $(id).disabled = running;
    $("mission-stop").disabled = !running;
    document.querySelectorAll(".robot-scenario-card").forEach((el) => { el.disabled = running; });
  }
  function ribbon() {
    const parent = $("mission-steps"); parent.replaceChildren();
    for (const [index, step] of (getScenario()?.grafcet.steps || []).entries()) {
      const el = document.createElement("button"); el.type = "button";
      el.className = `mission-step${active === step.nodeId ? " current" : ""}${completed.has(step.nodeId) ? " complete" : ""}`;
      el.textContent = `${completed.has(step.nodeId) ? "✓" : String(index + 1).padStart(2, "0")}  ${step.label}`;
      el.title = `${step.action} · ${step.command}`;
      el.onclick = () => { getWorld()?.focusNode?.(step.nodeId); selectExceptionAction(step); }; parent.append(el);
    }
  }
  function status(text, tone = "idle") { put("mission-status", text); $("mission-status").dataset.tone = tone; }
  function clearApproval() { pending = null; approvalCamera?.stop(); exceptionUI.endApproval(); $("approval-panel").classList.add("hidden"); }
  async function decide(decision) {
    if (!pending || !jobId) return;
    $("approval-approve").disabled = true; $("approval-reject").disabled = true;
    const approvalId = pending.approvalId;
    try {
      const body = decision === "approve" ? { ...exceptionUI.approvalPayload(), decision } : { approvalId, decision };
      await api(`/api/jobs/${jobId}/approval`, { method: "POST", body: JSON.stringify(body) });
    }
    catch (error) { if (pending?.approvalId !== approvalId) return; put("approval-error", error.message); $("approval-approve").disabled = !canApprove || !exceptionUI.canApprove(); $("approval-reject").disabled = !canApprove; }
  }
  $("approval-approve").onclick = () => decide("approve"); $("approval-reject").onclick = () => decide("reject");
  $("mission-run").onclick = () => { $("robot-mode").value = $("mission-mode").value; run(); };
  $("mission-mode").onchange = () => { $("robot-mode").value = $("mission-mode").value; };
  $("robot-mode").addEventListener("change", () => { $("mission-mode").value = $("robot-mode").value; });
  $("mission-scenario").onchange = () => selectScenario($("mission-scenario").value);
  $("mission-stop").onclick = async () => { if (!jobId) return; try { await api(`/api/jobs/${jobId}/cancel`, { method: "POST", body: "{}" }); } catch (error) { put("mission-detail", error.message); } };
  $("mission-focus").onclick = () => { const focused = document.querySelector(".workspace-grid").classList.toggle("twin-focused"); $("mission-focus").textContent = focused ? "Show panels" : "Focus twin"; requestAnimationFrame(() => getWorld()?.fit?.()); };
  $("mission-export").onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ prototype: true, productionCommands: false, jobId, events }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "routine-evidence.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return {
    // Main GRAFCET click handler may call selectExceptionStep(step), or use the lower-level
    // exceptionUI.selectAction({scenarioId, stepId, transitionId, command, label}).
    selectExceptionStep: selectExceptionAction,
    inspectStep: selectExceptionAction,
    inspectTransition(transition, sourceStep) {
      return exceptionUI.selectAction({ ...sourceStep, scenarioId: getScenario()?.id, stepId: sourceStep.id,
        transitionId: transition.id, nextStepId: transition.to, label: `${transition.id} · ${transition.receptivity}` });
    },
    exceptionUI,
    scenario(scenarios) { const select = $("mission-scenario"); select.replaceChildren(); for (const item of scenarios) { const option = document.createElement("option"); option.value = item.id; option.textContent = `${item.domain} · ${item.robot}`; select.append(option); } select.value = getScenario()?.id; ribbon(); },
    select(id) { $("mission-scenario").value = id; active = null; completed.clear(); ribbon(); },
    started(id) { jobId = id; exceptionUI.clearProof(); lock(true); events = []; clearApproval(); completed.clear(); active = null; status("Queued", "running"); },
    failed(message) { lock(false); status("Not running", "error"); put("mission-detail", message); clearApproval(); },
    frame(frame) {
      if ($("scene-3d").classList.contains("hidden")) return;
      const model = getModel(); if (!model) return;
      const existing = new Set();
      for (const projected of frame.nodes || []) {
        const node = model.nodes.find((item) => item.id === projected.id); if (!node) continue;
        existing.add(node.id); let el = labels.get(node.id);
        if (!el) { el = document.createElement("button"); el.type = "button"; el.className = "mesh-label"; el.append(document.createElement("strong"), document.createElement("span")); el.onclick = () => { getWorld()?.focusNode?.(node.id); inspectNode?.(getModel().nodes.find(item => item.id === node.id)); }; labels.set(node.id, el); $("mesh-labels").append(el); }
        el.children[0].textContent = node.name;
        el.children[1].textContent = `${completed.has(node.id) ? "✓ Done · " : active === node.id ? "● Active · " : ""}Cap ${node.capacity} · demo service ${node.service} s`;
        el.title = `${node.name}\n${node.subtitle}\nCapacity ${node.capacity} · Service ${node.service} demo seconds${node.rackState ? "\nRack: " + node.rackState + " · SKU " + node.sku + " · EPC " + node.rfidEpc : ""}`;
        el.classList.toggle("is-active", node.id === active); el.classList.toggle("is-complete", completed.has(node.id));
        el.style.transform = `translate(${projected.x}px, ${projected.y}px) translate(-50%, -100%)`; el.hidden = projected.visible === false;
      }
      for (const [id, el] of labels) if (!existing.has(id)) { el.remove(); labels.delete(id); }
    },
    event(event) {
      if (event.kind !== "robot_routine") return;
      jobId = event.id; events.push(event); if (events.length > 2000) events.shift();
      if (event.type === "robot_routine_started") { lock(true); completed.clear(); status("Running · simulated", "running"); put("mission-detail", "Following the SAP event into physical execution. No live commands."); }
      if (event.type === "grafcet_step_active") {
        active = event.nodeId; ribbon(); put("mission-step-title", `${event.stepId} · ${event.label}`); put("mission-detail", event.action); put("mission-sensor", `Waiting for ${event.sensor}: ${event.expected}`); put("mission-counter", `Cycle ${event.cycle} · ${event.index + 1}/${event.totalSteps}`);
        getWorld()?.setFlowState({ running: true, paused: event.awaitingApproval, activeNodeId: event.nodeId, fromNodeId: event.fromNodeId, toNodeId: event.nodeId, completedNodeIds: [...completed], stepId: event.stepId, durationMs: event.durationMs, startedAt: performance.now() });
      }
      if (event.type === "routine_transfer") {
        active = event.nodeId; ribbon(); status("Running · simulated", "running");
        const nodes = getModel()?.nodes || [], name = (id) => nodes.find((node) => node.id === id)?.name || id;
        put("mission-route", `${name(event.fromNodeId)} → ${name(event.toNodeId)}`);
        if (!event.stepId) { put("mission-step-title", event.label); put("mission-detail", "Moving a simulated business-event / evidence package along the digital thread."); }
        getWorld()?.setFlowState({ running: true, paused: false, activeNodeId: event.nodeId, fromNodeId: event.fromNodeId, toNodeId: event.toNodeId, durationMs: event.durationMs, startedAt: performance.now(), completedNodeIds: [...completed] });
      }
      if (event.type === "approval_required") {
        pending = event; status("Waiting for your approval", "waiting"); getWorld()?.setFlowState({ running: true, paused: true }); $("approval-panel").classList.remove("hidden");
        put("approval-title", `${event.stepId} · ${event.label}`);
        const riskAdvice = { critical: "Physical handling of goods. Verify identity and grip before approving.", risky: "Material movement. Confirm path is clear before approving.", routine: "Data / validation step. Low physical risk." };
        const risk = event.risk || "routine";
        const riskEl = $("approval-risk");
        riskEl.textContent = `RISK: ${risk.toUpperCase()} — ${riskAdvice[risk] || riskAdvice.routine}`;
        riskEl.dataset.risk = risk;
        approvalCamera ||= createCameraFeed($("approval-camera-canvas"), { label: "H1 CAM · DECISION" });
        approvalCamera.start();
        put("approval-action", `${event.action} Command: ${event.command}. Intended actor: ${event.intendedActor || "Authorized operator"}.`);
        put("approval-scope", `One simulated action · expires ${new Date(event.expiresAt).toLocaleTimeString()} · no SAP or robot writes. ${event.caseContext ? "SKU " + event.caseContext.sku + " · EPC " + event.caseContext.rfidEpc + " · qty " + event.caseContext.quantity + " → " + event.caseContext.destination + " · rack " + event.caseContext.rackState : ""}`);
        exceptionUI.beginApproval(event);
        put("approval-error", canApprove ? "The server is paused. Complete the fingerprint and explicitly review this action. Reject remains available without filling the form." : "An approver or administrator must decide."); $("approval-approve").disabled = !canApprove || !exceptionUI.canApprove(); $("approval-reject").disabled = !canApprove;
      }
      if (["approval_resolved", "approval_expired"].includes(event.type)) clearApproval();
      if (event.type === "sensor_sample") { put("mission-sensor", `✓ ${event.source}: ${event.value} · synthetic sample`); completed.add(event.nodeId); ribbon(); }
      if (["job_complete", "job_failed", "job_cancelled"].includes(event.type)) {
        lock(false); clearApproval(); getWorld()?.setFlowState({ running: false, paused: false, completedNodeIds: [...completed] });
        status(event.type === "job_complete" ? "Execution complete · resolution awaiting evidence" : event.type === "job_cancelled" ? "Cancelled safely" : "Stopped", event.type === "job_complete" ? "complete" : "error");
        put("mission-detail", event.error || "Simulated routine completed, not exception resolution. Review and submit resolution proof below."); $("run-robot-routine").textContent = "Run routine";
        if (event.type === "job_complete") void exceptionUI.showProof({ jobId, actionKind: event.result?.resolutionActionKind || "other" });
      }
    }
  };
}
