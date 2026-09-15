import assert from "node:assert/strict";
import { test } from "node:test";
import { experimentRoute, experimentTemplate, validateExperimentProfile, calculateObservedKpis } from "../src/industrial-timing.mjs";
import { runSimulation } from "../src/engine.mjs";

const model = (count = 1) => ({ executionRoute: Array.from({length:count},(_,i) => `n${i}`), nodes: Array.from({length:count},(_,i) => ({id:`n${i}`,capacity:1,service:2})) });
const fixed = (m = model()) => { const p = experimentTemplate(m); p.arrivalGapSeconds = 1; p.nodes.forEach(n => { n.processSeconds = {type:"fixed",value:10}; }); return p; };
const run = (experiment, options = {}, m = model()) => runSimulation(m,{entities:2,detail:false,experiment,...options});
test("template is synthetic, normalized, independent, and has no observed numbers", () => {
  const m = model(2), p = experimentTemplate(m), normalized = validateExperimentProfile(p,m);
  assert.equal(p.source,"demo"); assert.equal(p.unit,"seconds"); assert.equal(p.performanceData.totalCount,null);
  assert.equal(calculateObservedKpis(normalized.performanceData).oee,null);
  normalized.nodes[0].processSeconds.min = 99; assert.equal(p.nodes[0].processSeconds.min,1);
});
test("profile rejects invalid units, provenance, nodes, numbers, samples and overrides", () => {
  const mutations = [p=>p.unit="minutes",p=>p.source="verified",p=>{p.source="observed";delete p.sourceReference;},p=>p.entityUnit="",p=>delete p.setupOncePerResource,p=>p.arrivalGapSeconds=0,p=>p.arrivalGapSeconds=NaN,p=>p.nodes[0].nodeId="wrong",p=>p.nodes.push(p.nodes[0]),p=>p.nodes[0].processSeconds.value=0,p=>p.nodes[0].processSeconds.value=-1,p=>p.nodes[0].processSeconds.value=Infinity,p=>p.nodes[0].processSeconds.value="10",p=>p.nodes[0].handlingSeconds=-1,p=>p.nodes[0].capacity=33,p=>p.nodes[0].capacity=0,p=>p.nodes[0].capacity=1.5,p=>p.nodes[0].queueSeconds=3,p=>p.nodes[0].processSeconds={type:"triangular",min:3,mode:2,max:4},p=>p.nodes[0].processSeconds={type:"empirical",samples:[]},p=>p.nodes[0].processSeconds={type:"empirical",samples:[0]},p=>p.nodes[0].processSeconds={type:"empirical",samples:Array(1001).fill(1)}];
  for (const mutate of mutations) { const p = fixed(); mutate(p); assert.throws(()=>validateExperimentProfile(p,model()),e=>e.status===400 && e.code==="validation_error"); }
  const m = model(11), p = fixed(m); p.nodes.forEach(n=>n.processSeconds={type:"empirical",samples:Array(1000).fill(1)}); assert.throws(()=>validateExperimentProfile(p,m),/10000/);
  p.nodes.pop(); m.nodes.pop(); m.executionRoute.pop(); assert.equal(validateExperimentProfile(p,m).nodes.length,10);
});
test("fixed fixture: seconds, queue, throughput and utilization without added queue inputs", async () => {
  const s = await run(fixed()); assert.equal(s.completed,2); assert.equal(s.horizon,20); assert.equal(s.averageCycle,14.5); assert.equal(s.queuedSeconds,9); assert.equal(s.throughputPerHour,360); assert.equal(s.utilization.n0,1); assert.equal(s.p95Cycle,19); assert.equal(s.replicationMeanCycleSeconds.ci95.lower,null);
  assert.equal(s.audit.checks,0); assert.equal(s.audit.resolutionVerified,false);
});
test("setup is once per used resource or explicitly per entity; other segments per entity", async () => {
  const p = fixed(); p.nodes[0].setupSeconds=5;
  let s = await run(p); assert.equal(s.horizon,25); assert.equal(s.nodeMetrics.n0.setupApplications,1);
  p.setupOncePerResource=false; s=await run(p); assert.equal(s.horizon,30); assert.equal(s.nodeMetrics.n0.setupApplications,2);
  p.setupOncePerResource=true; p.nodes[0].capacity=2; s=await run(p); assert.equal(s.horizon,16); assert.equal(s.queuedSeconds,0); assert.equal(s.nodeMetrics.n0.setupApplications,2);
  p.nodes[0].handlingSeconds=1;p.nodes[0].travelSeconds=2;p.nodes[0].approvalSeconds=3;s=await run(p);assert.equal(s.horizon,22);
});
test("200 reproducible replications, paired capacity sensitivity, correct populations", async () => {
  const p=experimentTemplate(model()); p.nodes[0].processSeconds={type:"empirical",samples:[2,7,12]};
  const opts={mode:"monte-carlo",runs:200,seed:0,entities:8}; const a=await run(p,opts), b=await run(p,opts);
  assert.deepEqual(a,b); assert.equal(a.runs,200); assert.equal(a.replications.length,200); assert.equal(a.replications[0].seed,0); assert.equal(a.replications[1].seed,9973);
  const means=a.replications.map(r=>r.averageCycle).sort((a,b)=>a-b);
  assert.equal(a.replicationMeanCycleSeconds.p95,means[189]); assert.equal(a.replicationMeanCycleSeconds.p50,means[99]); assert.ok(a.replicationMeanCycleSeconds.ci95.lower<=a.averageCycle); assert.ok(a.replicationMeanCycleSeconds.ci95.upper>=a.averageCycle);
  p.nodes[0].capacity=32; const candidate=await run(p,opts); assert.ok(candidate.averageCycle<a.averageCycle); assert.equal(candidate.queuedSeconds,0); assert.deepEqual(candidate.replications.map(r=>r.seed),a.replications.map(r=>r.seed));
  for (const runs of [0,201,2.5,NaN,"5"]) await assert.rejects(()=>run(p,{mode:"monte-carlo",runs}));
  for (const entities of [0,81,1.2]) await assert.rejects(()=>run(p,{entities}));
});
test("maximum 250-node route completes all 80 entities past old event cap", async () => {
  const m=model(250), p=fixed(m), s=await run(p,{entities:80},m);
  assert.equal(s.completed,80);assert.equal(s.processedEvents,20080);assert.equal(Object.keys(s.utilization).length,250);
});
test("default node.service is DEMO seconds and asynchronous event contract stays intact", async () => {
  const events=[];const s=await runSimulation(model(),{entities:2,seed:0},async e=>events.push(e));
  assert.equal(s.timing.source,"demo");assert.equal(s.timeUnit,"seconds");assert.ok(s.timing.warnings[0].includes("node.service is DEMO seconds"));
  for(const type of ["arrival","service_start","service_complete","entity_complete","simulation_complete"]) assert.ok(events.some(e=>e.type===type));
  assert.ok(events.find(e=>e.type==="service_start").snapshot);assert.equal(events.at(-1).summary,s);
});
test("A → B → A retains three visits with one shared A resource pool", async () => {
  const m=model(2);m.executionRoute=["n0","n1","n0"];
  assert.deepEqual(experimentRoute(m),m.executionRoute);
  const p=fixed(m);assert.equal(p.nodes.length,2);p.nodes[1].processSeconds.value=1;
  const events=[];const s=await runSimulation(m,{experiment:p,entities:2},async e=>events.push(e));
  const services=events.filter(e=>e.type==="service_complete");assert.equal(services.length,6);
  for(const id of ["order-001","order-002"])assert.deepEqual(services.filter(e=>e.entityId===id).map(e=>e.routeIndex),[0,1,2]);
  assert.equal(s.completed,2);assert.equal(s.nodeMetrics.n0.busySeconds,40);assert.equal(s.horizon,40);assert.equal(s.nodeMetrics.n0.queuedSeconds,27);
  assert.equal(s.timing.nodeCount,2);assert.equal(s.timing.routeVisitCount,3);
  p.nodes[0].setupSeconds=5;const setup=await run(p,{},m);assert.equal(setup.nodeMetrics.n0.setupApplications,1);
});
test("event loop yields within a long replication and between short replications", async () => {
  let flushed=false;setImmediate(()=>{flushed=true;});let observed=false;
  await runSimulation(model(3),{entities:80},async e=>{if(e.type==="service_complete" && flushed)observed=true;});assert.equal(observed,true);
  let tick=false;setImmediate(()=>{tick=true;});let second=false;
  await runSimulation(model(),{entities:1,mode:"monte-carlo",runs:2,detail:false},async e=>{if(e.type==="monte_carlo_run" && e.run===2)second=tick;});assert.equal(second,true);
});
test("observed KPIs: exact A/P/Q, explicit denominators and no invented observations", () => {
  const m={assetDomain:"manufacturing",singleSKU:true,plannedProductionSeconds:100,runtimeSeconds:80,idealCycleSeconds:2,totalCount:30,goodCount:27,operatingSeconds:1000,failures:2,repairSeconds:90,repairs:3};
  const k=calculateObservedKpis(m); assert.equal(k.availability,.8);assert.equal(k.performance,.75);assert.equal(k.quality,.9);assert.ok(Math.abs(k.oee-.54)<1e-12);assert.equal(k.mtbfSeconds,500);assert.equal(k.mttrSeconds,30);assert.equal(k.verified,false);
  assert.equal(calculateObservedKpis().oee,null);assert.equal(calculateObservedKpis({...m,mixedSKU:true}).performance,null);
  assert.equal(calculateObservedKpis({...m,assetDomain:"logistics"}).mtbfSeconds,null);assert.equal(calculateObservedKpis({...m,assetDomain:"asset-management"}).oee,null);
  assert.equal(calculateObservedKpis({...m,failures:0,repairs:0}).mtbfSeconds,null);assert.equal(calculateObservedKpis({...m,failures:0,repairs:0}).mttrSeconds,null);
  const over=calculateObservedKpis({...m,idealCycleSeconds:4});assert.equal(over.performance,1.5);assert.ok(over.warnings.some(w=>w.includes("NOT been clamped")));
  assert.equal(calculateObservedKpis({...m,runtimeSeconds:0}).performance,null);
  for(const bad of [{goodCount:31},{runtimeSeconds:101},{failures:-1},{repairs:NaN},{totalCount:2.1}])assert.throws(()=>calculateObservedKpis({...m,...bad}));
});
