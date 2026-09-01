import crypto from "node:crypto";

export const policy = {
  defaultMode: "mock",
  allowProductionWrites: false,
  allowedEnvironments: ["mock", "sandbox"],
  requiredApprovalsForLive: ["tenant-owner", "security-review", "change-ticket"],
  denyReasons: [
    "No live tenant credentials are accepted by this demo.",
    "Production writes are disabled by policy.",
    "Every connector must declare a read/write scope and tenant boundary."
  ]
};

export function safeConnectionRequest(input = {}) {
  const environment = input.environment || "mock";
  const requestedWrite = Boolean(input.productionWrite || input.operation === "write");
  const allowed = policy.allowedEnvironments.includes(environment) && !requestedWrite;
  return {
    allowed,
    environment,
    operation: requestedWrite ? "write" : "read",
    reason: allowed ? "Dry-run connection permitted." : policy.denyReasons.join(" "),
    traceId: `safe_${crypto.randomUUID()}`
  };
}

export function auditEntry(action, details = {}, principal = {}) {
  return {
    id: `audit_${crypto.randomUUID()}`,
    at: new Date().toISOString(),
    actor: principal.userId || "system",
    tenantId: principal.tenantId || "system",
    action,
    result: details.result || "recorded",
    details
  };
}
