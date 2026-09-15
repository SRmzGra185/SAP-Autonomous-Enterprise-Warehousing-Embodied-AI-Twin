import { createHash } from "node:crypto";
import { HttpError } from "../http-utils.mjs";

/** Local simulation controls only. No device calls, capability certification or secret storage.
 * All validate* functions return a normalized copy or throw HttpError (400 malformed,
 * 409 blocked approval/incomplete execution). Errors never echo submitted values.
 * defaultExceptionDraft() is deliberately incomplete; never evidence or authorization.
 * describeExceptionControls() returns a fresh JSON descriptor for API/UI consumers.
 *
 * Approval JSON: {approvalId, decision, exceptionFingerprint, physicalResolvability}.
 * Fingerprint keys are the 15 exact labels below; physical values are unknown/yes/no.
 * validateExceptionReview(payload, actionBinding) requires every field and all seven yes.
 * actionBinding is SERVER-owned {approvalId, scenarioId, stepId, transitionId?, nextStepId?, cycle,
 * nodeId, command}; never take it from the decision body. Each approval ID is single-use.
 *
 * Resolution POST /api/jobs/:id/resolution body: {checks: {[check]:
 *   {state: "unknown"|"yes"|"no"|"not_applicable", evidenceReference: string, reason: string}}}.
 * Call validateResolutionProof(body, {jobId, jobStatus: "complete", actionKind}) AFTER
 * tenant/owner/role checks. Derive actionKind (material_move|inspection|other) from the
 * stored job, not user input. Mixed routines with any material movement use material_move.
 * Persist/return the result as the resolution record. Malformed bodies throw; valid but
 * incomplete/negative records return awaiting_evidence/blocked; only explicit affirmative
 * evidence yields resolved_simulated. No sensor event or synthetic result is auto-passed.
 * Evidence references are inert strings: not fetched or authenticated. The caller must
 * supply and review them. SHA-256 is a canonical LOCAL integrity hash, not a signature,
 * independent verification, real-world resolution, or safety certificate.
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
export const TEXT_LIMITS = Object.freeze({ fingerprint: 1200, evidenceReference: 512, reason: 1200 });
const physicalStates = ["unknown", "yes", "no"];
const proofStates = [...physicalStates, "not_applicable"];
const routes = [
  { id: "workflow_correction", label: "Workflow correction", description: "Correct process context; physical approval remains blocked unless all physical checks are yes." },
  { id: "human_intervention", label: "Human intervention", description: "Escalate to an authorized person; no automatic dispatch or safety claim." },
  { id: "device_inspection", label: "Device inspection", description: "Use evidenced sensing/navigation capability; inspection does not imply manipulation." },
  { id: "material_movement", label: "Device material movement", description: "Require actual payload, handling and destination capabilities; robot identity alone is insufficient." }
];
export function describeExceptionControls() {
  return structuredClone({ version: 1, fields: EXCEPTION_FIELDS, physicalChecks: PHYSICAL_CHECKS,
    resolutionChecks: RESOLUTION_CHECKS, physicalStates, proofStates, limits: TEXT_LIMITS,
    routes, simulationOnly: true, capabilityNotice: "Suitable device means actual capability for this action. ANYmal inspection capability does not imply material manipulation.",
    secretNotice: "No passwords, access tokens, credentials or signed URLs. Secret-pattern rejection is best-effort, not a DLP guarantee." });
}
export function defaultExceptionDraft() {
  return { exceptionFingerprint: Object.fromEntries(EXCEPTION_FIELDS.map(key => [key, ""])),
    physicalResolvability: Object.fromEntries(PHYSICAL_CHECKS.map(key => [key, "unknown"])) };
}
export function defaultResolutionProof() {
  return { checks: Object.fromEntries(RESOLUTION_CHECKS.map(key => [key, { state: "unknown", evidenceReference: "", reason: "" }])) };
}
function invalid(message) { throw new HttpError(400, message, "exception_validation_error"); }
function record(value, keys, name) {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(`${name} must be an object.`);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"))) invalid(`${name} contains unknown or non-data fields.`);
}
// Do not echo suspected secrets. Arbitrary credentials cannot be recognized reliably.
const secretPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:password|passwd|api[_-]?key|access[_-]?token|client[_-]?secret|authorization|signature|x-amz-signature)\s*[=:]\s*\S+|\b(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9]{15,}|AKIA[A-Z0-9]{16})\b|\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|https?:\/\/[^\s/]+:[^\s/]+@/i;
function cleanText(value, limit, name, required = false) {
  if (typeof value !== "string") invalid(`${name} must be text.`);
  if (value.length > limit) invalid(`${name} exceeds ${limit} characters.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) invalid(`${name} contains invalid control characters.`);
  if (secretPattern.test(value)) invalid(`${name} must not contain credentials or secrets.`);
  const normalized = value.trim();
  if (required && !normalized) invalid(`${name} is required.`);
  return normalized;
}
export function validateExceptionFingerprint(input, { requireComplete = true } = {}) {
  record(input, EXCEPTION_FIELDS, "exceptionFingerprint");
  return Object.fromEntries(EXCEPTION_FIELDS.map(key => [key, cleanText(Object.hasOwn(input, key) ? input[key] : "", TEXT_LIMITS.fingerprint, key, requireComplete)]));
}
export function validatePhysicalResolvability(input, { requireAllYes = false } = {}) {
  record(input, PHYSICAL_CHECKS, "physicalResolvability");
  const output = Object.fromEntries(PHYSICAL_CHECKS.map(key => {
    if (!Object.hasOwn(input, key) || !physicalStates.includes(input[key])) invalid(`${key} must be unknown, yes or no.`);
    return [key, input[key]];
  }));
  if (requireAllYes && PHYSICAL_CHECKS.some(key => output[key] !== "yes")) throw new HttpError(409, "Every physical resolvability check must be yes for this single simulated action.", "physical_resolvability_blocked");
  return output;
}
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function hash(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
export function validateExceptionReview(input, actionBinding) {
  record(input, ["exceptionFingerprint", "physicalResolvability"], "exception review");
  if (!actionBinding || typeof actionBinding.approvalId !== "string" || !actionBinding.approvalId.trim()) invalid("A server-owned approval binding is required.");
  const exceptionFingerprint = validateExceptionFingerprint(input.exceptionFingerprint);
  const physicalResolvability = validatePhysicalResolvability(input.physicalResolvability, { requireAllYes: true });
  const binding = structuredClone(actionBinding);
  const review = { version: 1, actionBinding: binding, exceptionFingerprint, physicalResolvability };
  return { ...review, fingerprintHash: hash(exceptionFingerprint), reviewHash: hash(review), hashAlgorithm: "SHA-256", hashScope: "canonical local review; not a signature or safety certificate" };
}
export function validateResolutionProof(input, { jobId, jobStatus, actionKind } = {}) {
  if (jobStatus !== "complete") throw new HttpError(409, "Resolution proof requires a completed job.", "resolution_execution_incomplete");
  cleanText(jobId, 160, "server job ID", true);
  if (!["material_move", "inspection", "other"].includes(actionKind)) invalid("A server-derived actionKind is required.");
  record(input, ["checks"], "resolution proof"); record(input.checks, RESOLUTION_CHECKS, "checks");
  const checks = {}, blockers = [], missingEvidence = [];
  for (const [index, key] of RESOLUTION_CHECKS.entries()) {
    const entry = input.checks[key]; record(entry, ["state", "evidenceReference", "reason"], key);
    if (!proofStates.includes(entry.state)) invalid(`${key} has an invalid state.`);
    checks[key] = { state: entry.state, evidenceReference: cleanText(entry.evidenceReference, TEXT_LIMITS.evidenceReference, `${key} evidenceReference`), reason: cleanText(entry.reason, TEXT_LIMITS.reason, `${key} reason`) };
    if (entry.state === "no") blockers.push(`${key}: no`);
    else if (entry.state === "not_applicable") {
      if (!(actionKind === "inspection" && index < 3)) blockers.push(`${key}: not_applicable is not allowed`);
      else if (!checks[key].reason) blockers.push(`${key}: an inspection non-applicability reason is required`);
    } else if (entry.state === "unknown" || !checks[key].evidenceReference) missingEvidence.push(key);
  }
  const resolutionProof = { checks };
  const binding = { jobId, actionKind };
  const status = blockers.length ? "blocked" : missingEvidence.length ? "awaiting_evidence" : "resolved_simulated";
  return { version: 1, status, binding, resolutionProof, blockers, missingEvidence,
    proofHash: hash({ version: 1, binding, resolutionProof, status }), hashAlgorithm: "SHA-256",
    hashScope: "canonical local proof; not a signature or safety certificate", simulated: true, productionCommands: false, dispatched: false };
}
