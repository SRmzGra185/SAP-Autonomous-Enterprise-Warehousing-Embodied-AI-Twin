---
name: soxtech-des-orchestration
description: Turn an ERP simulation request into a bounded, auditable DES scenario with mock-first adapters and safe agent delegation.
---

# SOXTECH DES Orchestration Skill

## Use when

The task involves designing or running an ERP, business data cloud, data-fabric, manufacturing, integration, or audit simulation.

## Workflow

1. Classify the request as model editing, DES simulation, robot routine/GRAFCET, integration dry-run, audit review, or agent planning.
2. Use Sol 5.6 XHigh (`gpt-5.6-sol`) as the primary orchestrator. Keep stable domain instructions and schemas at the beginning, mark the stable prefix with an explicit cache breakpoint, and append current scenario, tenant, and experiment parameters last.
3. Default to `mock` and `read-only`. Reject production writes, tenant credentials, and unapproved external actions.
4. Produce a bounded plan with a maximum of 8 steps, 4 delegations, and 2,400 output tokens unless a human explicitly raises the limits.
5. Delegate narrow work to specialists such as `goal-analyst`, `des-engine`, `integration-mapper`, `aiudit-reviewer`, and `ui-modeler`.
6. Route safeguard-triggered, provider-unavailable, token-limit, or step-limit cases to `gpt-5.5-pro`. Safeguard routes are safe-review-only: never attempt to bypass the safeguard.
7. Record every decision, handoff, adapter test, simulation seed, row-policy decision, and result in the tenant audit trail.
8. Return evidence: model version, job ID, simulation seed, metrics, adapter status, row scope, and denied-action reasons.

## Robot routine contract

0. Preserve the Data Fabric foundation. Add or replace only the `robotics` layer; never replace the platform model when loading a workcell.
1. Model the physical sequence as GRAFCET steps and receptivity-guarded transitions.
2. Bind every step to one rendered asset, one command, one sensor or signal group, and one expected condition.
3. Commission in this order: Bind, Teach, Validate, Simulate, Shadow, Assist, Release.
4. Run routines only as asynchronous jobs with event-stream updates for active step, sensor sample, command disposition, fired transition, and completion.
5. Keep `dispatched: false` in simulation, shadow, and assisted modes. Reject live mode until a separately governed device gateway and safety case exist.

## Required output contract

```json
{
  "mode": "mock|sandbox|live",
  "plan": [],
  "delegations": [],
  "safety": { "allowed": true, "deniedActions": [] },
  "simulation": { "seed": 42, "metrics": {} },
  "evidence": []
}
```

## Live integration gate

No live enterprise or industrial-system adapter is enabled by this prototype. Production requires tenant-scoped OIDC identity, database-native row-level security, secret management, private connector routing, RBAC, audit retention, data-residency controls, and explicit read/write approvals before changing `mode`.
