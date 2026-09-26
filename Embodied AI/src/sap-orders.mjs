// SAP order → robot mission → confirmation back to SAP (Digital Twin Robotics module).
// Simulated SAP EWM warehouse tasks ("stock check at storage bin") live here, one book per tenant.
// Dispatching a task compiles it into a fixed robot mission — no model call, the task already
// says what to do — and the robot photographs the bin with its inspect camera. That photo is the
// only thing Joule sees: one vision call per mission on SAP AI Core, cached by image, classifies
// the bin (stocked / empty / blocked / unclear). A confident match confirms the task, a confident
// mismatch raises an EWM exception, anything else waits for a person. Every confirmation and
// exception is simulated: nothing is written to a real SAP system.

import crypto from "node:crypto";
import { complete, extractText, extractJson, usageSummary } from "../orchestrator.mjs";
import { safetyIdentifier } from "../auth.mjs";

export const STAGES = [
  ["created", "Created in SAP EWM"],
  ["planned", "Robot mission"],
  ["at_bin", "Robot at the bin"],
  ["evidence", "Photo evidence"],
  ["verified", "Joule vision check"],
  ["closed", "Back to SAP EWM"]
];
const PRODUCTS = [
  { product: "DEMO-PUMP-KIT", productName: "Pump service kit", expectedQty: 4, uom: "EA", priority: "High" },
  { product: "DEMO-BEARING-6204", productName: "Bearing 6204-2RS", expectedQty: 24, uom: "EA", priority: "Medium" },
  { product: "DEMO-FILTER-HX10", productName: "Hydraulic filter HX-10", expectedQty: 12, uom: "EA", priority: "Medium" }
];
const RACK_STATES = ["stocked", "empty", "blocked", "unclear"];
const CONFIDENT = 0.6;
const EXCEPTIONS = {
  empty: { code: "DIFF", label: "Stock difference", followUp: "Physical inventory document created for the bin (simulated)." },
  blocked: { code: "BLCK", label: "Bin blocked", followUp: "Bin blocked for removal until access is cleared (simulated)." }
};

const now = () => new Date().toISOString();
const digits = (n) => String(crypto.randomInt(10 ** (n - 1), 10 ** n));
const text = (value, max) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null);

// Racks nearest to the robot's start first: short missions for a live demo.
function pickBins(places = []) {
  const start = places.find((p) => p.id === "start") || { x: 0, y: 0 };
  const racks = places.filter((p) => p.kind === "rack").sort((a, b) => Math.hypot(a.x - start.x, a.y - start.y) - Math.hypot(b.x - start.x, b.y - start.y));
  return racks.length ? racks.slice(0, 3).map((p) => ({ placeId: p.id, storageBin: p.name })) : [1, 2, 3].map((n) => ({ placeId: null, storageBin: `Rack ${n}` }));
}

export function createOrderBook() {
  const books = new Map();
  const seed = (places) => pickBins(places).map((bin, index) => {
    const createdAt = now();
    return {
      id: `WT-41000${digits(5)}`, type: "Stock check", source: "SAP EWM · simulated", warehouse: "SW01", ...bin, ...PRODUCTS[index % PRODUCTS.length],
      status: "open", createdAt, jobId: null, timeline: [{ stage: "created", at: createdAt, label: "Created in SAP EWM", detail: `Warehouse task for bin ${bin.storageBin}`, tone: "ok" }],
      evidence: null, verdict: null, confirmation: null, simulated: true
    };
  });
  // Tasks seeded before Isaac mapped the warehouse move to its real racks once the map arrives.
  const book = (tenantId, places = []) => {
    const current = books.get(tenantId);
    const unmapped = current?.every((order) => !order.placeId && order.status === "open") && places.some((p) => p.kind === "rack");
    if (!current || unmapped) books.set(tenantId, seed(places));
    return books.get(tenantId);
  };
  return {
    list: (tenantId, places) => book(tenantId, places),
    get: (tenantId, id, places) => book(tenantId, places).find((order) => order.id === id) || null,
    reset: (tenantId, places) => { books.set(tenantId, seed(places)); return books.get(tenantId); }
  };
}

export function stage(order, key, detail = "", tone = "ok", label = null) {
  order.timeline.push({ stage: key, at: now(), label: label || Object.fromEntries(STAGES)[key], detail: String(detail).slice(0, 200), tone });
}

// Public shape: the photo stays on the server (fetched once through /evidence), everything else travels.
export function publicOrder(order) {
  const { evidence, ...rest } = order;
  return { ...structuredClone(rest), evidence: evidence ? { caption: evidence.caption, capturedAt: evidence.capturedAt, pose: evidence.pose } : null }; // a copy: job events keep each moment
}

// The mission a warehouse task compiles to: go to the bin, inspect camera (photo), back to the dock.
export function missionFor(order) {
  return [{ type: "go_to", place: order.placeId }, { type: "view", view: "inspect" }, { type: "view", view: "chase" }, { type: "go_to", place: "start" }];
}

const SYSTEM = [
  "You are Joule in the SAP Autonomous Operations Twin. An SAP EWM warehouse task sent a robot, inside an NVIDIA Isaac Sim digital twin of a warehouse, to a storage bin. The robot faced the bin and took this photo.",
  "Classify the storage bin: the rack or shelf directly in front of the camera.",
  "- \"stocked\": its shelf levels hold boxes, cartons or goods.",
  "- \"empty\": the shelf is visible and holds no goods.",
  "- \"blocked\": access to it is obstructed (forklift, pallet, object or person in front of it).",
  "- \"unclear\": no rack is clearly visible, the image is dark or blurred, or it is a status card instead of a camera image.",
  "Describe only what is visible. Do not guess exact quantities unless the units are clearly countable.",
  "Respond ONLY with JSON: {\"rackState\": \"stocked\"|\"empty\"|\"blocked\"|\"unclear\", \"confidence\": number from 0 to 1, \"summary\": string (max 35 words), \"observations\": [string, max 3, each max 18 words]}. English only."
].join("\n");

// One vision call per mission: same photo of the same bin → cached answer, no new call.
export async function jouleVerifyBin(config, { image, order, principal, cache }) {
  const key = crypto.createHash("sha256").update(`${order.storageBin}|${image}`).digest("hex");
  if (cache.has(key)) return { ...cache.get(key), cached: true };
  if (!config.orchestrator.enabled) return { rackState: "unclear", confidence: 0, summary: "Joule is not connected, so a person has to review the photo.", observations: [], provider: "mock", model: null, usage: null, cached: false };
  const model = config.orchestrator.primaryModel;
  const task = `SAP EWM warehouse task ${order.id}: stock check at storage bin "${order.storageBin}" (warehouse ${order.warehouse}). Product ${order.product} (${order.productName}), expected ${order.expectedQty} ${order.uom}.`;
  const response = await complete(config, { system: SYSTEM, messages: [{ role: "user", content: [{ type: "text", text: task }, { type: "image", url: image }] }], maxTokens: 350, model, effort: "low", safetyId: safetyIdentifier(principal) });
  const parsed = extractJson(extractText(response)) || {};
  const confidence = Number(parsed.confidence);
  const verdict = {
    rackState: RACK_STATES.includes(parsed.rackState) ? parsed.rackState : "unclear",
    confidence: Number.isFinite(confidence) ? Math.round(Math.min(1, Math.max(0, confidence)) * 100) / 100 : 0,
    summary: text(parsed.summary, 280) || "Joule could not describe the photo.",
    observations: (Array.isArray(parsed.observations) ? parsed.observations : []).map((item) => text(item, 160)).filter(Boolean).slice(0, 3),
    provider: config.orchestrator.provider, model: response.model || model, usage: usageSummary(response)
  };
  if (cache.size > 50) cache.delete(cache.keys().next().value);
  cache.set(key, verdict);
  return { ...verdict, cached: false };
}

// Expected state of a stock check is "stocked". Joule decides only when it is confident.
export function decide(verdict) {
  if (verdict.confidence >= CONFIDENT && verdict.rackState === "stocked") return { decision: "confirm" };
  if (verdict.confidence >= CONFIDENT && EXCEPTIONS[verdict.rackState]) return { decision: "exception", ...EXCEPTIONS[verdict.rackState] };
  return { decision: "review" };
}

// Simulated posting back to EWM: a confirmation or an exception, with a document number.
export function closeOrder(order, { decision, code, label, followUp, by }) {
  const document = `EWM-${decision === "confirm" ? "CONF" : "EXC"}-${digits(8)}`;
  order.confirmation = { document, at: now(), by, outcome: decision === "confirm" ? "confirmed" : "exception", code: code || null, label: label || null, followUp: followUp || null, simulated: true };
  order.status = decision === "confirm" ? "confirmed" : "exception";
  if (decision === "confirm") stage(order, "closed", `Warehouse task confirmed · ${document} · ${by}`, "ok", "Confirmed in SAP EWM");
  else stage(order, "closed", `${code} · ${label} · ${document} · ${followUp}`, "warn", "Exception in SAP EWM");
  return order.confirmation;
}
