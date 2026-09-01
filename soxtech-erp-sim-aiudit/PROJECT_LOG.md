# SOXTECH ERP Sim AIudit — Project Log

## 2026-07-11 — First implementation slice

### Decisions captured

- Product hierarchy: visual DES simulation first, integration platform second, audit product third, agent platform fourth.
- Product direction: hybrid of ERP Factory Twin, Business Data Cloud City, AIudit Control Room, Open Integration Workbench, and Agentic ERP OS.
- First release: realistic mocks only; no SAP tenant credentials or production writes.
- Runtime: hybrid-ready, starting with a browser UI and Node server so the complete DES essentials run with minimal setup.
- Transport: asynchronous simulation jobs plus SSE event streaming; synchronous calls remain limited to short control-plane operations.
- Modeling: independent behavioral clone of object manipulation, object arrangement, model hierarchy, synchronized 2D/3D views, and DES concepts.
- DES essentials: deterministic seed, event queue, arrivals, service, capacity, queues, utilization, throughput, cycle times, P95, real-time pacing, and Monte Carlo runs.
- Agent routing configuration: Luna 5.6 Extra High as primary; GPT-5.5 Pro as fallback for safeguards, unavailable provider, token limits, or step limits.
- Safety defaults: mock/read-only mode, production write denial, tenant access disabled, audit events for jobs and model saves.
- “ISBN” remains a configurable source-system label pending later clarification.

### Implemented evidence

- `server.mjs`: dependency-light API server, async job registry, SSE event streams, model endpoint, adapter registry, runtime router metadata, policy endpoint, and audit endpoint.
- `src/engine.mjs`: discrete-event engine with a priority queue, resource capacity, service duration, deterministic RNG, completion metrics, audit checkpoints, real-time pacing, and Monte Carlo aggregation.
- `src/domain.mjs`: BDC-oriented demo model with SAP and non-SAP source systems, BDC Cockpit, Datasphere, BW PCE, data product, SAC, Joule, and AIudit gate objects.
- `src/adapters.mjs`: adapter runway covering OData, REST/JSON, GraphQL, XML/SOAP, MQTT, ODBC, Oracle SQL, OPC Classic, OPC UA, Socket, COM/ActiveX, C, and CAD.
- `src/safety.mjs`: safe connection decisions and audit entry creation.
- `public/index.html`, `public/styles.css`, `public/app.js`: ribbon UI, palette, draggable 2D model, synchronized CSS 3D twin, inspector, telemetry, adapter runway, GitHub redirect, and Agent OS event log.
- `skills/soxtech-des-orchestration/SKILL.md`: session-generated orchestration skill draft.

### Verification evidence

- Syntax checks passed for all `.mjs` files and the browser module using the bundled Node.js 24.14.0 runtime.
- API smoke test passed: `/api/health` returned `ok: true`; the model returned 9 objects and 10 edges; the adapter registry returned 13 adapters.
- Monte Carlo smoke test passed: 3 runs completed for 12 entities with average throughput `0.199` and 12 AIudit checks.
- SSE smoke test passed: 163 event frames streamed to `job_complete` for an 8-entity DES job.
- Safety smoke test passed: a production OData write request returned `allowed: false` with the live-tenant denial policy.

### Known next steps

1. Fix persistence with versioned model snapshots and collaboration conflict handling.
2. Add schema validation and contract tests for every adapter.
3. Add OAuth2/mTLS, SAP Cloud Connector, secret manager, tenant isolation, RBAC, retention, and data-residency configuration.
4. Add WebSocket bidirectional control if pausing, stepping, or intervention commands need low-latency interaction.
5. Replace CSS 3D with WebGL/WebGPU and spatial indexing for large scenes.
6. Add real model-driven agent planner with provider capability detection and explicit fallback tests.

## Research notes

- SAP Business Data Cloud is represented as a capability model rather than a single application.
- SAP Datasphere and SAP Integration Suite are the intended semantic and connectivity seams for future real integrations.
- The prototype does not claim SAP compatibility or Siemens implementation compatibility; it exposes independent contracts and mock behavior.

## 2026-07-11 — Visual and semantic redesign pass

### New decisions

- Visible object names are now vendor-neutral: Private Cloud ERP, Business Data Cockpit, Semantic Data Fabric, Warehouse PCE, Analytics / Planning, AI Agent, and AIudit Gate.
- The visual model is now an industrial campus metaphor rather than floating cards: warehouses, control tower, data reactor, archive silo, trusted-data crate, analytics pavilion, AI robot station, and safety gate.
- The 3D sandbox supports orbit rotation by drag, wheel zoom, focus-on-select, and a distinct inspector mini-environment for the selected object.
- Model editing is enabled by default and can be toggled between EDIT MODE and VIEW MODE. This is independent from production integration safety.
- HANA-oriented data lenses are explicit in the UI and API: Vector, Spatial, Property graph, Knowledge graph, and JSON.
- Ribbon tabs now replace their tools by context: Model, Simulate, Integrate, AIudit, and Agent OS.
- Added working actions for adding objects, gates, agents, save snapshots, undo/redo, simulation modes, adapter navigation, evidence lookup, fallback route display, zoom, and camera navigation.
- The SOXTECH mark is implemented as a scalable vector treatment based on the supplied reference: person-like O/X construction, diagonal building/street lines, and the blue T/street accent below the X.

### Second-pass verification

- Syntax checks still pass for all server modules and the browser module.
- API smoke test still passes with 9 generic model objects and a completed Monte Carlo job.
- `/api/hana-capabilities` returns all five requested data lenses.
- The generic visible model names are returned by `/api/model`.
- Production write safety remains denied after the visual redesign.
- Static UI smoke test confirms the SOXTECH vector mark, EDIT MODE control, and 3D world mount are present in the served page.

## 2026-07-11 — 3D grounding and object-menu correction

- Copied the supplied `SOXTECH LOGI.png` into the app and restored the original SOX / reversed TECH composition instead of substituting a new abstract mark.
- Added an object submenu that opens from palette and ribbon tools, previews the selected object as a small 3D environment, exposes capacity/service/plane metadata, and places the object only after explicit confirmation.
- Reworked roads so they are children of the same transformed ground plane, with curb thickness, lane markings, depth, and contact shadows.
- Added 3D icon miniatures to the object palette and contact shadows/raised bases to world objects.
- Static asset and runtime verification passed: the logo is served as `image/png`, the object submenu and Place on plane action are present, DES completes, and production writes remain denied.

## 2026-07-11 — Native mesh renderer correction

- Replaced the CSS pseudo-3D world with `public/webgl-world.js`, a native WebGL renderer using procedural polygonal meshes.
- Added rendered mesh families for warehouses, towers, reactors, silos, crates, pavilions, robots, and audit gates.
- Added a shared floor slab with all object bases at ground level and raised spatial corridors connecting model edges.
- Added a separate `deep-dive-canvas` WebGL viewport to the BDC Palette submenu. Palette selection now opens a rendered object environment before placement.
- Fixed the camera baseline so the initial view is above the plane rather than below it.
- Verification: WebGL module is served, main canvas and deep-dive canvas are present, 9 model nodes load, DES completes, and production writes remain denied.

## 2026-07-11 — Application interiors and capability mapping

- Palette and 3D mesh selection now open a zoom-in deep-dive environment with an object-specific cockpit interface.
- Added interface interiors for source systems, Business Data Cockpit, Data Product Studio, AIudit Control Room, Safety Gate, and Agent Workbench.
- Added executable mock surfaces for SQL Console, SQL Analyzer Plan File, PAL Hybrid Gradient Boosting Tree, Graph Viewer, Catalog Browser, Vector SQL, Spatial map, JSON SQL, API contracts, background activation, evidence export, graph algorithms, and bounded agent delegation.
- Restored object names, descriptions, capacities, service times, operational roles, and interface statistics in the deep-dive header and cockpit.
- Capability mapping was checked against current official documentation: Database Explorer SQL console/catalog/analyzer/debugger, HGBT mixed-feature classification/regression and cross-validation, graph workspaces/Cypher/neighborhood/shortest path, vector and spatial types, JSON SQL, and data-product/intelligent-content activation flows.

## 2026-07-11 — Weighted mash visual dynamics pass

- Visual priority locked as: 1) Industrial Plant Simulation Floor, 2) Cloud Operations Data Center, 3) Apple-like Industrial City.
- Added procedural material variation in the WebGL shader: panel seams, metal grain, glass treatment, and emissive flow particles.
- Added custom mesh families for torus reactors, cone roofs, storage silos, control towers, pavilions, robots, gates, crates, and industrial structures.
- Added animated work entities, worker-pool particles, queue workers, and live flow-state updates from DES events.
- Added campus backdrop blocks and a visible flow legend to reinforce the factory/data-center/city mash.
- Smoke evidence passed: flow legend present, dynamic worker generator present, material shader present, torus/cone meshes present, deep-dive interior present, DES complete, and production writes denied.

## Four 3D directions for selection

1. **Industrial Process Campus** — rendered warehouses, control tower, reactors, silos, quality gates, conveyors, forklifts, and human-scale work cells. Best for explaining ERP actions through physical operations.
2. **Data-Fabric Observatory** — a spatial data center with translucent vector volumes, graph bridges, JSON streams, knowledge-graph constellations, and semantic towers. Best for explaining HANA/BDC concepts.
3. **Autonomous Factory** — AI Agents are robotic operators moving between machines, while planning, maintenance, quality, and inventory become physical production stations. Best for the agentic-OS story.
4. **AIudit Metropolis** — a clean Apple-like city of control checkpoints, evidence vaults, approval gates, exception towers, and audit trails. Best for SOX/control storytelling.

## 2026-07-11 — High-effort industrial asset refinement and blindspot pass

- Rebuilt `public/webgl-world.js` after the failed incremental patch had left it empty; the renderer now contains a complete native WebGL path again.
- Replaced the generic block language with object-specific composite meshes: roofed warehouse/loading dock, semantic control tower, ringed reactor, catwalk silo, irregular stacked data crates, glass pavilion, mobile AI robot, and control gate.
- Added a professional industrial palette: deep navy/steel foundations, restrained teal/cyan data surfaces, bronze process accents, violet governed-data accents, and rose safety controls. Node colors in the 2D model and palette defaults now match the 3D visual system.
- Added material presets rather than noisy fake textures: metal panel seams/grain, glass edge response, data-stream motion, warning stripes, ground variation, and emissive status surfaces.
- Made the environment spatially legible: every asset has a raised base, the connectors are elevated data conduits, and the work flow has animated data packets, queue packages, and small worker-pool units that orbit each station.
- Preserved interaction: wheel zoom, pointer orbit, object picking, 3D deep dive, and interior cockpit flow remain available.

### Blindspot pass — decisions that were previously implicit

1. **Asset language:** each object needs a silhouette, scale hierarchy, material family, secondary detail, and status-light rule. This is now encoded in the renderer rather than left to node colors.
2. **Texture source:** procedural shader effects are appropriate for the token-optimized demo; production-quality PBR maps or glTF assets still need an explicit asset pipeline, licensing policy, UV rules, and LOD budget.
3. **Flow semantics:** a data packet, a worker, a queue item, and a capacity marker are different visual entities. They are now rendered separately; future work should define their event schema and replay contract.
4. **Camera and scale:** the model needs a world-unit convention, minimum object footprint, camera framing rules, and an acceptance render for both campus and deep-dive scenes.
5. **Performance:** large scenes will require instancing, frustum culling, LODs, texture atlases, and a GPU budget. The current demo prioritizes clarity over scale.
6. **State mapping:** every visual status must map to simulation state, audit state, or connection state; otherwise the scene can look alive without being explainable. The current flow state is connected to DES running/queue events, while detailed status mapping remains a next design task.
7. **Acceptance criteria:** “better” needs reference renders and measurable checks: no floating bases, no below-plane assets, distinct silhouettes, readable connectors, visible flow, selectable objects, and a working deep dive. The current smoke checks cover code/runtime gates; visual comparison should be added next.

### Verification evidence

- `node --check` passed for `public/webgl-world.js`, `public/app.js`, and `server.mjs`.
- Runtime smoke passed: health `true`, model nodes `9`, renderer palette/material/custom-mesh/flow markers `true`, DES job `complete`.
- Runtime safety remained unchanged: orchestrator `luna-5.6-extra-high`, fallback `gpt-5.5-pro`, transport `async job + SSE event stream`, live tenant access `disabled`.

## 2026-07-12 — Desktop, security, Data Lens, and high-effort visual release

- Added `Launch-SOXTECH-Desktop.cmd` and PowerShell launch/stop scripts. The launcher prefers the bundled Codex Node runtime, starts the API hidden, waits for `/api/health`, and opens an Edge app window. Launcher verification returned health `true`, version `0.2.0-desktop`, auth mode `desktop`.
- Added PWA manifest/service worker so the browser surface can run as a standalone desktop-style app shell.
- Repaired the In-Memory Data Lens bug. The buttons previously had no event handlers; read-only was not the cause. Vector, Spatial, Property Graph, Knowledge Graph, and JSON now open a dedicated 3D-backed workbench and submit tenant-scoped background queries.
- Added an Agent OS goal field backed by asynchronous jobs. Sol 5.6 XHigh (`gpt-5.6-sol`) analyzes the goal, defines bounded subtasks, launches named specialists, and consolidates their result. `gpt-5.5-pro` is the fallback.
- Implemented application-level fallback detection for provider safety/incomplete responses, provider unavailability, token-budget limits, and step limits. Safeguard fallback is safe-review-only and cannot be used to bypass the safeguard.
- Implemented OpenAI Responses background mode, hashed per-user `safety_identifier`, stable tenant `prompt_cache_key`, explicit cache breakpoints, and stable-prefix/dynamic-suffix prompt layout. No API key is present in source.
- Added loopback-only desktop identity and production OIDC/JWT verification with RS256, issuer, audience, expiry, JWKS cache, tenant claim, and role claim checks.
- Replaced wildcard CORS with an `APP_ORIGINS` allowlist. Added CSP, frame denial, MIME sniffing protection, referrer/permissions policy, body-size limits, strict input validation, and per-tenant/user rate limiting.
- Added row policy metadata (`tenantId`, `ownerId`, `visibility`) to every model node. Reads filter rows and dependent edges; writes reject viewers, cross-tenant rows, and unauthorized private rows. Jobs and audit entries are tenant-scoped.
- Added `.env.example`, `.gitignore`, `SECURITY.md`, and `USER_GUIDE.md`. Production startup fails closed unless OIDC issuer/audience configuration is supplied.
- Replaced more renderer primitives with profile-extruded and lathed polygonal meshes: hangars, tapered towers, pressure vessels, hoppers, chamfered vaults, capsules, and trusses. Added upgraded specular materials and moving AGV assemblies.
- Preserved the supplied SOXTECH logo pixels and positions. The visual change is a glass/metal application-icon shell, `contain` sizing, highlights, and shadow treatment around the original artwork.

### Verification evidence

- Syntax: 15 JavaScript/MJS files checked, 0 failures.
- Desktop launcher: health `true`, version `0.2.0-desktop`, auth mode `desktop`; stop script removed the running process.
- CORS: trusted origin echoed exactly; untrusted origin returned `403` with no allow-origin header; wildcard CORS scan returned `false`.
- RLS: all seeded rows contained tenant/owner/visibility metadata; cross-tenant write returned `403`; viewer write returned `403` and Edit Mode permission was `false`.
- Rate limit: four requests under a limit of three returned `[200, 200, 200, 429]`.
- Data Lens: Vector query background job completed with three rows. Browser DOM verification confirmed the Vector workbench was open with no boot error.
- Agent fallback: safeguard test completed on `gpt-5.5-pro`, reason `safeguard`, with a `safe-review-only` fallback event.
- DES: deterministic simulation job completed; production tenant access remained `disabled`.
- Static safety scan: no wildcard CORS, no hard-coded API-key pattern, supplied logo present, custom profile meshes and AGV motion present.
- Visual QA: clean 1720×1100 3D campus screenshot and 3D Vector Lens workbench screenshot generated and manually inspected.

### Blindspot pass — unknown unknowns that now need explicit choices

1. **Identity provider:** the API supports generic OIDC, but production login UX still depends on a provider choice (Entra ID, Auth0, Okta, or Keycloak), app registration, claims, PKCE redirect URLs, and logout/session policy.
2. **Database enforcement:** application RLS is demonstrable, not sufficient as the only production boundary. The production store must repeat policies as database-native RLS and encrypt persisted snapshots, jobs, and audit events.
3. **Desktop packaging:** the current desktop experience is a secure loopback API plus Edge/PWA app window. A signed MSI/Electron/Tauri package would add installer signing, auto-update, process lifecycle, and enterprise deployment requirements.
4. **Asset fidelity:** procedural polygonal models are now materially richer, but photorealistic production assets require a governed glTF/PBR pipeline, UVs, texture licensing, LODs, instancing, collision bounds, and target GPU budgets.
5. **Authentication transport:** SSE is ideal in desktop mode. Browser OIDC deployments need a bearer-aware streaming client or BFF cookie session plus CSRF controls because native `EventSource` cannot attach an Authorization header.
6. **Fallback semantics:** OpenAI documents Responses background mode, safety identifiers, and response/error states; fallback routing is application logic, not a safeguard-bypass feature. Safety-triggered fallback must remain constrained to review/alternative planning.
7. **Prompt-cache economics:** explicit GPT-5.6 cache writes can improve reuse but add cache-write cost. Cache keys need tenant partitioning, traffic limits, telemetry, and data-retention review.
8. **Service-worker lifecycle:** offline shell caching improves desktop startup but requires versioning and cache invalidation so UI and API contracts cannot drift after an update.

## 2026-07-13 - Desktop launcher repair

- Reproduced the failed launch instead of relying only on the earlier health smoke test.
- Fixed the malformed 32-bit Edge path and added a dedicated browser profile so the app opens as a separate desktop-style window.
- Normalized duplicate `PATH`/`Path` variables before child-process startup; this prevents PowerShell's case-insensitive environment dictionary failure.
- Prefer the bundled Codex Node runtime when present because the system Node process can be denied access to a Codex-managed workspace; system Node remains the portable fallback.
- Corrected the UI readiness probe from a nonexistent `scene-canvas` marker to the actual `webgl-world` canvas.
- Added persistent launcher, server-output, and server-error logs under `.runtime/`, stale PID cleanup, Node major-version validation, and a visible failure pause in the command launcher.
- Added explicit Edge/Chrome/default-browser fallbacks and clarified that users must open the `.cmd`, not the unsigned `.ps1` directly.

### Repair evidence

- PowerShell parser errors: `0`.
- Exact double-click command path exit code: `0`.
- API health: `true`; version: `0.2.0-desktop`.
- UI response: HTTP `200`; actual WebGL canvas marker present: `true`.
- Launcher log recorded the selected Edge executable and `Launch completed successfully`.

## 2026-07-13 - Actionable process guide

- Expanded the in-app Getting Started panel from a conceptual tour into an eight-step activation sequence covering edit mode, object placement, DES, integration dry-runs, AIudit, Agent OS, and Data Lenses.
- Expanded `USER_GUIDE.md` with an actionable activation map that explains what to click, the required follow-up, and the success signal for every Model, Simulate, Integrate, AIudit, Agent OS, zoom, and Data Lens control.
- Added complete Order-to-Insight, predictive-maintenance, and safe agent-assisted use cases with expected checkpoints and example Agent OS goals.
- Clarified the difference between read-only inspection/query/simulation capabilities and blocked tenant mutations or production routes.

## 2026-07-14 - Load Example black-state repair

- Reproduced the endpoint independently: `/api/model/example` returns the expected example with 9 objects and 10 connections.
- Replaced the inline Load Example handler with a guarded `loadExample()` transaction that validates the payload, records the previous model for Undo, resets selection/history state, closes stale deep-dive/lens overlays, and returns to the visible 2D model.
- Added a success toast with object/connection counts and a visible error toast plus Agent OS event-log entry when the API or renderer fails.
- Verified the served `app.js` contains the new handler and the API health/example route remains available.

## 2026-07-14 - Example use-case runbook

- Confirmed why `Load Example` appeared unchanged: the initial tenant model and example endpoint both used the same Order-to-Insight template, and the previous client handler only replaced in-browser state.
- Load Example now persists the example through the tenant-safe model endpoint, selects `Private Cloud ERP`, labels the model `Example loaded · Order-to-Insight ready`, resets simulation telemetry, and opens an executable Example Use Case runbook.
- Added runbook actions for Source Cockpit, Fabric Service, Data Product Studio, Integration dry-run, DES, AIudit, Safety Gate, Data Lens, Agent OS, and Save Snapshot.
- The runbook hides or layers correctly when it opens a deep-dive or lens workbench and prepares the bounded Agent OS goal without auto-running it.
- Persistence verification: POST accepted; subsequent model read returned 9 objects. Example API returned 9 objects and 10 connections.

## 2026-07-23 — Robot Lab, GRAFCET, and sim-to-real walkthrough

- Added four executable domain scenarios: autonomous retail shelf replenishment, multi-robot warehouse fulfillment, adaptive cobot assembly, and autonomous asset inspection.
- Replaced generic scenario blocks with dedicated polygonal asset assemblies, including a mobile manipulator, AMR, six-axis cobot cell, flexible feeder, smart fixture, torque station, conveyor, AS/RS rack, loading dock, quadruped robot, sensor mast, process machine, inspection cell, robot dock, and safety zone.
- Added animated mechanical details and material-specific visual presets while preserving orbit, zoom, object selection, shared-plane placement, and deep-dive cockpit behavior.
- Added a Robot Lab ribbon and interactive GRAFCET diagram. Manual stepping synchronizes the active step, selected 3D asset, sensor expectation, command, and transition receptivity.
- Added generated routine code, protocol/device I/O bindings, and an in-app commissioning walkthrough: Bind → Teach → Validate → Simulate → Shadow → Assist → Release.
- Added `/api/robot-scenarios`, `/api/robot-scenarios/:id`, and asynchronous `/api/robot-routines`. Routine jobs emit active-step, sensor, command, transition, and completion events over SSE.
- Enforced the mock-first fail-safe: all robot command events use `dispatched: false`; live mode returns `403 robot_live_denied`.
- Added cache invalidation for executable UI files and versioned the main application module to prevent stale desktop behavior after an update.
- Added `test/robotics-smoke.mjs` and the `npm test` command.

### Verification evidence

- Syntax checks passed for `server.mjs`, `validation.mjs`, `src/robotics.mjs`, `public/app.js`, `public/webgl-world.js`, and `public/service-worker.js`.
- Automated smoke test passed: `4 scenarios`, `8 GRAFCET steps`, and `live route denied`.
- Browser validation loaded the Assembly scenario as `Variant-to-Assembly Routine`, opened a `764 × 570` WebGL canvas, and rendered all eight GRAFCET steps.
- Browser validation confirmed the practical routine returns to `S0`, shows `weight + rgbd + rfid: all evidence agrees`, labels the last action `simulated`, and reports `1 robot cycle complete`.
- Browser validation confirmed Live mode keeps the button recoverable and displays `Live robot commands are disabled. Use simulation, shadow, or assisted mode.`

### Blindspot pass

1. **Simulation is not a robot driver.** ROS 2, OPC UA, PROFINET, and MQTT names currently represent contracts and mock bindings. Real device control requires vendor SDKs, device certificates, network segmentation, a safety PLC, heartbeat/watchdog logic, and certified stop behavior.
2. **GRAFCET needs fault branches.** The first routine release models the nominal cycle. Production-grade charts need timeout, retry, recovery, manual mode, emergency stop, loss-of-communication, and safe-home branches.
3. **Robot geometry is not yet kinematics.** The meshes animate expressively, but they do not yet solve inverse kinematics, collision detection, reachability, joint limits, or path planning.
4. **Sim-to-real needs calibrated frames.** Each cell needs world, robot-base, tool-center-point, camera, fixture, conveyor, and map frames plus a versioned calibration procedure.
5. **Training needs a reproducible environment.** Reinforcement or imitation learning requires observation/action spaces, reward definition, reset conditions, domain randomization, dataset lineage, model registry, and safety evaluation.
6. **Timing semantics need PLC-level precision.** Browser/SSE timing demonstrates sequence and observability; deterministic industrial control belongs in a real-time controller or PLC, not in the browser or cloud event loop.
7. **The asset pipeline remains procedural.** Photorealistic production fidelity requires licensed glTF/PBR assets, UVs, LODs, instancing, collision meshes, GPU budgets, and acceptance renders per target device.

## 2026-07-26 — Unified Data Fabric and robotics campus

- Corrected the architecture that previously replaced the complete platform model when `Load 3D cell` was pressed.
- Expanded the permanent platform scene to 14 vendor-neutral objects: managed LoB systems, customer-managed ERP, external sources, Business Data Cockpit, Semantic Data Fabric, Warehouse PCE, Open Data Connect, Object Store, Open Data Ecosystem, Trusted Data Products, Analytics / Planning, Intelligent Applications, AI Agent, and AIudit Gate.
- Added server-side composition at `POST /api/robot-scenarios/:id/compose`. It restores the platform foundation, preserves non-robot custom objects, removes only the previous robotics layer, adds the selected workcell, validates it, applies tenant row policy, saves it, and emits an audit record.
- Added cross-zone routes for source orders, cockpit orchestration, governed data products, AI guidance, robot telemetry, semantic context, and AIudit evidence.
- Added distinct Data Fabric Campus and Robot Operations floor districts, a connected digital-thread bridge, expanded camera bounds, and visible composition labels in the WebGL scene.
- Updated the 2D editor for the denser campus with compact nodes, adaptive labels, wider drag bounds, and emphasized cross-zone connectors.

### Verification evidence

- Syntax checks passed for eight server, domain, client, renderer, service-worker, and test modules.
- Automated test passed: `14 platform + 7 robot objects`, `8 GRAFCET steps`, and `live route denied`.
- Browser composition produced `SOXTECH Data Fabric + Assembly Digital Twin`, version `0.4.0-unified`, with 21 objects and five explicit cross-zone routes.
- Switching to Inspection retained 21 objects, kept Business Data Cockpit and Semantic Data Fabric, removed the Assembly cobot, and added the Inspection robot.
- Fixed reload-state binding so Robot Lab restores the model's saved `activeScenarioId`; the rendered workcell and executable GRAFCET can no longer silently select different domains.
- Visual inspection confirmed both districts land on the expanded plane; browser diagnostics contained no warnings or errors.
