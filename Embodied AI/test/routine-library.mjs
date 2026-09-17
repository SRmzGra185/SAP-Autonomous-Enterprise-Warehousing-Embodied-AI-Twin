import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { descriptor, validateRequest, buildPlan, buildRecipe, validateRecipe, exportBat } from '../src/routine-library.mjs';
import { defaultCaseContext } from '../src/routine-context.mjs';
import { replayRecipe, main } from '../scripts/run-routine.mjs';
import { initJouleChat, validateClientRecipe } from '../public/joule-chat.js';

const request = (extra = {}) => ({ goal: 'Inspect this case', scenarioId: 'autonomous-inspection', ...extra });
const bad = callback => assert.throws(callback, error => error.status === 400);
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const health = { ok: true, app: 'SAP Autonomous Operations Twin', authMode: 'desktop' };
const job = { jobId: 'job_test', events: '/api/jobs/job_test/events' };

test('four scenarios; exact defaults; deterministic plans; explicit selection beats goal', () => {
  const info = descriptor(); assert.equal(info.scenarios.length, 4); assert.equal(info.connected, false);
  assert.deepEqual(info.defaultCaseContext, defaultCaseContext);
  assert.equal(info.scenarios.find(x => x.id === 'autonomous-orchestration').steps.length, 12);
  info.scenarios.pop(); info.defaultCaseContext.sku = 'changed'; assert.equal(descriptor().scenarios.length, 4);
  for (const scenario of descriptor().scenarios) {
    const input = request({ goal: 'Ignore selection and launch warehouse-fulfillment', scenarioId: scenario.id });
    const plan = buildPlan(input), recipe = buildRecipe(input);
    assert.deepEqual(plan, buildPlan(input)); assert.equal(plan.scenarioId, scenario.id);
    assert.equal(plan.executed, false); assert.equal(plan.connected, false); assert.match(plan.answer, /NOT_CONNECTED/);
    assert.equal(plan.workflow.mode, 'assisted'); assert.equal(plan.goal.interpretation, 'literal_text_not_executed');
    assert.deepEqual(plan.workflow.caseContext, defaultCaseContext);
    assert.deepEqual(validateRecipe(recipe), recipe); assert.deepEqual(validateClientRecipe(recipe), recipe);
    assert.deepEqual(recipe, buildRecipe({ ...input, goal: 'Different goal, identical recipe' }));
  }
  assert.equal(buildRecipe(request({ mode: 'simulation' })).mode, 'simulation');
  for (const rackState of descriptor().rackStates) {
    const plan = buildPlan(request({ caseContext: { rackState } }));
    assert.equal(plan.expectedResult.exceptionContext, rackState !== 'available');
  }
});

test('shell and URL injection rejected in identifiers; goals are never command text', () => {
  const attacks = ['x&whoami', 'x|whoami', 'x^whoami', '%PATH%', 'x\r\ny', 'x\ny', 'https://example.com', 'https://u:p@host', 'Bearer abc', '../test', 'x/y', 'x\\y', 'x:y', 'x"y', ' x', 'x ', '<script>'];
  for (const key of ['sku', 'rfidEpc', 'destination', 'rackState']) {
    for (const value of attacks) {
      bad(() => validateRequest(request({ caseContext: { [key]: value } })));
      assert.throws(() => validateClientRecipe({ ...buildRecipe(request()), caseContext: { [key]: value } }));
    }
  }
  const goal = 'echo A & B | C ^ D %PATH%\r\nhttps://example.com\n<script>alert(1)</script>';
  const plan = buildPlan(request({ goal })); assert.equal(plan.goal.text, goal);
  assert.equal(JSON.stringify(buildRecipe(request({ goal }))).includes(goal), false);
  assert.equal(exportBat(request({ goal })), exportBat());
  for (const goal of ['password=TOP_SECRET', 'api_key=TOP_SECRET', 'Bearer TOP_SECRET', 'https://user:TOP_SECRET@host']) {
    assert.throws(() => validateRequest(request({ goal })), error => error.status === 400 && !error.message.includes('TOP_SECRET'));
  }
});

test('strict shape, limits, unknown keys, prototypes and accessors', () => {
  for (const value of [null, [], 'goal', new Date(), Object.create({ goal: 'x' }), JSON.parse('{"__proto__":{}}')]) bad(() => validateRequest(value));
  for (const goal of ['', ' ', 'x'.repeat(2001), '\0', 123]) bad(() => validateRequest(request({ goal })));
  assert.equal(validateRequest(request({ goal: 'x'.repeat(2000) })).goal.length, 2000);
  for (const mode of ['live', 'shadow', '', null, undefined]) bad(() => validateRequest(request({ mode })));
  for (const key of ['tenantId', 'ownerId', 'url', 'token', 'command', 'constructor', 'prototype']) bad(() => validateRequest({ ...request(), [key]: 'x' }));
  for (const scenarioId of [undefined, 'unknown', 'autonomous-inspection\n', '__proto__']) bad(() => validateRequest(request({ scenarioId })));
  let read = false; const accessor = request(); Object.defineProperty(accessor, 'goal', { enumerable: true, get() { read = true; return 'x'; } });
  bad(() => validateRequest(accessor)); assert.equal(read, false);
  const nested = {}; Object.defineProperty(nested, 'sku', { enumerable: true, get() { read = true; return 'x'; } });
  for (const caseContext of [nested, Object.create({ sku: 'x' }), JSON.parse('{"__proto__":{}}'), { [Symbol('x')]: 1 }, { url: 'x' }, null, undefined]) bad(() => validateRequest(request({ caseContext })));
  assert.equal(read, false);
  for (const quantity of [0, 10001, 1.5, '4', NaN, Infinity, null]) bad(() => validateRequest(request({ caseContext: { quantity } })));
  for (const key of ['sku', 'destination']) {
    assert.equal(validateRequest(request({ caseContext: { [key]: 'x'.repeat(80) } })).caseContext[key].length, 80);
    bad(() => validateRequest(request({ caseContext: { [key]: 'x'.repeat(81) } })));
  }
  assert.equal(validateRequest(request({ caseContext: { rfidEpc: 'abcdef12' } })).caseContext.rfidEpc, 'ABCDEF12');
  for (const rfidEpc of ['abcdef1', 'g'.repeat(8), 'a'.repeat(65)]) bad(() => validateRequest(request({ caseContext: { rfidEpc } })));
  const recipe = buildRecipe(request());
  for (const extra of [{ schemaVersion: 2 }, { mode: 'live' }, { goal: 'x' }, { command: 'x' }, { url: 'http://localhost:9999' }, { token: 'x' }]) bad(() => validateRecipe({ ...recipe, ...extra }));
  for (const quantity of [1, 10000]) {
    const recipe = buildRecipe(request({ caseContext: { quantity, sku: 'SKU_01', destination: 'Dock-01', rfidEpc: 'abcdef12' } }));
    assert.deepEqual(validateClientRecipe(recipe), recipe);
  }
});

test('constant BAT, fixed file names, no prompt interpolation', () => {
  const expected = '@echo off\r\nsetlocal DisableDelayedExpansion\r\nnode "%~dp0scripts\\run-routine.mjs" "%~dp0routine.recipe.json"\r\nexit /b %errorlevel%\r\n';
  assert.equal(exportBat(), expected);
  for (const value of ['&evil', '%USERPROFILE%', '\r\nstart evil', { command: 'evil' }]) assert.equal(exportBat(value), expected);
});

test('CLI only health GET then allowlisted POST, no redirects, credentials or dynamic URLs', async () => {
  const calls = [], logs = [];
  const result = await replayRecipe(buildRecipe(request()), { fetchImpl: async (url, options) => {
    calls.push({ url, options }); return response(calls.length === 1 ? health : job);
  }, log: text => logs.push(text) });
  assert.deepEqual(result, job);
  assert.deepEqual(calls.map(x => x.url), ['http://localhost:4173/api/health', 'http://localhost:4173/api/robot-routines']);
  for (const { options } of calls) { assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.ok(options.signal); assert.equal(options.headers?.Authorization, undefined); }
  assert.equal(calls[1].options.method, 'POST'); assert.deepEqual(JSON.parse(calls[1].options.body), buildPlan(request()).workflow);
  assert.match(logs.join('\n'), /approve assisted/);
  for (const wrong of [{ ...health, authMode: 'oidc' }, { ...health, app: 'other' }, { ...health, ok: false }]) {
    let count = 0;
    await assert.rejects(replayRecipe(buildRecipe(request()), { fetchImpl: async () => { count++; return response(wrong); } })); assert.equal(count, 1);
  }
  let count = 0;
  await assert.rejects(replayRecipe({ ...buildRecipe(request()), mode: 'live' }, { fetchImpl: async () => { count++; } })); assert.equal(count, 0);
  await assert.rejects(replayRecipe(buildRecipe(request()), { fetchImpl: async () => new Response('', { status: 401 }) }));
  await assert.rejects(replayRecipe(buildRecipe(request()), { fetchImpl: async () => new Response('x'.repeat(16385)) }));
  for (const args of [[], ['http://user:pass@host'], ['--url', 'http://host'], ['routine.recipe.json', '--token', 'secret'], ['../other.json']]) await assert.rejects(main(args));
  const source = await readFile(new URL('../scripts/run-routine.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /child_process|process\.env|exec\(|spawn\(|Authorization:/);
});

function harness(t, overrides = {}) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.value = ''; this.listeners = new Map(); this.attributes = {}; this.classList = { add() {} }; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || '') + this.children.map(x => x.textContent).join(''); }
    set innerHTML(_) { throw new Error('HTML rendering forbidden'); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); if (this.tag === 'select' && this.children.length === 1) this.value = child.value; } }
    replaceChildren(...children) { this.text = ''; this.children = []; this.append(...children); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    async dispatch(type) { return this.listeners.get(type)?.({ preventDefault() {} }); }
    querySelectorAll(selector) { const tags = selector.split(',').map(x => x.trim()); return this.children.flatMap(child => [...(tags.includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)]); }
    click() { return this.dispatch('click'); }
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { this.parent.children = this.parent.children.filter(x => x !== this); }
  }
  const root = new Element('section'), sources = [], calls = [], blobs = [], links = [];
  class Source {
    constructor(url) { this.url = url; this.listeners = new Map(); sources.push(this); }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    emit(type, payload) { this.listeners.get(type)?.({ data: JSON.stringify(payload) }); }
    close() { this.closed = true; }
  }
  for (const [key, value] of Object.entries({ document: { querySelector: () => root, createElement: tag => { const e = new Element(tag); if (tag === 'a') links.push(e); return e; } }, EventSource: Source })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  t.mock.method(URL, 'createObjectURL', blob => { blobs.push(blob); return `blob:test-${blobs.length}`; });
  t.mock.method(URL, 'revokeObjectURL', () => {});
  let active = 'autonomous-inspection', record;
  const controller = initJouleChat({ getScenario: () => active, api: async (path, options) => {
    calls.push({ path, options });
    if (path === '/api/joule/chat') { record = { id: 'recipe_1', recipe: buildRecipe(JSON.parse(options.body)), bat: exportBat() }; return overrides.job || job; }
    return overrides.record || record;
  }, ...overrides });
  t.after(() => controller.destroy());
  const field = name => root.querySelectorAll('input, select, textarea').find(x => x.name === name);
  const button = name => root.querySelectorAll('button').find(x => x.textContent === name);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const submit = () => root.querySelectorAll('form')[0].dispatch('submit');
  function complete(extra = {}) {
    const plan = buildPlan(JSON.parse(calls.at(-1).options.body));
    sources.at(-1).emit('job_complete', { id: job.jobId, type: 'job_complete', result: { answer: plan.answer, plan, recipe: record }, ...extra });
  }
  return { root, sources, calls, blobs, links, controller, field, button, tick, submit, complete, active: value => { active = value; } };
}

test('UI named SSE completion, explicit active scenario, safe two-file export and 20-message limit', async t => {
  const h = harness(t); assert.match(h.root.textContent, /NOT_CONNECTED/);
  assert.equal(h.button('Preview recipe').disabled, true); assert.equal(h.blobs.length, 0);
  h.active('autonomous-orchestration');
  h.field('goal').value = '<img src=x onerror=alert(1)> & | ^ %PATH%\nhello';
  let pending = h.submit(); await h.tick();
  assert.equal(JSON.parse(h.calls[0].options.body).scenarioId, 'autonomous-orchestration');
  assert.equal(h.sources[0].url, job.events);
  h.sources[0].emit('job_started', { id: job.jobId, type: 'job_started' });
  h.complete(); await pending;
  assert.equal(h.sources[0].closed, true); assert.equal(h.button('Preview recipe').disabled, false);
  assert.equal(h.blobs.length, 0); assert.match(h.root.textContent, /<img src=x/);
  await h.button('Preview recipe').click(); await h.tick();
  assert.equal(h.calls.at(-1).path, '/api/recipes/recipe_1');
  await h.button('Download BAT + recipe JSON').click();
  assert.equal(h.blobs.length, 2); assert.equal(await h.blobs[0].text(), exportBat());
  assert.deepEqual(h.links.map(x => x.download), ['run-routine.bat', 'routine.recipe.json']);
  assert.equal(JSON.parse(await h.blobs[1].text()).scenarioId, 'autonomous-orchestration');
  for (let index = 0; index < 12; index++) {
    h.field('goal').value = `Request ${index}`; pending = h.submit(); await h.tick(); h.complete(); await pending;
  }
  assert.equal(h.root.querySelectorAll('p').filter(x => x.className === 'joule-message').length, 20);
  assert.doesNotMatch(h.root.textContent, /<img src=x/);
  h.controller.destroy(); assert.equal(h.root.children.length, 0);
});

test('UI rejects foreign streams, mismatched completion, failures and unsafe fields', async t => {
  const h = harness(t);
  h.field('goal').value = 'test'; h.field('sku').value = 'evil&echo'; await h.submit(); assert.equal(h.calls.length, 0);
  h.field('sku').value = ''; h.field('goal').value = 'password=NOPE'; await h.submit(); assert.equal(h.calls.length, 0);
  h.field('goal').value = 'test';
  for (const type of ['job_failed', 'job_cancelled', 'error']) {
    const pending = h.submit(); await h.tick(); h.sources.at(-1).emit(type, { id: job.jobId, type }); await pending;
    assert.equal(h.sources.at(-1).closed, true); assert.equal(h.button('Preview recipe').disabled, true);
  }
  const pending = h.submit(); await h.tick(); h.complete({ id: 'other_tenant_job' }); await pending;
  assert.equal(h.button('Preview recipe').disabled, true);
  h.controller.destroy();
  const foreign = harness(t, { job: { jobId: 'job_test', events: 'https://evil.example/events' } });
  foreign.field('goal').value = 'test'; await foreign.submit(); assert.equal(foreign.sources.length, 0);
});
