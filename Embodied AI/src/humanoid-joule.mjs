// Joule for Digital Twin Robotics: translates a natural-language H1 goal into a
// teleop command (vx, vy, yaw, durationMs) via SAP AI Core, then hands it to the
// same validator and executor queue the Walk/Turn/Stop/Back buttons use — so a
// Joule command and a button press are indistinguishable once queued.

import { complete, extractText, extractJson, usageSummary } from "../orchestrator.mjs";
import { validateTeleopInput } from "./humanoid-lab.mjs";
import { safetyIdentifier } from "../auth.mjs";

export const PRESET_PROMPTS = [
  "H1, walk forward to the AS/RS rack.",
  "H1, turn left and hold.",
  "H1, turn right and hold.",
  "H1, back away slowly.",
  "H1, stop and hold balance."
];

const SYSTEM = [
  "You are Joule, the assistant of the SAP Autonomous Operations Twin's Digital Twin Robotics module (Unitree H1 humanoid, Isaac Sim), running on SAP AI Core.",
  "The user gives a short natural-language driving goal for the H1. Translate it into ONE teleop velocity command: vx (forward m/s, positive = forward), vy (lateral m/s, positive = left strafe), yaw (angular rad/s, positive = turn left), durationMs (how long to hold the command).",
  "Hard limits, never exceed: vx in [-1.2, 1.2], vy in [-0.6, 0.6], yaw in [-1.5, 1.5], durationMs in [500, 20000]. Prefer gentle values (|vx| around 0.5-0.8, |yaw| around 0.4-0.7) unless the goal explicitly asks for fast or slow motion.",
  "This queues ONE bounded velocity command on the existing teleoperation executor; it never invents destinations, paths, or multi-step plans, and it never claims the H1 reached a place it cannot verify — describe motion, not arrival.",
  "Respond ONLY with a JSON object: {\"answer\": string (max 60 words, plain description of the motion you are queuing), \"command\": {\"vx\": number, \"vy\": number, \"yaw\": number, \"durationMs\": integer} }. No prose outside the JSON."
].join("\n");

export async function jouleTeleopAssist(config, { goal, principal, emit }) {
  const trimmedGoal = String(goal || "").trim().slice(0, 300);
  if (!trimmedGoal) throw new Error("Describe what the H1 should do.");
  if (!config.orchestrator.enabled) {
    return { answer: `Joule NOT CONNECTED; applying a bounded local default for: ${trimmedGoal}`, command: validateTeleopInput({}), provider: "mock", model: null };
  }
  const model = config.orchestrator.primaryModel;
  await emit?.({ type: "planner_progress", stage: "aicore", model });
  try {
    const response = await complete(config, { system: SYSTEM, messages: [{ role: "user", content: trimmedGoal }], maxTokens: 400, model, effort: config.orchestrator.effort, safetyId: safetyIdentifier(principal) });
    const parsed = extractJson(extractText(response)) || {};
    const answer = typeof parsed.answer === "string" && parsed.answer.trim() ? parsed.answer.trim().slice(0, 400) : `Queuing a bounded H1 motion for: ${trimmedGoal}`;
    const command = validateTeleopInput(parsed.command || {});
    await emit?.({ type: "provider_status", providerId: response.id, status: response.stop_reason, usage: usageSummary(response) });
    return { answer, command, provider: config.orchestrator.provider, model: response.model || model, usage: usageSummary(response) };
  } catch (error) {
    await emit?.({ type: "fallback_activated", from: model, to: "local deterministic command", reason: "provider_unavailable", safetyMode: "continuation", detail: String(error.message || error).slice(0, 200) });
    return { answer: `SAP AI Core is unavailable; applying a bounded local default for: ${trimmedGoal}`, command: validateTeleopInput({}), provider: "mock", model: null };
  }
}
