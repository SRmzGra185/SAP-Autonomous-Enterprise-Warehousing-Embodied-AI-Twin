import { normalizeModel } from "./src/domain.mjs";
import { HttpError } from "./http-utils.mjs";

const hasRole = (principal, role) => principal.roles.includes(role);
export const canEdit = (principal) => hasRole(principal, "admin") || hasRole(principal, "editor");

export function seedTenantModel(template, principal) {
  const model = normalizeModel(template);
  return { ...model, tenantId: principal.tenantId, ownerId: principal.userId, nodes: model.nodes.map((node) => ({ ...node, tenantId: principal.tenantId, ownerId: "system", visibility: "tenant" })) };
}

export function canReadRow(node, principal) {
  return node.tenantId === principal.tenantId && (node.visibility !== "private" || node.ownerId === principal.userId || hasRole(principal, "admin"));
}

export function scopeModel(model, principal) {
  if (model.tenantId !== principal.tenantId) throw new HttpError(403, "Tenant boundary denied.", "rls_denied");
  const nodes = model.nodes.filter((node) => canReadRow(node, principal)), ids = new Set(nodes.map((node) => node.id));
  return { ...model, nodes, edges: model.edges.filter(([from, to]) => ids.has(from) && ids.has(to)), rowPolicy: { tenantId: principal.tenantId, userId: principal.userId, roles: principal.roles } };
}

export function applyModelWrite(current, input, principal) {
  if (!canEdit(principal)) throw new HttpError(403, "The current role cannot edit models.", "role_denied");
  if (current.tenantId !== principal.tenantId) throw new HttpError(403, "Tenant boundary denied.", "rls_denied");
  const existing = new Map(current.nodes.map((node) => [node.id, node]));
  const nodes = input.nodes.map((node) => {
    if (node.tenantId && node.tenantId !== principal.tenantId) throw new HttpError(403, "Cross-tenant row write denied.", "rls_denied");
    const previous = existing.get(node.id), ownerId = previous?.ownerId || principal.userId;
    if (previous?.visibility === "private" && previous.ownerId !== principal.userId && !hasRole(principal, "admin")) throw new HttpError(403, "Private row write denied.", "rls_denied");
    return { ...node, tenantId: principal.tenantId, ownerId, visibility: node.visibility || previous?.visibility || "tenant" };
  });
  return normalizeModel({ ...input, tenantId: principal.tenantId, ownerId: current.ownerId, nodes });
}

export function assertTenantResource(resource, principal) {
  if (!resource || resource.tenantId !== principal.tenantId) throw new HttpError(404, "Resource not found.", "not_found");
}
