/** Simulation-only UI helpers. Server validators/roles remain authoritative.
 * createExceptionUI({api, approvalHost, draftHost, proofHost, onChange}) returns:
 * selectAction({scenarioId, stepId, transitionId?, command?, label?}) — draft TN editor;
 * beginApproval(event), endApproval(), canApprove(), approvalPayload(), getDraft();
 * showProof({jobId, actionKind}), clearProof(). No browser persistence or device calls.
 * api is the existing authenticated JSON callback. Proof GET/POST uses
 * /api/jobs/:id/resolution and a direct resolution record (or {resolution: record}).
 * A record is {status, binding:{jobId,actionKind}, resolutionProof:{checks}, proofHash}.
 * GET may return null when unsaved; POST sends only {checks}. Proof is never inferred
 * from job completion or synthetic samples. See src/exception-resolution.mjs contract.
 */
export const EXCEPTION_FIELDS = Object.freeze([
  "Business Object", "Process", "Exception Type", "Business Impact", "Urgency",
  "Root Cause Candidates", "Physical Dependency", "Physical Location", "Required Outcome",
  "Available Resources", "Constraints", "Safety Requirements", "Authorization Requirements",
  "Evidence Requirements", "Resolution Criteria"
]);
export const PHYSICAL_CHECKS = Object.freeze([
  "isCausePhysical", "stateObservable", "suitableDeviceAvailable", "locationKnown",
  "actionSafe", "actionAuthorized", "resolutionVerifiable"
]);
export const RESOLUTION_CHECKS = Object.freeze([
  "correctMaterial", "correctQuantity", "correctDestination", "physicalPresence",
  "expectedState", "originatingExceptionCleared"
]);
export function defaultExceptionDraft() {
  return { exceptionFingerprint: Object.fromEntries(EXCEPTION_FIELDS.map(key => [key, ""])),
    physicalResolvability: Object.fromEntries(PHYSICAL_CHECKS.map(key => [key, "unknown"])) };
}
export function defaultResolutionProof() {
  return { checks: Object.fromEntries(RESOLUTION_CHECKS.map(key => [key, { state: "unknown", evidenceReference: "", reason: "" }])) };
}
const friendly = key => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase());
function element(tag, className = "", text = "") {
  const el = document.createElement(tag); el.className = className; el.textContent = text; return el;
}
function select(states) {
  const el = element("select");
  for (const state of states) { const option = element("option", "", state.replaceAll("_", " ")); option.value = state; el.append(option); }
  return el;
}
function field(parent, label, control) { const el = element("label", "exception-field", label); el.append(control); parent.append(el); return control; }
export function createExceptionUI({ api, approvalHost, draftHost, proofHost, onChange = () => {} }) {
  const drafts = new Map(), carry = new Map(), textInputs = new Map(), physicalInputs = new Map();
  let context = null, pendingId = null, currentKey = null, proofJobId = null, proofKind = "other", proofGeneration = 0, running = false;
  const root = element("section", "exception-controls"), title = element("h3", "", "Exception fingerprint · simulation only");
  const notice = element("p", "exception-notice", "No secrets or credentials. These are operator review values, not authoritative safety checks. Suitable device means actual capability for this action; ANYmal inspection does not imply material manipulation.");
  const routes = element("p", "exception-notice", "Four routes to review: workflow correction · human intervention · device inspection · device material movement. No route is chosen or dispatched automatically.");
  const grid = element("div", "exception-grid"), physical = element("fieldset", "exception-physical");
  physical.append(element("legend", "", "Physical resolvability — every unknown/no blocks simulated approval"));
  const review = element("input"); review.type = "checkbox";
  const reviewLabel = element("label", "exception-review"); reviewLabel.append(review, document.createTextNode(" I explicitly reviewed these values for this single action / TN. This is simulation only."));
  root.append(title, notice, routes, grid, physical, reviewLabel); root.hidden = true; draftHost.append(root);
  function save() {
    if (!currentKey) return;
    const draft = getDraft(); drafts.set(currentKey, draft);
    carry.set(context.scenarioId || "", structuredClone(draft.exceptionFingerprint));
  }
  function changed() { review.checked = false; save(); onChange(); }
  for (const name of EXCEPTION_FIELDS) {
    const input = element("textarea"); input.maxLength = 1200; input.rows = 2; input.autocomplete = "off"; input.spellcheck = false;
    input.placeholder = `${name} — required for approval`; input.addEventListener("input", changed);
    textInputs.set(name, field(grid, name, input));
  }
  for (const key of PHYSICAL_CHECKS) {
    const input = select(["unknown", "yes", "no"]); input.addEventListener("change", changed);
    physicalInputs.set(key, field(physical, friendly(key), input));
  }
  review.addEventListener("change", onChange);
  function getDraft() {
    return { exceptionFingerprint: Object.fromEntries([...textInputs].map(([key, input]) => [key, input.value])),
      physicalResolvability: Object.fromEntries([...physicalInputs].map(([key, input]) => [key, input.value])) };
  }
  function load(action) {
    save(); context = { ...action };
    currentKey = JSON.stringify([action.scenarioId || "", action.stepId || "", action.transitionId || "", action.command || ""]);
    const draft = structuredClone(drafts.get(currentKey) || defaultExceptionDraft());
    if (!drafts.has(currentKey) && carry.has(action.scenarioId || "")) draft.exceptionFingerprint = structuredClone(carry.get(action.scenarioId || ""));
    for (const [key, input] of textInputs) input.value = draft.exceptionFingerprint[key];
    for (const [key, input] of physicalInputs) input.value = draft.physicalResolvability[key];
    review.checked = false; root.hidden = false;
    title.textContent = `${action.stepId || "Action"}${action.transitionId ? ` / ${action.transitionId}` : ""} · ${action.label || "Exception fingerprint"} · simulation only`;
  }
  function canApprove() {
    return Boolean(pendingId && review.checked && [...textInputs.values()].every(input => input.value.trim() && input.value.length <= 1200) && [...physicalInputs.values()].every(input => input.value === "yes"));
  }
  function editability() { for (const input of root.querySelectorAll("input, textarea, select")) input.disabled = running && !pendingId; }
  const proof = element("section", "exception-proof"), proofTitle = element("h3", "", "Resolution proof · simulation only");
  const proofNotice = element("p", "exception-notice", "Execution completion is not exception resolution. Enter evidence references explicitly; synthetic events do not auto-pass any check. This local hash is not a signature or safety certificate. Never enter secrets or signed URLs.");
  const proofStatus = element("p", "exception-proof-status", "awaiting_evidence"), proofGrid = element("div", "exception-proof-grid");
  proofStatus.setAttribute("role", "status");
  const submit = element("button", "secondary-button", "Submit simulated resolution proof"); submit.type = "button";
  const exportProof = element("button", "secondary-button", "Export saved Resolution Proof"); exportProof.type = "button"; exportProof.disabled = true;
  let savedProof = null;
  exportProof.onclick = () => {
    if (!savedProof) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(savedProof, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "resolution-proof-simulated.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  proof.append(proofTitle, proofNotice, proofStatus, proofGrid, submit, exportProof); proof.hidden = true; proofHost.append(proof);
  let proofInputs = new Map();
  function renderProof(data = defaultResolutionProof()) {
    proofGrid.replaceChildren(); proofInputs = new Map();
    for (const [index, key] of RESOLUTION_CHECKS.entries()) {
      const row = element("fieldset", "exception-proof-row"); row.append(element("legend", "", friendly(key)));
      const states = ["unknown", "yes", "no", ...(proofKind === "inspection" && index < 3 ? ["not_applicable"] : [])];
      const state = field(row, "Result", select(states)); state.value = states.includes(data.checks?.[key]?.state) ? data.checks[key].state : "unknown";
      const evidenceReference = element("input"); evidenceReference.type = "text"; evidenceReference.maxLength = 512; evidenceReference.autocomplete = "off";
      evidenceReference.value = data.checks?.[key]?.evidenceReference || ""; field(row, "Evidence reference (required for yes; not fetched)", evidenceReference);
      const reason = element("textarea"); reason.maxLength = 1200; reason.rows = 2; reason.autocomplete = "off";
      reason.value = data.checks?.[key]?.reason || ""; field(row, "Reason (required for inspection not applicable)", reason);
      for (const input of [state, evidenceReference, reason]) input.addEventListener("input", () => { proofStatus.textContent = "Unsaved review · submit to validate; previous status does not apply to edits."; });
      proofInputs.set(key, { state, evidenceReference, reason }); proofGrid.append(row);
    }
  }
  function showRecord(response) {
    const record = response?.resolution ?? response;
    if (!record) { proofStatus.textContent = "awaiting_evidence · no submitted proof"; return; }
    if (record.binding?.jobId && record.binding.jobId !== proofJobId) throw new Error("Resolution response belongs to another job.");
    savedProof = record.proofHash ? structuredClone(record) : null; exportProof.disabled = !savedProof;
    if (["material_move", "inspection", "other"].includes(record.binding?.actionKind)) proofKind = record.binding.actionKind;
    if (record.resolutionProof) renderProof(record.resolutionProof);
    const status = ["awaiting_evidence", "blocked", "resolved_simulated"].includes(record.status) ? record.status : "awaiting_evidence";
    proofStatus.textContent = `${status} · simulation only${record.proofHash ? ` · local SHA-256 ${record.proofHash}` : ""}${record.blockers?.length ? ` · ${record.blockers.join("; ")}` : ""}`;
  }
  function busy(value) { submit.disabled = value; for (const input of proofGrid.querySelectorAll("input, textarea, select")) input.disabled = value; }
  submit.onclick = async () => {
    if (!proofJobId || submit.disabled) return;
    const generation = proofGeneration, id = proofJobId;
    const body = { checks: Object.fromEntries([...proofInputs].map(([key, controls]) => [key, Object.fromEntries(Object.entries(controls).map(([name, input]) => [name, input.value]))])) };
    busy(true);
    try { const response = await api(`/api/jobs/${encodeURIComponent(id)}/resolution`, { method: "POST", body: JSON.stringify(body) }); if (generation === proofGeneration) showRecord(response); }
    catch (error) { if (generation === proofGeneration) proofStatus.textContent = `Proof not saved: ${error.message}`; }
    finally { if (generation === proofGeneration) busy(false); }
  };
  return {
    selectAction(action) { if (pendingId || running) return false; load(action); reviewLabel.hidden = true; draftHost.append(root); editability(); onChange(); return true; },
    beginApproval(event) { if (pendingId === event.approvalId) return; load(event); pendingId = event.approvalId; reviewLabel.hidden = false; approvalHost.append(root); editability(); onChange(); },
    endApproval() { save(); pendingId = null; review.checked = false; reviewLabel.hidden = true; draftHost.append(root); editability(); onChange(); },
    setRunning(value) { running = Boolean(value); editability(); },
    getDraft, canApprove,
    approvalPayload() { if (!canApprove()) throw new Error("Complete all 15 fields, set all seven checks to yes and explicitly review this action."); return { approvalId: pendingId, ...getDraft() }; },
    async showProof({ jobId, actionKind = "other" }) {
      if (!jobId) return;
      const generation = ++proofGeneration; proofJobId = jobId; proofKind = actionKind; savedProof = null; exportProof.disabled = true;
      proof.hidden = false; proofTitle.textContent = `Resolution proof · ${jobId} · simulation only`;
      renderProof(); proofStatus.textContent = "awaiting_evidence · loading saved review"; busy(true);
      try { const response = await api(`/api/jobs/${encodeURIComponent(jobId)}/resolution`); if (generation === proofGeneration) showRecord(response); }
      catch (error) { if (generation === proofGeneration) proofStatus.textContent = `awaiting_evidence · saved proof unavailable: ${error.message}`; }
      finally { if (generation === proofGeneration) busy(false); }
    },
    clearProof() { ++proofGeneration; proofJobId = null; proof.hidden = true; savedProof = null; exportProof.disabled = true; }
  };
}
