import { boundedInteger, calculateObservedKpis, experimentRoute, validateExperimentProfile } from "./industrial-timing.mjs";

const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
const percentile = (a, p) => [...a].sort((x, y) => x - y)[Math.max(0, Math.ceil(a.length * p) - 1)];
function random(seed) { let v = seed >>> 0; return () => { v = (Math.imul(v, 1664525) + 1013904223) >>> 0; return v / 4294967296; }; }
function sample(d, u) {
  if (d.type === "fixed") return d.value;
  if (d.type === "empirical") return d.samples[Math.floor(u * d.samples.length)];
  return u < (d.mode - d.min) / (d.max - d.min) ? d.min + Math.sqrt(u * (d.max - d.min) * (d.mode - d.min)) : d.max - Math.sqrt((1 - u) * (d.max - d.min) * (d.max - d.mode));
}
function ci(values) {
  const n = values.length, df = n - 1, avg = mean(values);
  const table = [0,12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.160,2.145,2.131,2.120,2.110,2.101,2.093,2.086,2.080,2.074,2.069,2.064,2.060,2.056,2.052,2.048,2.045,2.042];
  const z = 1.95996398454, t = table[df] ?? z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2);
  const margin = n > 1 ? t * Math.sqrt(values.reduce((s,v) => s + (v - avg) ** 2, 0) / df / n) : null;
  return { lower: margin === null ? null : avg - margin, upper: margin === null ? null : avg + margin, n, method: "95% approximate Student-t CI for expected replication mean; independent replications assumed; NOT an order prediction interval; null for n<2" };
}

async function simulateOnce(model, o, emit, detail) {
  const active = experimentRoute(model), rng = random(o.seed), profile = o.experiment;
  const timings = new Map(profile?.nodes.map(n => [n.nodeId, n]) || []);
  const states = new Map([...new Set(active)].map(id => {
    const node = model.nodes.find(n => n.id === id), t = timings.get(id), capacity = boundedInteger(t?.capacity ?? node.capacity, `capacity:${id}`, 1, 32);
    if (!t && (!Number.isFinite(node.service) || node.service <= 0 || node.service > 1e7)) throw new Error(`Invalid DEMO node.service:${id}`);
    return [id, { node, capacity, queue: [], resources: Array.from({ length: capacity }, () => ({ busy: false, setup: false })), busySeconds: 0, queuedSeconds: 0, setupSeconds: 0, setupApplications: 0 }];
  }));
  // Common random numbers assigned to route visit/entity, not event order. Capacity
  // candidates retain paired draws even when their service interleaving changes.
  const durations = active.map(id => Array.from({ length: o.entities }, () => { const u = rng(), t = timings.get(id); return t ? sample(t.processSeconds, u) : states.get(id).node.service * (.75 + u * .9); }));
  const events = [], cycles = [], gap = profile?.arrivalGapSeconds ?? o.arrivalGap;
  let sequence = 0, clock = 0, processed = 0;
  const push = e => { events.push({ ...e, sequence: sequence++ }); events.sort((a,b) => a.time - b.time || a.sequence - b.sequence); };
  const audit = { checks: 0, passed: 0, breaches: 0, source: "not-evaluated", resolutionVerified: false };
  const idOf = index => `order-${String(index + 1).padStart(3, "0")}`;
  const send = async payload => {
    if (!detail) return;
    await emit({ ...payload, snapshot: { clock, unit: "seconds", queues: Object.fromEntries([...states].map(([id,s]) => [id,s.queue.length])), busy: Object.fromEntries([...states].map(([id,s]) => [id,s.resources.filter(r => r.busy).length])), completed: cycles.length, audit: { ...audit } } });
    if (o.mode === "realtime") await new Promise(resolve => setTimeout(resolve, 28)); // playback only
  };
  const start = async nodeId => {
    const s = states.get(nodeId), t = timings.get(nodeId);
    while (s.queue.length) {
      const r = s.resources.find(r => !r.busy); if (!r) break;
      const e = s.queue.shift(), setup = t && (!profile.setupOncePerResource || !r.setup) ? t.setupSeconds : 0;
      const duration = durations[e.routeIndex][e.index] + setup + (t ? t.handlingSeconds + t.travelSeconds + t.approvalSeconds : 0);
      s.queuedSeconds += clock - e.at; s.setupSeconds += setup; if (setup > 0) s.setupApplications++;
      r.busy = true; r.setup = true;
      push({ time: clock + duration, type: "service_complete", nodeId, index: e.index, routeIndex: e.routeIndex, r, duration });
      await send({ type: "service_start", nodeId, routeIndex: e.routeIndex, entityId: idOf(e.index), duration, setupSeconds: setup, queuedSeconds: clock - e.at, unit: "seconds" });
    }
  };
  for (let index = 0; index < o.entities; index++) push({ time: index * gap, type: "arrival", nodeId: active[0], index, routeIndex: 0 });
  const expectedEvents = o.entities * (active.length + 1);
  while (events.length) {
    if (++processed > expectedEvents) throw new Error("DES event budget exceeded; refusing truncated result.");
    if (processed % 128 === 0) await new Promise(resolve => setImmediate(resolve));
    const e = events.shift(), s = states.get(e.nodeId); clock = e.time;
    if (e.type === "arrival") { s.queue.push({ index: e.index, routeIndex: e.routeIndex, at: clock }); await send({ type: e.type, nodeId: e.nodeId, entityId: idOf(e.index) }); await start(e.nodeId); continue; }
    e.r.busy = false; s.busySeconds += e.duration;
    await send({ type: e.type, nodeId: e.nodeId, routeIndex: e.routeIndex, entityId: idOf(e.index) });
    const next = active[e.routeIndex + 1];
    if (!next) { cycles.push(clock - e.index * gap); await send({ type: "entity_complete", nodeId: e.nodeId, entityId: idOf(e.index) }); }
    else { states.get(next).queue.push({ index: e.index, routeIndex: e.routeIndex + 1, at: clock }); await send({ type: "transfer", fromNodeId: e.nodeId, toNodeId: next, nodeId: next, routeIndex: e.routeIndex + 1, entityId: idOf(e.index) }); await start(next); }
    await start(e.nodeId);
  }
  if (cycles.length !== o.entities || processed !== expectedEvents) throw new Error("DES incomplete: refusing partial summary.");
  const nodeMetrics = Object.fromEntries([...states].map(([id,s]) => [id, { capacity: s.capacity, busySeconds: s.busySeconds, queuedSeconds: s.queuedSeconds, utilization: s.busySeconds / (clock * s.capacity), setupSeconds: s.setupSeconds, setupApplications: s.setupApplications }]));
  const queuedSeconds = [...states.values()].reduce((sum,s) => sum + s.queuedSeconds, 0);
  return { seed: o.seed, entities: o.entities, completed: cycles.length, horizon: clock, elapsedSeconds: clock, timeUnit: "seconds", throughput: cycles.length / clock, throughputPerHour: cycles.length / clock * 3600, averageCycle: mean(cycles), p95Cycle: percentile(cycles,.95), orderP95CycleSeconds: percentile(cycles,.95), queuedSeconds, averageQueuedSeconds: queuedSeconds / o.entities, nodeMetrics, utilization: Object.fromEntries(Object.entries(nodeMetrics).map(([id,n]) => [id,n.utilization])), audit, processedEvents: processed, cycles };
}

export async function runSimulation(model, options = {}, emit = async () => {}) {
  const mode = options.mode ?? "fast";
  if (!["fast", "realtime", "monte-carlo"].includes(mode)) throw new Error("Unsupported simulation mode.");
  const requestedRuns = boundedInteger(options.runs ?? 5, "runs", 1, 200), runs = mode === "monte-carlo" ? requestedRuns : 1;
  const entities = boundedInteger(options.entities ?? 24, "entities", 1, 80), seed = boundedInteger(options.seed ?? 42, "seed", 0, 4294967295);
  const experiment = options.experiment === undefined ? undefined : validateExperimentProfile(options.experiment, model), arrivalGap = options.arrivalGap ?? .8;
  if (!experiment && (typeof arrivalGap !== "number" || !Number.isFinite(arrivalGap) || arrivalGap <= 0 || arrivalGap > 1e7)) throw new Error("arrivalGap must be finite seconds >0 and <=10000000.");
  const results = [];
  for (let i = 0; i < runs; i++) {
    const result = await simulateOnce(model, { ...options, mode, experiment, arrivalGap, entities, seed: (seed + i * 9973) >>> 0 }, emit, options.detail !== false && i === 0);
    results.push(result);
    if (runs > 1) { const { cycles, ...publicResult } = result; await emit({ type: "monte_carlo_run", run: i + 1, runs, result: publicResult }); }
    await new Promise(resolve => setImmediate(resolve));
  }
  const { cycles, ...first } = results[0], summary = structuredClone(first);
  Object.assign(summary, { mode, runs });
  for (const field of ["horizon", "elapsedSeconds", "throughput", "throughputPerHour", "averageCycle", "queuedSeconds", "averageQueuedSeconds"]) summary[field] = mean(results.map(r => r[field]));
  for (const id of Object.keys(summary.nodeMetrics)) for (const field of Object.keys(summary.nodeMetrics[id])) summary.nodeMetrics[id][field] = mean(results.map(r => r.nodeMetrics[id][field]));
  summary.utilization = Object.fromEntries(Object.entries(summary.nodeMetrics).map(([id,n]) => [id,n.utilization]));
  const means = results.map(r => r.averageCycle);
  summary.p95Cycle = summary.orderP95CycleSeconds = percentile(results.flatMap(r => r.cycles), .95);
  summary.orderP95Scope = runs === 1 ? "individual orders in one replication" : "pooled individual orders across replications; NOT averaged order p95s";
  summary.replicationMeanCycleSeconds = { mean: mean(means), p50: percentile(means,.5), p95: percentile(means,.95), ci95: ci(means) };
  summary.replications = results.map(({ seed, averageCycle, orderP95CycleSeconds, completed, horizon, throughputPerHour, queuedSeconds, processedEvents }) => ({ seed, averageCycle, orderP95CycleSeconds, completed, horizon, throughputPerHour, queuedSeconds, processedEvents }));
  const routeVisits = experimentRoute(model);
  summary.timing = {
    unit: "seconds", source: experiment?.source ?? "demo", verified: false,
    sourceReference: experiment?.sourceReference ?? null, entityUnit: experiment?.entityUnit ?? "order",
    nodeCount: new Set(routeVisits).size, routeVisitCount: routeVisits.length,
    empiricalSampleCount: experiment?.nodes.reduce((n,v) => n + (v.processSeconds.samples?.length || 0),0) ?? 0,
    setupPolicy: experiment?.setupOncePerResource ? "once per used resource per replication, on first entity" : "per entity per route visit",
    warnings: [
      experiment?.source === "observed" ? "Observed timings are user-declared, NOT verified or proof of robot performance." : "DEMO synthetic seconds. Without a profile, node.service is DEMO seconds sampled with uniform 0.75..1.65 multipliers; never observed machine time.",
      "One entity is one declared handling unit. Convert batch/base-quantity values before entry. Segments apply per entity per visit and occupy the same resource; queues are measured by DES, never added as inputs.",
      "Repeated node visits reuse the same resource pool and timing profile. Different actions on one physical resource currently share its process distribution; use an explicitly justified aggregate profile.",
      "Empty-system finite cohort, setup reset per replication; no warm-up, shared labor, transport network or breakdown model. Utilization is occupied time / (elapsed * capacity), not OEE.",
      "Aggregate horizon, throughput, utilization and queues are replication means; completed is per replication. Percentiles use nearest rank.",
      "Seeds = (seed + replication index * 9973) modulo 2^32; stable route-visit/entity draws support paired comparisons for the same route and entity count.",
      "No random governance certification or exception resolution is performed."
    ]
  };
  summary.observedKpis = calculateObservedKpis(experiment?.performanceData ?? {});
  await emit({ type: "simulation_complete", summary }); return summary;
}
