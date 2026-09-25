// Visual representations only. Never a driver, capability grant, or timing calibration.
export const UNITREE_MODELS = Object.freeze({
  unitree: Object.freeze({ label: "Unitree quadruped", description: "Four-legged inspection robot · exact hardware model to confirm" }),
  unitreeHumanoid: Object.freeze({ label: "Unitree H1 humanoid", description: "H1-inspired bipedal inspection robot · illustrative geometry, not vendor CAD" })
});
export const isUnitree = node => Boolean(node && ["unitree", "quadruped", "unitreeHumanoid"].includes(node.visual));
export const unitreeModelKey = node => node?.visual === "unitreeHumanoid" ? "unitreeHumanoid" : "unitree";
export function setRobotRepresentation(model, id, visual) {
  if (!Object.hasOwn(UNITREE_MODELS, visual)) throw new Error("Choose a supported Unitree representation.");
  const node = model.nodes.find(item => item.id === id);
  if (!isUnitree(node)) throw new Error("Select a Unitree robot first.");
  if (node.visual === visual) return false;
  node.visual = visual;
  if (Object.values(UNITREE_MODELS).some(model => node.name === model.label)) {
    node.name = UNITREE_MODELS[visual].label;
    node.subtitle = UNITREE_MODELS[visual].description;
  }
  return true;
}
export const UNITREE_CATALOG = Object.fromEntries(Object.entries(UNITREE_MODELS).map(([visual, model]) => [
  "robot-" + visual,
  { workspace: "physical", catalogGroup: "Robots · Unitree", name: model.label, subtitle: model.description,
    visual, kind: "agent", color: "#53616c", x: 0, y: 0, z: 0, capacity: 1, service: 3, deviceClass: "robot", protocols: ["Simulation"],
    layer: "custom", zone: "operations", visibility: "tenant" }
]));
