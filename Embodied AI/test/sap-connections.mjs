import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";
import { validateSapProfile, sapConnectionDescriptor, dryRunSapConnection } from "../src/sap-connections.mjs";
import { initConnectionsUI } from "../public/connections-ui.js";


// Synthetic offline fixtures only; never defaults or real tenant details.
const cloud = (extra = {}) => ({ role: "BDC_CONNECT", kind: "cloud", environment: "sandbox", tenantUrl: "https://tenant.invalid", ...extra });
const rejected = (input, code) => {
  const result = validateSapProfile(input);
  assert.equal(result.valid, false);
  assert.equal(result.complete, false);
  assert.equal(result.profile, null);
  if (code) assert.ok(result.errors.some((error) => error.code === code), JSON.stringify(result.errors));
  const check = dryRunSapConnection(input);
  assert.equal(check.allowed, false);
  assert.equal(check.status, "incomplete");
  assert.equal(check.connected, false);
  return result;
};

test("descriptor has exactly two cloud roles with blank metadata and seven fields", () => {
  const descriptor = sapConnectionDescriptor();
  assert.equal(descriptor.version, 2);
  assert.deepEqual(descriptor.roles.map(({ role }) => role), ["BDC_CONNECT", "JOULE"]);
  assert.deepEqual(Object.keys(descriptor.kinds), ["cloud"]);
  assert.deepEqual(Object.keys(descriptor.schema.properties), ["role", "kind", "environment", "tenantUrl", "destination", "readOnly", "liveEnabled"]);
  assert.equal(descriptor.storage, "none");
  assert.equal(descriptor.scope, "caller_owned_server_tenant_memory");
  assert.equal(descriptor.schema.additionalProperties, false);
  assert.equal(descriptor.policy.networkAccess, false);
  for (const { role, kind, fields, template } of descriptor.roles) {
    assert.equal(kind, "cloud");
    assert.equal(template.role, role);
    assert.equal(template.kind, kind);
    assert.deepEqual(fields, ["role", "kind", "environment", "tenantUrl", "destination"]);
    for (const field of ["environment", "tenantUrl", "destination"]) assert.equal(template[field], "");
    assert.equal(template.readOnly, true);
    assert.equal(template.liveEnabled, false);
    const result = validateSapProfile(template);
    assert.equal(result.valid, true);
    assert.equal(result.complete, false);
    assert.deepEqual(result.missing, ["environment", "tenantUrl|destination"]);
    assert.equal(dryRunSapConnection(template).status, "incomplete");
  }
});

test("descriptors, templates, arrays, and policy cannot mutate future calls", () => {
  const first = sapConnectionDescriptor(), expected = sapConnectionDescriptor();
  first.policy.liveEnabled = true;
  first.schema.properties.environment.enum.push("live");
  first.schema.properties.destination.maxLength = 999;
  first.kinds.cloud.fields.push("password");
  first.roles[0].template.tenantUrl = "https://changed.invalid";
  first.roles[0].description = "changed";
  first.roles[0].fields.push("password");
  first.emptyTemplate.readOnly = false;
  assert.deepEqual(sapConnectionDescriptor(), expected);
  assert.equal(validateSapProfile(cloud()).valid, true);
  rejected(cloud({ environment: "live" }), "invalid_enum");
});

test("empty and partial drafts never invent environment, kind, or tenant metadata", () => {
  for (const input of [undefined, {}, sapConnectionDescriptor().emptyTemplate]) {
    const result = validateSapProfile(input);
    assert.equal(result.valid, true);
    assert.equal(result.complete, false);
    assert.deepEqual(result.missing, ["role", "kind", "environment"]);
    assert.deepEqual(result.profile, { role: "", kind: "", environment: "", tenantUrl: "", destination: "", readOnly: true, liveEnabled: false });
  }
  const partial = validateSapProfile({ role: "JOULE", kind: "cloud" });
  assert.equal(partial.profile.tenantUrl, "");
  assert.equal(partial.profile.destination, "");
  assert.deepEqual(partial.missing, ["environment", "tenantUrl|destination"]);
  assert.equal(validateSapProfile({ role: "BDC_CONNECT" }).profile.kind, "");
});

test("both roles accept complete metadata without ever reporting a connection", () => {
  for (const { role } of sapConnectionDescriptor().roles) {
    const result = dryRunSapConnection(cloud({ role }));
    assert.equal(result.allowed, true);
    assert.equal(result.validation.valid, true);
    assert.equal(result.validation.complete, true);
    assert.equal(result.status, "configured_not_connected");
    assert.equal(result.reason, "metadata_complete");
    assert.equal(result.dryRun, true);
    assert.equal(result.readOnly, true);
    assert.equal(result.liveEnabled, false);
    assert.equal(result.connected, false);
    assert.equal(result.connectionAttempted, false);
    assert.equal(result.connectionTestsEnabled, false);
    assert.equal(Object.hasOwn(result, "success"), false);
  }
});

test("normalization does not mutate input, truncate strings, or coerce numbers", () => {
  const input = Object.freeze(cloud({ role: " JOULE ", environment: " sandbox ", destination: " offline_Destination-1.0 ", tenantUrl: " HTTPS://Tenant.Invalid:443/ " }));
  const result = validateSapProfile(input);
  assert.equal(result.valid, true);
  assert.equal(result.profile.role, "JOULE");
  assert.equal(result.profile.environment, "sandbox");
  assert.equal(result.profile.destination, "offline_Destination-1.0");
  assert.equal(result.profile.tenantUrl, "https://tenant.invalid");
  assert.equal(input.role, " JOULE ");
  assert.deepEqual(validateSapProfile(result.profile), result);
  assert.notEqual(validateSapProfile(input).profile, result.profile);
  for (const value of [7, 0, null, false]) rejected(cloud({ destination: value }), "invalid_type");
});

test("cloud needs URL or destination, validates both, and has no legacy fields", () => {
  const result = validateSapProfile({ role: "JOULE", kind: "cloud", environment: "mock", destination: "offline_destination-1.0" });
  assert.equal(result.complete, true);
  assert.equal(result.profile.tenantUrl, "");
  for (const field of ["sid", "client", "connectionName"]) assert.equal(Object.hasOwn(result.profile, field), false);
  assert.equal(validateSapProfile(cloud({ destination: "offline_destination" })).complete, true);
  const blank = validateSapProfile(cloud({ tenantUrl: "", destination: "" }));
  assert.equal(blank.valid, true);
  assert.equal(blank.complete, false);
  assert.deepEqual(blank.missing, ["tenantUrl|destination"]);
  rejected(cloud({ tenantUrl: "http://tenant.invalid", destination: "offline_destination" }), "insecure_tenant_url");
  rejected(cloud({ destination: "password=DO_NOT_RETURN" }), "invalid_format");
});

test("only exact cloud roles are accepted; legacy products and scenario connections are rejected", () => {
  for (const role of ["ERP", "EWM", "BW", "BDC", "Datasphere", "DATASPHERE", "SAC", "Joule", "bdc_connect", "joule", "warehouse-fulfillment", "UNKNOWN", "__proto__", "constructor", {}, null]) rejected(cloud({ role }));
  for (const kind of ["sap_gui_abap", "gui", "rfc", "odata", "Cloud", "__proto__", "constructor"]) rejected(cloud({ kind }));
  for (const environment of ["prod", "PRODUCTION", "live", true]) rejected(cloud({ environment }));
  for (const environment of ["mock", "sandbox"]) assert.equal(dryRunSapConnection(cloud({ environment })).allowed, true);
  for (const field of ["sid", "client", "connectionName", "scenarioId", "system", "host"]) {
    for (const value of ["", "DO_NOT_RETURN"]) rejected(cloud({ [field]: value }), "unknown_field");
  }
});

test("all declared string lengths match runtime limits without silent truncation", () => {
  for (const [field, rule] of Object.entries(sapConnectionDescriptor().schema.properties)) {
    if (rule.type === "string") rejected(cloud({ [field]: "A".repeat(rule.maxLength + 1) }), "too_long");
  }
  assert.equal(validateSapProfile(cloud({ destination: "A".repeat(128) })).valid, true);
  rejected(cloud({ destination: " ".repeat(2049) }), "too_long");
});

test("rejects markup, controls, invisible formatting, and malformed values", () => {
  for (const character of ["<", ">", "\n", "\r", "\t", "\0", "\x7f", "\u0085", "\u200b", "\u202e", "\ufeff"]) {
    for (const field of ["role", "kind", "environment", "tenantUrl", "destination"]) rejected(cloud({ [field]: `fixture${character}` }), "unsafe_text");
  }
  for (const value of [null, [], {}, 1, true, undefined]) rejected(cloud({ destination: value }), "invalid_type");
  for (const destination of ["A/B", "a:b", "a b", "a@b", "a?b", "a#b", ".", "a=b"]) rejected(cloud({ destination }), "invalid_format");
});

test("accepts HTTPS origins and only explicit local HTTP origins", () => {
  for (const [tenantUrl, expected] of [
    [" HTTPS://Tenant.Invalid:443/ ", "https://tenant.invalid"],
    ["https://tenant.invalid:8443", "https://tenant.invalid:8443"],
    ["http://localhost:4173", "http://localhost:4173"],
    ["http://LOCALHOST/", "http://localhost"],
    ["http://127.0.0.1:8080/", "http://127.0.0.1:8080"],
    ["http://[::1]:8080", "http://[::1]:8080"]
  ]) {
    const result = validateSapProfile(cloud({ tenantUrl }));
    assert.equal(result.valid, true, JSON.stringify(result.errors));
    assert.equal(result.profile.tenantUrl, expected);
    assert.deepEqual(validateSapProfile(result.profile), result);
  }
});

test("rejects remote HTTP, local lookalikes, and alternate numeric loopback spellings", () => {
  for (const tenantUrl of [
    "http://tenant.invalid", "http://10.0.0.1", "http://192.168.1.1", "http://169.254.169.254",
    "http://localhost.evil.invalid", "http://localhost.", "http://sub.localhost", "http://127.0.0.1.evil.invalid",
    "http://0.0.0.0", "http://127.0.0.2", "http://127.1", "http://2130706433", "http://0x7f000001",
    "http://0177.0.0.1", "http://127.000.000.001", "http://[::ffff:127.0.0.1]", "http://[0:0:0:0:0:0:0:1]"
  ]) rejected(cloud({ tenantUrl }), "insecure_tenant_url");
});

test("rejects credentials and token-bearing/ambiguous/non-HTTP URL shapes without echoes", () => {
  for (const tenantUrl of [
    "https://user:DO_NOT_RETURN@tenant.invalid", "https://user@tenant.invalid", "https://@tenant.invalid",
    "https://tenant.invalid/?token=DO_NOT_RETURN", "https://tenant.invalid#DO_NOT_RETURN",
    "https://tenant.invalid/path/DO_NOT_RETURN", "https://tenant.invalid?", "https://tenant.invalid#",
    "https://tenant.invalid/./", "https://tenant.invalid/%2e/", "https://tenant.invalid//",
    "https://%74enant.invalid", "http://%6cocalhost", "https://tenant.invalid\\path",
    "https:tenant.invalid", "https:///tenant.invalid", "//tenant.invalid", "tenant.invalid",
    "ftp://tenant.invalid", "file:///local", "javascript:alert(1)", "data:text/plain,fixture",
    "https://tenant.invalid:70000", "https://tenant.invalid:0", "http://[::1", "https://tenant.invalid /"
  ]) {
    const result = rejected(cloud({ tenantUrl }));
    assert.equal(JSON.stringify(result).includes("DO_NOT_RETURN"), false);
    assert.equal(JSON.stringify(dryRunSapConnection(cloud({ tenantUrl }))).includes("DO_NOT_RETURN"), false);
  }
});

test("rejects passwords/keys, nested credentials, unknown fields, and caller-supplied tenant ownership", () => {
  for (const field of ["password", "Password", "passwd", "pwd", "apiKey", "private_key", "clientSecret", "accessToken", "authorization", "cookie", "credentials", "certificate"]) {
    for (const value of ["DO_NOT_RETURN", "", { password: "DO_NOT_RETURN" }]) {
      const result = rejected(cloud({ [field]: value }), "credentials_forbidden");
      assert.equal(JSON.stringify(result).includes("DO_NOT_RETURN"), false);
    }
  }
  for (const field of ["tenantId", "ownerId", "user", "headers", "options", "auth", "operation", "productionWrite", "testConnection", "live"]) {
    rejected(cloud({ [field]: "DO_NOT_RETURN" }), "unknown_field");
  }
  const cyclic = {}; cyclic.credentials = cyclic;
  rejected(cloud({ options: cyclic }), "unknown_field");
  const result = rejected(cloud({ "DO_NOT_RETURN": "DO_NOT_RETURN" }));
  assert.equal(JSON.stringify(result).includes("DO_NOT_RETURN"), false);
});

test("rejects prototype tricks, accessors, symbols, non-JSON roots, and oversized objects", () => {
  for (const input of [null, [], "{}", 1, false, () => {}, new Date(), new Map(), Object.create({ role: "BDC_CONNECT" })]) rejected(input, "invalid_profile");
  for (const field of ["__proto__", "constructor", "prototype"]) {
    rejected({ ...cloud(), ...JSON.parse(`{"${field}":{"polluted":true}}`) }, "unknown_field");
  }
  assert.equal({}.polluted, undefined);
  const accessor = cloud();
  let getterCalled = false;
  Object.defineProperty(accessor, "destination", { enumerable: true, get() { getterCalled = true; throw new Error("must not execute"); } });
  rejected(accessor, "invalid_property");
  assert.equal(getterCalled, false);
  const hidden = cloud(); Object.defineProperty(hidden, "destination", { value: "offline_destination", enumerable: false });
  rejected(hidden, "invalid_property");
  rejected({ ...cloud(), [Symbol("DO_NOT_RETURN")]: "DO_NOT_RETURN" }, "unknown_field");
  rejected(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`unknown${i}`, ""])), "too_many_fields");
  assert.equal(validateSapProfile(Object.assign(Object.create(null), cloud())).complete, true);
});

test("read-only and live-disable flags cannot be relaxed or truthy-coerced", () => {
  for (const readOnly of [false, "true", 1, null, undefined]) rejected(cloud({ readOnly }), "unsafe_flag");
  for (const liveEnabled of [true, "false", 0, null, undefined]) rejected(cloud({ liveEnabled }), "unsafe_flag");
  assert.equal(validateSapProfile(cloud({ readOnly: true, liveEnabled: false })).complete, true);
});

test("production metadata can be held as a draft but every production check is denied", () => {
  for (const input of [
    cloud({ environment: "production" }), cloud({ role: "JOULE", environment: "production" }),
    cloud({ environment: " production ", tenantUrl: "http://localhost:4173" }),
    { role: "BDC_CONNECT", kind: "cloud", environment: "production" }
  ]) {
    assert.equal(validateSapProfile(input).valid, true);
    const check = dryRunSapConnection(input);
    assert.equal(check.allowed, false);
    assert.equal(check.status, "incomplete");
    assert.equal(check.reason, "production_connection_tests_disabled");
    assert.equal(check.connected, false);
    assert.equal(check.connectionAttempted, false);
  }
});

test("results contain no shared profile state, clocks, IDs, or tenant selection", () => {
  const first = validateSapProfile(cloud());
  const expected = validateSapProfile(cloud());
  first.profile.destination = "ZZZ";
  first.errors.push({ field: "$", code: "fixture", message: "fixture" });
  assert.deepEqual(validateSapProfile(cloud()), expected);
  assert.deepEqual(dryRunSapConnection(cloud()), dryRunSapConnection(cloud()));
  assert.deepEqual(Object.keys(expected.profile).sort(), ["role", "kind", "environment", "tenantUrl", "destination", "readOnly", "liveEnabled"].sort());
});

test("import and all exports stay offline under network tripwires", async (t) => {
  const deny = () => { throw new Error("Network access is forbidden in these tests."); };
  t.mock.method(globalThis, "fetch", deny);
  for (const module of [http, https]) for (const method of ["request", "get"]) t.mock.method(module, method, deny);
  t.mock.method(net.Socket.prototype, "connect", deny);
  for (const method of ["lookup", "resolve"]) t.mock.method(dns, method, deny);
  const offline = await import("../src/sap-connections.mjs?offline-contract-test");
  assert.deepEqual(Object.keys(offline).sort(), ["dryRunSapConnection", "sapConnectionDescriptor", "validateSapProfile"]);
  offline.sapConnectionDescriptor();
  for (const input of [{}, cloud(), cloud({ role: "JOULE" }), cloud({ tenantUrl: "http://localhost:4173" }), cloud({ environment: "production" })]) {
    offline.validateSapProfile(input);
    const result = offline.dryRunSapConnection(input);
    assert.equal(result.connectionAttempted, false);
    assert.equal(result.connected, false);
  }
  for (const mock of [fetch, http.request, http.get, https.request, https.get, net.Socket.prototype.connect, dns.lookup, dns.resolve]) {
    assert.equal(mock.mock.callCount(), 0);
  }
});


test("environment worksheet contains only blank BDC Connect/Joule cloud metadata and safety constants", async () => {
  const example = await readFile(new URL("../.env.sap.example", import.meta.url), "utf8");
  const lines = example.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
  const entries = Object.fromEntries(lines.map((line) => line.split("=")));
  for (const { role } of sapConnectionDescriptor().roles) {
    for (const suffix of ["ENVIRONMENT", "TENANT_URL", "DESTINATION"]) assert.equal(entries[`SAP_${role}_${suffix}`], "");
  }
  assert.equal(entries.SAP_CONNECTIONS_READ_ONLY, "true");
  assert.equal(entries.SAP_CONNECTIONS_LIVE_ENABLED, "false");
  assert.equal(entries.SAP_CONNECTIONS_TESTS_ENABLED, "false");
  assert.equal(lines.length, 9);
  assert.ok(Object.keys(entries).every((key) => !/PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|SID|CLIENT|LOGON/.test(key)));
});

// Small DOM/EventSource doubles: exercise UI contracts without a browser or sockets.
function uiHarness(t) {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = new Map(); this.attributes = {}; this.classList = { add() {} }; this.value = ""; }
    set textContent(value) { this.text = String(value); this.children = []; }
    get textContent() { return (this.text || "") + this.children.map((child) => child.textContent).join(""); }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    replaceChildren(...nodes) { this.text = ""; this.children = []; this.append(...nodes); }
    setAttribute(key, value) { this.attributes[key] = value; }
    addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
    async dispatch(type, event = {}) { for (const listener of this.listeners.get(type) || []) await listener(event); await this[`on${type}`]?.(event); }
    querySelectorAll(selector) { const tags = selector.split(",").map((tag) => tag.trim()); return this.children.flatMap((child) => [...(tags.includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)]); }
    click() { return this.dispatch("click"); }
    remove() { this.parent.children = this.parent.children.filter((child) => child !== this); }
  }
  const root = new Node("section"), sources = [], calls = [], blobs = [], revoked = [], saved = new Map(), controllers = [];
  t.after(() => { for (const controller of controllers) controller.destroy(); });
  class Source {
    constructor(url) { this.url = url; this.listeners = new Map(); sources.push(this); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    emit(type, payload) { this.listeners.get(type)?.({ data: JSON.stringify(payload) }); }
    close() { this.closed = true; }
  }
  for (const [key, value] of Object.entries({
    document: { querySelector: () => root, createElement: (tag) => new Node(tag) },
    window: { addEventListener() {}, removeEventListener() {} }, EventSource: Source
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  t.mock.method(globalThis, "fetch", () => { throw new Error("No direct fetch allowed."); });
  t.mock.method(URL, "createObjectURL", (blob) => { blobs.push(blob); return `blob:offline-${blobs.length}`; });
  t.mock.method(URL, "revokeObjectURL", (url) => revoked.push(url));
  const api = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (options.method === "GET") return { descriptor: sapConnectionDescriptor(), profiles: [...saved.values()] };
    const profile = JSON.parse(options.body);
    if (options.method === "PUT") {
      assert.equal(path, "/api/sap-connections");
      const result = validateSapProfile(profile); if (result.valid) saved.set(profile.role, result.profile); return result;
    }
    assert.equal(path, "/api/sap-connections/check"); assert.equal(options.method, "POST");
    return { jobId: "job_fixture", events: "/api/jobs/job_fixture/events" };
  };
  const button = (text) => root.querySelectorAll("button").find((node) => node.textContent === text);
  const field = (name) => root.querySelectorAll("input, select").find((node) => node.name === name);
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  const set = async (name, value) => { const input = field(name); input.value = value; await input.dispatch("input"); };
  const submit = async () => { await root.querySelectorAll("form")[0].dispatch("submit", { preventDefault() {} }); await tick(); };
  const importBundle = async (bundle, size) => {
    const input = root.querySelectorAll("input").find((node) => node.type === "file");
    const text = JSON.stringify(bundle); input.files = [{ size: size ?? Buffer.byteLength(text), text: async () => text }]; await input.dispatch("change");
  };
  const mount = async (options = { api }) => { const controller = await initConnectionsUI(options); controllers.push(controller); return controller; };
  return { root, sources, calls, blobs, revoked, saved, api, button, field, tick, set, submit, importBundle, mount };
}

test("UI renders two blank cloud drafts, uses exact API calls, and owns job_complete stream", async (t) => {
  const h = uiHarness(t), ui = await h.mount();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].path, "/api/sap-connections");
  assert.match(h.root.textContent, /Session-only/);
  assert.deepEqual(h.root.querySelectorAll("input, select").filter((node) => node.name).map((node) => node.name), ["environment", "tenantUrl", "destination"]);
  for (const name of ["environment", "tenantUrl", "destination"]) assert.equal(h.field(name).value, "");
  await h.submit();
  assert.equal(h.saved.get("BDC_CONNECT").environment, "");
  assert.match(h.root.textContent, /Saved — session-only tenant memory/);
  await h.set("environment", "sandbox"); await h.set("tenantUrl", " HTTPS://Tenant.Invalid:443/ ");
  await h.submit();
  assert.equal(h.saved.get("BDC_CONNECT").tenantUrl, "https://tenant.invalid");
  await h.button("Check metadata (offline)").click(); await h.tick();
  assert.equal(h.sources.length, 1); assert.equal(h.sources[0].url, "/api/jobs/job_fixture/events");
  assert.equal(h.button("Save session draft").disabled, true);
  h.sources[0].emit("job_complete", { id: "job_fixture", type: "job_complete", result: dryRunSapConnection(h.saved.get("BDC_CONNECT")) });
  assert.equal(h.sources[0].closed, true);
  assert.match(h.root.textContent, /Configured — not connected/);
  assert.equal(h.button("Save session draft").disabled, false);
  await h.button("Joule").click();
  for (const name of ["environment", "tenantUrl", "destination"]) assert.equal(h.field(name).value, "");
  await h.set("environment", "production");
  await h.button("Check metadata (offline)").click(); await h.tick();
  h.sources[1].emit("job_complete", { id: "job_fixture", type: "job_complete", result: dryRunSapConnection({ ...sapConnectionDescriptor().roles[1].template, environment: "production" }) });
  assert.match(h.root.textContent, /Production checks are disabled/);
  assert.equal(h.sources[1].closed, true); assert.equal(fetch.mock.callCount(), 0);
});

test("UI imports atomically without saving, rejects unsafe metadata, and exports sanitized JSON", async (t) => {
  const h = uiHarness(t), ui = await h.mount();
  await h.importBundle({ version: 1, profiles: [cloud({ destination: "  offline_Dest  " }), cloud({ role: "JOULE" })] });
  assert.equal(h.calls.length, 1); assert.equal(h.field("destination").value, "offline_Dest");
  assert.match(h.root.textContent, /Imported page draft — not saved/);
  const hostile = [
    cloud({ password: "DO_NOT_RETURN" }), cloud({ tenantId: "DO_NOT_RETURN" }), cloud({ role: "ERP" }),
    cloud({ sid: "" }), cloud({ readOnly: false }), cloud({ liveEnabled: true }),
    cloud({ tenantUrl: "https://user:DO_NOT_RETURN@tenant.invalid" }), cloud({ tenantUrl: "http://127.1" }),
    cloud({ tenantUrl: "https://tenant.invalid/?token=DO_NOT_RETURN" }), cloud({ tenantUrl: "https://tenant.invalid\\path" }),
    cloud({ destination: "<DO_NOT_RETURN>" }), cloud({ destination: "\u200bDO_NOT_RETURN" }), cloud({ destination: 7 })
  ];
  for (const profile of hostile) {
    await h.importBundle({ version: 1, profiles: [cloud({ destination: "should_not_replace" }), profile] });
    assert.match(h.root.textContent, /Import rejected/);
    assert.equal(h.field("destination").value, "offline_Dest");
    assert.equal(h.root.textContent.includes("DO_NOT_RETURN"), false);
  }
  for (const bundle of [
    { version: 1, profiles: [cloud(), cloud()] }, { version: 1, profiles: [] },
    { version: 1, profiles: [cloud()], tenantId: "DO_NOT_RETURN" }, { version: 2, profiles: [cloud()] }
  ]) { await h.importBundle(bundle); assert.match(h.root.textContent, /Import rejected/); }
  await h.importBundle({ version: 1, profiles: [cloud()] }, 16385); assert.match(h.root.textContent, /Import rejected/);
  await h.button("Export local JSON").click();
  const exported = JSON.parse(await h.blobs[0].text());
  assert.deepEqual(Object.keys(exported), ["version", "profiles"]);
  assert.equal(exported.version, 1); assert.equal(exported.profiles.length, 2);
  for (const profile of exported.profiles) assert.deepEqual(validateSapProfile(profile).profile, profile);
  assert.equal(exported.profiles[0].destination, "offline_Dest"); assert.equal(h.calls.length, 1);
  ui.destroy(); assert.equal(h.revoked.length, 1);
});

test("UI refuses external event URLs, forged connected results, and closes failed/disposed streams", async (t) => {
  const h = uiHarness(t);
  let external = true;
  const ui = await h.mount({ api: async (path, options) => {
    const response = await h.api(path, options);
    return options.method === "POST" && external ? { ...response, events: "https://external.invalid/events" } : response;
  } });
  await h.button("Check metadata (offline)").click(); await h.tick();
  assert.equal(h.sources.length, 0); assert.equal(h.button("Save session draft").disabled, false);
  external = false;
  await h.button("Check metadata (offline)").click(); await h.tick();
  h.sources[0].emit("job_complete", { id: "job_fixture", type: "job_complete", result: { ...dryRunSapConnection(cloud()), connected: true } });
  assert.match(h.root.textContent, /Could not verify/); assert.equal(h.sources[0].closed, true);
  await h.button("Check metadata (offline)").click(); await h.tick(); h.sources[1].emit("error", {});
  assert.equal(h.sources[1].closed, true); assert.equal(h.button("Save session draft").disabled, false);
  await h.button("Check metadata (offline)").click(); await h.tick();
  ui.destroy(); assert.equal(h.sources[2].closed, true); assert.equal(h.root.children.length, 0);
  assert.equal(h.calls.at(-1).signal.aborted, true);
});

test("UI refresh clears prior tenant drafts; a late response cannot revive a destroyed mount", async (t) => {
  const h = uiHarness(t); h.saved.set("BDC_CONNECT", validateSapProfile(cloud()).profile);
  const ui = await h.mount();
  assert.equal(h.field("tenantUrl").value, "https://tenant.invalid");
  h.saved.clear(); await ui.refresh(); assert.equal(h.field("tenantUrl").value, "");
  let release;
  const slow = h.mount({ api: () => new Promise((resolve) => { release = resolve; }) });
  await h.mount();
  release({ descriptor: sapConnectionDescriptor(), profiles: [cloud({ tenantUrl: "https://stale.invalid" })] });
  const stale = await slow; stale.destroy();
  assert.equal(h.field("tenantUrl").value, "");
  assert.equal(h.root.textContent.includes("stale.invalid"), false);
});
