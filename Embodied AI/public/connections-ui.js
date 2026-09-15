// Same-origin simulator API only. No SAP requests, secrets, or browser persistence.
const ROLES = ["BDC_CONNECT", "JOULE"];
const FIELDS = ["role", "kind", "environment", "tenantUrl", "destination", "readOnly", "liveEnabled"];
const ENVIRONMENTS = ["", "mock", "sandbox", "production"];
const LABELS = { BDC_CONNECT: "BDC Connect", JOULE: "Joule" };
const UNSAFE_TEXT = /[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u;
const mounts = new WeakMap();

function plain(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}

// Client-side guard for imported/exported JSON; the server validator is authoritative.
// Reject unknown keys instead of silently stripping potentially sensitive content.
function sanitizeProfile(input) {
  const fail = () => { throw new Error("Use only supported, secret-free cloud metadata. Check field formats and leave unknown values blank."); };
  if (!plain(input) || Reflect.ownKeys(input).length > FIELDS.length) fail();
  const profile = { role: "", kind: "", environment: "", tenantUrl: "", destination: "", readOnly: true, liveEnabled: false };
  for (const field of Reflect.ownKeys(input)) {
    if (!FIELDS.includes(field)) fail();
    const property = Object.getOwnPropertyDescriptor(input, field);
    if (!property.enumerable || !Object.hasOwn(property, "value")) fail();
    const value = property.value;
    if (field === "readOnly" || field === "liveEnabled") {
      if (value !== profile[field]) fail();
    } else {
      if (typeof value !== "string" || value.length > 2048 || UNSAFE_TEXT.test(value)) fail();
      profile[field] = value.trim();
    }
  }
  if (!ROLES.includes(profile.role) || profile.kind !== "cloud" || !ENVIRONMENTS.includes(profile.environment)) fail();
  if (profile.destination.length > 128 || !/^(?:[A-Za-z0-9][A-Za-z0-9._-]*)?$/.test(profile.destination)) fail();
  if (profile.tenantUrl) {
    const value = profile.tenantUrl, match = /^(https?):\/\/([^/?#]+)\/?$/i.exec(value);
    if (!match || /[@\s\\%]/u.test(value)) fail();
    let url;
    try { url = new URL(value); } catch { fail(); }
    if (!url.hostname || url.username || url.password || url.pathname !== "/" || url.port === "0") fail();
    if (url.protocol === "http:" && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(match[2])) fail();
    profile.tenantUrl = url.origin;
  }
  return profile;
}

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function validationText(validation) {
  if (!validation || typeof validation.valid !== "boolean") throw new Error("Invalid validation response.");
  if (!validation.valid) {
    // Never display raw server error text or rejected values.
    const fields = [...new Set((validation.errors || []).map((error) => error.field).filter((field) => FIELDS.includes(field)))];
    return `Draft rejected. ${fields.length ? `Review: ${fields.join(", ")}.` : "Only listed, secret-free metadata fields are accepted."}`;
  }
  if (validation.complete) return "Configured — not connected. No tenant interface or permissions have been verified.";
  const missing = (validation.missing || []).filter((field) => FIELDS.includes(field) || field === "tenantUrl|destination")
    .map((field) => field === "tenantUrl|destination" ? "tenant URL or destination" : field);
  return `Incomplete draft${missing.length ? ` — missing ${missing.join(", ")}` : ""}. Not connected.`;
}

/**
 * Mount into #connections-settings. api(path, {method, body, signal}) returns parsed JSON.
 * Returns { refresh, destroy }, or null when the mount is absent. Main owns tenant auth.
 */
export async function initConnectionsUI({ api }) {
  const root = document.querySelector("#connections-settings");
  if (!root) return null;
  if (typeof api !== "function") throw new TypeError("Connections UI requires an api function.");
  mounts.get(root)?.destroy();
  const lifetime = new AbortController();
  const drafts = new Map(), messages = new Map(), sources = new Set(), timers = new Set(), downloads = new Set();
  let disposed = false, revision = 0, busy = false, selected = ROLES[0], descriptor = null;

  root.classList.add("sap-connections", "panel");
  const heading = element("div", undefined, "panel-heading");
  const titles = element("div");
  titles.append(element("span", "TWO CLOUD CONNECTIONS · OFFLINE METADATA", "eyebrow"), element("h2", "BDC Connect & Joule"));
  heading.append(titles);
  const layout = element("div", undefined, "sap-form-grid");
  const navigation = element("nav", undefined, "sap-profile-list");
  navigation.setAttribute("aria-label", "Connection profiles");
  const content = element("div");
  const note = element("p", "Session-only — drafts saved in current tenant server memory; no server disk persistence. They are not durable and may be lost on server restart or session cleanup. Unsaved edits stay in this page.", "sap-profile-description");
  const boundary = element("p", "Scenarios reuse these two connections. No external connection tests, authentication, or actions are performed. Never enter credentials or secrets.", "sap-profile-description");
  const notice = element("p", "Loading connection drafts…", "sap-result");
  notice.setAttribute("role", "status"); notice.setAttribute("aria-live", "polite");
  const editor = element("div"), transfer = element("div", undefined, "sap-profile-actions");
  const exportButton = element("button", "Export local JSON", "secondary-button");
  const importLabel = element("label", "Import local JSON ");
  const importInput = element("input"); importInput.type = "file"; importInput.accept = ".json,application/json";
  importInput.setAttribute("aria-label", "Import sanitized connection drafts from local JSON");
  importLabel.append(importInput);
  const retry = element("button", "Retry loading", "secondary-button");
  for (const button of [exportButton, retry]) button.type = "button";
  transfer.append(exportButton, importLabel, retry);
  content.append(note, boundary, notice, editor, transfer); layout.append(navigation, content); root.replaceChildren(heading, layout);

  function lock(value) {
    busy = value;
    for (const control of root.querySelectorAll("button, input, select")) control.disabled = value;
    if (!descriptor) { exportButton.disabled = true; importInput.disabled = true; }
  }

  function stopStreams() {
    for (const source of sources) source.close(); sources.clear();
    for (const timer of timers) clearTimeout(timer); timers.clear();
    for (const url of downloads) URL.revokeObjectURL(url); downloads.clear();
  }

  function render() {
    navigation.replaceChildren(); editor.replaceChildren();
    if (!descriptor) return;
    for (const role of ROLES) {
      const button = element("button", LABELS[role], role === selected ? "active" : ""); button.type = "button";
      button.setAttribute("aria-pressed", String(role === selected));
      button.onclick = () => { if (!busy) { selected = role; render(); } };
      navigation.append(button);
    }
    const metadata = descriptor.roles.find(({ role }) => role === selected);
    const description = element("p", metadata.description, "sap-profile-description");
    const form = element("form"); form.noValidate = true;
    const fields = element("div", undefined, "sap-profile-fields");
    for (const [field, labelText] of [["environment", "Environment"], ["tenantUrl", "Tenant URL (origin only)"], ["destination", "Destination name"]]) {
      const label = element("label", labelText);
      const input = element(field === "environment" ? "select" : "input");
      input.name = field; input.id = `sap-${selected.toLowerCase()}-${field}`;
      input.setAttribute("aria-describedby", "sap-profile-help");
      if (field === "environment") {
        for (const value of ENVIRONMENTS) { const option = element("option", value || "Not supplied"); option.value = value; input.append(option); }
      } else {
        input.type = "text"; input.maxLength = field === "tenantUrl" ? 2048 : 128;
        input.autocomplete = "off"; input.spellcheck = false;
      }
      input.value = drafts.get(selected)[field];
      input.addEventListener("input", () => {
        if (busy || disposed) return;
        drafts.get(selected)[field] = input.value;
        messages.set(selected, "Unsaved page draft — not connected."); result.textContent = messages.get(selected);
      });
      label.append(input); fields.append(label);
    }
    const help = element("p", "Cloud metadata only. Leave unknown values blank. Completeness needs an environment and either a tenant origin or a destination. Production checks are disabled.", "sap-profile-description");
    help.id = "sap-profile-help";
    const actions = element("div", undefined, "sap-profile-actions");
    const save = element("button", "Save session draft", "primary-button"); save.type = "submit";
    const check = element("button", "Check metadata (offline)", "secondary-button"); check.type = "button";
    actions.append(save, check);
    const result = element("p", messages.get(selected) || "Blank draft — not connected.", "sap-result");
    result.setAttribute("role", "status"); result.setAttribute("aria-live", "polite");
    form.append(fields, help, actions, result); editor.append(description, form);
    form.addEventListener("submit", (event) => { event.preventDefault(); void run("save"); });
    check.onclick = () => { void run("check"); };
    lock(busy);
  }

  function finish(role, message) {
    if (disposed) return;
    messages.set(role, message); lock(false); render();
  }

  function watch(job, role, generation) {
    // Reject external URLs, alternate job IDs, credentials, query strings, and fragments.
    if (!job || typeof job.jobId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(job.jobId)
      || job.events !== `/api/jobs/${job.jobId}/events`) throw new Error("Invalid check job response.");
    const source = new EventSource(job.events); sources.add(source);
    let ended = false;
    const close = () => {
      if (ended) return false;
      ended = true; source.close(); sources.delete(source); clearTimeout(timer); timers.delete(timer);
      return !disposed && generation === revision;
    };
    const timer = setTimeout(() => { if (close()) finish(role, "Metadata check timed out. No connection was attempted; you can retry."); }, 30000);
    timers.add(timer);
    source.addEventListener("job_complete", (event) => {
      if (!close()) return;
      try {
        const payload = JSON.parse(event.data), result = payload.result;
        if (payload.id !== job.jobId || payload.type !== "job_complete" || !result
          || result.dryRun !== true || result.readOnly !== true || result.liveEnabled !== false
          || result.connected !== false || result.connectionAttempted !== false || result.connectionTestsEnabled !== false) {
          throw new Error("Unsafe check response.");
        }
        if (result.reason === "production_connection_tests_disabled" && result.allowed === false) {
          finish(role, "Production checks are disabled. Metadata may be saved as a draft; no connection was attempted.");
        } else if (result.reason === "invalid_profile" && result.allowed === false && result.validation?.valid === false) {
          finish(role, validationText(result.validation));
        } else if (result.allowed === true && result.validation?.valid === true
          && ((result.reason === "metadata_complete" && result.status === "configured_not_connected" && result.validation.complete === true)
            || (result.reason === "metadata_incomplete" && result.status === "incomplete" && result.validation.complete === false))) {
          finish(role, `Offline check: ${validationText(result.validation)}`);
        } else throw new Error("Invalid check result.");
      } catch { finish(role, "Could not verify the offline check result. Not connected."); }
    });
    for (const event of ["job_failed", "job_cancelled", "error"]) {
      source.addEventListener(event, () => { if (close()) finish(role, "Metadata check stopped or event stream unavailable. Not connected; retry when ready."); });
    }
  }

  async function run(action) {
    if (busy || disposed || !descriptor) return;
    const role = selected, generation = revision;
    lock(true); messages.set(role, action === "save" ? "Saving session-only draft…" : "Checking metadata offline…"); render();
    try {
      const profile = sanitizeProfile(drafts.get(role));
      const response = await api(action === "save" ? "/api/sap-connections" : "/api/sap-connections/check", {
        method: action === "save" ? "PUT" : "POST", body: JSON.stringify(profile), signal: lifetime.signal
      });
      if (disposed || generation !== revision) return;
      if (action === "save") {
        const message = validationText(response);
        if (response.valid) {
          const saved = sanitizeProfile(response.profile);
          if (saved.role !== role) throw new Error("Mismatched role.");
          drafts.set(role, saved);
        }
        finish(role, `${response.valid ? "Saved — session-only tenant memory. " : ""}${message}`);
      } else watch(response, role, generation);
    } catch {
      if (!disposed && generation === revision) finish(role, "Could not save or check this draft. Check metadata formats, session permissions, and API availability. No connection was attempted.");
    }
  }

  async function refresh() {
    if (disposed) return;
    const generation = ++revision;
    stopStreams(); drafts.clear(); messages.clear(); descriptor = null; render(); lock(true);
    notice.textContent = "Loading connection drafts…"; retry.hidden = true;
    try {
      const data = await api("/api/sap-connections", { method: "GET", signal: lifetime.signal });
      if (disposed || generation !== revision) return;
      if (!data?.descriptor || data.descriptor.version !== 2 || !Array.isArray(data.descriptor.roles)
        || data.descriptor.roles.length !== 2 || !Array.isArray(data.profiles) || data.profiles.length > 2) throw new Error("Invalid descriptor.");
      const next = new Map();
      for (const role of ROLES) {
        const metadata = data.descriptor.roles.find((entry) => entry.role === role && entry.kind === "cloud");
        const template = sanitizeProfile(metadata?.template);
        if (template.role !== role || template.environment || template.tenantUrl || template.destination) throw new Error("Templates must be blank.");
        next.set(role, template);
      }
      const seen = new Set();
      for (const input of data.profiles) {
        const saved = sanitizeProfile(input);
        if (seen.has(saved.role)) throw new Error("Duplicate role.");
        seen.add(saved.role); next.set(saved.role, saved);
      }
      descriptor = data.descriptor;
      for (const [role, profile] of next) {
        drafts.set(role, profile); messages.set(role, seen.has(role) ? "Loaded session-only tenant draft — not connected." : "Blank draft — not connected.");
      }
      notice.textContent = "Only BDC Connect and Joule. Role and cloud kind are fixed; tenant details are never guessed.";
      lock(false); render();
    } catch {
      if (disposed || generation !== revision) return;
      descriptor = null; drafts.clear(); messages.clear(); render(); lock(false); retry.hidden = false;
      notice.textContent = "Connection settings unavailable. Check your session and the SAP profile API, then retry. No profiles were loaded.";
    }
  }

  exportButton.onclick = () => {
    if (busy || disposed || !descriptor) return;
    try {
      const profiles = ROLES.map((role) => sanitizeProfile(drafts.get(role)));
      const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, profiles }, null, 2)], { type: "application/json" }));
      downloads.add(url);
      const link = element("a"); link.href = url; link.download = "sap-cloud-connection-drafts.json";
      root.append(link); link.click(); link.remove();
      const timer = setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); timers.delete(timer); }, 1000); timers.add(timer);
      notice.textContent = "Exported sanitized local JSON. It includes current page drafts, not credentials or tenant ownership. Treat tenant metadata as private.";
    } catch { notice.textContent = "Export rejected. Review metadata formats and remove unsupported or sensitive content."; }
  };
  importInput.onchange = async () => {
    if (busy || disposed || !descriptor) return;
    const file = importInput.files?.[0], generation = revision;
    importInput.value = ""; if (!file) return;
    lock(true);
    try {
      if (file.size > 16384) throw new Error("File too large.");
      const bundle = JSON.parse(await file.text());
      if (disposed || generation !== revision) return;
      if (!plain(bundle) || Object.keys(bundle).length !== 2 || bundle.version !== 1
        || !Array.isArray(bundle.profiles) || !bundle.profiles.length || bundle.profiles.length > 2) throw new Error("Invalid bundle.");
      const profiles = bundle.profiles.map(sanitizeProfile);
      if (new Set(profiles.map(({ role }) => role)).size !== profiles.length) throw new Error("Duplicate roles.");
      // Validate the entire bundle before changing any page drafts. Import never saves.
      for (const profile of profiles) { drafts.set(profile.role, profile); messages.set(profile.role, "Imported page draft — not saved. Review and save this role to current tenant memory."); }
      selected = profiles[0].role;
      notice.textContent = "Imported locally. Review each profile and use Save session draft; no server data has changed.";
    } catch { if (!disposed && generation === revision) notice.textContent = "Import rejected. Use a supported JSON export (up to 16 KiB), unique cloud roles, and no credentials or extra fields. Existing drafts are unchanged."; }
    finally { if (!disposed && generation === revision) { lock(false); render(); } }
  };
  retry.onclick = () => { void refresh(); };

  const controller = {
    refresh,
    destroy() {
      if (disposed) return;
      disposed = true; revision++; lifetime.abort(); stopStreams(); drafts.clear(); messages.clear(); descriptor = null;
      window.removeEventListener("pagehide", controller.destroy);
      if (mounts.get(root) === controller) { mounts.delete(root); root.replaceChildren(); }
    }
  };
  mounts.set(root, controller); window.addEventListener("pagehide", controller.destroy);
  await refresh();
  return controller;
}
