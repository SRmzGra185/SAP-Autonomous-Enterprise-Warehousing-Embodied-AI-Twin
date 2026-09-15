# SAP Autonomous Operations Twin
Prototype: BDC Connect + Joule coordination concepts, four operations workcells, DES/Monte Carlo and evidence-gated simulated exception resolution.

## Run
Use the existing Launch-SOXTECH-Desktop.cmd (legacy filename), or `npm start`, then open http://127.0.0.1:4173.
Node.js 20 or newer is required. Include the complete project folder when sharing; server.mjs imports the root and src modules and serves public assets.

## Current scope
Only BDC Connect and Joule have connection profiles. Both are offline metadata drafts, not working tenant connections. Asset Management, Manufacturing, Orchestration and Logistics are local scenario workspaces, not four additional SAP connections.
Unrelated standalone catalog pages have been removed from the default model and UI. Historic project-log entries describe earlier versions.

Implemented foundations:
- 2D SVG and native WebGL 1 3D twin with GRAFCET routines.
- Tenant-scoped async jobs and SSE; local deterministic planning with zero model calls.
- Assisted single-action approval requiring a 15-field exception fingerprint, seven physical-resolvability checks and explicit operator review.
- Separate post-job Resolution Proof. Missing/negative evidence cannot produce resolved_simulated. No real SAP exception is closed.
- Seconds-based fixed/triangular/empirical timing profiles and capacity experiments. Baseline/candidate Monte Carlo uses repeatable seeds.
- Distinct order P95, replication-mean uncertainty, queue time, utilization and throughput/hour.
- OEE/MTTR/MTBF calculations from explicitly supplied observations where applicable; no synthetic OEE presented as measured performance.
- Input validation, trusted-origin CORS, rate limits and existing tenant/role checks.

## Read
- USER_GUIDE.md: reproducible demonstration and controls.
- POWER_OPERATIONS_ROUTES.md: four product directions, KPI research, architecture boundaries and ANYmal distinction.
- SAP_CONNECTIONS.md: draft fields and supported local API contracts.
- PROJECT_LOG.md: change history and verification evidence.

## Honest limits
No live BDC/Joule/robot connections; no production commands. Browser animation is not physics or real-time control. Timing profiles marked observed are user-declared, not independently verified. The finite-cohort DES is not a full factory simulator: shift calendars, shared labor, finite transport buffers, breakdown/recovery processes and measured-data validation need further work. Resolution references are manually attested simulation evidence, not authenticated sensors or safety certification.

Connection drafts, jobs, approvals and proofs live in server memory and are lost on restart. Export what you need before stopping. Local plan caching is not provider prompt caching. The previous model-provider implementation is not exposed through the operations API; no safety bypass via a fallback model is permitted.

## Tests
Run `npm test`. In the Codex Windows sandbox, Node path canonicalization may fail with EPERM even for an authorized project. Verification in this session used `node --preserve-symlinks --preserve-symlinks-main test/<test-name>.mjs`; this does not change the app source or grant filesystem access.
