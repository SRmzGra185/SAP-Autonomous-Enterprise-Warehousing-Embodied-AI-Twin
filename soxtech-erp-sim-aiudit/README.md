# SAP Embodied AI Simulation Lab

A challenge-focused prototype that extends SAP Autonomous Enterprise concepts from digital orchestration into governed physical execution. It combines SAP business context, Joule-style agent orchestration, SAP Business Data Cloud concepts, discrete-event simulation, GRAFCET robot routines, and a 2D/3D digital twin.

## Run

Double-click `Launch-SOXTECH-Desktop.cmd` (legacy launcher filename), or run `npm start` and open <http://127.0.0.1:4173>.

The first model is now a complete SAP EWM Order-to-Dispatch demonstration: SAP context and data products are connected to an AMR fleet, a robotic picking cell, conveyor control, inspection, and goods-issue confirmation.

## Challenge story

1. SAP EWM releases a warehouse order.
2. SAP Business Data Cloud supplies governed business and operational context.
3. Joule agents plan and supervise a bounded outcome.
4. SAP Warehouse Robotics / robot skills dispatch the physical work.
5. Sensors and PLC signals advance an executable GRAFCET routine.
6. Human approval and governance policies block live physical commands in the prototype.
7. Robot evidence and business confirmation return to SAP Datasphere, SAP Analytics Cloud, and the audit trail.

## Implemented

- Unified SAP platform + physical workcell model in the same 2D/3D scene.
- Four SAP-oriented Embodied AI scenarios: Retail, EWM Warehousing, Digital Manufacturing Assembly, and Asset Management Inspection.
- Discrete-event simulation that follows the loaded SAP-to-physical route.
- GRAFCET programming, simulation, shadow, assisted, and locked live modes.
- SAP BDC Cockpit, SAP Datasphere, SAP BW PCE, SAP BDC Connect, SAP Data Products, SAP Analytics Cloud, SAP Intelligent Applications, and Joule Agent deep dives.
- SAP HANA Cloud-style Vector, Spatial, Property Graph, Knowledge Graph, and JSON workbenches.
- Asynchronous jobs and SSE event streams.
- Tenant scoping, RBAC, input validation, CORS restrictions, rate limits, audit evidence, and production-command denial.
- Prompt caching and bounded primary/fallback agent orchestration.

## Honest boundary

This is a realistic simulation prototype, not an SAP-delivered product and not a certified integration. SAP, robot, PLC, and cloud interfaces remain mocks or dry runs. Moving to a physical pilot requires real SAP service contracts, robot-vendor adapters, functional-safety engineering, device identity, network zoning, and customer-specific approvals.
