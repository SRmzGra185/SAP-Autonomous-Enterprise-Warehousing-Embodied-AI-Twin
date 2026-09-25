// Joule planner inside the Joule Analytics dashboard: the routine chat (scenario and case
// fields, prompt library, Ask Joule) with its reusable recipe (Preview recipe, BAT + JSON
// export). The recipe standardises the workflow so it replays between steps without asking
// Joule again. "Queue in local app" starts the recipe's routine and hands over to the twin,
// which follows it and collects the assisted approvals.
import { initJouleChat } from "./joule-chat.js";

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", Accept: "application/json", ...(options.headers || {}) } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

// Scenario of the run the dashboard is analysing (set by analytics.js); default = twin default.
let runScenario = "autonomous-inspection";

const planner = initJouleChat({
  api,
  getScenario: () => runScenario,
  activeLabel: "Use this run's scenario",
  runRecipe: async (workflow) => {
    const job = await api("/api/robot-routines", { method: "POST", body: JSON.stringify({ scenarioId: workflow.scenarioId, mode: workflow.mode, cycles: workflow.cycles, speed: workflow.speed, caseContext: workflow.caseContext }) });
    if (!job?.jobId) throw new Error("Routine was not queued.");
    setTimeout(() => window.location.assign("/"), 900); // the twin picks up the active routine and its approvals
  }
});

document.addEventListener("analytics:run", (event) => {
  const id = event.detail?.scenarioId;
  if (id) { runScenario = id; planner?.refreshSelection(); }
  // jump (not animate) once the charts above have their final height, so the planner lands at the top
  if (window.location.hash === "#joule-planner") setTimeout(() => document.querySelector("#joule-planner")?.scrollIntoView({ behavior: "instant", block: "start" }), 400);
});
