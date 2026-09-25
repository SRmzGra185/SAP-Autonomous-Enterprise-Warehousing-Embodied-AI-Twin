// Optional isolated UI regression: requires Playwright and a local Chromium/Edge installation.
// Never connects to or edits the user's running tenant at :4173.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const origin = "http://127.0.0.1:4301";
const server = spawn(process.execPath,[...process.execArgv,"server.mjs"],{
  cwd:new URL("..",import.meta.url),stdio:["ignore","pipe","pipe"],
  env:{...process.env,HOST:"127.0.0.1",PORT:"4301",AUTH_MODE:"desktop",NODE_ENV:"development",DESKTOP_ROLE:"admin",APP_ORIGINS:origin,RATE_LIMIT_MAX:"5000",OPENAI_ENABLED:"false"}
});
let log="", browser;
server.stdout.on("data",c=>log+=c);server.stderr.on("data",c=>log+=c);
const readModel=async()=>{const r=await fetch(origin+"/api/model",{headers:{Origin:origin}});assert.equal(r.status,200);return r.json();};
async function until(fn,timeout=20000) { const end=Date.now()+timeout;do{const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,100));}while(Date.now()<end);throw new Error("Condition timed out. "+log); }
const evidence=new URL("../test-evidence/",import.meta.url);await mkdir(evidence,{recursive:true});
try {
  await until(async()=>{try{return (await fetch(origin+"/api/health")).ok;}catch{return false;}},7000);
  browser=await chromium.launch({channel:process.env.TEST_BROWSER_CHANNEL || "msedge",headless:true,args:["--use-angle=swiftshader","--enable-unsafe-swiftshader"]});
  const page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1,serviceWorkers:"block"});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(origin);await page.locator('[data-tool="robot-unitreeHumanoid"]').waitFor({state:"attached"});
  const original=await readModel();
  await page.locator("#palette-search").fill("H1");
  await page.locator('[data-tool="robot-unitreeHumanoid"]').click();
  await page.locator('#interior-dive [data-robot-model="preview"]').selectOption("unitree");
  assert.equal((await readModel()).nodes.length,original.nodes.length,"Preview must not add a robot");
  await page.locator('#interior-dive [data-robot-model="preview"]').selectOption("unitreeHumanoid");
  await page.locator("#interior-canvas").scrollIntoViewIfNeeded();
  await page.screenshot({path:fileURLToPath(new URL("unitree-humanoid.png",evidence))});
  await page.locator("#interior-place").click();
  const placed=await until(async()=>{const m=await readModel();return m.nodes.length===original.nodes.length+1&&m;});
  const robot=placed.nodes.find(n=>!original.nodes.some(old=>old.id===n.id));assert.equal(robot.visual,"unitreeHumanoid");
  await page.locator("#interior-close").click();
  await page.locator('#inspector-content [data-robot-model]').selectOption("unitree");
  await until(async()=>(await readModel()).nodes.find(n=>n.id===robot.id).visual==="unitree");
  await page.locator('#editor-history [data-command="undo"]').click();
  await until(async()=>(await readModel()).nodes.find(n=>n.id===robot.id).visual==="unitreeHumanoid");
  await page.locator('#editor-history [data-command="redo"]').click();
  await until(async()=>(await readModel()).nodes.find(n=>n.id===robot.id).visual==="unitree");
  await page.locator('[data-view="2d"]').click();
  await page.locator('.node-group[data-id="'+robot.id+'"]').dblclick();
  await page.locator('#interior-dive [data-robot-model]').selectOption("unitreeHumanoid");
  await until(async()=>(await readModel()).nodes.find(n=>n.id===robot.id).visual==="unitreeHumanoid");
  await page.locator('#interior-dive [data-robot-model]').selectOption("unitree");
  await page.locator("#interior-canvas").scrollIntoViewIfNeeded();
  await page.screenshot({path:fileURLToPath(new URL("unitree-quadruped.png",evidence))});
  await page.locator("#interior-close").click();
  const switched=(await readModel()).nodes.find(n=>n.id===robot.id);
  for(const key of ["x","y","z","capacity","service","protocols"]) assert.deepEqual(switched[key],robot[key],key+" preserved");
  await page.locator('[data-view="3d"]').click();
  await page.locator('#mesh-labels .mesh-label').filter({hasText:"SAP BDC Connect"}).waitFor({state:"visible"});
  const label=page.locator('#mesh-labels .mesh-label').filter({hasText:"SAP BDC Connect"});
  await label.scrollIntoViewIfNeeded();const rect=await label.boundingBox(), beforeDrag=await readModel();
  await page.mouse.move(rect.x+15,rect.y+12);await page.mouse.down();await page.mouse.move(rect.x+80,rect.y+35,{steps:12});await page.mouse.up();
  await until(async()=>{const a=(await readModel()).nodes.find(n=>n.id==="connect"),b=beforeDrag.nodes.find(n=>n.id==="connect");return a.x!==b.x||a.y!==b.y;});
  await page.locator('#editor-history [data-command="undo"]').click();
  await until(async()=>(await readModel()).nodes.find(n=>n.id==="connect").x===beforeDrag.nodes.find(n=>n.id==="connect").x);
  await page.locator('[data-view="2d"]').click();
  await page.locator('.node-group[data-id="connect"]').click();
  await page.locator('#ribbon-tools [data-capacity-input]').fill("4");
  await page.locator('#ribbon-tools [data-capacity-input]').press("Tab");
  await until(async()=>(await readModel()).nodes.find(n=>n.id==="connect").capacity===4);
  await page.locator('#ribbon-tools [data-editor-tool="trail"]').click();
  await page.locator('.node-group[data-id="connect"]').click();
  await page.locator('.node-group[data-id="approval"]').click();
  await until(async()=>(await readModel()).edges.some(e=>e[0]==="connect"&&e[1]==="approval"));
  assert.equal(await page.locator("#toast").evaluate(el=>getComputedStyle(el).color),"rgb(255, 255, 255)");
  await page.locator('[data-ribbon="simulate"]').click();
  assert.equal(await page.locator('#ribbon-tools [data-editor-tool="select"]').count(),0);
  await page.locator("#entity-count").fill("8");
  for(const command of ["run","realtime","monte"]) {
    const response=page.waitForResponse(r=>r.url().endsWith("/api/simulations")&&r.request().method()==="POST");
    await page.locator('#ribbon-tools [data-command="'+command+'"]').click();assert.equal((await response).status(),202);
    await until(async()=>await page.locator("#model-status").textContent()==="Experiment complete",45000);
    await until(async()=>await page.locator("#run-simulation").isEnabled());
  }
  await page.locator('#ribbon-tools [data-command="rewind"]').click();assert.match(await page.locator("#clock-label").textContent(),/0.00/);
  await page.locator('#editor-history [data-command="save"]').click();
  await until(async()=>(await page.locator("#toast").textContent()).includes("snapshot saved"));
  const experiment=page.locator("#industrial-experiments"), savedBefore=await readModel();
  await experiment.locator('[data-action="template"]').click();
  await until(async()=>(await experiment.locator('[data-output="status"]').textContent()).includes("template loaded"));
  await experiment.locator('[data-input="capacity"]').fill("3");
  await experiment.locator('[data-input="entities"]').fill("8");
  await experiment.locator('[data-input="runs"]').fill("3");
  await experiment.locator('[data-action="run"]').click();
  await experiment.locator(".ix-comparison").waitFor({state:"visible",timeout:45000});
  assert.equal(await experiment.locator(".ix-summary-grid").count(),2);
  assert.equal(await experiment.locator(".ix-details[open]").count(),0);
  assert.deepEqual(await readModel(),savedBefore,"Candidate capacity must not mutate the sandbox");
  await experiment.screenshot({path:fileURLToPath(new URL("timing-executive-summary.png",evidence))});
  await page.reload();await page.locator('[data-tool="robot-unitreeHumanoid"]').waitFor({state:"attached"});
  assert.equal((await readModel()).nodes.find(n=>n.id===robot.id).visual,"unitree");
  assert.deepEqual(errors,[]);
  console.log("PASS browser: palette, 3D variants, preview isolation, persistence, object menu, select/drag, capacity, trails, Undo/Redo, white toast, all Simulate actions, paired executive experiment.");
} finally { if(browser)await browser.close();server.kill(); }
