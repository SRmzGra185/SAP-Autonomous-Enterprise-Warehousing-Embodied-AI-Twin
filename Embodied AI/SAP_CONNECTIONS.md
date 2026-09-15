# BDC Connect and Joule: offline connection drafts

The operations simulator has exactly two connection roles: `BDC_CONNECT` and `JOULE`, both `kind: "cloud"`. Scenarios reuse these profiles; a scenario or a simulated system is not another connection.

BDC Connect shares governed data products with supported external platforms. A profile here does not establish that sharing or prove platform support. Joule actions require supported interfaces in the user's tenant; this module does not supply a universal Joule endpoint, entitlements, authentication, or action authorization.

Only environment, tenant origin, and destination-name metadata are editable. All start blank. There are no SAP GUI, SID, client, Logon-name, standalone SAC/Datasphere/BW/ERP, or additional product profiles. Legacy roles and fields are rejected, not silently migrated.

## Scope and safety

The implementation in these files consists of a pure descriptor/validator, its tests, an optional worksheet, and a browser settings module. Main owns server routes, authentication, tenant memory, job launch/replay, HTML mounting, app startup, models, and styling. Those files are not changed by this work.

No SAP tenant or external platform is contacted. Pure functions do not perform I/O, read environment variables, store profiles, generate IDs, read clocks, or invoke adapters. Browser requests are only to the same-origin simulator API and its job event stream. A metadata check never falls through to a live/simulated connection adapter.

Safety constants cannot be relaxed:

```js
{ readOnly: true, liveEnabled: false }
// Every offline check additionally has:
{ dryRun: true, connected: false, connectionAttempted: false,
  connectionTestsEnabled: false }
```

Completeness means metadata supplied, never connected. Production metadata may be saved for planning, but production checks are denied even when complete.

## Descriptor and pure exports

```js
import {
  sapConnectionDescriptor, validateSapProfile, dryRunSapConnection
} from "./src/sap-connections.mjs";

const descriptor = sapConnectionDescriptor(); // version: 2
const draft = descriptor.roles.find(({ role }) => role === "BDC_CONNECT").template;
// { role: "BDC_CONNECT", kind: "cloud", environment: "",
//   tenantUrl: "", destination: "", readOnly: true, liveEnabled: false }

const validation = validateSapProfile(draft);
// { valid: true, complete: false, profile: <normalized draft>,
//   missing: ["environment", "tenantUrl|destination"], errors: [] }

const check = dryRunSapConnection(draft);
// allowed: true; status: "incomplete"; reason: "metadata_incomplete"
// connected: false; connectionAttempted: false
```

All exports are synchronous, deterministic, input-preserving, and return fresh mutable data without sharing state across calls. The descriptor schema is UI field metadata, not a standalone JSON Schema or an SAP schema; the validator and cloud completion rules are authoritative.

- `sapConnectionDescriptor()` returns version 2, `roles` with exactly two entries, each with `role`, `kind`, `label`, `description`, `fields`, and `.template`. It also returns safety policy, `kinds.cloud`, schema field metadata, and an unselected `emptyTemplate`. The empty template leaves role/kind blank too; the validator never guesses them. `storage: "none"` describes the pure module, while `scope: "caller_owned_server_tenant_memory"` identifies its intended caller-owned storage boundary.
- `validateSapProfile(input = {})` returns exactly `{ valid, complete, profile, missing, errors }`. Valid partial/blank metadata is accepted. Invalid input gives `valid: false`, `complete: false`, and `profile: null`. Only the returned valid profile may be saved. Errors are `{ field, code, message }` with fixed messages and no rejected values or unknown key names.
- `dryRunSapConnection(input = {})` returns exactly `{ allowed, status, reason, dryRun, readOnly, liveEnabled, connected, connectionAttempted, connectionTestsEnabled, validation }`. `allowed` authorizes offline metadata inspection only.

| Input | allowed | status | reason |
| --- | --- | --- | --- |
| Valid partial nonproduction draft | true | incomplete | metadata_incomplete |
| Valid complete nonproduction profile | true | configured_not_connected | metadata_complete |
| Invalid input | false | incomplete | invalid_profile |
| Valid production profile, complete or not | false | incomplete | production_connection_tests_disabled |

The nested production validation can be complete while the check is denied. An environment is an unverified user assertion; relabeling it never enables a network call.

## Exact API contract for main

The browser's `api(path, options)` must resolve to parsed JSON and reject transport/authentication errors, as the existing app helper does. Request bodies are JSON-stringified single profiles, never `{ profile: ... }` wrappers or arrays.

| Method/path | Request body | Response |
| --- | --- | --- |
| GET /api/sap-connections | None | 200 `{ descriptor: sapConnectionDescriptor(), profiles: [...savedProfiles] }` |
| PUT /api/sap-connections | One profile | 200 `validateSapProfile(profile)` result, including semantic invalid results; only valid profiles are stored |
| POST /api/sap-connections/check | One profile | 202 `{ jobId, events: "/api/jobs/<jobId>/events" }` |
| GET /api/jobs/<jobId>/events | None | Tenant-authorized named SSE events, including `job_complete` below |

The GET array contains zero to two sanitized saved profiles for the authenticated tenant, at most one per supported role. Unsaved defaults come from `descriptor.roles[].template`, not invented tenant values.

PUT is an upsert by role in the authenticated tenant's memory. Incomplete drafts are saved. For persistence, require a supported nonblank role and `kind: "cloud"`; the pure validator's unselected drafts are not storage keys. Reject unselected storage requests with HTTP 400 and a fixed error/code. Invalid metadata is not saved; return its validation object. Malformed JSON, oversized requests, unauthorized requests, and other transport failures use conventional 4xx errors (e.g. `{ error, code }`) rather than a success-shaped response.

POST launches only a background `dryRunSapConnection(profile)` job, does not save the profile, and returns its ID immediately. Production denial and invalid metadata belong in the job result, not a successful connection result. Job IDs must match `[A-Za-z0-9_-]{1,100}`; existing UUID-prefixed job IDs fit.

The named terminal SSE event must be:

```text
event: job_complete
data: {"id":"<jobId>","type":"job_complete","result":<dryRunSapConnection(profile)>}
```

Standard job fields such as kind, sequence, and timestamp may also be present. Replay already-recorded events on subscription: the pure check can complete before EventSource opens. Support `job_failed` and `job_cancelled` as terminal events for infrastructure failures/cancellation.

The UI opens its own `new EventSource(events)`, never the simulator's shared stream. It requires the exact relative path for that job ID, rejects external or mismatched event URLs, and handles `job_complete` from `event.result`. It closes on completion, failure, cancellation, transport error, 30-second timeout, refresh, reinitialization, or destruction. No polling fallback or external connection attempt occurs.

Native EventSource does not use headers from the injected API helper. Main must provide matching same-origin authenticated session/cookie handling for the API and SSE; do not put bearer tokens or tenant IDs in event URLs.

## Main-owned tenant/session memory

Derive tenancy from a trusted authenticated principal, never from profiles, import files, query parameters, or browser-selected owner IDs. Enforce view/edit/check permissions and tenant isolation on every route and event subscription.

Use a tenant-keyed memory map with one role-keyed profile map per tenant. Store clones of valid normalized profiles only; cap each tenant at two supported roles. Do not reuse old seven-role profile registries or seed every tenant from a global environment file. Main must own session/tenant expiry, cleanup, body/job limits, and lifecycle. Audit fixed status/error codes rather than raw metadata, request bodies, or credentials.

The UI explicitly labels saves “Session-only” and explains that current-tenant server memory is nondurable and may be lost on server restart or session cleanup. This does not promise an implemented logout cleanup mechanism in the pure module. Main must implement the intended session lifecycle. No server disk or browser localStorage/sessionStorage/IndexedDB persistence is required or used by these files.

## Browser integration

Main adds `#connections-settings` to its HTML and initializes after the authenticated session is established:

```js
import { initConnectionsUI } from "./connections-ui.js";
const connectionsUI = await initConnectionsUI({ api });
```

This async export returns `{ refresh, destroy }`, or `null` if the mount is absent. It renders exactly two role choices, fixed cloud kind, three editable metadata fields, Save session draft, Check metadata (offline), and local JSON import/export. It uses the existing `sap-*`/button CSS classes and safe DOM text nodes, not dynamic HTML. Failed initial loading shows a retry control and does not invent saved data.

Use `await connectionsUI.refresh()` to discard page edits and reload the current tenant's saved drafts. Main must call `connectionsUI.destroy()` before logout/tenant changes, then initialize again after establishing the new session. Destruction aborts API requests, closes owned streams, clears drafts, and revokes download URLs. Reinitializing the same mount also destroys the previous instance; stale responses cannot restore its drafts.

Local JSON uses a separate file-format version:

```json
{
  "version": 1,
  "profiles": [
    {
      "role": "BDC_CONNECT",
      "kind": "cloud",
      "environment": "",
      "tenantUrl": "",
      "destination": "",
      "readOnly": true,
      "liveEnabled": false
    }
  ]
}
```

Import accepts one or two unique supported roles, at most 16 KiB, with no extra envelope/profile fields. It validates the whole file before changing any page draft, normalizes safe strings/origins, rejects unsafe flags and URL shapes, and never automatically sends PUT. Review and save each imported role explicitly. Export sanitizes both current page drafts (including unsaved edits) into a local download with no tenant ownership or credentials. No server disk is touched.

The browser guard is intentionally narrower than general blank-draft validation: imported/saved UI profiles require a selected supported role and cloud kind. The server validator remains authoritative. Unknown/secret fields are rejected, not silently removed. Sanitization is not a secret-content detector: an opaque credential pasted into a syntactically valid name cannot reliably be recognized. Tenant metadata can itself be private; do not include secrets or share exports indiscriminately.

## Validation boundaries

Only seven fields are accepted: `role`, `kind`, `environment`, `tenantUrl`, `destination`, `readOnly`, `liveEnabled`. Inputs must be flat plain objects with enumerable data values, not arrays, classes, accessors, symbols, or prototype tricks. Extra keys, nested authentication, passwords, tokens, usernames, certificates, caller-supplied tenancy, and legacy product fields are rejected even if blank. Safety booleans, if supplied, must be literal true/false as specified above.

Strings are trimmed but never truncated/coerced. Reject raw strings over 2,048 UTF-16 code units, controls, invisible formatting, and angle-bracket markup.

| Field | Accepted values / limit after trimming |
| --- | --- |
| role | blank, BDC_CONNECT, JOULE; max 11 |
| kind | blank or cloud; max 5 |
| environment | blank, mock, sandbox, production; max 10 |
| destination | blank or ASCII letter/digit followed by letters/digits, dot, underscore, hyphen; max 128 |
| tenantUrl | blank or absolute HTTP(S) origin only; max 2,048 |

Both URL and destination are validated when supplied; at least one is needed for completeness. URLs normalize to `URL.origin`. Reject credentials/userinfo, paths beyond optional trailing slash, queries, fragments, percent-encoding, backslashes, and port zero. HTTPS is required except for literal HTTP localhost, 127.0.0.1, or [::1], optionally with a valid port. Local lookalikes, suffixes, numeric/abbreviated aliases, and alternate IPv6 spellings do not receive that exception.

This is not DNS/SSRF authorization, destination resolution, endpoint existence, ownership verification, interface capability discovery, or authentication. No DNS is resolved. Future networking needs separately approved endpoints, egress/redirect/DNS protections, tenant authorization, supported interfaces, and isolated secrets. Never treat `complete` or `allowed` as that approval.

## Environment worksheet and tests

`.env.sap.example` is an optional inert worksheet with blank BDC Connect/Joule cloud values and fixed safety constants. It does not load itself; the pure module never reads it. These changes do not add an environment loader or mapping into tenant profiles. Main must explicitly implement and document any runtime loading before claiming these values are used; merely loading environment variables does not create a saved profile.

Run with Node 20+ from this project, without installation, a running server, GUI, or tenant:

```sh
node --test test/sap-connections.mjs
node --check public/connections-ui.js
```

If Windows sandbox path canonicalization raises EPERM during Node startup, the tested commands are:

```sh
node --preserve-symlinks --preserve-symlinks-main --test test/sap-connections.mjs
node --preserve-symlinks --preserve-symlinks-main --check public/connections-ui.js
```

Tests cover pure validation, blank templates, removed roles, hostile metadata/URLs, production denial, result isolation, and network tripwires. DOM/EventSource doubles also cover UI API shapes, session drafts, local import/export, private streams, unsafe event responses, teardown, and stale response isolation. These are offline unit/contract tests, not browser visual QA, deployed route integration, or SAP interoperability tests.
