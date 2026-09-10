import { route } from "./domain.mjs";

class EventQueue {
  #items = [];
  #sequence = 0;

  push(item) {
    this.#items.push({ ...item, sequence: this.#sequence++ });
    this.#items.sort((a, b) => a.time - b.time || a.sequence - b.sequence);
  }

  pop() {
    return this.#items.shift();
  }

  get length() {
    return this.#items.length;
  }
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))];
}

async function simulateOnce(model, options, emit, detail = true) {
  const nodeMap = new Map(model.nodes.map((node) => [node.id, node]));
  const robotRoute = model.nodes
    .filter((node) => node.layer === "robotics")
    .sort((left, right) => Number(left.x || 0) - Number(right.x || 0) || Number(left.y || 0) - Number(right.y || 0))
    .map((node) => node.id);
  const proposedRoute = robotRoute.length
    ? ["source-s4", "cockpit", "joule", ...robotRoute, "datasphere", "aIudit"]
    : route;
  const activeRoute = [...new Set(proposedRoute)].filter((id) => nodeMap.has(id));
  const rng = seededRandom(Number(options.seed || 42));
  const events = new EventQueue();
  const queues = new Map(activeRoute.map((id) => [id, []]));
  const busy = new Map(activeRoute.map((id) => [id, 0]));
  const busyTime = new Map(activeRoute.map((id) => [id, 0]));
  const enteredAt = new Map();
  const completedAt = [];
  const completionTimes = new Map();
  const audit = { checks: 0, passed: 0, breaches: 0 };
  const startedAt = new Map();
  const entityCount = Math.max(8, Math.min(80, Number(options.entities || 24)));
  const arrivalGap = Math.max(0.2, Number(options.arrivalGap || 0.8));
  let clock = 0;
  let processed = 0;
  let nextEntity = 1;

  const snapshot = () => ({
    clock: Number(clock.toFixed(2)),
    queues: Object.fromEntries([...queues].map(([id, value]) => [id, value.length])),
    busy: Object.fromEntries([...busy]),
    completed: completedAt.length,
    audit: { ...audit }
  });

  const send = async (payload) => {
    if (!detail) return;
    await emit({ ...payload, snapshot: snapshot() });
    const pace = options.mode === "realtime" ? 28 : 0;
    if (pace) await new Promise((resolve) => setTimeout(resolve, pace));
  };

  const startAvailable = async (nodeId) => {
    const node = nodeMap.get(nodeId);
    while ((busy.get(nodeId) || 0) < node.capacity && queues.get(nodeId)?.length) {
      const entityId = queues.get(nodeId).shift();
      const duration = node.service * (0.75 + rng() * 0.9);
      busy.set(nodeId, busy.get(nodeId) + 1);
      startedAt.set(`${entityId}:${nodeId}`, clock);
      events.push({ time: clock + duration, kind: "service_complete", nodeId, entityId, duration });
      await send({ type: "service_start", nodeId, entityId, duration: Number(duration.toFixed(2)) });
    }
  };

  for (let index = 0; index < entityCount; index += 1) {
    const entityId = `order-${String(nextEntity++).padStart(3, "0")}`;
    events.push({ time: index * arrivalGap, kind: "arrival", nodeId: activeRoute[0], entityId });
    enteredAt.set(entityId, index * arrivalGap);
  }

  while (events.length && processed < 10000) {
    const event = events.pop();
    clock = event.time;
    processed += 1;

    if (event.kind === "arrival") {
      queues.get(event.nodeId).push(event.entityId);
      await send({ type: "arrival", nodeId: event.nodeId, entityId: event.entityId });
      await startAvailable(event.nodeId);
      continue;
    }

    const node = nodeMap.get(event.nodeId);
    busy.set(event.nodeId, Math.max(0, busy.get(event.nodeId) - 1));
    busyTime.set(event.nodeId, busyTime.get(event.nodeId) + event.duration);
    await send({ type: "service_complete", nodeId: event.nodeId, entityId: event.entityId });

    if (node.id === "aIudit") {
      audit.checks += 1;
      const breach = rng() < 0.035;
      if (breach) audit.breaches += 1;
      else audit.passed += 1;
      await send({ type: breach ? "audit_breach" : "audit_pass", nodeId: node.id, entityId: event.entityId });
    }

    const nextIndex = activeRoute.indexOf(event.nodeId) + 1;
    if (nextIndex >= activeRoute.length) {
      completedAt.push(clock);
      completionTimes.set(event.entityId, clock);
      await send({ type: "entity_complete", nodeId: event.nodeId, entityId: event.entityId });
    } else {
      const nextNodeId = activeRoute[nextIndex];
      queues.get(nextNodeId).push(event.entityId);
      await send({ type: "transfer", nodeId: nextNodeId, entityId: event.entityId });
      await startAvailable(nextNodeId);
    }
    await startAvailable(event.nodeId);
  }

  const horizon = Math.max(clock, 1);
  const utilization = Object.fromEntries(activeRoute.map((id) => [id, Number(Math.min(1, busyTime.get(id) / (horizon * nodeMap.get(id).capacity)).toFixed(3))]));
  const cycleTimes = [...completionTimes].map(([entityId, finish]) => finish - enteredAt.get(entityId));

  return {
    seed: Number(options.seed || 42),
    entities: entityCount,
    completed: completedAt.length,
    horizon: Number(horizon.toFixed(2)),
    throughput: Number((completedAt.length / horizon).toFixed(3)),
    averageCycle: Number((cycleTimes.reduce((sum, value) => sum + value, 0) / Math.max(1, cycleTimes.length)).toFixed(2)),
    p95Cycle: Number(percentile(cycleTimes, 0.95).toFixed(2)),
    utilization,
    audit
  };
}

export async function runSimulation(model, options = {}, emit = async () => {}) {
  const mode = options.mode || "fast";
  const runs = mode === "monte-carlo" ? Math.max(2, Math.min(20, Number(options.runs || 5))) : 1;
  const results = [];

  for (let index = 0; index < runs; index += 1) {
    const result = await simulateOnce(model, { ...options, seed: Number(options.seed || 42) + index * 9973 }, emit, index === 0 || mode !== "monte-carlo");
    results.push(result);
    if (runs > 1) await emit({ type: "monte_carlo_run", run: index + 1, runs, result });
  }

  const summary = runs === 1 ? results[0] : {
    mode,
    runs,
    entities: results[0].entities,
    completed: Math.round(results.reduce((sum, result) => sum + result.completed, 0) / runs),
    horizon: Number((results.reduce((sum, result) => sum + result.horizon, 0) / runs).toFixed(2)),
    throughput: Number((results.reduce((sum, result) => sum + result.throughput, 0) / runs).toFixed(3)),
    averageCycle: Number((results.reduce((sum, result) => sum + result.averageCycle, 0) / runs).toFixed(2)),
    p95Cycle: Number(percentile(results.map((result) => result.p95Cycle), 0.95).toFixed(2)),
    audit: {
      checks: Math.round(results.reduce((sum, result) => sum + result.audit.checks, 0) / runs),
      passed: Math.round(results.reduce((sum, result) => sum + result.audit.passed, 0) / runs),
      breaches: Math.round(results.reduce((sum, result) => sum + result.audit.breaches, 0) / runs)
    }
  };

  await emit({ type: "simulation_complete", summary });
  return summary;
}
