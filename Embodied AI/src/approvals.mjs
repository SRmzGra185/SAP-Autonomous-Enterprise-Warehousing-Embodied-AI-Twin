import crypto from "node:crypto";
import { HttpError } from "../http-utils.mjs";
import { describeExceptionControls, defaultExceptionDraft, validateExceptionReview } from "./exception-resolution.mjs";

// An approval is single-use and bound to one job action, never a reusable permission.
export function createApprovalGate({ emit, signal, timeoutMs = 300_000 }) {
  let pending = null, disposed = false;
  function finish(error, decision) {
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (error) current.reject(error); else current.resolve(decision);
  }
  const abort = () => finish(new Error("Routine cancelled; no further commands executed."));
  signal?.addEventListener("abort", abort, { once: true });
  return {
    get pending() { return pending ? structuredClone(pending.public) : null; },
    request(action) {
      if (disposed) return Promise.reject(new Error("Routine ended."));
      if (signal?.aborted) return Promise.reject(new Error("Routine cancelled."));
      if (pending) return Promise.reject(new Error("Another action is awaiting approval."));
      return new Promise((resolve, reject) => {
        const approval = { ...structuredClone(action), approvalId: crypto.randomUUID(), expiresAt: new Date(Date.now() + timeoutMs).toISOString(), scope: "single simulated action", productionCommands: false, dispatched: false,
          exceptionControls: describeExceptionControls(), exceptionDraft: defaultExceptionDraft() };
        pending = { public: approval, resolve, reject, timer: setTimeout(() => {
          try { emit({ type: "approval_expired", ...structuredClone(approval) }); }
          catch (error) { finish(error); return; }
          finish(new Error("Approval expired. Routine stopped without executing the pending action."));
        }, timeoutMs) };
        try { emit({ type: "approval_required", ...structuredClone(approval) }); }
        catch (error) { finish(error); }
      });
    },
    decide(input, principal) {
      if (!Array.isArray(principal?.roles) || !principal.roles.some((role) => ["admin", "approver"].includes(role))) throw new HttpError(403, "An approver or administrator role is required.", "role_denied");
      if (!input || !["approve", "reject"].includes(input.decision) || typeof input.approvalId !== "string") throw new HttpError(400, "Select approve or reject for the current approval ID.", "validation_error");
      if (Object.keys(input).some(key => !["approvalId", "decision", "exceptionFingerprint", "physicalResolvability"].includes(key))) throw new HttpError(400, "Unknown approval fields.", "validation_error");
      if (!pending || pending.public.approvalId !== input.approvalId) throw new HttpError(409, "This approval is no longer pending.", "approval_stale");
      if (signal?.aborted) { abort(); throw new HttpError(409, "Routine cancelled.", "approval_stale"); }
      if (Date.now() >= Date.parse(pending.public.expiresAt)) { finish(new Error("Approval expired.")); throw new HttpError(409, "Approval expired.", "approval_stale"); }
      const actionBinding = Object.fromEntries(["approvalId", "scenarioId", "stepId", "transitionId", "nextStepId", "cycle", "nodeId", "command"].filter(key => pending.public[key] !== undefined).map(key => [key, pending.public[key]]));
      const review = input.decision === "approve" ? validateExceptionReview({ exceptionFingerprint: input.exceptionFingerprint, physicalResolvability: input.physicalResolvability }, actionBinding) : { actionBinding };
      const decision = { ...structuredClone(pending.public), ...review, decision: input.decision, approvedBy: principal.userId, decidedAt: new Date().toISOString(), productionCommands: false, dispatched: false };
      try { emit({ type: "approval_resolved", ...structuredClone(decision) }); }
      catch (error) { finish(error); throw error; }
      finish(input.decision === "reject" ? new Error("Operator rejected the action. Routine stopped.") : null, decision);
      return decision;
    },
    dispose() { disposed = true; signal?.removeEventListener("abort", abort); finish(new Error("Routine ended.")); }
  };
}
