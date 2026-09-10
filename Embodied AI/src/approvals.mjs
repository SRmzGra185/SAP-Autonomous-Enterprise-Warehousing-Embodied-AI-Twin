import crypto from "node:crypto";
import { HttpError } from "../http-utils.mjs";

// An approval is single-use and bound to one job action, never a reusable permission.
export function createApprovalGate({ emit, signal, timeoutMs = 300_000 }) {
  let pending = null;
  function finish(error, decision) {
    if (!pending) return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (error) current.reject(error); else current.resolve(decision);
  }
  signal?.addEventListener("abort", () => finish(new Error("Routine cancelled; no further commands executed.")), { once: true });
  return {
    get pending() { return pending?.public || null; },
    request(action) {
      if (signal?.aborted) return Promise.reject(new Error("Routine cancelled."));
      if (pending) return Promise.reject(new Error("Another action is awaiting approval."));
      return new Promise((resolve, reject) => {
        const approval = { ...action, approvalId: crypto.randomUUID(), expiresAt: new Date(Date.now() + timeoutMs).toISOString(), scope: "single simulated action", productionCommands: false };
        pending = { public: approval, resolve, reject, timer: setTimeout(() => {
          emit({ type: "approval_expired", ...approval });
          finish(new Error("Approval expired. Routine stopped without executing the pending action."));
        }, timeoutMs) };
        emit({ type: "approval_required", ...approval });
      });
    },
    decide(input, principal) {
      if (!principal.roles.some((role) => ["admin", "approver"].includes(role))) throw new HttpError(403, "An approver or administrator role is required.", "role_denied");
      if (!input || !["approve", "reject"].includes(input.decision) || typeof input.approvalId !== "string") throw new HttpError(400, "Select approve or reject for the current approval ID.", "validation_error");
      if (!pending || pending.public.approvalId !== input.approvalId) throw new HttpError(409, "This approval is no longer pending.", "approval_stale");
      const decision = { ...pending.public, decision: input.decision, approvedBy: principal.userId, decidedAt: new Date().toISOString() };
      emit({ type: "approval_resolved", ...decision });
      finish(input.decision === "reject" ? new Error("Operator rejected the action. Routine stopped.") : null, decision);
      return decision;
    },
    dispose() { finish(new Error("Routine ended.")); }
  };
}
