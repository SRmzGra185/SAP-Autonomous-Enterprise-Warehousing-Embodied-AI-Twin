import assert from "node:assert/strict";
import { test } from "node:test";
import { initExperimentsUI, effectiveCapacity, withCapacity, modelSignature, isPaired } from "../public/experiments-ui.js";
import { experimentTemplate, validateExperimentProfile } from "../src/industrial-timing.mjs";
import { runSimulation } from "../src/engine.mjs";

const model = () => ({ id: "fixture", name: "Test cell", executionRoute: ["a", "b"], nodes: [{ id: "a", name: "Packing", capacity: 2, service: 3 }, { id: "b", name: "Transport", capacity: 4, service: 2 }] });
// Minimal DOM implementation: no browser or third-party test dependency.
class Element {
  constructor(tag = "div") { this.tagName = tag; this.children = []; this._value = ""; this._text = ""; this.hidden = false; this.disabled = false; this.files = []; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(" "); }
  set value(value) { this._value = String(value); }
  get value() { return this.tagName === "select" ? (this.children.find(child => child.value === this._value) || this.children[0])?.value || "" : this._value; }
  get options() { return this.children; }
  append(child) { this.children.push(child); }
  prepend(child) { this.children.unshift(child); }
  replaceChildren(...children) { this.children = children; this._text = ""; }
  set innerHTML(html) {
    this.markup = html; this.elements = new Map();
    for (const match of html.matchAll(/<(\w+)\b([^>]*\bdata-(input|action|output)="([^"]+)"[^>]*)>/g)) {
      const el = new Element(match[1]); el.hidden = /\bhidden\b/.test(match[2]);
      el.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || "";
      this.elements.set(`[data-${match[3]}="${match[4]}"]`, el);
    }
  }
  querySelector(selector) { return this.elements.get(selector); }
  querySelectorAll() { return [...this.elements.values()].filter(el => ["button", "input", "textarea", "select"].includes(el.tagName)); }
}
function harness(t, options = {}) {
  const root = new Element(), calls = [], sources = [], current = { model: model() };
  const oldDocument = globalThis.document, oldEventSource = globalThis.EventSource;
  globalThis.document = { querySelector: () => root, createElement: tag => new Element(tag) };
  class Source {
    constructor(url) { this.url = url; this.handlers = {}; sources.push(this); }
    addEventListener(type, fn) { this.handlers[type] = fn; }
    close() { this.closed = true; }
    emit(payload, generic = false) { (generic ? this.onmessage : this.handlers[payload.type])({ data: JSON.stringify(payload) }); }
  }
  globalThis.EventSource = Source;
  const api = async (path, opts) => {
    calls.push({ path, options: opts });
    if (options.api) return options.api(path, opts);
    if (path === "/api/experiment-template") return experimentTemplate(current.model);
    return { jobId: `job-${calls.length}`, events: `/events/${calls.length}` };
  };
  const ui = initExperimentsUI({ api, getModel: () => current.model, onCapacityChange: options.onCapacityChange, beforeRun: options.beforeRun, onRunningChange: options.onRunningChange });
  t.after(() => { ui.destroy(); globalThis.document = oldDocument; globalThis.EventSource = oldEventSource; });
  return { ui, root, calls, sources, current, input: name => root.querySelector(`[data-input="${name}"]`), out: name => root.querySelector(`[data-output="${name}"]`), click: name => root.querySelector(`[data-action="${name}"]`).onclick() };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("capacity helper respects profile overrides, bounds and immutability", () => {
  const m = model(), p = experimentTemplate(m); p.nodes[1].capacity = 7;
  const before = structuredClone(p), candidate = withCapacity(p, "a", 32);
  assert.equal(effectiveCapacity(p, m, "a"), 2); assert.equal(effectiveCapacity(p, m, "b"), 7);
  assert.equal(candidate.nodes[0].capacity, 32); assert.equal(candidate.nodes[1].capacity, 7);
  assert.deepEqual(p, before); assert.equal(m.nodes[0].capacity, 2);
  validateExperimentProfile(candidate, m);
  for (const value of [0, 33, 1.5, NaN, "3"]) assert.throws(() => withCapacity(p, "a", value), /whole number/);
  assert.throws(() => withCapacity(p, "missing", 3), /missing/);
});
test("model signature sees identity, route and capacity changes, ignores layout dragging", () => {
  const m = model(), before = modelSignature(m); m.nodes[0].x = 123;
  assert.equal(modelSignature(m), before);
  for (const mutate of [m => m.id = "new", m => m.nodes[0].capacity++, m => m.executionRoute.reverse()]) {
    const copy = structuredClone(m); mutate(copy); assert.notEqual(modelSignature(copy), before);
  }
});
test("resource picker syncs candidate JSON and optional callback is detached", async t => {
  let notification;
  const h = harness(t, { onCapacityChange: value => { notification = value; value.candidate.nodes[0].capacity = 31; } });
  await h.ui.loadTemplate(); const saved = structuredClone(h.current.model);
  assert.equal(h.out("baseline-capacity").textContent, "2");
  assert.equal(h.input("candidate").value, "");
  h.input("capacity").value = "5"; h.input("capacity").oninput();
  assert.equal(JSON.parse(h.input("candidate").value).nodes[0].capacity, 5);
  assert.equal(notification.experimentOnly, true); assert.deepEqual(h.current.model, saved);
  h.input("resource").value = "b"; h.input("resource").onchange();
  assert.equal(h.out("baseline-capacity").textContent, "4");
  h.input("capacity").value = "8"; h.input("capacity").oninput();
  assert.deepEqual(JSON.parse(h.input("candidate").value).nodes.map(n => n.capacity), [5, 8]);
  h.input("capacity").value = "33"; h.input("capacity").oninput();
  assert.match(h.out("status").textContent, /whole number/);
  await h.click("run"); assert.equal(h.calls.filter(c => c.path === "/api/simulations").length, 0);
});
test("stale model preserves drafts, blocks run and asks before template replacement", async t => {
  const h = harness(t); await h.ui.loadTemplate();
  h.input("capacity").value = "7"; h.input("capacity").oninput();
  const draft = h.input("candidate").value;
  h.current.model.nodes[0].capacity = 6; assert.equal(h.ui.refreshModel(), true);
  assert.equal(h.out("baseline-capacity").textContent, "6"); assert.equal(h.input("candidate").value, draft);
  await h.click("run"); assert.equal(h.calls.length, 1);
  await h.ui.loadTemplate(); assert.equal(h.out("confirm").hidden, false); assert.equal(h.calls.length, 1);
  h.click("cancel"); assert.equal(h.input("candidate").value, draft);
  h.click("keep"); assert.equal(h.ui.refreshModel(), false); assert.equal(h.input("candidate").value, draft);
  await h.ui.loadTemplate(); await h.click("replace"); assert.equal(h.input("candidate").value, "");
});
test("late template response does not erase drafts after model replacement", async t => {
  let resolve;
  const h = harness(t, { api: () => new Promise(r => { resolve = r; }) });
  h.input("baseline").value = JSON.stringify(experimentTemplate(h.current.model));
  const draft = h.input("baseline").value;
  await h.ui.loadTemplate(); const loading = h.click("replace");
  h.current.model = { ...model(), id: "different" }; resolve(experimentTemplate(model())); await loading;
  assert.equal(h.input("baseline").value, draft); assert.match(h.out("status").textContent, /Drafts preserved/);
});
test("import respects overrides and invalid JSON prevents submission", async t => {
  const h = harness(t); const profile = experimentTemplate(h.current.model); profile.nodes[0].capacity = 9;
  h.input("file").files = [{ size: 100, text: async () => JSON.stringify(profile) }]; await h.input("file").onchange();
  assert.equal(h.out("baseline-capacity").textContent, "9"); assert.match(h.out("capacity-source").textContent, /override/);
  h.input("candidate").value = "{"; h.input("candidate").oninput(); await h.click("run");
  assert.equal(h.calls.length, 0); assert.match(h.out("status").textContent, /Candidate JSON is invalid/);
  h.input("file").files = [{ size: 1024 * 1024 + 1 }]; await h.input("file").onchange(); assert.match(h.out("status").textContent, /1 MiB/);
});
test("real engine summaries render cards and paired comparison via isolated SSE", async t => {
  const transitions = [];
  const h = harness(t, { onRunningChange: value => transitions.push(value) }); await h.ui.loadTemplate(); h.input("capacity").value = "3"; h.input("capacity").oninput();
  assert.deepEqual(transitions, []);
  h.input("runs").value = "2"; h.input("entities").value = "3";
  const running = h.click("run"); await tick();
  for (let i = 0; i < 2; i++) {
    const request = JSON.parse(h.calls[i + 1].options.body);
    assert.equal(request.mode, "monte-carlo"); assert.equal(request.detail, false); assert.equal(request.seed, 42);
    const summary = await runSimulation(h.current.model, request);
    h.sources[i].emit({ type: i ? "job_complete" : "simulation_complete", summary, result: summary }, !!i); await tick();
    if (!i) assert.deepEqual(transitions, [true]);
  }
  await running;
  assert.deepEqual(transitions, [true, false]);
  assert.equal(h.out("results").children[0].className, "ix-comparison");
  assert.match(h.out("results").textContent, /Average time per unit/); assert.match(h.out("results").textContent, /Raw result JSON/);
  assert.match(h.out("results").textContent, /does not establish statistical significance/);
  assert.ok(h.sources.every(s => s.closed)); assert.equal(h.current.model.nodes[0].capacity, 2);
  assert.match(h.root.markup, /<details class="ix-details"><summary>Timing profiles/);
});
test("failed and destroyed streams clean up and never submit a candidate", async t => {
  const h = harness(t); await h.ui.loadTemplate();
  let pending = h.click("run"); await tick(); h.sources[0].emit({ type: "job_failed", error: "Invalid profile" }); await pending;
  assert.match(h.out("status").textContent, /Invalid profile/); assert.equal(h.sources[0].closed, true);
  pending = h.click("run"); await tick(); h.ui.destroy(); await pending; assert.equal(h.sources[1].closed, true);
});
test("pairing rejects empty, changed seeds, different units and incomplete cohorts", () => {
  const a = { timing: { entityUnit: "order" }, replications: [{ seed: 42, completed: 3 }] };
  assert.equal(isPaired(a, structuredClone(a)), true);
  assert.equal(isPaired({ replications: [] }, { replications: [] }), false);
  for (const mutate of [b => b.replications[0].seed++, b => b.replications[0].completed--, b => b.timing.entityUnit = "batch"]) {
    const b = structuredClone(a); mutate(b); assert.equal(isPaired(a, b), false);
  }
});
test("beforeRun flushes before submission and running hook unlocks on guard rejection", async t => {
  let release; const transitions = [];
  const h = harness(t, { beforeRun: () => new Promise((resolve, reject) => { release = reject; }), onRunningChange: value => transitions.push(value) });
  await h.ui.loadTemplate(); assert.deepEqual(transitions, []);
  const pending = h.click("run"); await tick();
  assert.deepEqual(transitions, [true]); assert.equal(h.calls.length, 1); assert.equal(h.sources.length, 0);
  release(new Error("Robot or basic DES is active")); await pending;
  assert.deepEqual(transitions, [true, false]); assert.equal(h.calls.length, 1);
  assert.match(h.out("status").textContent, /Robot or basic DES is active/);
});
test("successful save flush completes before POST and destroy releases run lock", async t => {
  let release; const transitions = [];
  const h = harness(t, { beforeRun: () => new Promise(resolve => { release = resolve; }), onRunningChange: value => transitions.push(value) });
  await h.ui.loadTemplate(); const pending = h.click("run"); await tick(); assert.equal(h.calls.length, 1);
  release(); await tick(); assert.equal(h.calls[1].path, "/api/simulations");
  assert.deepEqual(transitions, [true]); h.ui.destroy(); await pending; assert.deepEqual(transitions, [true, false]);
});
test("malformed profile structure disables capacity without crashing editor", async t => {
  const h = harness(t); await h.ui.loadTemplate();
  for (const bad of [null, {}, { nodes: [null] }, { nodes: "bad" }]) {
    h.input("baseline").value = JSON.stringify(bad); assert.doesNotThrow(() => h.input("baseline").oninput());
    assert.equal(h.input("capacity").disabled, true);
  }
});
