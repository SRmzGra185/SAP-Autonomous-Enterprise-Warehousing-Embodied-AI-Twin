// Joule for Digital Twin Robotics: turns one natural-language instruction into a short
// mission plan for the Unitree H1 / Go2 in the Isaac Sim warehouse — go to named
// destinations of the PhysX map ("Rack 3", "Forklift 1"), bounded velocity moves, camera
// views and holds — via SAP AI Core. The plan is validated against the live map
// (destinations that don't exist are dropped, velocities clamped per robot) and executed
// by the same executor queue as the buttons.

import { complete, extractText, extractJson, usageSummary } from "../orchestrator.mjs";
import { validatePlan, ROBOTS } from "./humanoid-lab.mjs";
import { safetyIdentifier } from "../auth.mjs";

const STATIC_PROMPTS = [
  "Walk forward, then turn left and hold.",
  "Show me a wide view, then turn right slowly.",
  "Turn around and walk back.",
  "Stop and hold balance."
];

// Presets built from the destinations the executor found in the loaded warehouse.
export function presetPrompts(places = [], robot = "h1") {
  const name = ROBOTS[robot]?.name?.replace("Unitree ", "") || "Robot";
  const racks = places.filter((p) => p.kind === "rack"), others = places.filter((p) => ["forklift", "pallet", "boxes"].includes(p.kind));
  if (!racks.length && !others.length) return STATIC_PROMPTS;
  const out = [];
  if (racks[0]) out.push(`${name}, go to ${racks[Math.min(2, racks.length - 1)].name} and come back to the start.`);
  if (racks.length >= 3) out.push(`Patrol ${racks[0].name}, ${racks[1].name} and ${racks[2].name}, then return to the start.`);
  if (others[0]) out.push(`Inspect ${others[0].name}, then show me a wide view.`);
  if (places.some((p) => p.id === "far-end")) out.push("Walk to the far end of the warehouse with the top camera.");
  out.push("Turn around and hold balance.");
  return out.slice(0, 5);
}

function systemPrompt(robot, places, pose) {
  const spec = ROBOTS[robot] || ROBOTS.h1;
  const list = places.length ? places.map((p) => `${p.id} = "${p.name}" (${p.kind}) at x=${p.x}, y=${p.y}`).join("\n") : "(no map: only move / view / wait steps are possible)";
  return [
    `You are Joule, the assistant of the SAP Autonomous Operations Twin's Digital Twin Robotics module, running on SAP AI Core. You command a ${spec.name} (${spec.kind}) inside an NVIDIA Isaac Sim warehouse.`,
    "Turn the user's instruction into a short mission plan of 1 to 8 steps. Step types:",
    '- {"type":"go_to","place":"<id>"}: walk to a named destination; the robot plans its own collision-free route. Use ONLY ids from the list below.',
    '- {"type":"move","vx":m/s,"vy":m/s,"yaw":rad/s,"durationMs":int}: bounded velocity command (vx forward, yaw positive = turn left). Limits: |vx| ≤ 1.0, |vy| ≤ 0.4, |yaw| ≤ 1.2, 500 ≤ durationMs ≤ 15000. A 180° turn is about yaw 1.0 for 3200 ms.',
    '- {"type":"view","view":"chase"|"wide"|"top"}: camera (chase follows behind, wide shows the aisle, top is overhead).',
    '- {"type":"wait","ms":int}: hold position (200-20000 ms).',
    `Destinations on the current map:\n${list}`,
    pose ? `The robot is now at x=${pose.x}, y=${pose.y}, heading ${Math.round((pose.heading * 180) / Math.PI)}°.` : "",
    "Never invent destinations. If the user names a place that is not in the list, choose the closest matching id or say it is not on the map. 'Come back', 'return' or 'regresa' means go_to start.",
    'Respond ONLY with JSON: {"answer": string (max 60 words, what the robot will do, in the user\'s language), "steps": [ ... ]}. No prose outside the JSON.'
  ].filter(Boolean).join("\n");
}

// Offline (no AI Core): destinations, views and turns named in the text, in the order they appear;
// "the forklift" without a number means the first one; "back/return" ends at the start.
function localPlan(goal, places) {
  const text = goal.toLowerCase(), found = [];
  const add = (at, step) => { if (at >= 0) found.push([at, step]); };
  const KIND_WORDS = { rack: /\b(rack|estanter[ií]a|anaquel)s?\b/, forklift: /\b(forklift|montacargas)\b/, pallet: /\b(pallet|tarima)s?\b/, boxes: /\b(box|boxes|caja|cajas)\b/ };
  const used = new Set();
  for (const place of places) {
    if (["start", "open", "far"].includes(place.kind)) continue;
    const num = place.name.match(/(\d+)$/)?.[1];
    const word = KIND_WORDS[place.kind];
    if (!num || !word) continue;
    const m = text.match(new RegExp(`(?:${word.source.slice(2, -2)})\\s*(?:#|no\\.?|number|n[uú]mero)?\\s*${num}\\b`));
    if (m) { add(m.index, { type: "go_to", place: place.id }); used.add(place.kind); }
  }
  for (const [kind, word] of Object.entries(KIND_WORDS)) {
    if (used.has(kind)) continue;
    const m = text.match(word), first = places.find((p) => p.kind === kind);
    if (m && first) add(m.index, { type: "go_to", place: first.id });
  }
  const view = text.match(/\b(wide|amplia|panor[aá]mica)\b/); if (view) add(view.index, { type: "view", view: "wide" });
  const top = text.match(/\b(top|overhead|a[eé]rea|cenital|desde arriba)\b/); if (top) add(top.index, { type: "view", view: "top" });
  const far = text.match(/\b(far end|fondo|extremo)\b/); if (far && places.some((p) => p.id === "far-end")) add(far.index, { type: "go_to", place: "far-end" });
  const around = text.match(/\b(turn around|da la vuelta|media vuelta)\b/); if (around) add(around.index, { type: "move", vx: 0, vy: 0, yaw: 1.0, durationMs: 3200 });
  const back = text.match(/\b(come back|back to|return|regresa|vuelve|start|inicio)\b/); if (back && places.some((p) => p.id === "start")) add(back.index, { type: "go_to", place: "start" });
  const steps = found.sort((a, b) => a[0] - b[0]).map(([, step]) => step);
  if (!steps.length) steps.push(/\b(stop|hold|alto|detente)\b/.test(text) ? { type: "wait", ms: 1500 } : { type: "move", vx: 0.8, vy: 0, yaw: 0, durationMs: 4000 });
  return steps;
}

export async function jouleMissionPlan(config, { goal, principal, emit, places = [], robot = "h1", pose = null }) {
  const trimmedGoal = String(goal || "").trim().slice(0, 300);
  if (!trimmedGoal) throw new Error("Describe what the robot should do.");
  const offline = (reason) => {
    const steps = validatePlan(localPlan(trimmedGoal, places), places, robot);
    return { answer: `${reason} Local plan: ${steps.map((s) => s.label).join(" → ")}.`, steps, provider: "mock", model: null };
  };
  if (!config.orchestrator.enabled) return offline("Joule NOT CONNECTED (no SAP AI Core binding).");
  const model = config.orchestrator.primaryModel;
  await emit?.({ type: "planner_progress", stage: "aicore", model });
  try {
    const response = await complete(config, { system: systemPrompt(robot, places, pose), messages: [{ role: "user", content: trimmedGoal }], maxTokens: 700, model, effort: config.orchestrator.effort, safetyId: safetyIdentifier(principal) });
    const parsed = extractJson(extractText(response)) || {};
    const steps = validatePlan(parsed.steps, places, robot);
    const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim().slice(0, 400) : `Plan: ${steps.map((s) => s.label).join(" → ")}`;
    await emit?.({ type: "provider_status", providerId: response.id, status: response.stop_reason, usage: usageSummary(response) });
    return { answer, steps, provider: config.orchestrator.provider, model: response.model || model, usage: usageSummary(response) };
  } catch (error) {
    await emit?.({ type: "fallback_activated", from: model, to: "local keyword plan", reason: "provider_unavailable", safetyMode: "continuation", detail: String(error.message || error).slice(0, 200) });
    return offline("SAP AI Core is unavailable.");
  }
}
