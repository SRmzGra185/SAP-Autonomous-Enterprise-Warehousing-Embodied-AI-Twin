import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import { createApprovalGate } from "../src/approvals.mjs";
import * as controls from "../src/exception-resolution.mjs";
import * as ui from "../public/exception-ui.js";

const { EXCEPTION_FIELDS, PHYSICAL_CHECKS, RESOLUTION_CHECKS, defaultExceptionDraft,
  defaultResolutionProof, describeExceptionControls, validateExceptionFingerprint,
  validatePhysicalResolvability, validateExceptionReview, validateResolutionProof } = controls;
const principal = { userId: "reviewer", roles: ["approver"] };
const action = { scenarioId: "warehouse", stepId: "S2", transitionId: "T2", nextStepId: "S3", cycle: 1, nodeId: "amr", command: "fleet.dispatch()" };
const completeDraft = () => ({ exceptionFingerprint: Object.fromEntries(EXCEPTION_FIELDS.map(key => [key, `Reviewed ${key}`])), physicalResolvability: Object.fromEntries(PHYSICAL_CHECKS.map(key => [key, "yes"])) });
const context = { jobId: "job-test", jobStatus: "complete", actionKind: "material_move" };
const proof = () => ({ checks: Object.fromEntries(RESOLUTION_CHECKS.map(key => [key, { state: "yes", evidenceReference: `local-review/${key}`, reason: "" }])) });
const bad = fn => assert.throws(fn, error => error.status === 400);
const blocked = fn => assert.throws(fn, error => error.status === 409);
function canonical(value) { return value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value); }

test("exact descriptors, pure defaults, backend/UI contract parity", () => {
  assert.equal(EXCEPTION_FIELDS.length, 15); assert.equal(PHYSICAL_CHECKS.length, 7); assert.equal(RESOLUTION_CHECKS.length, 6);
  assert.deepEqual(ui.EXCEPTION_FIELDS, EXCEPTION_FIELDS); assert.deepEqual(ui.PHYSICAL_CHECKS, PHYSICAL_CHECKS); assert.deepEqual(ui.RESOLUTION_CHECKS, RESOLUTION_CHECKS);
  assert.deepEqual(ui.defaultExceptionDraft(), defaultExceptionDraft()); assert.deepEqual(ui.defaultResolutionProof(), defaultResolutionProof());
  const draft = defaultExceptionDraft(); draft.exceptionFingerprint.Process = "changed";
  assert.equal(defaultExceptionDraft().exceptionFingerprint.Process, "");
  const descriptor = describeExceptionControls(); descriptor.fields.pop();
  assert.equal(describeExceptionControls().fields.length, 15); assert.equal(descriptor.routes.length, 4);
});
test("strict fingerprint validation; no coercion, unknown fields, oversize text or recognizable secrets", () => {
  assert.deepEqual(validateExceptionFingerprint({}, { requireComplete: false }), defaultExceptionDraft().exceptionFingerprint);
  const draft = completeDraft();
  for (const key of EXCEPTION_FIELDS) {
    for (const value of ["", "   ", null, 4, [], {}, "x".repeat(1201), "password=do-not-record", "Bearer abcdef", "https://a:b@host/path", "\u0000"])
      bad(() => validateExceptionFingerprint({ ...draft.exceptionFingerprint, [key]: value }));
    const missing = { ...draft.exceptionFingerprint }; delete missing[key]; bad(() => validateExceptionFingerprint(missing));
  }
  assert.equal(validateExceptionFingerprint({ ...draft.exceptionFingerprint, Process: " x " }).Process, "x");
  assert.equal(validateExceptionFingerprint({ ...draft.exceptionFingerprint, Process: "x".repeat(1200) }).Process.length, 1200);
  bad(() => validateExceptionFingerprint({ ...draft.exceptionFingerprint, rogue: "field" }));
  bad(() => validateExceptionFingerprint(JSON.parse('{"__proto__": {}}')));
  bad(() => validateExceptionFingerprint([]));
  assert.throws(() => validateExceptionFingerprint({ ...draft.exceptionFingerprint, Process: "password=TOP-SECRET-VALUE" }), error => !error.message.includes("TOP-SECRET-VALUE"));
});
test("all seven states independently block unknown/no; review hash binds single action", () => {
  const draft = completeDraft(), binding = { ...action, approvalId: "approval-one" };
  for (const key of PHYSICAL_CHECKS) {
    for (const value of ["unknown", "no"]) blocked(() => validateExceptionReview({ ...draft, physicalResolvability: { ...draft.physicalResolvability, [key]: value } }, binding));
    for (const value of [true, "YES", null, "not_applicable"]) bad(() => validatePhysicalResolvability({ ...draft.physicalResolvability, [key]: value }));
    const missing = { ...draft.physicalResolvability }; delete missing[key]; bad(() => validatePhysicalResolvability(missing));
  }
  bad(() => validatePhysicalResolvability({ ...draft.physicalResolvability, rogue: "yes" }));
  const one = validateExceptionReview(draft, binding);
  assert.match(one.reviewHash, /^[a-f0-9]{64}$/);
  assert.equal(one.reviewHash, validateExceptionReview({ physicalResolvability: draft.physicalResolvability, exceptionFingerprint: Object.fromEntries(Object.entries(draft.exceptionFingerprint).reverse()) }, binding).reviewHash);
  assert.notEqual(one.reviewHash, validateExceptionReview(draft, { ...binding, approvalId: "approval-two" }).reviewHash);
  assert.notEqual(one.reviewHash, validateExceptionReview(draft, { ...binding, transitionId: "T3" }).reviewHash);
});
test("post-execution proof: no auto-pass, all required evidence, inspection N/A rules, canonical local hash", () => {
  blocked(() => validateResolutionProof(proof(), { ...context, jobStatus: "running" }));
  bad(() => validateResolutionProof(proof(), { ...context, actionKind: "automatic" }));
  assert.equal(validateResolutionProof(defaultResolutionProof(), context).status, "awaiting_evidence");
  for (const [index, key] of RESOLUTION_CHECKS.entries()) {
    for (const state of ["no", "unknown", "not_applicable"]) {
      const input = proof(); input.checks[key].state = state;
      assert.equal(validateResolutionProof(input, context).status, state === "unknown" ? "awaiting_evidence" : "blocked");
    }
    const input = proof(); input.checks[key].evidenceReference = "";
    assert.equal(validateResolutionProof(input, context).status, "awaiting_evidence");
    input.checks[key] = { state: "not_applicable", reason: "Inspection-only sensing; no material handling", evidenceReference: "" };
    assert.equal(validateResolutionProof(input, { ...context, actionKind: "inspection" }).status, index < 3 ? "resolved_simulated" : "blocked");
    input.checks[key].reason = "";
    assert.equal(validateResolutionProof(input, { ...context, actionKind: "inspection" }).status, "blocked");
    bad(() => validateResolutionProof({ checks: { ...proof().checks, [key]: { ...proof().checks[key], rogue: true } } }, context));
    bad(() => validateResolutionProof({ checks: { ...proof().checks, [key]: { ...proof().checks[key], evidenceReference: "x".repeat(513) } } }, context));
    bad(() => validateResolutionProof({ checks: { ...proof().checks, [key]: { ...proof().checks[key], reason: "x".repeat(1201) } } }, context));
    const missing = proof(); delete missing.checks[key]; bad(() => validateResolutionProof(missing, context));
  }
  bad(() => validateResolutionProof({ ...proof(), actionKind: "inspection" }, context));
  bad(() => validateResolutionProof({ ...proof(), synthetic: true }, context));
  const result = validateResolutionProof(proof(), context);
  assert.equal(result.status, "resolved_simulated"); assert.equal(result.dispatched, false);
  assert.equal(result.proofHash, createHash("sha256").update(canonical({ version: 1, binding: result.binding, resolutionProof: result.resolutionProof, status: result.status })).digest("hex"));
  assert.notEqual(result.proofHash, validateResolutionProof(proof(), { ...context, jobId: "other-job" }).proofHash);
});
test("approval validates actual role and pending inputs; immutable single-action audit; no replay", async () => {
  const events = [], gate = createApprovalGate({ emit: event => events.push(event), timeoutMs: 1000 });
  const wait = gate.request(action), approvalId = gate.pending.approvalId;
  const body = { approvalId, decision: "approve", ...completeDraft() };
  assert.throws(() => gate.decide(body, { roles: ["operator"] }), error => error.status === 403);
  assert.throws(() => gate.decide(body, null), error => error.status === 403);
  bad(() => gate.decide({ approvalId, decision: "approve" }, principal));
  blocked(() => gate.decide({ ...body, physicalResolvability: defaultExceptionDraft().physicalResolvability }, principal));
  await assert.rejects(gate.request(action), /Another action/);
  assert.equal(gate.pending.approvalId, approvalId);
  const exposed = gate.pending; exposed.stepId = "tampered"; events[0].stepId = "tampered";
  const decision = gate.decide(body, principal); assert.equal((await wait).actionBinding.stepId, "S2");
  assert.equal(decision.actionBinding.nextStepId, "S3"); assert.equal(decision.dispatched, false);
  const resolved = events.find(event => event.type === "approval_resolved");
  assert.deepEqual(resolved.exceptionFingerprint, completeDraft().exceptionFingerprint); assert.ok(resolved.fingerprintHash); assert.ok(resolved.reviewHash);
  body.exceptionFingerprint.Process = "later mutation"; assert.notEqual(resolved.exceptionFingerprint.Process, "later mutation");
  blocked(() => gate.decide(body, principal));
  const next = gate.request({ ...action, transitionId: "T3" }); const nextRejected = assert.rejects(next, /rejected/);
  blocked(() => gate.decide(body, principal));
  gate.decide({ approvalId: gate.pending.approvalId, decision: "reject" }, principal); await nextRejected;
  assert.equal(gate.pending, null); gate.dispose();
});
test("pending request/cancel, expiry, disposal and failed emission settle without hanging", { timeout: 2000 }, async () => {
  const controller = new AbortController(), gate = createApprovalGate({ emit() {}, signal: controller.signal });
  const wait = assert.rejects(gate.request(action), /cancelled/);
  controller.abort(); await wait; assert.equal(gate.pending, null); await assert.rejects(gate.request(action), /cancelled/); gate.dispose();
  const expired = createApprovalGate({ emit() {}, timeoutMs: 5 }); await assert.rejects(expired.request(action), /expired/); expired.dispose();
  const disposed = createApprovalGate({ emit() {} }); const finish = assert.rejects(disposed.request(action), /ended/); disposed.dispose(); await finish; await assert.rejects(disposed.request(action), /ended/);
  const broken = createApprovalGate({ emit() { throw new Error("audit failed"); } }); await assert.rejects(broken.request(action), /audit failed/); assert.equal(broken.pending, null); broken.dispose();
});

// Small DOM double: exercise form binding/payloads without a browser or network.
class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.value = ""; this.checked = false; this.listeners = {}; }
  append(...children) { for (const child of children) { if (child.parent) child.parent.children = child.parent.children.filter(item => item !== child); child.parent = this; this.children.push(child); } }
  replaceChildren(...children) { this.children = []; this.append(...children); }
  setAttribute() {}
  addEventListener(name, handler) { this.listeners[name] = handler; }
  querySelectorAll(selector) { const tags = selector.split(",").map(tag => tag.trim()); return this.children.flatMap(child => [...(tags.includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)]); }
}
test("UI retains drafts, resets each action review, protects pending binding, GET/POST proof is explicit", async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: tag => new Element(tag), createTextNode: () => new Element("text") };
  try {
    const approvalHost = new Element("div"), draftHost = new Element("div"), proofHost = new Element("div"), calls = [];
    const api = async (path, options) => { calls.push({ path, options }); return validateResolutionProof(options ? JSON.parse(options.body) : defaultResolutionProof(), { ...context, jobId: "job-ui" }); };
    const editor = ui.createExceptionUI({ api, approvalHost, draftHost, proofHost });
    editor.selectAction(action);
    for (const input of draftHost.querySelectorAll("textarea")) input.value = "Reviewed local context";
    editor.beginApproval({ ...action, approvalId: "first" });
    for (const input of approvalHost.querySelectorAll("select")) input.value = "yes";
    const review = approvalHost.querySelectorAll("input")[0]; review.checked = true;
    assert.equal(editor.canApprove(), true); assert.equal(editor.approvalPayload().approvalId, "first");
    assert.equal(editor.selectAction({ ...action, stepId: "wrong" }), false);
    editor.endApproval(); editor.beginApproval({ ...action, approvalId: "second" });
    assert.equal(editor.canApprove(), false); assert.equal(editor.getDraft().exceptionFingerprint.Process, "Reviewed local context");
    editor.setRunning(true); editor.endApproval(); assert.ok(draftHost.querySelectorAll("textarea").every(input => input.disabled));
    await editor.showProof({ jobId: "job-ui", actionKind: "material_move" });
    assert.equal(calls.length, 1); assert.equal(calls[0].options, undefined);
    assert.ok(proofHost.querySelectorAll("select").every(input => input.value === "unknown"));
    const submit = proofHost.querySelectorAll("button")[0]; await submit.onclick();
    assert.equal(calls[1].path, "/api/jobs/job-ui/resolution"); assert.deepEqual(Object.keys(JSON.parse(calls[1].options.body)), ["checks"]);
    assert.ok(proofHost.querySelectorAll("select").every(input => input.value === "unknown"));
    editor.clearProof(); await submit.onclick(); assert.equal(calls.length, 2);
  } finally { globalThis.document = previous; }
});
