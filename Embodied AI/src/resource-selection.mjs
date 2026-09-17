// Explicit synthetic fixtures. This is constrained ranking, not a live optimizer.
export function proposeResource(kind, candidates) {
  const eligible = candidates.filter(c => c.available === true && c.authorized === true && c.safetyReviewed === true && c.capable === true && Number.isFinite(c.estimatedSeconds) && c.estimatedSeconds > 0);
  const ranked = [...eligible].sort((a, b) => a.estimatedSeconds - b.estimatedSeconds || a.id.localeCompare(b.id));
  return { kind, basis: "SYNTHETIC candidate estimates; lowest estimated seconds among eligible candidates", simulated: true, requiresHumanApproval: true,
    selected: ranked[0] || null, candidates, excluded: candidates.filter(c => !eligible.includes(c)).map(c => c.id) };
}
const candidate = (id, name, estimatedSeconds, overrides = {}) => ({ id, name, estimatedSeconds, available: true, authorized: true, safetyReviewed: true, capable: true, ...overrides });
export function proposalForStep(nodeId) {
  if (nodeId === "orch-work") return proposeResource("technician", [
    candidate("tech-a", "Technician A · pump skill · demo", 900),
    candidate("tech-b", "Technician B · unavailable · demo", 300, { available: false }),
    candidate("tech-c", "Technician C · pump skill · demo", 1500)
  ]);
  if (nodeId === "orch-line") return proposeResource("production line", [
    candidate("line-a", "Line A · current setup · demo", 1800),
    candidate("line-b", "Line B · compatible tooling · demo", 1200),
    candidate("line-c", "Line C · incompatible tooling · demo", 600, { capable: false })
  ]);
  if (nodeId === "orch-transport") return proposeResource("transport and route", [
    candidate("route-a", "Operator + trolley · aisle A · demo", 240),
    candidate("route-b", "Operator + trolley · blocked aisle B · demo", 120, { safetyReviewed: false }),
    candidate("route-c", "Authorized carrier · dock C · demo", 480)
  ]);
  return null;
}
