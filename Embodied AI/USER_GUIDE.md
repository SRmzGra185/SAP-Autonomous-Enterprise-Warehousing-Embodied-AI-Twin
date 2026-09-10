# SAP Embodied AI Simulation Lab — User Guide

## Start the desktop app

1. Double-click `Launch-SOXTECH-Desktop.cmd` (the Windows Command Script), not the `.ps1` file. Windows may block an unsigned `.ps1` when opened directly; the command launcher applies the correct local execution policy.
2. The launcher starts the API on `127.0.0.1`, waits for its health check, and opens an Edge app window. If Edge is unavailable, it opens the default browser.
3. Use `Stop-SOXTECH-Desktop.ps1` when you want to stop the local API.

If the window does not appear, open `http://127.0.0.1:4173` in your browser. The launcher records the exact failure in `.runtime/launcher.log`, with API details in `.runtime/server.stderr.log`. A failed launch now leaves the command window open so the error is visible.

The default desktop identity is an administrator inside the isolated `sap-embodied-ai-demo` tenant. Copy `.env.example` to `.env` to change the port, tenant, role, OIDC provider, rate limits, or model settings. Never place real secrets in `.env.example` or source code.

## Platform tour

### 1. Build the model

- Use **New Model**, **Open**, or **Load Example** in the top menu.
- Keep **Edit Mode** enabled to drag 2D nodes or place objects from the palette.
- Use **Undo**, **Redo**, and **Save Snapshot** from the Model ribbon.
- Switch to **View Mode** to prevent accidental structural changes.

### 2. Work in 2D and 3D

- **2D Model** is the process editor: nodes are DES stations and connections are routes.
- **3D Twin** is the rendered industrial campus: drag to orbit and use the mouse wheel to zoom.
- Click a rendered object to enter its deep-dive environment and application cockpit.

### 3. Use object cockpits

- **LoB Source** exposes catalog, API, and event interfaces.
- **SAP BDC Cockpit** exposes cockpit activation, SQL Console, SQL Analyzer, PAL HGBT, Graph Viewer, and catalog tools.
- **Data Product** exposes semantic models, Vector, Spatial, JSON, Graph, and API contracts.
- **Governance** exposes controls, evidence, exceptions, and lineage.
- **Safety Gate** explains policy and approval decisions.
- **Joule Agent** shows bounded planning, tools, guardrails, and trace information.

Cockpit buttons are realistic mock executables. They queue or simulate work but never contact production tenants.

### 4. Run discrete-event simulation

1. Choose **Fast DES**, **Real-time DES**, or **Monte Carlo**.
2. Set the number of orders.
3. Press **Run experiment**.
4. Watch moving packets and AGVs, worker pools, queues, simulation time, throughput, cycle time, P95 cycle time, and Governance breaches.

### 5. Program and train a robot routine

1. Open **Robot Lab** in the ribbon.
2. Choose **Retail**, **Warehousing**, **Assembly**, or **Inspection**.
3. Press **Connect to SAP campus**. The permanent Data Fabric platform stays in the model and the selected domain-specific workcell is added as a connected Robot Operations zone.
4. Read the GRAFCET left to right. A step `S#` is an active action; a transition `T#` fires only when its receptivity is true.
5. Press **Next step** to rehearse the sequence manually. The selected 3D object, sensor expectation, command, and transition update together.
6. Inspect **Routine code** to see the executable control skeleton and **I/O bindings** to see which mock protocol and device back each object.
7. Follow **Commissioning** in order: Bind → Teach → Validate → Simulate → Shadow → Assist → Release.
8. Select an execution mode and press **Run routine**. The routine runs as a background job, highlights the active GRAFCET step, samples the named sensor, evaluates the receptivity, and records the simulated command.

Use **Simulation** for synthetic I/O, **Shadow** to read real signals without issuing commands, and **Assisted** to model human approval. **Live** is intentionally locked; this release never dispatches a production robot command.

| Scenario | Physical routine | Enterprise outcome |
| --- | --- | --- |
| Retail | Detect shelf gap → reserve SKU → pick → enter safe aisle → replenish → verify | Inventory and planogram evidence reconciled |
| Warehousing | Release order → retrieve tote → dispatch AMR → robot pick → convey → weigh/scan → dock | Handling unit and shipment confirmed |
| Assembly | Read variant → present part → change tool → align → clamp → torque → inspect → route | Production confirmation or controlled rework |
| Inspection | Load mission → preflight → navigate → stabilize → capture sensors → classify → govern | Evidence-backed maintenance review proposed |

### 6. Explore the Data Fabric Runway

- Adapter cards run safe background connection tests.
- Vector, Spatial, Property Graph, Knowledge Graph, and JSON buttons open a dedicated 3D-backed workbench.
- Enter a query and press **Run background query**. Results are filtered to the authenticated tenant.

**Read-only does not mean inactive.** It allows inspection, queries, simulations, and dry-run tests. It blocks data mutation and production routes.

### 7. Use Joule Agent Orchestration

1. Enter a bounded goal in the Joule Agent Orchestration field.
2. Press **Delegate**.
3. Sol 5.6 XHigh analyzes the goal, defines subtasks, launches up to four specialists, and consolidates their output.
4. The event log shows specialist launches, provider status, and any fallback route.

The default limits are 2,400 output tokens, eight steps, and four delegations. GPT-5.5 Pro is the fallback. Safeguard-triggered fallback runs in safe-review-only mode and cannot be used to bypass a safeguard.

## Actionable activation playbook

Use this sequence whenever you want to activate a control or understand what it does:

1. Load `Load Example` to start from the prepared SAP EWM Order-to-Dispatch scenario, or choose `New Model` for an empty model.
2. Confirm the inspector says `EDIT MODE`. If it says `VIEW MODE`, click the Edit Mode switch. A viewer role cannot enable editing.
3. Click the actionable once, observe the toast or panel change, then complete the follow-up action shown below.
4. Check the Inspector, event log, telemetry cards, or background-job result before moving to the next actionable.
5. Press `Save Snapshot` at the end of a meaningful change. Use `Undo` or `Redo` only after a model edit.

After `Load Example`, the app opens an **Example Use Case / SAP EWM Order-to-Dispatch** runbook. Use its buttons in order; they activate the relevant cockpit, runway, simulation, audit, lens, Joule Agent Orchestration, and snapshot action for you. Close the opened cockpit or workbench to return to the runbook and continue.

| Actionable | Activation process | Success signal |
| --- | --- | --- |
| `Select` | Open Model, Simulate, Integrate, Governance, or Joule Agent Orchestration and click Select. Then click a 2D node or rendered 3D mesh. | The object is highlighted and its Inspector/deep-dive context updates. |
| `Process` | Open Model, click Process, review the SAP BDC Cockpit deep dive, then choose `Place on plane` if you want a new service. | A rendered service mesh appears on the shared plane and the model node count increases. |
| `Data Product` | Open Model, click Data Product, inspect Semantic Model, Vector, Spatial, JSON, Graph, or API Contract, then place it if needed. | Data Product Studio opens with its interface tab active. |
| `Governance` | Open Governance, click Governance, then inspect Controls, Evidence, Exceptions, and Lineage. | The control room shows coverage, evidence count, exceptions, and lineage context. |
| `Gate` | Open Governance or Model, click Gate, then review Policy, Approvals, or Simulation. | The safety state shows mock-only boundary, production writes denied, and approval required. |
| `Save Snapshot` | Click it after placing, moving, or editing objects. | A save confirmation appears and the current model is persisted to the API snapshot. |
| `Undo` / `Redo` | Change the model first, then click Undo or Redo. | The model and Inspector revert or reapply the structural change. |
| `Run` | Open Simulate, choose Fast DES, set Orders, and click Run experiment or Run in the ribbon. | Event stream, moving workers, timeline, throughput, cycle time, P95, and Governance breaches update. |
| `Real-time` | Open Simulate and click Real-time. | The simulation runs with live event pacing and telemetry updates. |
| `Monte Carlo` | Open Simulate and click Monte Carlo. | Five bounded experiment samples run and aggregate telemetry is returned. |
| `Reset clock` | Open Simulate and click Reset clock. | The event timeline returns to `t = 0`. |
| `Adapter` / `Dry-run test` | Open Integrate, click either actionable, choose an adapter in Data fabric runway, then run its test. | The adapter reports a mock dry-run result; no production route is called. |
| `Evidence` | Open Governance and click Evidence. | The API returns the current tenant's audit entry count. |
| `Joule Agent` | Open Joule Agent Orchestration, click Joule Agent, then inspect Plan, Tools, Guardrails, or Trace. | The bounded specialist cockpit opens. |
| `Route` | Open Joule Agent Orchestration and click Route. | The event log confirms planner → DES specialist → governance reviewer. |
| `Fallback` | Open Joule Agent Orchestration and click Fallback. | The fallback route is armed for safeguard, provider, token, or step-limit events. |
| `Zoom` | Use the `−`, `＋`, or fit controls above the 2D model. | The 2D model scale changes; 3D uses drag to orbit and wheel to zoom. |
| `Open Robot Lab` | Open Robot Lab in the top ribbon, then choose a domain scenario. | The scenario’s GRAFCET, routine code, I/O bindings, and commissioning guide appear. |
| `Load 3D Cell` | Choose a Robot Lab scenario and click Load 3D Cell. | A domain-specific polygonal workcell replaces the current model and opens in 3D. |
| `Next GRAFCET` | Click Next step repeatedly. | The active `S#`, selected physical asset, sensor, command, and next `T#` advance together. |
| `Run Routine` | Select Simulation, Shadow, or Assisted; set cycles and speed; press Run routine. | The background event stream executes every step and returns to `S0` with production output blocked. |
| `Shadow Mode` | Click Shadow Mode in the Robot Lab ribbon. | Real-input semantics are selected while every physical command remains virtual. |

## Complete use case: adaptive cobot assembly commissioning

1. Open **Robot Lab** and choose **Assembly — Adaptive Cobot Assembly**.
2. Press **Connect to SAP campus**. Orbit the unified scene: the SAP Business Data Cloud campus remains behind the connected production-order terminal, flexible feeder, six-axis cobot, smart fixture, torque controller, vision gate, and release/rework zone.
3. Open **I/O bindings**. Map the mock tags to a ROS 2 robot namespace, OPC UA fixture tags, PROFINET torque controller, and REST/JSON production-order endpoint.
4. Open **Commissioning** and complete **Bind** and **Teach**: define the tool center point, feeder pickup frame, fixture datum, approach poses, speed limit, and safety zone.
5. Use **Next step** to dry-teach all eight GRAFCET steps. At each step, confirm that the sensor expectation and transition receptivity correspond to the physical action.
6. Select **Simulation**, speed `1×`, and run one cycle. Verify the sequence returns to `S0` and all commands say `simulated`.
7. Increase to several cycles or use the DES Monte Carlo experiment to test arrival variability, robot service time, quality failures, and rework load.
8. Select **Shadow** when real read-only device adapters are available. Compare live tag values against the same receptivities while commands stay inside the twin.
9. Select **Assisted** to rehearse operator approvals before command groups. The prototype still records commands without dispatching them.
10. Attempt **Live** to verify the fail-safe. The API must return `403 robot_live_denied`; production release requires a separately governed device gateway, safety PLC, identity, risk assessment, and signed change approval.

### How the unified campus is composed

- The **SAP Business Data Cloud campus** is permanent: managed and customer-managed sources, external sources, SAP BDC Cockpit, SAP Datasphere, SAP BW PCE, SAP BDC Connect, Object Store, Open Data Ecosystem, SAP Data Products, SAP Analytics Cloud, SAP Intelligent Applications, Joule Agents, and Governance Gate.
- The **Robot Operations** district contains the physical workcell selected in Robot Lab.
- **Connect to SAP campus** replaces only the previous robotics district. It does not remove platform objects or user-created non-robot objects.
- Cross-zone routes connect orders to the workcell, governed data products and AI guidance to robot agents, robot telemetry back to the semantic fabric, and workcell evidence to Governance.
- **Load Example** intentionally returns to the platform-only campus. Add any Robot Lab scenario afterward to reconstruct a unified digital twin.

## Complete use case: production-quality SAP EWM order-to-dispatch simulation

This is the recommended first process because it activates the whole suite while remaining mock-only.

1. Choose `Load Example`, then click `Edit Mode`.
2. Switch to `2D Model`. Click a source node, process node, data product, Governance, and Gate to verify their Inspector descriptions and capacities.
3. Switch to `3D Twin`. Drag the scene to orbit and scroll to zoom. Click the source mesh and choose its deep-dive environment.
4. In the source cockpit, open `APIs` and press `Test` for the OData/JSON, REST/XML, or MQTT/OPC UA mock interface. Then open `Events` to inspect incoming plant events.
5. Return to the model and open the SAP BDC Cockpit mesh. In `Cockpit`, press `Activate` on a staged data package. In `SQL Console`, press `Run background`; in `PAL HGBT`, press `Train background job`; in `Graph Viewer`, try `Neighborhood` or `Shortest Path`.
6. Open the Data Product mesh. Review `Semantic Model`, then inspect `Vector`, `Spatial`, `JSON`, `Graph`, and `API Contract` to see how operational objects become a governed Industry 4.0 data product.
7. Open `Integrate`, run an adapter dry-run, and confirm the result is mock-only.
8. Open `Simulate`, select `Real-time` or `Monte Carlo`, set Orders to `24`, and press `Run experiment`. Watch the moving data packets, workers, queues, timeline, and telemetry cards.
9. Open `Governance`, review Controls and Exceptions, then press `Evidence` in the ribbon. Confirm that the event log contains the simulation and interface actions.
10. Enter this bounded Joule Agent Orchestration goal and press `Delegate`: `Compare the baseline and Monte Carlo SAP EWM order-to-dispatch runs, identify the highest queue risk, and produce a safe review with no production writes.`
11. Open the Joule Agent deep dive to inspect Plan, Tools, Guardrails, and Trace. If a safeguard or limit event occurs, verify the event log says the fallback is safe-review-only.
12. Click `Save Snapshot` and use the resulting model snapshot as the reproducible demo state.

## Complete use case: predictive maintenance investigation

1. Open the SAP BDC Cockpit cockpit and select `SQL Console` to inspect asset and work-order data.
2. Open `PAL HGBT`, keep seed `42`, choose `FAILURE_RISK`, and press `Train background job`.
3. Open `Graph Viewer`, use `Neighborhood` around `PRESS-03`, then use `Shortest Path` to connect the asset to its work order and quality event.
4. Open Data Product Studio and compare the Vector similarity results, Spatial plant pins, JSON event values, and Graph relationships.
5. Run a Monte Carlo DES experiment to compare queue impact when a maintenance event is introduced.
6. Use Governance Evidence and Exceptions to document the result, then save a snapshot.

## Complete use case: safe agent-assisted scenario design

1. Open Joule Agent Orchestration and click `Joule Agent` to inspect the available Plan, Tools, Guardrails, and Trace surfaces.
2. Enter a narrow goal with a measurable output, such as: `Test 30 orders across Fast DES and Monte Carlo, compare P95 cycle time, and explain any Governance breach.`
3. Press `Delegate`. The background job decomposes the goal, runs bounded specialist work, and consolidates the result.
4. Use `Route` to confirm the planner-to-specialist-to-reviewer route.
5. Use `Fallback` to confirm the configured lower-model route. A safeguard fallback can only produce a safe review or alternative plan; it cannot bypass the safeguard.
6. Verify the event log and audit evidence, then save a snapshot of the resulting scenario.

## What “read-only” means here

Read-only does not disable the actionables. It allows object inspection, SQL and graph exploration, lens queries, DES experiments, adapter dry-runs, background jobs, audit evidence, and snapshots. It blocks tenant mutations and production routes. To change the simulation model, use Edit Mode; to change real tenant data, a future production connector, identity provider, approval workflow, and database-native RLS deployment would be required.

## Roles

- `admin`: read and edit all tenant rows, including private rows.
- `editor`: read tenant rows and edit permitted tenant/private rows.
- `viewer`: read only; Edit Mode remains unavailable.

All rows carry `tenantId`, `ownerId`, and `visibility` metadata. The API filters rows and job/audit access on every request.
