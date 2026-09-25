// Isaac Sim bridge for the Digital Twin Robotics (Unitree H1 / Go2) module.
// An external executor (NVIDIA Isaac Sim, running e.g. on an NVIDIA Brev instance)
// polls for a queued job (train / deploy / teleop), claims it, and streams back
// typed h1_* events (training metrics, deploy phases, teleop steps, camera
// snapshots). Those events are forwarded to the twin verbatim. If no executor is
// connected, humanoid-lab.mjs runs its own local deterministic simulation instead.

import crypto from "node:crypto";
import { HttpError } from "../http-utils.mjs";

const HUMANOID_EVENT_TYPES = new Set([
  "h1_train_metric", "h1_deploy_phase", "h1_teleop_step", "h1_log", "h1_snapshot", "h1_nav_path", "h1_plan_step", "complete", "failed"
]);
const MAX_IMAGE_CHARS = 400000, MAX_MAP_CHARS = 600000;
const slug = (value, max = 40) => String(value ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, max);

const text = (value, max = 160) => String(value ?? "").replace(/[ -]/g, " ").trim().slice(0, max);
const num = (value, fallback, min, max) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback; };

export function createIsaacBridge(config) {
  const settings = config.isaac;
  const humanoidJobs = new Map();
  let executor = null, map = null, frame = null;
  const now = () => Date.now();
  const connected = () => Boolean(executor) && now() - executor.lastSeen < settings.executorTtlMs;

  function authorize(req) {
    if (!settings.token) throw new HttpError(503, "Isaac bridge disabled: set ISAAC_TOKEN on the server.", "isaac_disabled");
    const given = Buffer.from(String(req.headers["x-isaac-token"] || "")), expected = Buffer.from(settings.token);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HttpError(401, "Invalid Isaac executor token.", "isaac_unauthorized");
  }

  function registerExecutor(info = {}) {
    const pose = info.pose && typeof info.pose === "object" ? { x: num(info.pose.x, 0, -1000, 1000), y: num(info.pose.y, 0, -1000, 1000), heading: num(info.pose.heading, 0, -10, 10) } : executor?.pose || null;
    executor = {
      id: text(info.id || "isaac-executor", 64), name: text(info.name || "Isaac Sim", 80), scene: text(info.scene, 120), version: text(info.version, 40), dryRun: Boolean(info.dryRun), lastSeen: now(),
      robot: slug(info.robot, 12) || executor?.robot || null, robotLabel: text(info.robotLabel, 40) || executor?.robotLabel || null,
      environment: String(info.environment || "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 40) || executor?.environment || null,
      pose, mapVersion: num(info.mapVersion, 0, 0, 1e6), view: ["chase", "wide", "top"].includes(info.view) ? info.view : executor?.view || "chase"
    };
    return executor;
  }

  // Occupancy map + named destinations the executor derived from the warehouse (PhysX scan).
  function setMap(body = {}) {
    const image = String(body.image || "");
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_MAP_CHARS) throw new HttpError(400, "Map image must be a PNG data URI under 600 KB.", "validation_error");
    const b = body.bounds || {};
    const bounds = { minX: num(b.minX, 0, -500, 500), minY: num(b.minY, 0, -500, 500), maxX: num(b.maxX, 0, -500, 500), maxY: num(b.maxY, 0, -500, 500) };
    if (!(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY)) throw new HttpError(400, "Map bounds are empty.", "validation_error");
    const places = (Array.isArray(body.places) ? body.places : []).slice(0, 40).map((p) => ({
      id: slug(p.id), name: text(p.name, 40), kind: slug(p.kind, 20), x: num(p.x, 0, -500, 500), y: num(p.y, 0, -500, 500), heading: p.heading == null ? null : num(p.heading, 0, -10, 10)
    })).filter((p) => p.id && p.name);
    map = {
      version: num(body.version, 1, 0, 1e6), robot: slug(body.robot, 12), environment: text(body.environment, 40), environmentLabel: text(body.environmentLabel, 60),
      cell: num(body.cell, 0.25, 0.05, 2), width: num(body.width, 0, 1, 2000), height: num(body.height, 0, 1, 2000), bounds,
      spawn: { x: num(body.spawn?.x, 0, -500, 500), y: num(body.spawn?.y, 0, -500, 500) }, image, places, receivedAt: new Date().toISOString()
    };
    if (executor) executor.lastSeen = now();
    return { accepted: true, version: map.version, places: places.length };
  }

  const getMap = () => map;

  // Latest robot-camera frame (idle heartbeat from the executor, or any job snapshot).
  function setFrame(body = {}) {
    const image = String(body.image || "");
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_IMAGE_CHARS) throw new HttpError(400, "Frame must be an image data URI under 400 KB.", "validation_error");
    frame = { image, caption: text(body.caption, 120), at: now() };
    if (executor) executor.lastSeen = now();
    return { accepted: true, at: frame.at };
  }
  const getFrame = () => frame;
  const mapPlaces = () => (map ? map.places : []);

  function descriptor() {
    const active = [...humanoidJobs.values()].filter((j) => ["pending", "claimed", "running"].includes(j.status));
    return {
      enabled: Boolean(settings.token),
      connected: connected(),
      executor: executor ? { id: executor.id, name: executor.name, scene: executor.scene, version: executor.version, dryRun: executor.dryRun, lastSeenMs: now() - executor.lastSeen, robot: executor.robot, robotLabel: executor.robotLabel, environment: executor.environment, pose: executor.pose, view: executor.view, mapVersion: executor.mapVersion } : null,
      map: map ? { version: map.version, robot: map.robot, environment: map.environment, environmentLabel: map.environmentLabel, places: map.places } : null,
      frameAt: frame?.at || null,
      activeJobs: active.map((j) => ({ jobId: j.jobId, kind: j.kind, status: j.status, claimedAt: j.claimedAt || null })),
      claimTimeoutMs: settings.claimTimeoutMs,
      eventTimeoutMs: settings.eventTimeoutMs
    };
  }

  function publicHumanoidJob(j) {
    return { jobId: j.jobId, kind: j.kind, payload: j.payload, createdAt: j.createdAt };
  }

  function nextMission(info) {
    registerExecutor(info);
    // The twin keeps the map in memory: after a redeploy it asks the executor to resend it.
    const needMap = executor.mapVersion > 0 && (!map || map.version !== executor.mapVersion);
    const job = [...humanoidJobs.values()].find((j) => j.status === "pending");
    if (!job) return { needMap };
    job.status = "claimed"; job.claimedAt = now(); job.executorId = executor.id; job.lastEventAt = now();
    wake(job);
    return { humanoidJob: publicHumanoidJob(job), needMap };
  }

  function normalizeHumanoid(raw) {
    const type = text(raw?.type, 20);
    if (!HUMANOID_EVENT_TYPES.has(type)) return null;
    if (type === "h1_train_metric") return { type, iteration: num(raw.iteration, 0, 0, 100000), totalIterations: num(raw.totalIterations, 0, 0, 100000), reward: num(raw.reward, 0, -1000, 1000), episodeLength: num(raw.episodeLength, 0, 0, 100000) };
    if (type === "h1_deploy_phase") return { type, phase: text(raw.phase, 20), label: text(raw.label, 160) };
    if (type === "h1_teleop_step") return { type, i: num(raw.i, 0, 0, 10000), steps: num(raw.steps, 0, 0, 10000), pose: { x: num(raw.pose?.x, 0, -1000, 1000), y: num(raw.pose?.y, 0, -1000, 1000), heading: num(raw.pose?.heading, 0, -100, 100) }, gait: text(raw.gait, 20) };
    if (type === "h1_nav_path") return { type, target: { id: slug(raw.target?.id), name: text(raw.target?.name, 40) }, points: (Array.isArray(raw.points) ? raw.points : []).slice(0, 80).map((p) => [num(p?.[0], 0, -1000, 1000), num(p?.[1], 0, -1000, 1000)]) };
    if (type === "h1_plan_step") return { type, index: num(raw.index, 0, 0, 50), total: num(raw.total, 0, 0, 50), label: text(raw.label, 120), status: ["running", "done", "failed"].includes(raw.status) ? raw.status : "running", detail: text(raw.detail, 160) };
    if (type === "h1_snapshot") { const image = String(raw.image || ""); if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > MAX_IMAGE_CHARS) return null; return { type, caption: text(raw.caption, 120), image }; }
    if (type === "complete") return { type, result: raw.result && typeof raw.result === "object" ? raw.result : {} };
    if (type === "failed") return { type, reason: text(raw.reason, 300) || "unspecified" };
    return { type: "h1_log", message: text(raw.message, 300) };
  }

  function pushEvents(jobId, events) {
    const job = humanoidJobs.get(jobId);
    if (!job) throw new HttpError(404, "Unknown job.", "isaac_mission_unknown");
    if (!["claimed", "running"].includes(job.status)) throw new HttpError(409, `Job is ${job.status}; stop the executor.`, "isaac_mission_closed");
    let accepted = 0;
    for (const raw of events.slice(0, 50)) {
      const event = normalizeHumanoid(raw);
      if (!event) continue;
      if (event.type === "h1_teleop_step" && executor) executor.pose = event.pose; // live pose for the map between polls
      if (event.type === "h1_snapshot") frame = { image: event.image, caption: event.caption, at: now() };
      job.queue.push(event); accepted += 1;
    }
    job.lastEventAt = now(); if (executor) executor.lastSeen = now();
    wake(job);
    return { accepted, status: job.status };
  }

  function wake(job) { for (const resolve of job.waiters.splice(0)) resolve(); }

  function waitForSignal(job, timeoutMs, signal) {
    return new Promise((resolve) => {
      const done = (value) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(value); };
      const onAbort = () => done("aborted"), timer = setTimeout(() => done("timeout"), timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      job.waiters.push(() => done("signal"));
    });
  }

  // Generic humanoid job (train / deploy / teleop): claim → stream typed events → complete.
  async function runHumanoidJob(kind, payload, input, emit, controls, job) {
    const signal = controls.signal;
    const record = { jobId: job.id, kind, payload, status: "pending", createdAt: now(), claimedAt: null, executorId: null, lastEventAt: null, queue: [], waiters: [] };
    humanoidJobs.set(job.id, record);
    try {
      const claimDeadline = now() + settings.claimTimeoutMs;
      while (record.status === "pending" && now() < claimDeadline) {
        const outcome = await waitForSignal(record, Math.max(50, claimDeadline - now()), signal);
        if (outcome === "aborted") throw new Error("Job cancelled.");
      }
      if (record.status === "pending") {
        record.status = "cancelled";
        return null; // caller (humanoid-lab.mjs) falls back to the local simulation
      }
      record.status = "running";
      await emit({ type: "h1_log", message: `${kind} claimed by ${executor.name}${executor.dryRun ? " (dry run)" : ""}` });
      for (;;) {
        if (!record.queue.length) {
          const outcome = await waitForSignal(record, settings.eventTimeoutMs, signal);
          if (outcome === "aborted") { record.status = "cancelled"; throw new Error("Job cancelled."); }
          if (outcome === "timeout") {
            record.status = "failed";
            await emit({ type: "fallback_activated", reason: "h1_isaac_silent", message: `No events from Isaac Sim for ${Math.round(settings.eventTimeoutMs / 1000)} s; the ${kind} job stopped.` });
            throw new Error("Isaac Sim executor went silent.");
          }
          continue;
        }
        const event = record.queue.shift();
        if (event.type === "failed") { record.status = "failed"; throw new Error(`Isaac Sim reported a failure: ${event.reason}`); }
        if (event.type === "complete") { record.status = "complete"; await emit({ type: `h1_${kind}_complete`, ...event.result, executor: executor?.name || null }); return { ...event.result, executor: executor ? { id: executor.id, name: executor.name, dryRun: executor.dryRun } : null }; }
        await emit(event); // h1_train_metric / h1_deploy_phase / h1_teleop_step / h1_snapshot / h1_log pass straight through
      }
    } finally {
      if (["pending", "claimed", "running"].includes(record.status)) record.status = "cancelled";
      setTimeout(() => humanoidJobs.delete(job.id), 60000).unref?.();
    }
  }

  return { authorize, descriptor, nextMission, pushEvents, runHumanoidJob, connected, setMap, getMap, mapPlaces, setFrame, getFrame, executorState: () => executor };
}
