export const MODEL_VERSION = "0.7.0-operations";
export const retiredPlatformIds = new Set(["source-s4", "source-file", "source-external", "cockpit", "datasphere", "bw", "objectstore", "ecosystem", "dataproduct", "sac", "intelligentapps", "aIudit"]);

const platformNode = (id, kind, visual, name, subtitle, x, y, workspace, color = "#40566a") => ({
  id, kind, visual, name, subtitle, x, y, z: 0, capacity: 3, service: 2, color,
  zone: "platform", workspace, simulated: true
});

export const operationsScope = {
  name: "SAP Autonomous Operations Twin", version: MODEL_VERSION,
  externalIntegrations: ["SAP BDC Connect", "Joule"],
  connectionRoles: ["BDC_CONNECT", "JOULE"],
  mode: "simulation", liveTenantAccess: false, productionCommands: false,
  boundaries: {
    data: "BDC Connect shares governed data products with compatible platforms; it is not a universal transactional or robot-control API.",
    coordination: "Joule domain assistants depend on licensed applications and supported tenant interfaces. This demo simulates their coordination; it does not call Joule.",
    physical: "Robots, sensors, control protocols and GRAFCET commands are local simulations, not external connections.",
    orchestration: "Autonomous Orchestration is a demo scenario aligned to SAP Supply Chain Orchestration, not a claim of an identically named SAP product."
  },
  assistants: ["Asset and Service Assistant", "Manufacturing Assistant", "Planning Assistant", "Product Design Assistant", "Logistics Assistant"],
  sources: [
    "https://news.sap.com/2026/05/more-autonomous-supply-chain/",
    "https://www.sap.com/topics/events/sapphire/innovation-news-guide-2026",
    "https://help.sap.com/docs/business-data-cloud/sap-business-data-cloud-connect/working-with-data-products-in-sap-business-data-cloud-connect?locale=en-US"
  ]
};

export const defaultModel = {
  id: "sap-autonomous-operations", name: "SAP Autonomous Operations · BDC Connect + Joule",
  version: MODEL_VERSION, layout: "platform-campus",
  nodes: [
    platformNode("connect", "bdc", "tower", "SAP BDC Connect", "Governed data sharing · connection not configured", 24, 96, "connect", "#37677a"),
    platformNode("operation-context", "data", "silo", "Governed Operations Context", "Local shared-product samples · contracts · lineage", 204, 96, "context", "#596781"),
    platformNode("joule", "agent", "robot", "Joule", "Domain assistant coordination · simulated, not connected", 384, 96, "agent", "#43577d"),
    platformNode("asset-management", "bdc", "processMachine", "Autonomous Asset Management", "Asset and Service Assistant · condition to maintenance", 24, 276, "asset-management", "#49756e"),
    platformNode("manufacturing", "bdc", "cobotCell", "Autonomous Manufacturing", "Manufacturing Assistant · adaptive production and quality", 244, 276, "manufacturing", "#4c667e"),
    platformNode("orchestration", "bdc", "pavilion", "Autonomous Orchestration", "Planning and Product Design assistants · cross-domain recovery", 464, 276, "orchestration", "#68708b"),
    platformNode("logistics", "bdc", "loadingDock", "Autonomous Logistics", "Logistics Assistant · warehouse task coordination", 684, 276, "logistics", "#52736b"),
    platformNode("approval", "audit", "gate", "Human Approval", "Local assisted-mode execution gate · no live commands", 594, 96, "approval", "#8b6b48"),
    platformNode("evidence", "audit", "inspectionCell", "Execution Evidence", "Local event trace · simulated outcomes · export", 864, 96, "evidence", "#735b79")
  ],
  edges: [["connect", "operation-context"], ["operation-context", "joule"], ["joule", "approval"],
    ...["asset-management", "manufacturing", "orchestration", "logistics"].flatMap(id => [["approval", id], [id, "evidence"]])]
};

export function cloneModel(model = defaultModel) { return structuredClone(model); }
export function normalizeModel(model) {
  const next = cloneModel(model);
  next.nodes = next.nodes.map(node => ({
    ...node, visual: node.visual || ({ source: "warehouse", bdc: "tower", data: "crate", consume: "pavilion", audit: "gate", agent: "robot" }[node.kind] || "crate"),
    x: Number.isFinite(node.x) ? node.x : 100, y: Number.isFinite(node.y) ? node.y : 100,
    z: Number.isFinite(node.z) ? node.z : 0,
    capacity: Math.max(1, Math.floor(node.capacity || 1)), service: Math.max(0.01, Number(node.service || 1))
  }));
  next.edges = Array.isArray(next.edges) ? next.edges : [];
  return next;
}
export const route = ["connect", "operation-context", "joule", "approval", "asset-management", "evidence"];
