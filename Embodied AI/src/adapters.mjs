const common = { status: "not connected · simulated contract", mode: "local dry run only", productionWrite: false, auth: ["Tenant destination reference; credentials stay outside the model"] };
export const adapters = [
  { id: "bdc-connect", name: "SAP BDC Connect", category: "Governed data-product sharing", protocols: ["Supported partner interface; tenant configuration required"], role: "BDC_CONNECT", ...common },
  { id: "joule", name: "Joule", category: "Domain assistant coordination", protocols: ["Supported Joule tenant interface; entitlement required"], role: "JOULE", ...common }
];
export function getAdapter(id) { return adapters.find(adapter => adapter.id === id); }
