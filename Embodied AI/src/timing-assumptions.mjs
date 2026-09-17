// Deliberate scenario assumptions, NEVER measured or manufacturer cycle-time claims.
const byNode = {
  "orch-asset": [30, 60, 180], "orch-dog": [90, 180, 420], "orch-work": [60, 180, 600],
  "orch-tech": [300, 900, 1800], "orch-demand": [60, 300, 1800], "orch-line": [30, 120, 300],
  "orch-cell": [30, 60, 120], "orch-quality": [20, 45, 120], "orch-pack": [30, 60, 120],
  "orch-rack": [15, 30, 90], "orch-transport": [120, 240, 600], "orch-delivery": [30, 90, 240]
};
const byVisual = { unitree: [90,180,420], cobotCell: [30,60,120], rack: [15,30,90], inspectionCell: [20,45,120], conveyor: [15,30,60], loadingDock: [60,120,300] };
export function timingAssumption(node = {}) {
  const values = byNode[node.id] || (node.layer === "robotics" ? byVisual[node.visual] : null) || [1,2,3];
  return { type: "triangular", min: values[0], mode: values[1], max: values[2] };
}
