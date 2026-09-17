/**
 * LOCAL DETERMINISTIC CONTRACT (no Joule/LLM, network, storage or execution here).
 * descriptor() -> fresh JSON describing limits, scenarios and offline behavior.
 * validateRequest(input) -> normalized copy; throws status=400 (invalid_recipe_request
 * or the shared case validator's validation_error). Errors never echo rejected values.
 * Request EXACT keys: {goal, scenarioId, mode?, caseContext?}. goal: 1..2000 chars,
 * inert text (multiline allowed); scenarioId REQUIRED from the explicit UI selection.
 * mode: assisted (default) | simulation. No keyword-based scenario selection.
 * caseContext EXACT optional keys: {sku, rfidEpc, quantity, destination, rackState}.
 * Shared validateCaseContext fills DEMO defaults (see descriptor().defaultCaseContext).
 * Identifiers: 1..80 ASCII letters/digits/._- starting alphanumeric. RFID EPC:
 * 8..64 hex digits (normalized uppercase). quantity: integer 1..10000.
 * rackState: available | empty | blocked | replenishment_delayed. Omit blank fields.
 * No URLs, secrets or executable input in case fields.
 * buildPlan(request) -> {answer, source, connected, executed, goal, scenarioId,
 *   selectionReason, workflow, expectedResult}; workflow is a ready robot-routines
 *   body {scenarioId, mode, cycles:1, speed:1, caseContext}. Never execute it here.
 * buildRecipe(request) -> {schemaVersion:1, scenarioId, mode, caseContext}.
 * validateRecipe(recipe) -> normalized copy; no goals, commands, URLs or credentials.
 * exportBat() -> CONSTANT CRLF text, independent of all input. Never run on server.
 *
 * MAIN integration: POST /api/joule/chat validates body, launches tenant-owned job,
 * builds plan + recipe and returns job {jobId, events:'/api/jobs/:jobId/events'}.
 * job_complete SSE: {id:jobId,type:'job_complete',result:{answer:plan.answer,plan,
 *   recipe:{id:serverGeneratedId,recipe:buildRecipe(input),bat:exportBat()}}}.
 * GET /api/recipes/:id -> same {id,recipe,bat} public record. Store tenantId/ownerId
 * separately SERVER SIDE; authenticate/authorize ALL reads, jobs and SSE with the
 * stored tenant. Never accept tenantId from body or expose another tenant's record.
 * These pure helpers do not implement access control. Do not audit/log raw goals.
 *
 * Export names: run-routine.bat + routine.recipe.json. Copy BOTH to project root;
 * keep scripts/ and src/ in place. Start app first, double-click BAT manually.
 * Local desktop auth only. Assisted replay queues a job; approvals remain in app.
 * Simulation replay is simulated only. No auth tokens, cloud calls or live commands.
 */
import { validateCaseContext, defaultCaseContext, rackStates } from './routine-context.mjs';

const SCENARIOS = [
  { id: 'autonomous-inspection', name: 'Autonomous inspection', steps: ['Select Unitree inspection route', 'Sample simulated sensors', 'Classify condition', 'Record inspection evidence'] },
  { id: 'adaptive-assembly', name: 'Adaptive assembly', steps: ['Read variant', 'Present component', 'UR5 simulated assembly', 'Inspect and route result'] },
  { id: 'autonomous-orchestration', name: 'Autonomous orchestration', steps: ['Asset operator', 'Unitree inspection', 'Joule Work technician assignment (simulated)', 'Technician review', 'Executive demand', 'Line allocation', 'UR5 assembly', 'Quality', 'Pack and RFID', 'Warehouse', 'Transport', 'Delivery follow-up'] },
  { id: 'warehouse-fulfillment', name: 'Warehouse fulfillment', steps: ['Validate order', 'Check rack and reserve tote', 'Move and pick material', 'Verify quantity and destination'] }
];
const MODES = ['assisted', 'simulation'];
const BAT = '@echo off\r\nsetlocal DisableDelayedExpansion\r\nnode "%~dp0scripts\\run-routine.mjs" "%~dp0routine.recipe.json"\r\nexit /b %errorlevel%\r\n';

function fail(field) {
  const error = new Error(`Invalid ${field}. Use only supported, secret-free local recipe data.`);
  error.status = 400; error.code = 'invalid_recipe_request'; throw error;
}
function record(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(field);
  for (const key of Reflect.ownKeys(value)) {
    if (!keys.includes(key)) fail(field);
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property.enumerable || !Object.hasOwn(property, 'value')) fail(field);
  }
  return value;
}
function caseData(input = {}) {
  record(input, ['sku', 'rfidEpc', 'quantity', 'destination', 'rackState'], 'caseContext');
  return validateCaseContext(input);
}
function routine(input) {
  if (!Object.hasOwn(input, 'scenarioId') || !SCENARIOS.some(({ id }) => id === input.scenarioId)) fail('scenarioId');
  const mode = Object.hasOwn(input, 'mode') ? input.mode : 'assisted';
  if (!MODES.includes(mode)) fail('mode');
  if (Object.hasOwn(input, 'caseContext') && input.caseContext === undefined) fail('caseContext');
  return { scenarioId: input.scenarioId, mode, caseContext: caseData(input.caseContext) };
}
export function descriptor() {
  return { source: 'local_deterministic', connected: false, status: 'NOT_CONNECTED',
    liveEnabled: false, llmCalls: false, scenarios: structuredClone(SCENARIOS),
    modes: [...MODES], rackStates: [...rackStates], defaultCaseContext: { ...defaultCaseContext },
    limits: { goal: 2000, identifier: 80, rfidEpc: 64, quantity: 10000, conversation: 20 },
    exportFiles: ['run-routine.bat', 'routine.recipe.json'],
    instructions: 'Copy both export files to the project root; keep scripts/ and src/. Start the local app, then manually run the BAT. Review assisted approvals in the app.' };
}
export function validateRequest(input) {
  record(input, ['goal', 'scenarioId', 'mode', 'caseContext'], 'request');
  if (!Object.hasOwn(input, 'goal') || typeof input.goal !== 'string' || input.goal.length > 2000 || !input.goal.trim()
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(input.goal)
    || /(?:bearer\s+\S+|(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+|https?:\/\/[^\s/]*@)/i.test(input.goal)) fail('goal');
  return { goal: input.goal, ...routine(input) };
}
export function buildPlan(input) {
  const request = validateRequest(input), scenario = SCENARIOS.find(({ id }) => id === request.scenarioId);
  const rack = request.caseContext.rackState;
  const exception = rack && rack !== 'available';
  const answer = `Local deterministic planner — NOT_CONNECTED to Joule. Selected: ${scenario.name} (${scenario.id}); mode: ${request.mode}. `
    + 'Your goal is recorded as text, not executed or interpreted as a command. Only the explicit fields configure this predefined workflow. '
    + (exception ? `Rack state ${rack} is exception context, not evidence that it has been resolved. ` : '')
    + 'The plan has not run. Preview or export the recipe; assisted execution requires approval in the app.';
  return { answer, source: 'local_deterministic', connected: false, executed: false,
    goal: { text: request.goal, interpretation: 'literal_text_not_executed' },
    scenarioId: scenario.id, selectionReason: 'explicit_ui_selection',
    workflow: { scenarioId: scenario.id, mode: request.mode, cycles: 1, speed: 1, caseContext: request.caseContext },
    expectedResult: { status: 'proposed_not_run', steps: [...scenario.steps],
      evidenceRequired: true, exceptionContext: Boolean(exception), productionCommands: false } };
}
export function buildRecipe(input) {
  const { scenarioId, mode, caseContext } = validateRequest(input);
  return { schemaVersion: 1, scenarioId, mode, caseContext };
}
export function validateRecipe(input) {
  record(input, ['schemaVersion', 'scenarioId', 'mode', 'caseContext'], 'recipe');
  if (input.schemaVersion !== 1) fail('schemaVersion');
  return { schemaVersion: 1, ...routine(input) };
}
export function exportBat() { return BAT; }
