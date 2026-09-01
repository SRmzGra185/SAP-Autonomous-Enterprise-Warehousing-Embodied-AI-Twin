import { HttpError } from "./http-utils.mjs";

const text = (value, name, max = 120) => {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[<>\u0000-\u001f]/.test(value)) throw new HttpError(400, `${name} is invalid.`, "validation_error");
  return value.trim();
};
const number = (value, name, min, max) => { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < min || parsed > max) throw new HttpError(400, `${name} must be between ${min} and ${max}.`, "validation_error"); return parsed; };
const oneOf = (value, name, options) => { if (!options.includes(value)) throw new HttpError(400, `${name} must be one of: ${options.join(", ")}.`, "validation_error"); return value; };

export function validateModelInput(body) {
  if (!body || typeof body !== "object" || !Array.isArray(body.nodes) || !Array.isArray(body.edges)) throw new HttpError(400, "Model requires nodes and edges arrays.", "validation_error");
  if (body.nodes.length > 250 || body.edges.length > 750) throw new HttpError(400, "Model exceeds the demo size limit.", "validation_error");
  const ids = new Set();
  const nodes = body.nodes.map((node, index) => {
    if (!node || typeof node !== "object") throw new HttpError(400, `nodes[${index}] is invalid.`, "validation_error");
    const id = text(node.id, `nodes[${index}].id`, 80);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new HttpError(400, `nodes[${index}].id must be unique and URL-safe.`, "validation_error");
    ids.add(id);
    return {
      ...node, id, name: text(node.name, `nodes[${index}].name`, 100), subtitle: text(node.subtitle || "Operational object", `nodes[${index}].subtitle`, 160),
      kind: oneOf(node.kind, `nodes[${index}].kind`, ["source", "bdc", "data", "consume", "audit", "agent"]),
      visual: oneOf(node.visual, `nodes[${index}].visual`, ["warehouse", "tower", "reactor", "silo", "crate", "pavilion", "robot", "gate", "posTerminal", "retailShelf", "rack", "mobileManipulator", "safetyZone", "sensorMast", "amr", "cobotCell", "conveyor", "inspectionCell", "loadingDock", "partsFeeder", "assemblyFixture", "torqueStation", "robotDock", "quadruped", "processMachine"]),
      x: number(node.x, `nodes[${index}].x`, -1000, 2000), y: number(node.y, `nodes[${index}].y`, -1000, 2000), z: number(node.z ?? 0, `nodes[${index}].z`, 0, 20),
      capacity: Math.floor(number(node.capacity, `nodes[${index}].capacity`, 1, 100)), service: number(node.service, `nodes[${index}].service`, 0.01, 1000),
      color: /^#[0-9a-fA-F]{6}$/.test(node.color || "") ? node.color : "#40566a",
      visibility: oneOf(node.visibility || "tenant", `nodes[${index}].visibility`, ["tenant", "private"])
    };
  });
  const edges = body.edges.map((edge, index) => {
    if (!Array.isArray(edge) || edge.length !== 2 || !ids.has(edge[0]) || !ids.has(edge[1]) || edge[0] === edge[1]) throw new HttpError(400, `edges[${index}] references invalid nodes.`, "validation_error");
    return [edge[0], edge[1]];
  });
  return { ...body, id: text(body.id || "model", "model.id", 80), name: text(body.name || "Untitled model", "model.name", 120), version: text(body.version || "0.1.0-demo", "model.version", 40), nodes, edges };
}

export function validateSimulationInput(body = {}) {
  return { mode: oneOf(body.mode || "fast", "mode", ["fast", "realtime", "monte-carlo"]), entities: Math.floor(number(body.entities ?? 24, "entities", 1, 500)), runs: Math.floor(number(body.runs ?? 5, "runs", 1, 50)), seed: Math.floor(number(body.seed ?? 42, "seed", 0, 2147483647)) };
}

export function validateConnectionInput(body, adapterIds) {
  return { adapter: oneOf(body?.adapter, "adapter", adapterIds), environment: oneOf(body?.environment || "mock", "environment", ["mock", "sandbox"]), operation: oneOf(body?.operation || "read", "operation", ["read", "write"]), productionWrite: body?.productionWrite === true };
}

export function validateAgentTask(body = {}, limits) {
  const trigger = body.fallbackTest || null;
  if (trigger) oneOf(trigger, "fallbackTest", ["safeguard", "provider_unavailable", "token_budget_exceeded", "step_limit_exceeded"]);
  return { goal: text(body.goal, "goal", 2000), maxTokens: Math.floor(number(body.maxTokens ?? limits.maxTokens, "maxTokens", 256, limits.maxTokens)), maxSteps: Math.floor(number(body.maxSteps ?? limits.maxSteps, "maxSteps", 1, limits.maxSteps)), maxDelegations: Math.floor(number(body.maxDelegations ?? limits.maxDelegations, "maxDelegations", 1, limits.maxDelegations)), fallbackTest: trigger };
}

export function validateRobotRoutineInput(body = {}, scenarioIds = []) {
  return {
    scenarioId: oneOf(body.scenarioId, "scenarioId", scenarioIds),
    mode: oneOf(body.mode || "simulation", "mode", ["simulation", "shadow", "assisted", "live"]),
    cycles: Math.floor(number(body.cycles ?? 1, "cycles", 1, 20)),
    speed: number(body.speed ?? 1, "speed", 0.25, 4)
  };
}
