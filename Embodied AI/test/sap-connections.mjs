import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";
import { validateSapProfile, sapConnectionDescriptor, dryRunSapConnection } from "../src/sap-connections.mjs";

// Synthetic metadata only. These values are not templates or real SAP credentials.
const abap = (extra = {}) => ({ role: "ERP", kind: "sap_gui_abap", environment: "sandbox", connectionName: "Offline fixture", sid: "T01", client: "007", ...extra });
const cloud = (extra = {}) => ({ role: "Datasphere", kind: "cloud", environment: "sandbox", tenantUrl: "https://tenant.invalid", ...extra });
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

test("descriptor maps all seven roles and keeps all connection values blank", () => {
  const descriptor = sapConnectionDescriptor();
  assert.deepEqual(descriptor.roles.map(({ role }) => role), ["ERP", "EWM", "BW", "BDC", "Datasphere", "SAC", "Joule"]);
  assert.equal(descriptor.storage, "none");
  assert.equal(descriptor.scope, "caller_owned_server_tenant_memory");
  assert.equal(descriptor.schema.additionalProperties, false);
  for (const { role, kind, fields, template } of descriptor.roles) {
    const isAbap = ["ERP", "EWM", "BW"].includes(role);
    assert.equal(kind, isAbap ? "sap_gui_abap" : "cloud");
    assert.deepEqual(fields, ["role", "kind", "environment", ...(isAbap ? ["connectionName", "sid", "client"] : ["tenantUrl", "destination"])]);
    for (const field of fields.filter((field) => !["role", "kind"].includes(field))) assert.equal(template[field], "");
    assert.equal(Object.hasOwn(template, "sid"), isAbap);
    const result = validateSapProfile(template);
    assert.equal(result.valid, true);
    assert.equal(result.complete, false);
    assert.equal(dryRunSapConnection(template).status, "incomplete");
  }
});

test("descriptors, templates, arrays, and policy cannot mutate future calls", () => {
  const first = sapConnectionDescriptor();
  const expected = sapConnectionDescriptor();
  first.policy.liveEnabled = true;
  first.schema.properties.environment.enum.push("live");
  first.schema.properties.sid.maxLength = 100;
  first.kinds.cloud.fields.push("password");
  first.roles[0].template.client = "999";
  first.roles[0].fields.push("password");
  first.emptyTemplate.readOnly = false;
  assert.deepEqual(sapConnectionDescriptor(), expected);
  assert.equal(validateSapProfile(abap()).valid, true);
  rejected(abap({ environment: "live" }), "invalid_enum");
});

test("empty and partial drafts never invent SID, client, environment, or kind", () => {
  for (const input of [undefined, {}, sapConnectionDescriptor().emptyTemplate]) {
    const result = validateSapProfile(input);
    assert.equal(result.valid, true);
    assert.equal(result.complete, false);
    assert.deepEqual(result.missing, ["role", "kind", "environment"]);
    assert.deepEqual(result.profile, { role: "", kind: "", environment: "", readOnly: true, liveEnabled: false });
  }
  const partial = validateSapProfile({ role: "ERP", kind: "sap_gui_abap", sid: "" });
  assert.equal(partial.profile.client, "");
  assert.equal(partial.profile.sid, "");
  assert.deepEqual(partial.missing, ["environment", "connectionName", "sid", "client"]);
  assert.equal(validateSapProfile({ role: "ERP" }).profile.kind, "");
});

test("every role accepts complete metadata without ever reporting a connection", () => {
  for (const { role, kind } of sapConnectionDescriptor().roles) {
    const result = dryRunSapConnection(kind === "cloud" ? cloud({ role }) : abap({ role }));
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

test("normalizes allowed strings without mutating input or coercing client numbers", () => {
  const input = Object.freeze(abap({ connectionName: "  Almacén / pruebas  ", sid: " t01 ", client: " 007 " }));
  const result = validateSapProfile(input);
  assert.equal(result.valid, true);
  assert.equal(result.profile.connectionName, "Almacén / pruebas");
  assert.equal(result.profile.sid, "T01");
  assert.equal(result.profile.client, "007");
  assert.equal(input.sid, " t01 ");
  assert.deepEqual(validateSapProfile(result.profile), result);
  assert.notEqual(validateSapProfile(input).profile, result.profile);
  for (const client of [7, 0, null, false, "7", "07", "0000", "1e2", "-01", "１２３"]) rejected(abap({ client }));
  for (const client of ["000", "001", "099", "999"]) assert.equal(validateSapProfile(abap({ client })).profile.client, client);
});

test("ABAP SID syntax is conservative, ASCII, and exactly three characters", () => {
  for (const sid of ["AB", "ABCD", "123", "A-1", "A_1", "ßa", "Ａ01", {}, 123]) rejected(abap({ sid }));
  assert.equal(validateSapProfile(abap({ sid: "a1b" })).profile.sid, "A1B");
});

test("cloud requires URL or destination, validates both when supplied, and needs no SID", () => {
  const destinationOnly = { role: "Joule", kind: "cloud", environment: "mock", destination: "offline_destination-1.0" };
  const result = validateSapProfile(destinationOnly);
  assert.equal(result.complete, true);
  assert.equal(result.profile.tenantUrl, "");
  assert.equal(Object.hasOwn(result.profile, "sid"), false);
  assert.equal(Object.hasOwn(result.profile, "client"), false);
  assert.equal(validateSapProfile(cloud({ destination: "offline_destination" })).complete, true);
  const blank = validateSapProfile(cloud({ tenantUrl: "", destination: "" }));
  assert.equal(blank.valid, true);
  assert.equal(blank.complete, false);
  assert.deepEqual(blank.missing, ["tenantUrl|destination"]);
  rejected(cloud({ tenantUrl: "http://tenant.invalid", destination: "offline_destination" }), "insecure_tenant_url");
  rejected(cloud({ destination: "password=DO_NOT_RETURN" }), "invalid_format");
});

test("strict enums, role-kind mapping, and branch-specific fields", () => {
  for (const role of ["erp", "UNKNOWN", "__proto__", "constructor", {}, null]) rejected(abap({ role }));
  for (const kind of ["gui", "rfc", "odata", "Cloud", "__proto__", "constructor"]) rejected(abap({ kind }));
  for (const environment of ["prod", "PRODUCTION", "live", true]) rejected(abap({ environment }));
  for (const environment of ["mock", "sandbox"]) assert.equal(dryRunSapConnection(abap({ environment })).allowed, true);
  rejected(abap({ role: "SAC" }), "role_kind_mismatch");
  rejected(cloud({ role: "BW" }), "role_kind_mismatch");
  for (const field of ["sid", "client", "connectionName"]) rejected(cloud({ [field]: "" }), "field_not_applicable");
  for (const field of ["tenantUrl", "destination"]) rejected(abap({ [field]: "" }), "field_not_applicable");
});

test("declared field lengths match runtime limits without silent truncation", () => {
  for (const field of ["connectionName", "sid", "client", "destination"]) {
    const limit = sapConnectionDescriptor().schema.properties[field].maxLength;
    const input = field === "destination" ? cloud({ [field]: "A".repeat(limit + 1) }) : abap({ [field]: "A".repeat(limit + 1) });
    rejected(input, "too_long");
  }
  rejected(cloud({ tenantUrl: `https://${"a".repeat(2048)}.invalid` }), "too_long");
  assert.equal(validateSapProfile(abap({ connectionName: "A".repeat(120) })).valid, true);
  assert.equal(validateSapProfile(cloud({ destination: "A".repeat(128) })).valid, true);
  rejected(abap({ connectionName: " ".repeat(2049) }), "too_long");
});

test("rejects markup, controls, invisible formatting, and malformed field values", () => {
  for (const character of ["<", ">", "\n", "\r", "\t", "\0", "\x7f", "\u0085", "\u200b", "\u202e", "\ufeff"]) {
    rejected(abap({ connectionName: `fixture${character}` }), "unsafe_text");
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
      const result = rejected(abap({ [field]: value }), "credentials_forbidden");
      assert.equal(JSON.stringify(result).includes("DO_NOT_RETURN"), false);
    }
  }
  for (const field of ["tenantId", "ownerId", "user", "headers", "options", "auth", "operation", "productionWrite", "testConnection", "live"]) {
    rejected(abap({ [field]: "DO_NOT_RETURN" }), "unknown_field");
  }
  const cyclic = {}; cyclic.credentials = cyclic;
  rejected(abap({ options: cyclic }), "unknown_field");
  const result = rejected(abap({ "DO_NOT_RETURN": "DO_NOT_RETURN" }));
  assert.equal(JSON.stringify(result).includes("DO_NOT_RETURN"), false);
});

test("rejects prototype tricks, accessors, symbols, non-JSON roots, and oversized objects", () => {
  for (const input of [null, [], "{}", 1, false, () => {}, new Date(), new Map(), Object.create({ role: "ERP" })]) rejected(input, "invalid_profile");
  for (const field of ["__proto__", "constructor", "prototype"]) {
    rejected({ ...abap(), ...JSON.parse(`{"${field}":{"polluted":true}}`) }, "unknown_field");
  }
  assert.equal({}.polluted, undefined);
  const accessor = abap();
  let getterCalled = false;
  Object.defineProperty(accessor, "sid", { enumerable: true, get() { getterCalled = true; throw new Error("must not execute"); } });
  rejected(accessor, "invalid_property");
  assert.equal(getterCalled, false);
  const hidden = abap(); Object.defineProperty(hidden, "sid", { value: "T01", enumerable: false });
  rejected(hidden, "invalid_property");
  rejected({ ...abap(), [Symbol("DO_NOT_RETURN")]: "DO_NOT_RETURN" }, "unknown_field");
  rejected(Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`unknown${i}`, ""])), "too_many_fields");
  assert.equal(validateSapProfile(Object.assign(Object.create(null), abap())).complete, true);
});

test("read-only and live-disable flags cannot be relaxed or truthy-coerced", () => {
  for (const readOnly of [false, "true", 1, null, undefined]) rejected(abap({ readOnly }), "unsafe_flag");
  for (const liveEnabled of [true, "false", 0, null, undefined]) rejected(cloud({ liveEnabled }), "unsafe_flag");
  assert.equal(validateSapProfile(abap({ readOnly: true, liveEnabled: false })).complete, true);
});

test("production metadata can be held as a draft but every production check is denied", () => {
  for (const input of [
    abap({ environment: "production" }), cloud({ environment: "production" }),
    cloud({ environment: " production ", tenantUrl: "http://localhost:4173" }),
    { role: "ERP", kind: "sap_gui_abap", environment: "production" }
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
  const first = validateSapProfile(abap());
  const expected = validateSapProfile(abap());
  first.profile.sid = "ZZZ";
  first.errors.push({ field: "$", code: "fixture", message: "fixture" });
  assert.deepEqual(validateSapProfile(abap()), expected);
  assert.deepEqual(dryRunSapConnection(cloud()), dryRunSapConnection(cloud()));
  assert.deepEqual(Object.keys(expected.profile).sort(), ["role", "kind", "environment", "connectionName", "sid", "client", "readOnly", "liveEnabled"].sort());
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
  for (const input of [{}, abap(), cloud(), cloud({ tenantUrl: "http://localhost:4173" }), abap({ environment: "production" })]) {
    offline.validateSapProfile(input);
    const result = offline.dryRunSapConnection(input);
    assert.equal(result.connectionAttempted, false);
    assert.equal(result.connected, false);
  }
  for (const mock of [fetch, http.request, http.get, https.request, https.get, net.Socket.prototype.connect, dns.lookup, dns.resolve]) {
    assert.equal(mock.mock.callCount(), 0);
  }
});

test("environment example keeps every fill-later connection value empty", async () => {
  const example = await readFile(new URL("../.env.sap.example", import.meta.url), "utf8");
  const lines = example.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
  const entries = Object.fromEntries(lines.map((line) => line.split("=")));
  for (const { role, kind } of sapConnectionDescriptor().roles) {
    const prefix = `SAP_${role.toUpperCase()}_`;
    const suffixes = kind === "sap_gui_abap" ? ["ENVIRONMENT", "CONNECTION_NAME", "SID", "CLIENT"] : ["ENVIRONMENT", "TENANT_URL", "DESTINATION"];
    for (const suffix of suffixes) assert.equal(entries[`${prefix}${suffix}`], "");
  }
  assert.equal(entries.SAP_CONNECTIONS_READ_ONLY, "true");
  assert.equal(entries.SAP_CONNECTIONS_LIVE_ENABLED, "false");
  assert.equal(entries.SAP_CONNECTIONS_TESTS_ENABLED, "false");
  assert.equal(lines.length, 27);
  assert.ok(Object.keys(entries).every((key) => !/PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL/.test(key)));
});
