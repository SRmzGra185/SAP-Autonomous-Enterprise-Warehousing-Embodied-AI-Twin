import { route } from "./domain.mjs";

// Durations are seconds PER ENTITY, not SAP routing base quantities. Convert
// machine/labor standard values, base quantity and operation splits before entry.
// No universal machine durations, distribution fitting or production verification.
export const EXPERIMENT_LIMITS = Object.freeze({ nodes: 250, routeVisits: 1000, samplesPerNode: 1000, samplesTotal: 10000, seconds: 1e7, capacity: 32, entities: 80, runs: 200 });
const fail = (message) => { const error = new Error(message); error.status = 400; error.statusCode = 400; error.code = "validation_error"; throw error; };
const record = (value, path) => { if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${path} must be an object.`); };
const keys = (value, allowed, path) => { record(value, path); for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key} is unsupported.`); };
const numeric = (value, path, min = 0, max = EXPERIMENT_LIMITS.seconds, positive = false) => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (positive && value === 0)) fail(`${path} must be a finite number ${positive ? "> 0" : `>= ${min}`} and <= ${max}.`);
  return value;
};
const string = (value, path, max = 500) => { if (typeof value !== "string" || !value.trim() || value.length > max) fail(`${path} must be nonempty text (max ${max}).`); return value.trim(); };
export const boundedInteger = (value, path, min, max) => { numeric(value, path, min, max); if (!Number.isInteger(value)) fail(`${path} must be an integer.`); return value; };

export function experimentRoute(model) {
  if (!Array.isArray(model?.nodes) || model.nodes.length > EXPERIMENT_LIMITS.nodes) fail("model.nodes must contain at most 250 nodes.");
  const ids = new Set(model.nodes.map(node => node.id));
  if (ids.size !== model.nodes.length) fail("Model node IDs must be unique.");
  const proposed = Array.isArray(model.executionRoute) ? model.executionRoute : route;
  if (proposed.length > EXPERIMENT_LIMITS.routeVisits) fail("Execution route exceeds 1000 visits.");
  const active = proposed.filter(id => ids.has(id));
  if (!active.length) fail("The model has no executable operations route. Load an operations scenario.");
  return active;
}

function distribution(input, path) {
  record(input, path);
  const positive = (n, field) => numeric(n, `${path}.${field}`, 0, EXPERIMENT_LIMITS.seconds, true);
  if (input.type === "fixed") { keys(input, ["type", "value"], path); return { type: "fixed", value: positive(input.value, "value") }; }
  if (input.type === "triangular") {
    keys(input, ["type", "min", "mode", "max"], path);
    const min = positive(input.min, "min"), mode = positive(input.mode, "mode"), max = positive(input.max, "max");
    if (!(min <= mode && mode <= max && min < max)) fail(`${path} requires 0 < min <= mode <= max and min < max.`);
    return { type: "triangular", min, mode, max };
  }
  if (input.type === "empirical") {
    keys(input, ["type", "samples"], path);
    if (!Array.isArray(input.samples) || input.samples.length < 1 || input.samples.length > EXPERIMENT_LIMITS.samplesPerNode) fail(`${path}.samples requires 1..1000 samples.`);
    return { type: "empirical", samples: Array.from(input.samples, (sample, i) => positive(sample, `samples[${i}]`)) };
  }
  fail(`${path}.type must be fixed, triangular or empirical.`);
}

const measurementFields = ["plannedProductionSeconds", "runtimeSeconds", "idealCycleSeconds", "totalCount", "goodCount", "operatingSeconds", "repairSeconds", "failures", "repairs"];
function measurements(input) {
  keys(input, [...measurementFields, "assetDomain", "singleSKU", "mixedSKU", "sourceReference"], "performanceData");
  const out = {};
  if (input.assetDomain !== undefined) {
    if (!["manufacturing", "asset-management", "logistics", "other"].includes(input.assetDomain)) fail("performanceData.assetDomain is unsupported.");
    out.assetDomain = input.assetDomain;
  }
  for (const field of ["singleSKU", "mixedSKU"]) if (input[field] !== undefined) {
    if (typeof input[field] !== "boolean") fail(`performanceData.${field} must be boolean.`);
    out[field] = input[field];
  }
  if (input.sourceReference !== undefined) out.sourceReference = string(input.sourceReference, "performanceData.sourceReference");
  for (const field of measurementFields) if (input[field] !== undefined && input[field] !== null) {
    out[field] = numeric(input[field], `performanceData.${field}`, 0, 1e12, field === "idealCycleSeconds");
    if (["totalCount", "goodCount", "failures", "repairs"].includes(field) && !Number.isInteger(out[field])) fail(`performanceData.${field} must be an integer.`);
  }
  if (out.runtimeSeconds > out.plannedProductionSeconds) fail("runtimeSeconds cannot exceed plannedProductionSeconds.");
  if (out.goodCount > out.totalCount) fail("goodCount cannot exceed totalCount.");
  return out;
}

/** Returns a fresh normalized profile; throws {status:400, code:'validation_error'}.
 * Complete route coverage is required: no silent demo substitution in observed data.
 * Setup true: once on first use of EACH resource, reset each replication.
 * Setup false: charged to EVERY entity on EVERY visit. Other segments per visit.
 */
export function validateExperimentProfile(input, model) {
  keys(input, ["version", "unit", "source", "sourceReference", "entityUnit", "setupOncePerResource", "arrivalGapSeconds", "nodes", "performanceData"], "experiment");
  if (input.version !== undefined && input.version !== 1) fail("experiment.version must be 1.");
  if (input.unit !== "seconds") fail("experiment.unit must explicitly be seconds.");
  if (!["demo", "observed"].includes(input.source)) fail("experiment.source must be demo or observed (user-declared, not verified).");
  const sourceReference = input.sourceReference === undefined ? undefined : string(input.sourceReference, "experiment.sourceReference");
  if (input.source === "observed" && !sourceReference) fail("Observed timing requires sourceReference.");
  if (typeof input.setupOncePerResource !== "boolean") fail("experiment.setupOncePerResource must explicitly be boolean.");
  const ids = new Set(experimentRoute(model)), seen = new Set();
  if (!Array.isArray(input.nodes) || input.nodes.length !== ids.size) fail("experiment.nodes must cover every unique executable route node exactly once.");
  let samples = 0;
  const nodes = Array.from(input.nodes, (item, i) => {
    const path = `experiment.nodes[${i}]`;
    keys(item, ["nodeId", "processSeconds", "setupSeconds", "handlingSeconds", "travelSeconds", "approvalSeconds", "capacity"], path);
    if (!ids.has(item.nodeId) || seen.has(item.nodeId)) fail(`${path}.nodeId must be a unique executable model node.`);
    seen.add(item.nodeId);
    const out = { nodeId: item.nodeId, processSeconds: distribution(item.processSeconds, `${path}.processSeconds`) };
    samples += out.processSeconds.samples?.length || 0;
    for (const field of ["setupSeconds", "handlingSeconds", "travelSeconds", "approvalSeconds"]) out[field] = numeric(item[field] === undefined ? 0 : item[field], `${path}.${field}`);
    if (item.capacity !== undefined) out.capacity = boundedInteger(item.capacity, `${path}.capacity`, 1, 32);
    else boundedInteger(model.nodes.find(node => node.id === item.nodeId).capacity, `${path}.modelCapacity`, 1, 32);
    return out;
  });
  if (samples > EXPERIMENT_LIMITS.samplesTotal) fail("experiment exceeds 10000 total empirical samples.");
  return { version: 1, unit: "seconds", source: input.source, ...(sourceReference ? { sourceReference } : {}), entityUnit: string(input.entityUnit, "experiment.entityUnit", 80), setupOncePerResource: input.setupOncePerResource,
    arrivalGapSeconds: numeric(input.arrivalGapSeconds, "experiment.arrivalGapSeconds", 0, EXPERIMENT_LIMITS.seconds, true), nodes,
    ...(input.performanceData !== undefined ? { performanceData: measurements(input.performanceData) } : {}) };
}

export function calculateObservedKpis(input = {}) {
  const m = measurements(input), warnings = ["USER-ENTERED observations; not verified telemetry or proof of robot performance. Missing/zero denominators produce null, not zero."];
  const production = m.assetDomain === "manufacturing", asset = production || m.assetDomain === "asset-management";
  const sameCycle = m.singleSKU === true && m.mixedSKU !== true;
  const ratio = (n, d) => Number.isFinite(n) && Number.isFinite(d) && d > 0 ? n / d : null;
  if (!production) warnings.push("OEE is unavailable outside an explicitly declared manufacturing asset domain.");
  if (!sameCycle) warnings.push("Mixed SKU / unconfirmed single-SKU ideal cycle unsupported: performance and OEE are null.");
  if (!asset) warnings.push("MTBF/MTTR require manufacturing or asset-management assetDomain.");
  const availability = production ? ratio(m.runtimeSeconds, m.plannedProductionSeconds) : null;
  const performance = production && sameCycle ? ratio(m.idealCycleSeconds * m.totalCount, m.runtimeSeconds) : null;
  const quality = production ? ratio(m.goodCount, m.totalCount) : null;
  if (performance > 1) warnings.push("Performance exceeds 1 (100%): verify ideal cycle and counts; value has NOT been clamped.");
  return { source: "user-entered-observations", verified: false, sourceReference: m.sourceReference ?? null, assetDomain: m.assetDomain ?? null,
    availability, performance, quality, oee: [availability, performance, quality].every(v => v !== null) ? availability * performance * quality : null,
    mtbfSeconds: asset ? ratio(m.operatingSeconds, m.failures) : null, mttrSeconds: asset ? ratio(m.repairSeconds, m.repairs) : null,
    definitions: { availability: "runtimeSeconds / plannedProductionSeconds", performance: "idealCycleSeconds * totalCount / runtimeSeconds; single SKU, same ideal cycle", quality: "goodCount / totalCount", oee: "availability * performance * quality (fractions, not percentages)", mtbfSeconds: "operatingSeconds / failures (failure count, not repairs)", mttrSeconds: "repairSeconds / repairs (completed repair count, not failures)" }, warnings };
}

export function experimentTemplate(model) {
  const ids = [...new Set(experimentRoute(model))];
  return { version: 1, unit: "seconds", source: "demo", sourceReference: "Synthetic illustrative seconds; replace with locally measured per-entity values.", entityUnit: "order", setupOncePerResource: true, arrivalGapSeconds: 1,
    nodes: ids.map(nodeId => ({ nodeId, processSeconds: { type: "triangular", min: 1, mode: 2, max: 3 }, setupSeconds: 0, handlingSeconds: 0, travelSeconds: 0, approvalSeconds: 0 })),
    performanceData: { assetDomain: "other", singleSKU: false, plannedProductionSeconds: null, runtimeSeconds: null, idealCycleSeconds: null, totalCount: null, goodCount: null, operatingSeconds: null, repairSeconds: null, failures: null, repairs: null } };
}
