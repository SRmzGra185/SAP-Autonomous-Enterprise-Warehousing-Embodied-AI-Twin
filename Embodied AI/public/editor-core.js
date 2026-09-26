import { UNITREE_CATALOG } from "./robot-models.js";
export const EDIT_LIMITS = Object.freeze({ capacity: 32, min: -1000, max: 2000, history: 100 });
export function rememberEdit(state, before) {
  if (!before || JSON.stringify(before) === JSON.stringify(state.model)) return false;
  state.history.push(structuredClone(before));
  if (state.history.length > EDIT_LIMITS.history) state.history.shift();
  state.future = [];
  return true;
}
export function travelHistory(state, direction) {
  const source = direction === "undo" ? state.history : state.future;
  if (!source.length) return false;
  const destination = direction === "undo" ? state.future : state.history;
  destination.push(structuredClone(state.model));
  state.model = source.pop();
  if (!state.model.nodes.some(n => n.id === state.selectedId)) state.selectedId = null;
  return true;
}
export function moveObject(model, id, x, y) {
  const node = model.nodes.find(n => n.id === id);
  if (!node || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  node.x = Math.round(Math.max(EDIT_LIMITS.min, Math.min(EDIT_LIMITS.max, x)) * 10) / 10;
  node.y = Math.round(Math.max(EDIT_LIMITS.min, Math.min(EDIT_LIMITS.max, y)) * 10) / 10;
  return true;
}
export function setObjectCapacity(model, id, value) {
  const n = Number(value), node = model.nodes.find(item => item.id === id);
  if (!node || !Number.isInteger(n) || n < 1 || n > EDIT_LIMITS.capacity) throw new Error("Capacity must be a whole number from 1 to 32.");
  node.capacity = n;
}
export function addTrail(model, from, to) {
  if (from === to) throw new Error("Choose a different destination object.");
  if (![from,to].every(id => model.nodes.some(n => n.id === id))) throw new Error("Trail endpoint is missing.");
  if (model.edges.some(e => e[0] === from && e[1] === to)) throw new Error("This directed trail already exists.");
  if (model.edges.length >= 750) throw new Error("The model supports at most 750 trails.");
  model.edges.push([from,to]);
}
export function buildObjectCatalog(base, scenarios) {
  const catalog = Object.fromEntries(Object.entries({...base,...UNITREE_CATALOG}).map(([key,value]) => [key,{...value, catalogGroup:value.catalogGroup || "Operations"}]));
  for (const scenario of scenarios) for (const node of scenario.model.nodes) {
    const key = "asset-" + scenario.id + "-" + node.id;
    const { id, tenantId, ownerId, parentId, ...template } = node;
    catalog[key] = { ...structuredClone(template), workspace:"physical", layer:"custom", zone:"operations", catalogGroup:scenario.domain + " · " + scenario.name, catalogScenarioId:scenario.id, templateNodeId:id };
  }
  return catalog;
}
// Intersect a perspective camera ray with the floor (Y=0). No screen-plane shortcut.
export function screenToGround({x,y,width,height,eye,target,fov=.82}) {
  if (!(width > 0 && height > 0) || ![x,y,...eye,...target].every(Number.isFinite)) return null;
  const norm = v => { const len=Math.hypot(...v); return len > 1e-9 ? v.map(n=>n/len) : [0,0,0]; };
  const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const forward=norm(target.map((n,i)=>n-eye[i])),right=norm(cross(forward,[0,1,0])),up=cross(right,forward);
  const px=(2*x/width-1)*Math.tan(fov/2)*width/height, py=(1-2*y/height)*Math.tan(fov/2);
  const direction=forward.map((n,i)=>n+right[i]*px+up[i]*py);
  if (direction[1]>=-1e-7) return null;
  const distance=-eye[1]/direction[1];
  if (distance<0) return null;
  return eye.map((n,i)=>n+distance*direction[i]);
}
