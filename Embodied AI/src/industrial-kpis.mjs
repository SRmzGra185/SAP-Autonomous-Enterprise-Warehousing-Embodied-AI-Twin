// Instrumentation roadmap: absence of observations is not a measured zero.
export const routineKpis = {
  "autonomous-inspection": [
    ["MTTR", "repair seconds / completed repairs", "repair start/end and repair count"],
    ["MTBF (operating-time estimator)", "operating seconds / failures", "equipment population, observation window, failure count"],
    ["Detection and mission time", "seconds from alarm to detection; dispatch to mission end", "correlated timestamps"],
    ["Inspection coverage", "valid inspection points / required points", "accepted evidence per point"],
    ["False-positive rate", "false alarms / actually normal cases", "independent reference labels"],
    ["Verified maintenance outcome", "verified outcomes / attempted interventions", "repair evidence and originating exception read-back"]
  ],
  "adaptive-assembly": [
    ["OEE · Availability / Performance / Quality", "A × P × Q; single ideal-cycle basis", "planned time, runtime, ideal cycle, total/good counts"],
    ["Machine cycle and setup", "seconds/unit; setup seconds/batch", "operation, SKU, batch, event timestamps"],
    ["Throughput and queue time", "units/hour; seconds waiting", "DES events or observed process events"],
    ["First-pass yield and rework", "first-pass good / inputs; rework / inputs", "quality outcomes before rework"],
    ["Blocked / starved time", "seconds awaiting downstream / upstream", "mutually exclusive equipment state intervals"],
    ["Energy per good unit", "kWh / accepted units", "meter window and accepted count"]
  ],
  "warehouse-fulfillment": [
    ["Picking and order cycle", "task creation to completed picking; order to dispatch, seconds", "correlated task/handling-unit timestamps"],
    ["Travel and fleet use", "loaded/empty seconds; occupied seconds / available seconds", "mission states, map, shifts and charging"],
    ["Material / quantity / destination accuracy", "fully verified moves / attempted moves", "identity, count, UoM, location and physical presence"],
    ["Queue and dock dwell", "seconds waiting by resource", "arrival, service start/end and departure"],
    ["On-time fulfillment", "orders fulfilled by agreed deadline / eligible orders", "due dates and verified completion"],
    ["Energy per move", "kWh / verified transfers", "charger/battery measurements and transfer evidence"]
  ],
  "autonomous-orchestration": [
    ["Time to act / verified resolution", "exception to first action / verified close, seconds", "exception, authorization and proof timestamps"],
    ["Physical resolvability", "eligible physical exceptions / assessed exceptions", "seven checks including unknown/blocked outcomes"],
    ["First-time resolution and reopening", "first-attempt verified closes / attempts; reopened / closes", "case identity and follow-up window"],
    ["Approval wait and handoffs", "seconds waiting; responsible-party changes", "single-action decision records"],
    ["SLA compliance", "verified within deadline / eligible exceptions", "deadline, pauses policy and proof timestamp"],
    ["AI usage per exception", "measured tokens and provider calls / handled exceptions", "provider usage; current local planner makes zero model calls"]
  ]
};
