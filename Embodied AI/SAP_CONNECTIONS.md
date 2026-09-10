# SAP connections: fill later, offline only

No SID, client (mandante), connection name, tenant URL, destination, or credentials have been supplied. Leave unknown values **blank**. Nothing here discovers a tenant, reads SAP Logon, resolves a destination, tests a connection, or logs on to SAP. The module has no dependencies, network calls, environment reads, GUI automation, or storage. Server/UI integration remains with the main implementation owner; no routes or UI were changed.

## What these profiles describe

| Logical role | `kind` | Connection fields | Required for completeness |
| --- | --- | --- | --- |
| ERP, EWM, BW | `sap_gui_abap` | `connectionName`, `sid`, `client` | All three |
| BDC, Datasphere, SAC, Joule | `cloud` | `tenantUrl`, `destination` | At least one; both are validated if supplied |

Every profile also has `role`, `kind`, and `environment`, which must be selected before it is complete. Role spelling is exact, including `Datasphere` and `Joule`. Environments are blank, `mock`, `sandbox`, or `production`. No environment or connection information is inferred. The role-to-kind table is this workbench's deliberately limited mapping, not a claim that every deployment of those SAP products uses one universal connection method. In particular, a Joule entry does not establish a generic Joule API, subscription, entitlement, or agent endpoint.

SAP describes SAP Logon as a way to select and log on to an SAP system. Its BW connection documentation separately identifies a three-character system ID and a three-digit client number. A real landscape may also require application/message server, instance, group, and security settings; those are outside this reference-only module. Obtain authoritative values from your SAP administrator when available. [SAP GUI: Variable Logon](https://help.sap.com/docs/sap_gui_for_windows/63bd20104af84112973ad59590645513/8a2d088096a0426095c5eebfe5e6a380.html), [SAP BW connection settings](https://help.sap.com/docs/SAP_BUSINESSOBJECTS_BUSINESS_INTELLIGENCE_PLATFORM/d0236a8293c2484793d927217b14dc0e/4709dc166e041014910aba7db0e91070.html).

SAP BTP Connectivity uses destinations for application connections and distinguishes HTTP(S) services from RFC calls to ABAP function modules. HTTP destinations additionally describe access/proxy and authentication configuration. This module retains only a destination's symbolic name, not its configuration or secrets. [SAP BTP Connectivity overview](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/destinations), [SAP HTTP destinations](https://help.sap.com/docs/connectivity/sap-btp-connectivity-cf/http-destinations).

**SAP GUI configuration alone is not an OData/RFC bridge.** The integration consequence of the SAP documentation above is that a saved Logon reference cannot authorize or supply API/RFC connectivity. A future connector would separately need an approved service or RFC interface, authentication outside these profiles, tenant authorization, and appropriate network/security configuration. A tenant homepage URL likewise proves neither API availability nor authentication. This implementation does not supply that future connector. Official SAP Help references checked on 2026-09-09; no SAP tenant was contacted.

## Exports and return contract

```js
import {
  sapConnectionDescriptor,
  validateSapProfile,
  dryRunSapConnection
} from "./src/sap-connections.mjs";

const descriptor = sapConnectionDescriptor();
const draft = descriptor.roles.find(({ role }) => role === "ERP").template;
// { role: "ERP", kind: "sap_gui_abap", environment: "",
//   connectionName: "", sid: "", client: "", readOnly: true, liveEnabled: false }

const validation = validateSapProfile(draft);
// { valid: true, complete: false, profile: <fresh normalized draft>,
//   missing: ["environment", "connectionName", "sid", "client"], errors: [] }

const check = dryRunSapConnection(draft);
// check.status === "incomplete"; check.connected === false
```

All three functions are synchronous and deterministic. They neither mutate the input nor share mutable returned data between calls.

- `sapConnectionDescriptor()` returns versioned, JSON-serializable UI metadata: safety policy, `schema.properties` with types/limits/enums/patterns, completion rules, role mappings, an unselected `emptyTemplate`, and one blank `template` per role. Only role/kind selectors and safety constants are preset. The schema is an application field descriptor, **not a standalone JSON Schema validator**; `kinds` holds conditional completion rules and `validateSapProfile` is authoritative. Patterns use JavaScript Unicode mode.
- `validateSapProfile(input = {})` returns `{ valid, complete, profile, missing, errors }`. Empty/partial drafts are valid but incomplete. Malformed or forbidden data yields `valid: false`, `complete: false`, and `profile: null`; never save the original input or a failed result. `errors` contains `{ field, code, message }` with fixed messages and no rejected values or unknown field names. `missing` contains field names; `tenantUrl|destination` means either field is needed. No exceptions are intentionally thrown for ordinary JSON-shaped invalid inputs.
- `dryRunSapConnection(input = {})` returns `{ allowed, status, reason, dryRun, readOnly, liveEnabled, connected, connectionAttempted, connectionTestsEnabled, validation }`. `validation` is the preceding validator result. `allowed` permits only offline metadata inspection; it is never permission to open a socket or call another adapter. Safe constants are always `dryRun: true`, `readOnly: true`, `liveEnabled: false`, `connected: false`, `connectionAttempted: false`, and `connectionTestsEnabled: false`.

| Check input | `allowed` | `status` | `reason` |
| --- | --- | --- | --- |
| Valid blank/partial nonproduction draft | `true` | `incomplete` | `metadata_incomplete` |
| Valid complete nonproduction metadata | `true` | `configured_not_connected` | `metadata_complete` |
| Invalid or forbidden data | `false` | `incomplete` | `invalid_profile` |
| Valid production metadata, complete or not | `false` | `incomplete` | `production_connection_tests_disabled` |

Production metadata may be validated and held for planning, but even its dry-run check is denied. The nested `validation.complete` can therefore be true while the check is denied. `incomplete` is the conservative check status for drafts, invalid input, and policy denials; use `reason` to distinguish them. A blank environment never counts as complete. Relabeling a production system does not make it safe: environments are unverified caller assertions, and **no environment can enable live tests**. There is no fake successful SAP logon or connectivity claim.

## Validation boundaries

Only the ten fields listed by `schema.properties` are accepted. Profiles must be flat plain objects containing enumerable data values, not arrays, classes, accessors, or symbols. Unknown fields, including caller-supplied tenant/owner IDs, nested authentication objects, passwords, keys, tokens, cookies, and certificates, are rejected even if empty. There is no credential field, username field, or secret-manager reference field. `readOnly` and `liveEnabled` are optional on input but, when present, must be the literal booleans `true` and `false` respectively. They are always included safely in validated output. Other execution/write/test switches are unknown fields and rejected.

String values are trimmed, never truncated or coerced from numbers. Raw strings over 2,048 UTF-16 code units, controls, invisible formatting, and angle-bracket markup are rejected. Limits apply after trimming:

| Field | Limit / accepted format |
| --- | --- |
| `role`, `kind`, `environment` | Exact descriptor enums or empty string; respective maxima 10, 12, 10 |
| `connectionName` | 120; starts with a Unicode letter/number, then letters/numbers, spaces, `. _ ( ) / -` |
| `sid` | Exactly 3 ASCII alphanumerics when filled, starts with a letter; ASCII lowercase normalized to uppercase |
| `client` | Exactly 3 ASCII digits when filled; string preserves leading zeroes; no default mandante |
| `destination` | 128; starts with ASCII letter/digit, then ASCII letters/digits, `. _ -`; case preserved |
| `tenantUrl` | 2,048; absolute HTTP(S) **origin only**, normalized to `URL.origin` |

These are conservative application rules, not full SAP system-name/destination validation. Cross-kind fields must be omitted, even if blank: cloud profiles have no SID/client/Logon name; ABAP references have no tenant URL/destination. A blank kind remains an incomplete draft rather than being guessed from the role.

Tenant origins cannot contain credentials/userinfo, paths other than an optional `/`, query strings, fragments, percent-encoding, backslashes, or port zero. Put a path-specific API behind an administrator-configured destination, not into `tenantUrl`. HTTPS is required except for the literal host spellings `localhost`, `127.0.0.1`, and `[::1]` with an optional valid port. Other private hosts, suffix lookalikes, abbreviated/numeric loopback aliases, and alternate IPv6 spellings do not receive the HTTP exception. This exception describes local metadata only; no local service is contacted either.

This is **not** a DNS/SSRF authorization check, ownership check, existence check, or secret-content detector. An opaque secret pasted into an otherwise valid name cannot reliably be recognized; users must not put secrets in names or URLs. No DNS resolution occurs. Future networking must independently enforce tenant-bound destination resolution, approved endpoints/egress, DNS and redirect checks, secret isolation, and production denial. Do not use `complete` or `allowed` as that authorization.

## Main-owned integration and tenant memory

Keep a server-owned `Map` keyed by the authenticated principal's tenant ID, with a separate profile map per tenant and a role key inside it. Derive tenancy from trusted authentication, **never from this profile or a browser-submitted tenant ID**. Enforce profile-edit permission before validating/saving and tenant permission again on every read/check. Limit body size and profiles per tenant; pass only parsed plain JSON into this module.

Suggested handler sequence (integration is not implemented here): authenticate/authorize; parse bounded JSON; call `validateSapProfile`; reject `valid: false`; store a clone of `result.profile` in that tenant's server memory, including incomplete drafts; return only tenant-authorized data. Check handlers call `dryRunSapConnection` and surface its exact status/reason. Audit status/error codes and trusted actor/tenant identifiers rather than raw request bodies or connection metadata. Render labels as text, not HTML.

The module has no profile registry and no cross-tenant mutable cache. Main owns memory lifecycle/cleanup, access control, route errors, UI labels, and any future persistence. Do not store these profiles in browser `localStorage` or a process-global single shared profile. No automatic fallback to existing simulated/live adapters should occur when validation fails or a draft is incomplete. Display a completed result as “Configured — not connected,” never “Connected” or “SAP logon successful.”

## Optional environment worksheet and tests

`.env.sap.example` is an inert, optional fill-later worksheet; the module and existing server do **not** load it. Each role has blank connection fields and a blank environment. Role/kind come from the descriptor. If main later adds an importer, it must explicitly select the role and authorized server tenant, map only that role's fields, and call the validator. Do not merge process environment into a profile or seed all tenants from a global environment file. The worksheet's safety flags are documentation, not enable switches; their values cannot turn on connections. It contains no credentials or guessed tenant details.

Run from this project directory with Node 20+; no install, GUI, running server, or tenant is needed:

```sh
node test/sap-connections.mjs
# Alternatively:
node --test test/sap-connections.mjs
```

Tests use synthetic metadata and `.invalid` URLs solely for offline validation. They cover blank templates, every role, normalization, length/type/enum checks, secret and unknown-field rejection, hostile URL shapes, production denial, immutable result isolation, and network tripwires. These are validator tests, not SAP interoperability tests. Package scripts and existing server/UI files are intentionally unchanged.
