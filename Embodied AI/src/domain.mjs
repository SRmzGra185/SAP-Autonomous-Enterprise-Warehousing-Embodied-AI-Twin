export const MODEL_VERSION = "0.5.0-embodied-ai";

export const hanaCapabilities = [
  { id: "vector", name: "Vector", detail: "Similarity search and AI retrieval", color: "#7c5cff" },
  { id: "spatial", name: "Spatial", detail: "Plant, route, and asset geometry", color: "#16a085" },
  { id: "property-graph", name: "Property graph", detail: "Connected assets and events", color: "#0ea5e9" },
  { id: "knowledge-graph", name: "Knowledge graph", detail: "Business meaning and relationships", color: "#f59e0b" },
  { id: "json", name: "JSON", detail: "Flexible operational payloads", color: "#f97316" }
];

export const defaultModel = {
  id: "sap-autonomous-enterprise-campus",
  name: "SAP Autonomous Enterprise · Embodied AI Campus",
  version: MODEL_VERSION,
  layout: "platform-campus",
  nodes: [
    { id: "source-s4", kind: "source", visual: "warehouse", name: "SAP-Managed LoB Systems", subtitle: "SAP S/4HANA Cloud Private Edition · Sustainability · CX · HCM", x: 24, y: 48, z: 0, capacity: 4, service: 2, color: "#31506a", zone: "platform" },
    { id: "source-file", kind: "source", visual: "warehouse", name: "Customer-Managed SAP Systems", subtitle: "SAP S/4HANA On-Premise · ECC · SAP BW", x: 24, y: 142, z: 0, capacity: 3, service: 3, color: "#49677a", zone: "platform" },
    { id: "source-external", kind: "source", visual: "warehouse", name: "Non-SAP Source Systems", subtitle: "Files · APIs · AWS · Azure", x: 24, y: 236, z: 0, capacity: 3, service: 3, color: "#526d7a", zone: "platform" },
    { id: "cockpit", kind: "bdc", visual: "tower", name: "SAP BDC Cockpit", subtitle: "Govern data products · packages · activation", x: 192, y: 142, z: 1, capacity: 3, service: 4, color: "#40566a", zone: "platform" },
    { id: "datasphere", kind: "bdc", visual: "reactor", name: "SAP Datasphere", subtitle: "Robot events · business semantics · lineage", x: 360, y: 48, z: 2, capacity: 3, service: 5, color: "#1e5a63", zone: "platform" },
    { id: "bw", kind: "bdc", visual: "silo", name: "SAP BW PCE", subtitle: "OEE · history · planning archive", x: 360, y: 142, z: 1, capacity: 3, service: 5, color: "#536774", zone: "platform" },
    { id: "connect", kind: "bdc", visual: "tower", name: "SAP BDC Connect", subtitle: "Microsoft · Databricks · Snowflake", x: 360, y: 236, z: 2, capacity: 3, service: 3, color: "#3f6572", zone: "platform" },
    { id: "objectstore", kind: "data", visual: "silo", name: "SAP Object Store", subtitle: "SAP and custom data products", x: 528, y: 94, z: 2, capacity: 5, service: 3, color: "#5b6382", zone: "platform" },
    { id: "ecosystem", kind: "bdc", visual: "pavilion", name: "Open Data Ecosystem", subtitle: "Streaming · governance · AI partners", x: 528, y: 236, z: 2, capacity: 4, service: 4, color: "#3d6f68", zone: "platform" },
    { id: "dataproduct", kind: "data", visual: "crate", name: "SAP Data Products", subtitle: "Robotics · maintenance · quality", x: 696, y: 142, z: 3, capacity: 4, service: 4, color: "#66589c", zone: "platform" },
    { id: "sac", kind: "consume", visual: "pavilion", name: "SAP Analytics Cloud", subtitle: "BI · planning · simulation outcomes", x: 864, y: 48, z: 4, capacity: 3, service: 4, color: "#1e6d64", zone: "platform" },
    { id: "intelligentapps", kind: "consume", visual: "pavilion", name: "SAP Intelligent Applications", subtitle: "Industry 4.0 decision workspaces", x: 864, y: 142, z: 4, capacity: 3, service: 3, color: "#326f72", zone: "platform" },
    { id: "joule", kind: "consume", visual: "robot", name: "Joule Agents", subtitle: "Plan · dispatch · supervise physical work", x: 864, y: 236, z: 4, capacity: 3, service: 3, color: "#324c68", zone: "platform" },
    { id: "aIudit", kind: "audit", visual: "gate", name: "Governance & Safety Gate", subtitle: "Human approval · evidence · release policy", x: 864, y: 330, z: 3, capacity: 2, service: 2, color: "#814b5b", zone: "platform" }
  ],
  edges: [
    ["source-s4", "cockpit"], ["source-file", "cockpit"], ["source-external", "cockpit"],
    ["cockpit", "datasphere"], ["cockpit", "bw"], ["cockpit", "connect"], ["connect", "ecosystem"],
    ["datasphere", "objectstore"], ["bw", "objectstore"], ["objectstore", "dataproduct"], ["ecosystem", "dataproduct"],
    ["dataproduct", "sac"], ["dataproduct", "intelligentapps"], ["dataproduct", "joule"], ["dataproduct", "aIudit"], ["aIudit", "sac"]
  ]
};

export function cloneModel(model = defaultModel) {
  return structuredClone(model);
}

export function normalizeModel(model) {
  const next = cloneModel(model);
  next.nodes = next.nodes.map((node) => ({
    ...node,
    visual: node.visual || visualFor(node.kind),
    x: Number.isFinite(node.x) ? node.x : 100,
    y: Number.isFinite(node.y) ? node.y : 100,
    z: Number.isFinite(node.z) ? node.z : 0,
    capacity: Math.max(1, Math.floor(node.capacity || 1)),
    service: Math.max(1, Number(node.service || 1))
  }));
  next.edges = Array.isArray(next.edges) ? next.edges : [];
  return next;
}

function visualFor(kind) {
  return { source: "warehouse", bdc: "tower", data: "crate", consume: "pavilion", audit: "gate", agent: "robot" }[kind] || "crate";
}

export const route = ["source-s4", "cockpit", "datasphere", "dataproduct", "aIudit", "sac"];
