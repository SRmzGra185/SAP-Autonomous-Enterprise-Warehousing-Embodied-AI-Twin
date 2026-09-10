// Offline metadata only. No storage, environment reads, GUI automation, or I/O.
const ROLE_KINDS = Object.freeze({
  ERP: "sap_gui_abap", EWM: "sap_gui_abap", BW: "sap_gui_abap",
  BDC: "cloud", Datasphere: "cloud", SAC: "cloud", Joule: "cloud"
});
const SAFETY = Object.freeze({ readOnly: true, liveEnabled: false });
const COMMON_FIELDS = ["role", "kind", "environment"];
const KIND_FIELDS = {
  sap_gui_abap: ["connectionName", "sid", "client"],
  cloud: ["tenantUrl", "destination"]
};
const FIELDS = {
  role: { type: "string", maxLength: 10, enum: ["", ...Object.keys(ROLE_KINDS)] },
  kind: { type: "string", maxLength: 12, enum: ["", ...Object.keys(KIND_FIELDS)] },
  environment: { type: "string", maxLength: 10, enum: ["", "mock", "sandbox", "production"] },
  connectionName: {
    type: "string", maxLength: 120,
    pattern: "^(?:[\\p{L}\\p{N}][\\p{L}\\p{N} ._()/-]*)?$"
  },
  sid: { type: "string", maxLength: 3, pattern: "^(?:[A-Z][A-Z0-9]{2})?$" },
  client: { type: "string", maxLength: 3, pattern: "^(?:[0-9]{3})?$" },
  tenantUrl: { type: "string", maxLength: 2048, format: "tenant-origin-or-empty" },
  destination: {
    type: "string", maxLength: 128,
    pattern: "^(?:[A-Za-z0-9][A-Za-z0-9._-]*)?$"
  },
  readOnly: { type: "boolean", const: true },
  liveEnabled: { type: "boolean", const: false }
};
const UNSAFE_TEXT = /[<>\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/u;
const SECRET_FIELD = /pass(?:word|phrase|wd)?|pwd|secret|token|key|credential|authorization|cookie|certificate/i;

function issue(field, code, message) {
  // Only use known field names and fixed messages; never reflect rejected input.
  return { field, code, message };
}

function emptyProfile(role = "") {
  const kind = ROLE_KINDS[role] || "";
  return {
    role, kind, environment: "",
    ...Object.fromEntries((KIND_FIELDS[kind] || []).map((field) => [field, ""])),
    ...SAFETY
  };
}

/** Fresh, JSON-serializable UI metadata. schema is a field descriptor, not a SAP schema. */
export function sapConnectionDescriptor() {
  return {
    version: 1,
    scope: "caller_owned_server_tenant_memory",
    storage: "none",
    policy: {
      ...SAFETY, dryRunOnly: true, networkAccess: false,
      connectionTestsEnabled: false, productionConnectionTestsEnabled: false
    },
    schema: {
      type: "object",
      additionalProperties: false,
      properties: structuredClone(FIELDS),
      requiredForCompletion: [...COMMON_FIELDS],
      normalization: "Trim strings; uppercase ASCII SID only; canonicalize tenant URL to origin."
    },
    kinds: {
      sap_gui_abap: {
        fields: [...KIND_FIELDS.sap_gui_abap],
        requiredForCompletion: [...KIND_FIELDS.sap_gui_abap],
        note: "Reference to an administrator-supplied SAP Logon entry; not an OData/RFC bridge."
      },
      cloud: {
        fields: [...KIND_FIELDS.cloud],
        atLeastOneForCompletion: [...KIND_FIELDS.cloud],
        note: "Tenant origin and/or destination name only; no ABAP SID or client."
      }
    },
    roles: Object.entries(ROLE_KINDS).map(([role, kind]) => ({
      role, kind, fields: [...COMMON_FIELDS, ...KIND_FIELDS[kind]],
      template: emptyProfile(role)
    })),
    emptyTemplate: emptyProfile()
  };
}

function sanitizeTenantUrl(value, errors) {
  if (!value) return "";
  const reject = (code, message) => {
    errors.push(issue("tenantUrl", code, message));
    return "";
  };
  if (value.includes("@")) {
    return reject("credentials_forbidden", "Do not include user information or credentials in tenant URLs.");
  }
  // Origins only: no paths, query strings, fragments, percent-encoding, or backslashes.
  // In particular, reject ambiguous WHATWG URL repairs before parsing.
  const match = /^(https?):\/\/([^/?#]+)\/?$/i.exec(value);
  if (!match || /[\s\\%]/u.test(value)) {
    return reject("invalid_tenant_url", "Use an absolute HTTP(S) tenant origin without path, query, or fragment.");
  }
  let url;
  try { url = new URL(value); } catch {
    return reject("invalid_tenant_url", "Tenant origin is not a valid URL.");
  }
  if (!url.hostname || url.username || url.password || url.pathname !== "/" || url.port === "0") {
    return reject("invalid_tenant_url", "Tenant origin must have a host, no credentials, and a usable port.");
  }
  // Match the original authority as well as parsing it: no abbreviated/numeric IP aliases.
  if (url.protocol === "http:" && !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::[0-9]{1,5})?$/i.test(match[2])) {
    return reject("insecure_tenant_url", "HTTPS is required except for literal localhost, 127.0.0.1, or [::1].");
  }
  return url.origin;
}

function sanitizeField(field, value, errors) {
  const rule = FIELDS[field];
  const reject = (code, message) => {
    errors.push(issue(field, code, message));
    return "";
  };
  if (rule.type === "boolean") {
    if (value !== rule.const) reject("unsafe_flag", "Read-only must remain true and live execution must remain false.");
    return rule.const;
  }
  if (typeof value !== "string") return reject("invalid_type", "Use a string; leave unknown values as an empty string.");
  if (value.length > 2048) return reject("too_long", "Input exceeds the maximum string length.");
  if (UNSAFE_TEXT.test(value)) return reject("unsafe_text", "Control characters, invisible formatting, and markup are not allowed.");
  let clean = value.trim();
  if (clean.length > rule.maxLength) return reject("too_long", `Maximum length is ${rule.maxLength} characters.`);
  if (field === "sid") {
    if (!/^[A-Za-z0-9]*$/.test(clean)) return reject("invalid_format", "SID must contain only ASCII letters and digits.");
    clean = clean.toUpperCase();
  }
  if (rule.enum && !rule.enum.includes(clean)) return reject("invalid_enum", "Choose a listed value or leave it blank.");
  if (rule.pattern && !new RegExp(rule.pattern, "u").test(clean)) return reject("invalid_format", "Value does not match the field's allowed format.");
  return field === "tenantUrl" ? sanitizeTenantUrl(clean, errors) : clean;
}

function readFields(input, errors) {
  if (!input || typeof input !== "object" || Array.isArray(input)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) {
    errors.push(issue("$", "invalid_profile", "Profile must be a plain JSON object."));
    return {};
  }
  const keys = Reflect.ownKeys(input);
  if (keys.length > Object.keys(FIELDS).length) {
    errors.push(issue("$", "too_many_fields", "Profile contains too many fields."));
    return {};
  }
  const clean = {};
  for (const field of keys) {
    if (typeof field !== "string" || !Object.hasOwn(FIELDS, field)) {
      const secret = typeof field === "string" && SECRET_FIELD.test(field);
      errors.push(issue("$", secret ? "credentials_forbidden" : "unknown_field",
        secret ? "Passwords, keys, tokens, and other credentials are not accepted." : "Only explicitly listed profile fields are allowed."));
      continue;
    }
    const property = Object.getOwnPropertyDescriptor(input, field);
    if (!property.enumerable || !Object.hasOwn(property, "value")) {
      errors.push(issue(field, "invalid_property", "Profile fields must be enumerable data values, not accessors."));
      continue;
    }
    clean[field] = sanitizeField(field, property.value, errors);
  }
  return clean;
}

/**
 * Accept blank drafts, reject invalid/unknown/secret fields. No input mutation.
 * Returns { valid, complete, profile, missing, errors }; profile is null on error.
 * Missing values are not validation errors, and complete never means connected.
 */
export function validateSapProfile(input = {}) {
  const errors = [];
  const clean = readFields(input, errors);
  const profile = { role: "", kind: "", environment: "", ...clean, ...SAFETY };
  if (profile.role && profile.kind && ROLE_KINDS[profile.role] !== profile.kind) {
    errors.push(issue("kind", "role_kind_mismatch", "Role and connection kind must match the descriptor."));
  }
  if (profile.kind) {
    const allowed = KIND_FIELDS[profile.kind];
    for (const field of Object.values(KIND_FIELDS).flat()) {
      if (Object.hasOwn(clean, field) && !allowed.includes(field)) {
        errors.push(issue(field, "field_not_applicable", "Omit fields belonging to the other connection kind, even when blank."));
      }
    }
    for (const field of allowed) if (!Object.hasOwn(profile, field)) profile[field] = "";
  }
  const missing = COMMON_FIELDS.filter((field) => !profile[field]);
  if (profile.kind === "sap_gui_abap") {
    missing.push(...KIND_FIELDS.sap_gui_abap.filter((field) => !profile[field]));
  } else if (profile.kind === "cloud" && !profile.tenantUrl && !profile.destination) {
    missing.push("tenantUrl|destination");
  }
  const valid = errors.length === 0;
  return { valid, complete: valid && missing.length === 0, profile: valid ? profile : null, missing, errors };
}

/** Offline completeness check only. Production checks are denied, even if complete. */
export function dryRunSapConnection(input = {}) {
  const validation = validateSapProfile(input);
  const production = validation.profile?.environment === "production";
  const allowed = validation.valid && !production;
  const reason = !validation.valid ? "invalid_profile"
    : production ? "production_connection_tests_disabled"
      : validation.complete ? "metadata_complete" : "metadata_incomplete";
  return {
    allowed,
    status: allowed && validation.complete ? "configured_not_connected" : "incomplete",
    reason,
    dryRun: true,
    ...SAFETY,
    connected: false,
    connectionAttempted: false,
    connectionTestsEnabled: false,
    validation
  };
}
