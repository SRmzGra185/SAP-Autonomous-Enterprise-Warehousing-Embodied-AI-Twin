import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { rememberEdit,travelHistory,moveObject,setObjectCapacity,addTrail,buildObjectCatalog,screenToGround } from "../public/editor-core.js";
import { robotScenarios,composeRobotTwin } from "../src/robotics.mjs";
import { defaultModel } from "../src/domain.mjs";
import { validateModelInput } from "../validation.mjs";
import { UNITREE_CATALOG, setRobotRepresentation, isUnitree } from "../public/robot-models.js";
import { timingAssumption } from "../src/timing-assumptions.mjs";
const fixture=()=>({nodes:[{id:"a",x:0,y:0,z:0,capacity:1},{id:"b",x:100,y:100,z:0,capacity:2}],edges:[]});
const state=()=>({model:fixture(),history:[],future:[],selectedId:"a"});
test("Movement, trails, and capacity share complete undo/redo snapshots",()=>{
  const s=state(), initial=structuredClone(s.model);
  for(const edit of [()=>moveObject(s.model,"a",320,410),()=>addTrail(s.model,"a","b"),()=>setObjectCapacity(s.model,"a",4)]) {
    const before=structuredClone(s.model);edit();assert.equal(rememberEdit(s,before),true);
  }
  const end=structuredClone(s.model);assert.equal(s.history.length,3);
  for(let i=0;i<3;i++) assert.equal(travelHistory(s,"undo"),true);
  assert.deepEqual(s.model,initial); assert.equal(travelHistory(s,"undo"),false);
  for(let i=0;i<3;i++) assert.equal(travelHistory(s,"redo"),true);
  assert.deepEqual(s.model,end); assert.equal(travelHistory(s,"redo"),false);
});
test("No-op clicks do not fill history; new edits discard redo; bounded history",()=>{
  const s=state();assert.equal(rememberEdit(s,structuredClone(s.model)),false);
  for(let i=1;i<=105;i++){const before=structuredClone(s.model);moveObject(s.model,"a",i,0);rememberEdit(s,before);}
  assert.equal(s.history.length,100);travelHistory(s,"undo");
  const before=structuredClone(s.model);setObjectCapacity(s.model,"a",2);rememberEdit(s,before);assert.equal(s.future.length,0);
});
test("Trail validation excludes self, missing and duplicate links; routing stays explicit",()=>{
  const m=fixture(); m.executionRoute=["a","b"];addTrail(m,"a","b");
  assert.deepEqual(m.executionRoute,["a","b"]);
  for(const edge of [["a","a"],["x","b"],["a","b"]]) assert.throws(()=>addTrail(m,...edge));
  addTrail(m,"b","a");assert.equal(m.edges.length,2);
});
test("Positions stay on the model plane; capacity rejects out-of-range/fractional values",()=>{
  const m=fixture();moveObject(m,"a",-9999,9999);assert.deepEqual([m.nodes[0].x,m.nodes[0].y,m.nodes[0].z],[-1000,2000,0]);
  assert.equal(moveObject(m,"a",NaN,0),false);
  for(const value of [0,33,1.2,"x",Infinity]) assert.throws(()=>setObjectCapacity(m,"a",value));
  setObjectCapacity(m,"a","3");assert.equal(m.nodes[0].capacity,3);
});
test("Ground ray correctly follows perspective, independent of screen scaling",()=>{
  const center=screenToGround({x:400,y:300,width:800,height:600,eye:[0,10,10],target:[0,0,0]});
  assert.ok(Math.abs(center[0])<1e-9 && Math.abs(center[1])<1e-9 && Math.abs(center[2])<1e-9);
  const left=screenToGround({x:300,y:300,width:800,height:600,eye:[0,10,10],target:[0,0,0]});
  const scaled=screenToGround({x:600,y:600,width:1600,height:1200,eye:[0,10,10],target:[0,0,0]});
  assert.ok(left[0]<0);assert.deepEqual(left,scaled);
  assert.equal(screenToGround({x:1,y:1,width:0,height:3,eye:[0,1,1],target:[0,0,0]}),null);
  assert.equal(screenToGround({x:400,y:0,width:800,height:600,eye:[0,1,10],target:[0,1,0]}),null);
});
test("Palette covers EVERY object across all cases and additions pass backend validation",()=>{
  const c=buildObjectCatalog({},robotScenarios);
  assert.equal(Object.keys(c).length,robotScenarios.reduce((n,s)=>n+s.model.nodes.length,0)+2);
  for(const [index,template] of Object.values(c).entries()){
    const m=composeRobotTwin(defaultModel,defaultModel,robotScenarios[0]);
    m.nodes.push({...template,id:"custom-"+index});assert.doesNotThrow(()=>validateModelInput(m));
    assert.equal(template.layer,"custom");assert.ok(template.templateNodeId || template.catalogGroup==="Robots · Unitree");assert.equal(template.tenantId,undefined);
  }
});
test("Unitree model swap preserves role, timing, capacity, identity and links; undo/redo restores it",()=>{
  const m=composeRobotTwin(defaultModel,defaultModel,robotScenarios[0]), robot=m.nodes.find(isUnitree);
  assert.ok(robot);const before=structuredClone(m), timing=timingAssumption(robot);
  const s={model:m,selectedId:robot.id,history:[],future:[]};
  assert.equal(setRobotRepresentation(m,robot.id,"unitreeHumanoid"),true);
  assert.equal(rememberEdit(s,before),true);
  const expected=structuredClone(before);expected.nodes.find(n=>n.id===robot.id).visual="unitreeHumanoid";
  assert.deepEqual(m,expected);assert.deepEqual(timingAssumption(robot),timing);
  assert.doesNotThrow(()=>validateModelInput(m));
  const composed=composeRobotTwin(m,defaultModel,robotScenarios[0]);
  assert.equal(composed.nodes.find(n=>n.id===robot.id).visual,"unitreeHumanoid");
  travelHistory(s,"undo");assert.deepEqual(s.model,before);
  travelHistory(s,"redo");assert.deepEqual(s.model,expected);
  assert.equal(setRobotRepresentation(s.model,robot.id,"unitreeHumanoid"),false);
  assert.throws(()=>setRobotRepresentation(s.model,robot.id,"arm"));
  assert.throws(()=>setRobotRepresentation(s.model,"connect","unitreeHumanoid"));
});
test("Palette contains both Unitree forms; generic names follow the representation, scenario roles do not",()=>{
  const palette=buildObjectCatalog({},[]);assert.deepEqual(Object.keys(palette).sort(),Object.keys(UNITREE_CATALOG).sort());
  const n={...palette["robot-unitreeHumanoid"],id:"new-robot"};
  setRobotRepresentation({nodes:[n]},n.id,"unitree");
  assert.equal(n.name,"Unitree quadruped");assert.equal(n.visual,"unitree");
  assert.equal(n.protocols[0],"Simulation");
});
test("Model and Simulate expose intended commands; toasts explicitly white",async()=>{
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8"),css=await readFile(new URL("../public/editor-ui.css",import.meta.url),"utf8");
  assert.match(app,/model: \[\["select".*"Trail"\]\]/);
  const simulation=app.split("simulate: ")[1].split("\n")[0];assert.ok(!simulation.includes("select"));
  for(const command of ["run","realtime","monte","rewind","save"]) assert.ok(simulation.includes('"'+command+'"'));
  assert.match(css,/#toast\.toast[^}]*color:#fff!important/);
});
