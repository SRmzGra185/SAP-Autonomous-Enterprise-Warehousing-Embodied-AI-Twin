const common = {
  status: "simulated",
  mode: "read-only dry run",
  productionWrite: false,
  auth: ["OAuth2", "mTLS", "tenant-scoped credentials"]
};

export const adapters = [
  { id: "odata", name: "OData", category: "Business semantic API", protocols: ["OData V2", "OData V4"], ...common },
  { id: "rest", name: "REST / JSON", category: "API", protocols: ["HTTPS", "JSON"], ...common },
  { id: "graphql", name: "GraphQL", category: "API", protocols: ["GraphQL", "JSON"], ...common },
  { id: "xml", name: "XML / SOAP", category: "API", protocols: ["XML", "SOAP"], ...common },
  { id: "mqtt", name: "MQTT", category: "Industrial event", protocols: ["MQTT 3.1.1", "MQTT 5"], ...common },
  { id: "odbc", name: "ODBC", category: "Database", protocols: ["ODBC"], ...common },
  { id: "oracle", name: "Oracle SQL", category: "Database", protocols: ["Oracle SQL", "JDBC"], ...common },
  { id: "opcclassic", name: "OPC Classic", category: "Industrial control", protocols: ["COM/DCOM"], ...common },
  { id: "opcua", name: "OPC UA", category: "Industrial control", protocols: ["OPC UA", "mTLS"], ...common },
  { id: "socket", name: "Socket", category: "Transport", protocols: ["TCP", "WebSocket"], ...common },
  { id: "com", name: "COM / ActiveX", category: "Windows edge", protocols: ["COM", "ActiveX"], ...common },
  { id: "c", name: "C SDK", category: "Native edge", protocols: ["C ABI"], ...common },
  { id: "cad", name: "CAD", category: "Geometry", protocols: ["JT", "STEP", "glTF"], ...common }
];

export function getAdapter(id) {
  return adapters.find((adapter) => adapter.id === id);
}
