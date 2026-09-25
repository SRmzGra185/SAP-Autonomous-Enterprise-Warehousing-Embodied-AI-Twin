// Local placeholder only; no browser persistence, remote requests, secrets or HTML rendering.
const SCENARIOS = [
  ['autonomous-inspection', 'Autonomous inspection'], ['adaptive-assembly', 'Adaptive assembly'],
  ['autonomous-orchestration', 'Autonomous orchestration'], ['warehouse-fulfillment', 'Warehouse fulfillment']
];
const RACK_STATES = ['available', 'empty', 'blocked', 'replenishment_delayed'];
// Mirrors the main-owned routine-context.mjs; parity is covered by tests.
const DEFAULT_CONTEXT = { sku: 'DEMO-PUMP-KIT', rfidEpc: '3034257BF400B78000000001', quantity: 4, destination: 'DEMO-RECEIVING-01', rackState: 'available' };
const BAT = '@echo off\r\nsetlocal DisableDelayedExpansion\r\nnode "%~dp0scripts\\run-routine.mjs" "%~dp0routine.recipe.json"\r\nexit /b %errorlevel%\r\n';
const CASE_KEYS = ['sku', 'rfidEpc', 'quantity', 'destination', 'rackState'];
// Prompt library: curated goals per scenario. Fields are applied to the explicit inputs; the goal stays text.
const PROMPTS = {
  'autonomous-inspection': [
    { label: 'Pump inspection', goal: 'Inspect pump DEMO-PUMP-KIT with the Unitree robot, classify its condition from the simulated sensors and record the evidence; if an anomaly is detected, propose the corresponding maintenance order.', fields: { sku: 'DEMO-PUMP-KIT' } },
    { label: 'Assisted route', goal: 'Walk the inspection route in assisted mode and pause before every physical action so an operator approves it in the app.', fields: { mode: 'assisted' } },
    { label: 'Simulate 4 assets', goal: 'Simulate the inspection of 4 assets with no live commands and summarize the safety risks and which evidence gets recorded.', fields: { mode: 'simulation', quantity: 4 } }
  ],
  'adaptive-assembly': [
    { label: 'Variant assembly', goal: 'Assemble the DEMO-PUMP-KIT variant with the UR5, inspect the result and route rejected parts to review.', fields: { sku: 'DEMO-PUMP-KIT' } },
    { label: 'Simulated cycle', goal: 'Prepare one adaptive assembly cycle in simulation and explain which sensors validate each step before moving to the next.', fields: { mode: 'simulation' } }
  ],
  'autonomous-orchestration': [
    { label: 'Full circle', goal: 'Orchestrate the full circle inspection → maintenance → production → RFID packing → delivery for 4 units to DEMO-RECEIVING-01, with human approval at every handover.', fields: { quantity: 4, destination: 'DEMO-RECEIVING-01', mode: 'assisted' } },
    { label: 'Technician via Joule Work', goal: 'After the inspection, assign a technician via Joule Work (simulated), align executive demand with the assembly line and explain which approvals each step requires.' }
  ],
  'warehouse-fulfillment': [
    { label: 'Fulfill order', goal: 'Fulfill 4 units of SKU DEMO-PUMP-KIT with EPC 3034257BF400B78000000001 to destination DEMO-RECEIVING-01, verify quantity and destination and record the evidence.', fields: { sku: 'DEMO-PUMP-KIT', rfidEpc: '3034257BF400B78000000001', quantity: 4, destination: 'DEMO-RECEIVING-01' } },
    { label: 'Blocked rack', goal: 'The rack is blocked: reserve an alternative tote and explain how to resolve the exception before moving any material.', fields: { rackState: 'blocked' } },
    { label: 'Order in simulation', goal: 'Prepare the order in simulation mode and tell me which evidence gets recorded and what assisted mode would do differently.', fields: { mode: 'simulation' } }
  ],
  '*': [
    { label: 'Risks & approvals', goal: 'Which safety risks does this routine carry and which human approvals are required before each physical action?' },
    { label: 'Explain step by step', goal: 'Explain step by step what the robot will do, which sensors it uses and which data is recorded as evidence for SAP.' }
  ]
};
const mounts = new WeakMap();
function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}
function button(text, action) {
  const item = node('button', text); item.type = 'button'; item.addEventListener('click', action); return item;
}
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error('Invalid data.');
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!keys.includes(key) || !property.enumerable || !Object.hasOwn(property, 'value')) throw new Error('Invalid data.');
  }
}
// Server remains authoritative. Rebuild exported JSON from this strict data allowlist.
export function validateClientRecipe(value) {
  exact(value, ['schemaVersion', 'scenarioId', 'mode', 'caseContext']);
  if (value.schemaVersion !== 1 || !SCENARIOS.some(([id]) => id === value.scenarioId)
    || !['assisted', 'simulation'].includes(value.mode)) throw new Error('Invalid recipe.');
  exact(value.caseContext, ['sku', 'rfidEpc', 'quantity', 'destination', 'rackState']);
  const context = { ...DEFAULT_CONTEXT };
  for (const key of ['sku', 'rfidEpc', 'quantity', 'destination', 'rackState']) {
    if (!Object.hasOwn(value.caseContext, key)) continue;
    const field = value.caseContext[key];
    const valid = key === 'quantity' ? Number.isInteger(field) && field >= 1 && field <= 10000
      : key === 'rackState' ? RACK_STATES.includes(field)
      : typeof field === 'string' && (key === 'rfidEpc' ? /^[A-Fa-f0-9]{8,64}$/.test(field) : /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(field));
    if (!valid) throw new Error('Invalid case context.');
    context[key] = key === 'rfidEpc' ? field.toUpperCase() : field;
  }
  return { schemaVersion: 1, scenarioId: value.scenarioId, mode: value.mode, caseContext: context };
}
function recipeRecord(value) {
  if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id) || value.bat !== BAT) throw new Error('Invalid recipe record.');
  return { id: value.id, recipe: validateClientRecipe(value.recipe), bat: BAT };
}
/**
 * initJouleChat({api,getScenario,runRecipe?}) mounts #joule-chat, or returns null.
 * api(path,{method,body,signal}) -> parsed JSON (same-origin, auth owned by main).
 * getScenario() -> selected scenario ID or {id}; checked again on every ask unless
 * user explicitly overrides in this panel. No scenario inferred from goal words.
 * Optional runRecipe(workflow) is called ONLY by the preview's explicit queue button;
 * main owns queuing/approval UI. Without it, this panel only plans and exports.
 * POST result and GET record contract: see src/routine-library.mjs header.
 * Optional activeLabel names the "use active scenario" button (default: workspace wording).
 * Returns {refreshSelection,destroy}. Call destroy on tenant/session change to erase
 * history and close streams. No conversation history is submitted to the server.
 */
export function initJouleChat({ api, getScenario, runRecipe, activeLabel }) {
  const root = document.querySelector('#joule-chat');
  if (!root) return null;
  if (typeof api !== 'function' || typeof getScenario !== 'function') throw new TypeError('api and getScenario are required.');
  mounts.get(root)?.destroy();
  let disposed = false, busy = false, overridden = false, connected = false, currentRecord = null, source = null, stopWatch = null;
  const history = [], controllers = new Set(), downloadUrls = new Set(), timers = new Set();
  root.classList.add('joule-chat');
  const header = node('div', undefined, 'joule-heading');
  const title = node('h2', 'Joule-like local planner'), badge = node('span', 'NOT_CONNECTED', 'joule-badge');
  header.append(title, badge);
  const note = node('p', 'Deterministic placeholder · no Joule API or remote LLM. Do not enter credentials. Goals are text; only explicit fields configure the four predefined routines. Blank case fields use the displayed DEMO defaults.');
  const messages = node('div', undefined, 'joule-messages'); messages.setAttribute('role', 'log'); messages.setAttribute('aria-live', 'polite');
  const suggestions = node('div', undefined, 'joule-suggestions'); suggestions.hidden = true;
  const status = node('p', 'Ready to plan. Nothing has run.', 'joule-status'); status.setAttribute('role', 'status');
  const form = node('form');
  const fields = node('div', undefined, 'joule-fields');
  const inputs = {};
  function field(name, label, options) {
    const wrapper = node('label', label), control = node(options ? 'select' : 'input');
    control.name = name; inputs[name] = control;
    if (options) for (const [value, text] of options) { const option = node('option', text); option.value = value; control.append(option); }
    else { control.type = 'text'; control.maxLength = name === 'rfidEpc' ? 64 : 80; control.autocomplete = 'off'; control.spellcheck = false; control.placeholder = String(DEFAULT_CONTEXT[name] ?? ''); }
    wrapper.append(control); fields.append(wrapper); return control;
  }
  const scenario = field('scenarioId', 'Scenario', SCENARIOS); scenario.required = true;
  scenario.addEventListener('change', () => { overridden = true; renderPrompts(); });
  const active = button(activeLabel || 'Use active workspace scenario', () => { overridden = false; refreshSelection(); });
  field('mode', 'Replay mode', [['assisted', 'Assisted · approve in app'], ['simulation', 'Simulation only']]);
  field('sku', 'SKU (optional)'); field('rfidEpc', 'RFID EPC · hex (optional)');
  const quantity = field('quantity', 'Quantity (optional)'); quantity.type = 'number'; quantity.min = '1'; quantity.max = '10000'; quantity.step = '1';
  field('destination', 'Destination (optional)');
  field('rackState', 'Rack state (optional)', [['', 'DEMO default: available'], ...RACK_STATES.map(value => [value, value])]);
  const goalLabel = node('label', 'What result do you want?');
  const goal = node('textarea'); goal.name = 'goal'; goal.maxLength = 2000; goal.required = true; goal.rows = 3;
  goal.placeholder = 'Describe your goal. Choose the scenario and case fields above.'; goalLabel.append(goal);
  const ask = node('button', 'Ask local planner'); ask.type = 'submit';
  const preview = button('Preview recipe', () => { void openPreview(); }); preview.disabled = true;
  const clear = button('Clear conversation', () => { history.length = 0; messages.replaceChildren(); currentRecord = null; preview.disabled = true; suggestions.hidden = true; suggestions.replaceChildren(); });
  const actions = node('div', undefined, 'joule-actions'); actions.append(ask, preview, clear);
  const promptBar = node('div', undefined, 'joule-prompts');
  function applyFields(values) {
    if (!values) return;
    if (values.scenarioId && SCENARIOS.some(([id]) => id === values.scenarioId)) { scenario.value = values.scenarioId; overridden = true; }
    if (values.mode) inputs.mode.value = values.mode;
    for (const key of CASE_KEYS) if (values[key] !== undefined) inputs[key].value = String(values[key]);
    renderPrompts();
  }
  function renderPrompts() {
    const items = [...(PROMPTS[scenario.value] || []), ...PROMPTS['*']];
    promptBar.replaceChildren(node('span', 'PROMPT LIBRARY', 'joule-prompts-label'), ...items.map(prompt => {
      const chip = button(prompt.label, () => { if (busy) return; goal.value = prompt.goal; applyFields(prompt.fields); goal.focus(); status.textContent = connected ? 'Prompt loaded. Ask Joule to plan it.' : 'Prompt loaded. Ask the local planner to plan it.'; });
      chip.className = 'joule-chip'; chip.title = prompt.goal; return chip;
    }));
  }
  function renderSuggestions(values) {
    suggestions.replaceChildren(); suggestions.hidden = true;
    if (!values) return;
    const changes = Object.entries(values).filter(([key, value]) => String(key === 'scenarioId' ? scenario.value : inputs[key]?.value ?? '') !== String(value));
    if (!changes.length) return;
    const listEl = node('ul');
    for (const [key, value] of changes) listEl.append(node('li', `${key} → ${value}`));
    const apply = button('Apply suggestions', () => { applyFields(values); suggestions.hidden = true; status.textContent = 'Fields updated from Joule. Ask again to rebuild the recipe with them.'; });
    const ignore = button('Ignore', () => { suggestions.hidden = true; });
    const row = node('div', undefined, 'joule-actions'); row.append(apply, ignore);
    suggestions.append(node('strong', 'Joule suggests these explicit fields from your goal:'), listEl, row);
    suggestions.hidden = false;
  }
  form.append(fields, active, promptBar, goalLabel, actions);
  const modal = node('dialog', undefined, 'joule-recipe-dialog');
  modal.setAttribute('aria-label', 'Local routine recipe preview');
  const modalStatus = node('p'); modalStatus.setAttribute('role', 'status');
  const recipeText = node('pre');
  const exportButton = button('Download BAT + recipe JSON', () => download());
  const runButton = button('Queue in local app', () => { void queue(); }); runButton.hidden = typeof runRecipe !== 'function';
  const close = button('Close', () => modal.close());
  const modalActions = node('div', undefined, 'joule-actions'); modalActions.append(exportButton, runButton, close);
  modal.append(node('h3', 'Reusable local recipe'), modalStatus, recipeText,
    node('p', 'Copy run-routine.bat and routine.recipe.json to the project root; keep scripts/ and src/. Start the app, then manually run the BAT. Your browser may ask to allow two downloads. Nothing is executed by export.'), modalActions);
  root.replaceChildren(header, note, messages, suggestions, form, status, modal);
  async function loadDescriptor() {
    try {
      const descriptor = await call('/api/joule/descriptor');
      if (disposed || !descriptor || descriptor.status !== 'CONNECTED' || typeof descriptor.model !== 'string') return;
      connected = true;
      title.textContent = 'Joule'; badge.textContent = 'CONNECTED'; badge.classList.add('connected');
      note.textContent = `Your goal is interpreted in natural language; only the explicit fields configure the four predefined routines, and Joule can only suggest values for them. Nothing executes from this chat; assisted replay still requires approval in the app. Do not enter credentials.`;
      ask.textContent = 'Ask Joule'; renderPrompts();
    } catch { /* stays NOT_CONNECTED */ }
  }
  function refreshSelection() {
    if (disposed || overridden) return;
    const selected = getScenario(); const id = typeof selected === 'string' ? selected : selected?.id;
    scenario.value = SCENARIOS.some(([value]) => value === id) ? id : '';
    if (!scenario.value) status.textContent = 'Choose one of the four scenarios; no active selection is available.';
    renderPrompts();
  }
  function addMessage(role, text) {
    history.push({ role, text }); if (history.length > 20) history.shift();
    messages.replaceChildren(...history.map(item => node('p', `${item.role}: ${item.text}`, 'joule-message')));
    messages.scrollTop = messages.scrollHeight;
  }
  function lock(value) {
    busy = value;
    for (const item of form.querySelectorAll('button, input, select, textarea')) item.disabled = value;
    preview.disabled = value || !currentRecord;
  }
  async function call(path, options = {}) {
    const controller = new AbortController(); controllers.add(controller);
    const timer = setTimeout(() => controller.abort(), 15000); timers.add(timer);
    try { return await api(path, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); timers.delete(timer); controllers.delete(controller); }
  }
  function watch(job) {
    if (!job || typeof job.jobId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(job.jobId)
      || job.events !== `/api/jobs/${job.jobId}/events`) throw new Error('Invalid local job.');
    return new Promise((resolve, reject) => {
      source = new EventSource(job.events);
      const stream = source; let ended = false;
      const timer = setTimeout(() => finish(new Error('Planner timed out.')), 120000); timers.add(timer);
      function finish(error, result) {
        if (ended) return; ended = true; stream.close(); source = null; stopWatch = null;
        clearTimeout(timer); timers.delete(timer); error ? reject(error) : resolve(result);
      }
      stopWatch = () => finish(new Error('Planner stopped.'));
      for (const type of ['job_started', 'job_progress', 'planner_progress', 'job_complete', 'job_failed', 'job_cancelled']) {
        stream.addEventListener(type, event => {
          if (ended || disposed) return;
          try {
            if (typeof event.data !== 'string' || event.data.length > 32768) throw new Error('Invalid event.');
            const payload = JSON.parse(event.data);
            if (payload.id !== job.jobId || payload.type !== type) throw new Error('Invalid event.');
            if (type === 'job_complete') finish(null, payload.result);
            else if (type === 'job_failed' || type === 'job_cancelled') finish(new Error('Planner stopped.'));
            else status.textContent = payload.stage === 'aicore' ? 'Joule is reasoning…' : 'Local planner is preparing the predefined workflow…';
          } catch { finish(new Error('Invalid planner event.')); }
        });
      }
      stream.addEventListener('error', () => finish(new Error('Planner stream unavailable.')));
    });
  }
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || disposed) return;
    refreshSelection();
    try {
      const context = {};
      for (const key of ['sku', 'rfidEpc', 'quantity', 'destination', 'rackState']) {
        if (inputs[key].value !== '') context[key] = key === 'quantity' ? Number(inputs[key].value) : inputs[key].value;
      }
      const wanted = validateClientRecipe({ schemaVersion: 1, scenarioId: scenario.value, mode: inputs.mode.value, caseContext: context });
      if (!goal.value.trim() || goal.value.length > 2000
        || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(goal.value)
        || /(?:bearer\s+\S+|(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*\S+|https?:\/\/[^\s/]*@)/i.test(goal.value)) throw new Error('Invalid goal.');
      const request = { goal: goal.value, scenarioId: wanted.scenarioId, mode: wanted.mode, caseContext: wanted.caseContext };
      currentRecord = null; lock(true); addMessage('You', request.goal); suggestions.hidden = true;
      status.textContent = connected ? 'Submitting to Joule…' : 'Submitting local planning job…';
      const job = await call('/api/joule/chat', { method: 'POST', body: JSON.stringify(request) });
      if (disposed) return;
      const result = await watch(job);
      if (disposed) return;
      const record = recipeRecord(result?.recipe);
      if (typeof result.answer !== 'string' || result.answer.length > 4000 || result.plan?.source !== 'local_deterministic'
        || typeof result.plan.connected !== 'boolean' || result.plan.executed !== false
        || JSON.stringify(record.recipe) !== JSON.stringify(wanted)) throw new Error('Invalid planner result.');
      currentRecord = record;
      const joule = result.joule && typeof result.joule === 'object' ? result.joule : null;
      addMessage(joule ? 'Joule' : 'Local planner', result.answer);
      for (const risk of Array.isArray(joule?.risks) ? joule.risks.slice(0, 3) : []) if (typeof risk === 'string') addMessage('Joule · risk', risk.slice(0, 300));
      for (const next of Array.isArray(joule?.nextActions) ? joule.nextActions.slice(0, 3) : []) if (typeof next === 'string') addMessage('Joule · next', next.slice(0, 300));
      renderSuggestions(joule?.fieldSuggestions && typeof joule.fieldSuggestions === 'object' ? joule.fieldSuggestions : null);
      status.textContent = joule
        ? 'Plan ready · Joule · recipe stays deterministic · nothing executed. Preview to inspect or export.'
        : 'Plan ready · NOT_CONNECTED · nothing executed. Preview to inspect or export.';
    } catch {
      if (!disposed) { currentRecord = null; status.textContent = 'Planning unavailable or input rejected. Check the listed fields and retry. No routine was executed by this panel.'; }
    } finally { if (!disposed) lock(false); }
  });
  async function openPreview() {
    if (busy || disposed || !currentRecord) return;
    lock(true); exportButton.disabled = true; runButton.disabled = true;
    recipeText.textContent = ''; modalStatus.textContent = 'Loading tenant-scoped recipe…'; modal.showModal();
    try {
      const next = recipeRecord(await call(`/api/recipes/${currentRecord.id}`));
      if (disposed) return;
      if (next.id !== currentRecord.id || JSON.stringify(next.recipe) !== JSON.stringify(currentRecord.recipe)) throw new Error('Recipe changed.');
      currentRecord = next; recipeText.textContent = JSON.stringify(next.recipe, null, 2);
      modalStatus.textContent = 'Validated local data · not run. Export downloads two files; it never launches the BAT.';
      exportButton.disabled = false; runButton.disabled = false;
    } catch { if (!disposed) modalStatus.textContent = 'Recipe unavailable for this session. Ask the planner again.'; }
    finally { if (!disposed) lock(false); }
  }
  function download() {
    if (disposed || exportButton.disabled || !currentRecord) return;
    const recipe = validateClientRecipe(currentRecord.recipe);
    for (const [name, text, type] of [['run-routine.bat', BAT, 'application/octet-stream'], ['routine.recipe.json', JSON.stringify(recipe, null, 2) + '\n', 'application/json']]) {
      const url = URL.createObjectURL(new Blob([text], { type })); downloadUrls.add(url);
      const link = node('a'); link.href = url; link.download = name; modal.append(link); link.click(); link.remove();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.delete(url); timers.delete(timer); }, 30000); timers.add(timer);
    }
    modalStatus.textContent = 'Two downloads requested. Check both files in Downloads; nothing was executed.';
  }
  async function queue() {
    if (disposed || busy || runButton.disabled || typeof runRecipe !== 'function' || !currentRecord) return;
    const recipe = validateClientRecipe(currentRecord.recipe); lock(true); runButton.disabled = true;
    try {
      await runRecipe({ scenarioId: recipe.scenarioId, mode: recipe.mode, cycles: 1, speed: 1, caseContext: recipe.caseContext });
      if (!disposed && modal.open) modal.close();
      if (!disposed) modalStatus.textContent = 'Handed to the local app. Review progress and assisted approvals there; completion is not assumed.';
    } catch { if (!disposed) modalStatus.textContent = 'Could not confirm queuing. Check app progress before retrying.'; }
    finally { if (!disposed) lock(false); }
  }
  const controller = { refreshSelection, destroy() {
    if (disposed) return; disposed = true; stopWatch?.(); source?.close();
    for (const request of controllers) request.abort();
    for (const timer of timers) clearTimeout(timer);
    for (const url of downloadUrls) URL.revokeObjectURL(url);
    controllers.clear(); timers.clear(); downloadUrls.clear(); history.length = 0; currentRecord = null;
    if (modal.open) modal.close(); root.replaceChildren(); mounts.delete(root);
  } };
  mounts.set(root, controller); refreshSelection(); void loadDescriptor(); return controller;
}
