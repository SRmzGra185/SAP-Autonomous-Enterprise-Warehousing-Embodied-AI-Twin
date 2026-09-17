import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultModel } from "../src/domain.mjs";
import { robotScenarios, robotScenarioById, composeRobotTwin, runRobotRoutine } from "../src/robotics.mjs";
import { defaultCaseContext, validateCaseContext } from "../src/routine-context.mjs";
import { proposeResource } from "../src/resource-selection.mjs";
import { experimentTemplate, validateExperimentProfile } from "../src/industrial-timing.mjs";
const scenario = robotScenarioById("autonomous-orchestration");
test("Only orchestration is a twelve-stage full circle; other case identities stay", () => {
  assert.deepEqual(robotScenarios.map(s => s.id), ["autonomous-inspection","adaptive-assembly","autonomous-orchestration","warehouse-fulfillment"]);
  assert.equal(scenario.grafcet.steps.length,12);
  assert.equal(robotScenarioById("autonomous-inspection").grafcet.steps.length,7);
  assert.deepEqual([...new Set(scenario.grafcet.steps.map(s=>s.domainWorkspace))],["asset-management","manufacturing","orchestration"]);
  assert.ok(scenario.grafcet.steps.every(s=>s.actor));
});
test("Joule coordinates three domains; all composed references resolve", () => {
  const model=composeRobotTwin(defaultModel,defaultModel,scenario), ids=new Set(model.nodes.map(n=>n.id));
  assert.equal(model.nodes.find(n=>n.id==="joule").visual,"joule");
  assert.equal(model.relationships.filter(r=>r.from==="joule").length,3);
  assert.ok(model.executionRoute.every(id=>ids.has(id)));
  assert.ok(model.edges.every(e=>e.every(id=>ids.has(id))));
  assert.ok(model.nodes.some(n=>n.visual==="unitree"));
  assert.ok(model.nodes.some(n=>n.visual==="cobotCell" && n.name.includes("UR5")));
});
test("Case context rejects command fragments, unknown fields and invalid identifiers", () => {
  for(const value of [{sku:"x&del"}, {rfidEpc:"not-rfid"}, {quantity:0}, {destination:"../x"}, {rackState:"resolved"}, {url:"https://example.com"}])
    assert.throws(()=>validateCaseContext(value), e=>e.status===400);
  assert.equal(validateCaseContext({rfidEpc:"aabbccdd"}).rfidEpc,"AABBCCDD");
});
test("Full circle produces 12 actions and three reviewed synthetic proposals, never live commands",async()=>{
  const events=[], approvals=[];
  const result=await runRobotRoutine(scenario,{mode:"assisted",cycles:1,speed:100000,caseContext:defaultCaseContext},e=>events.push(e),{requestApproval:async a=>approvals.push(a)});
  assert.equal(approvals.length,12); assert.equal(result.stepsExecuted,12);
  assert.equal(result.resourceProposals.length,3);
  assert.equal(result.resolutionStatus,"awaiting_evidence");
  assert.equal(result.productionCommands,false);
  assert.ok(approvals.every(a=>a.caseContext.sku===defaultCaseContext.sku && a.intendedActor));
  assert.ok(events.filter(e=>e.type==="robot_command").every(e=>e.dispatched===false));
  assert.equal(result.resourceProposals[2].selected.id,"route-a");
});
for(const rackState of ["empty","blocked","replenishment_delayed"]) test(rackState+" halts before warehouse dispatch", async()=>{
  const events=[];
  await assert.rejects(runRobotRoutine(scenario,{mode:"simulation",cycles:1,speed:100000,caseContext:{...defaultCaseContext,rackState}},e=>events.push(e)),/Shelf/);
  assert.ok(events.some(e=>e.type==="shelf_exception"));
  assert.ok(!events.some(e=>e.type==="robot_command" && e.command==="logistics.propose_dispatch()"));
  assert.ok(!events.some(e=>e.type==="robot_routine_complete"));
});
test("Resource ranking excludes unsafe/unavailable and fails closed with no candidate",()=>{
  const base={id:"a",name:"demo",estimatedSeconds:30,available:true,authorized:true,safetyReviewed:true,capable:true};
  assert.equal(proposeResource("test",[{...base,available:false}]).selected,null);
  const p=proposeResource("test",[{...base,id:"fast",estimatedSeconds:1,safetyReviewed:false},base]);
  assert.equal(p.selected.id,"a"); assert.deepEqual(p.excluded,["fast"]);
});
test("Per-case governance and time assumptions are explicit, not certification/telemetry",()=>{
  for(const s of robotScenarios) { assert.match(s.governance.status,/not certified/); assert.equal(s.governance.liveCommands,false); assert.ok(s.governance.standards.length>=5); }
  const m=composeRobotTwin(defaultModel,defaultModel,scenario), p=validateExperimentProfile(experimentTemplate(m),m);
  assert.equal(p.source,"demo"); assert.match(p.sourceReference,/UNVALIDATED/);
  assert.equal(p.nodes.find(n=>n.nodeId==="orch-cell").processSeconds.mode,60);
  assert.equal(p.performanceData.runtimeSeconds,undefined);
});
