import { MATERIAL, meshFor, part, axesFor, beam, transformParts, objectParts, articulationParts, isArticulated, payloadParts, amrParts } from './mesh-assets.js';
import { screenToGround } from './editor-core.js';

const TAU = Math.PI * 2;

const PALETTES = {
  warehouse: { base: "#31506a", trim: "#9db8c7", glass: "#a6d7e7", accent: "#2f80ed", metal: "#5f7685", dark: "#1e3142" },
  tower: { base: "#40566a", trim: "#d1a05b", glass: "#a8c9d7", accent: "#e3ad58", metal: "#667b89", dark: "#263847" },
  reactor: { base: "#1e5a63", trim: "#8ed4c8", glass: "#b5e7df", accent: "#23a892", metal: "#47747b", dark: "#163f49" },
  silo: { base: "#536774", trim: "#d0ae69", glass: "#b8d3dc", accent: "#c7893e", metal: "#718592", dark: "#344954" },
  crate: { base: "#66589c", trim: "#c9bef1", glass: "#d9d3ff", accent: "#8b78e4", metal: "#7669aa", dark: "#403762" },
  pavilion: { base: "#1e6d64", trim: "#91d7ca", glass: "#c8f0e8", accent: "#25b39d", metal: "#4e8e88", dark: "#164b47" },
  robot: { base: "#324c68", trim: "#c0dce7", glass: "#e1f6ff", accent: "#45b5a3", metal: "#607a8d", dark: "#1e3043" },
  gate: { base: "#814b5b", trim: "#f0c768", glass: "#ffdca6", accent: "#e25575", metal: "#95626e", dark: "#542f3e" },
  posTerminal: { base: "#365a72", trim: "#b9d5df", glass: "#bcebf2", accent: "#40b8b0", metal: "#647c8a", dark: "#21394a" },
  retailShelf: { base: "#8a6a43", trim: "#e2c38e", glass: "#c8e9e7", accent: "#e29545", metal: "#7b8790", dark: "#4a3b2d" },
  rack: { base: "#526b79", trim: "#c7d4da", glass: "#cce9ed", accent: "#e19a4d", metal: "#6f8088", dark: "#2c414b" },
  mobileManipulator: { base: "#2d6f68", trim: "#c5e2da", glass: "#d8f7f0", accent: "#4dd1b8", metal: "#637d82", dark: "#193f42" },
  safetyZone: { base: "#98613c", trim: "#f0ca79", glass: "#ffe3aa", accent: "#ec7b45", metal: "#866e5d", dark: "#543728" },
  sensorMast: { base: "#6d5889", trim: "#d8cced", glass: "#e8ddff", accent: "#9c7bea", metal: "#766f87", dark: "#3d3152" },
  amr: { base: "#2c6972", trim: "#c4e0e4", glass: "#d7f4f5", accent: "#41c5b6", metal: "#617a82", dark: "#193d45" },
  cobotCell: { base: "#445e74", trim: "#d3dee6", glass: "#d9f2f5", accent: "#4ab7a8", metal: "#72828d", dark: "#253846" },
  conveyor: { base: "#6b6454", trim: "#dbc68f", glass: "#d8ebec", accent: "#e5a64d", metal: "#7c8589", dark: "#3d3a32" },
  inspectionCell: { base: "#76546b", trim: "#e4c8d9", glass: "#f0ddec", accent: "#d46f9f", metal: "#817482", dark: "#482f42" },
  loadingDock: { base: "#3b6b64", trim: "#c1ddd7", glass: "#d8f0ed", accent: "#46bba4", metal: "#627c78", dark: "#22433f" },
  partsFeeder: { base: "#716653", trim: "#dfc994", glass: "#e6f1ec", accent: "#e5a64d", metal: "#7c8589", dark: "#403a30" },
  assemblyFixture: { base: "#635a76", trim: "#d7cde5", glass: "#e8e1f2", accent: "#9177c7", metal: "#777682", dark: "#393344" },
  torqueStation: { base: "#806644", trim: "#e6ce9d", glass: "#f3e5c8", accent: "#e3a550", metal: "#837a69", dark: "#493a27" },
  robotDock: { base: "#536b73", trim: "#ccdadd", glass: "#dff2f3", accent: "#4bc3b0", metal: "#6e7e83", dark: "#304047" },
  quadruped: { base: "#386961", trim: "#c6dfd8", glass: "#def3ed", accent: "#4bc9ad", metal: "#687c7a", dark: "#203e3b" },
  processMachine: { base: "#596573", trim: "#ced7de", glass: "#d7ebef", accent: "#55b9c5", metal: "#737f88", dark: "#303b47" }
};

// All coordinates, picking, roads and label anchors share [X, Y-up, Z].
const STRIDE = 11, FOV = .82, MAX_DISTANCE = 500;
const clamp = (v, low, high) => Math.max(low, Math.min(high, v));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const sub3 = (a, b) => a.map((v, i) => v - b[i]);
const dot3 = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm3 = (a) => { const n = Math.hypot(...a) || 1; return a.map((v) => v / n); };
const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const palette = (node) => PALETTES[node.visual] || PALETTES.crate;
function nodeWorld(node, deepDive = false) { return deepDive ? [0, 0, 0] : [(finite(node.x) - 530) / 105, 0, (finite(node.y) - 315) / 62]; }
function identity() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) out[col * 4 + row] = a[row] * b[col * 4] + a[4 + row] * b[col * 4 + 1] + a[8 + row] * b[col * 4 + 2] + a[12 + row] * b[col * 4 + 3];
  return out;
}
function perspective(aspect, far) {
  const f = 1 / Math.tan(FOV / 2), near = .05, out = new Float32Array(16);
  out[0] = f / aspect; out[5] = f; out[10] = (far + near) / (near - far); out[11] = -1; out[14] = 2 * far * near / (near - far);
  return out;
}
function lookAt(eye, target) {
  const forward = norm3(sub3(target, eye)), right = norm3(cross3(forward, [0, 1, 0])), up = cross3(right, forward), out = identity();
  out[0] = right[0]; out[1] = up[0]; out[2] = -forward[0]; out[4] = right[1]; out[5] = up[1]; out[6] = -forward[1];
  out[8] = right[2]; out[9] = up[2]; out[10] = -forward[2]; out[12] = -dot3(right, eye); out[13] = -dot3(up, eye); out[14] = dot3(forward, eye);
  return out;
}
const colors = new Map();
function rgb(value) {
  if (!colors.has(value)) {
    const text = /^#[0-9a-f]{6}$/i.test(value) ? value : '#698496', n = parseInt(text.slice(1), 16);
    colors.set(value, [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]);
  }
  return colors.get(value);
}
function boundsEmpty() { return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }; }
function includePoint(bounds, p) { for (let i = 0; i < 3; i++) { bounds.min[i] = Math.min(bounds.min[i], p[i]); bounds.max[i] = Math.max(bounds.max[i], p[i]); } }
function includeBounds(bounds, other) { includePoint(bounds, other.min); includePoint(bounds, other.max); }
function centerOf(bounds) { return lerp3(bounds.min, bounds.max, .5); }
function boundsForParts(parts) {
  const bounds = boundsEmpty();
  for (const item of parts) {
    const mesh = meshFor(item.shape), axes = axesFor(item);
    for (let i = 0; i < mesh.data.length; i += 6) {
      const p = item.position.slice();
      for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) p[row] += axes[col][row] * mesh.data[i + col] * item.size[col];
      includePoint(bounds, p);
    }
  }
  return bounds;
}
// Bake each complete assembly into one draw call, including per-vertex materials.
// Inverse-transpose normal scaling matters for thin rails and curved shells.
function bakeParts(parts, reusable) {
  const count = parts.reduce((n, p) => n + meshFor(p.shape).count, 0), required = count * STRIDE;
  const data = reusable && reusable.length >= required ? reusable : new Float32Array(Math.max(required, reusable ? reusable.length * 2 : 0));
  let write = 0;
  for (const item of parts) {
    const mesh = meshFor(item.shape), axes = axesFor(item), color = rgb(item.color);
    for (let i = 0; i < mesh.data.length; i += 6) {
      let px = item.position[0], py = item.position[1], pz = item.position[2], nx = 0, ny = 0, nz = 0;
      for (let col = 0; col < 3; col++) {
        const v = mesh.data[i + col] * item.size[col], n = mesh.data[i + 3 + col] / Math.max(.000001, item.size[col]);
        px += axes[col][0] * v; py += axes[col][1] * v; pz += axes[col][2] * v;
        nx += axes[col][0] * n; ny += axes[col][1] * n; nz += axes[col][2] * n;
      }
      const length = Math.hypot(nx, ny, nz) || 1;
      data[write++] = px; data[write++] = py; data[write++] = pz;
      data[write++] = nx / length; data[write++] = ny / length; data[write++] = nz / length;
      data[write++] = color[0]; data[write++] = color[1]; data[write++] = color[2];
      data[write++] = item.material;
      data[write++] = item.material === 7 ? .28 * (1 - Math.min(1, Math.hypot(mesh.data[i], mesh.data[i + 2]) * 2)) : item.emissive;
    }
  }
  return { data, count };
}
function edgeIds(edge) { return Array.isArray(edge) ? edge : [edge?.fromNodeId ?? edge?.from ?? edge?.source, edge?.toNodeId ?? edge?.to ?? edge?.target]; }
function segmentParts(a, b, active = false) {
  const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz);
  if (length < .01) return [];
  // Ry rotates local +X toward -Z, hence the negative atan2.
  const yaw = -Math.atan2(dz, dx), mid = lerp3(a, b, .5);
  if (active) return [part('bevel', [mid[0], .065, mid[2]], [length, .018, .14], '#5de8dc', yaw, .65, MATERIAL.glow)];
  const out = [part('bevel', [mid[0], .014, mid[2]], [length, .025, .37], '#324b5b', yaw, 0, MATERIAL.ground)];
  for (const side of [-1, 1]) {
    const offset = [-dz / length * .155 * side, 0, dx / length * .155 * side];
    out.push(part('box', [mid[0] + offset[0], .03, mid[2] + offset[2]], [length, .007, .012], '#738c99', yaw, 0, MATERIAL.metal));
  }
  return out;
}
function routeFor(from, to) {
  if (!from || !to || from.node.id === to.node.id) return null;
  const a = from.origin, b = to.origin, delta = sub3(b, a), length = Math.hypot(delta[0], delta[2]);
  if (length < .08) return null;
  const direction = delta.map((v) => v / length);
  const clearance = (entry, sign) => {
    const values = [0, 2].filter((i) => Math.abs(direction[i]) > .00001).map((i) => {
      const limit = direction[i] * sign > 0 ? entry.bounds.max[i] : entry.bounds.min[i];
      return Math.abs((limit - entry.origin[i]) / direction[i]);
    });
    return Math.min(...values) + .08;
  };
  const start = clearance(from, 1), end = clearance(to, -1);
  // No invented traffic when nodes overlap or there is no drawable aisle.
  if (start + end >= length - .04) return null;
  return { a: a.map((v, i) => v + direction[i] * start), b: b.map((v, i) => v - direction[i] * end), yaw: -Math.atan2(delta[2], delta[0]), length: length - start - end };
}
function campusParts(bounds, deepDive, layout) {
  const center = centerOf(bounds), width = Math.max(deepDive ? 3.7 : 6, bounds.max[0] - bounds.min[0] + 1.4), depth = Math.max(deepDive ? 3.1 : 4, bounds.max[2] - bounds.min[2] + 1.4);
  const out = [
    part('bevel', [center[0], -.15, center[2]], [width, .3, depth], '#1a2d3d', 0, 0, MATERIAL.ground),
    part('box', [center[0], -.005, center[2]], [width - .18, .01, depth - .18], '#344c5b', 0, 0, MATERIAL.ground)
  ];
  // Sparse construction joints, not procedural material stripes.
  if (!deepDive) for (let x = Math.ceil(bounds.min[0]); x < bounds.max[0]; x += 2) out.push(part('box', [x, .002, center[2]], [.009, .003, depth - .4], '#405867', 0, 0, MATERIAL.ground));
  for (const side of [-1, 1]) out.push(part('bevel', [center[0], .025, center[2] + side * (depth / 2 - .12)], [width - .28, .06, .055], '#8a9fab', 0, 0, MATERIAL.metal));
  if (layout === 'unified-campus' && bounds.min[2] < .48 && bounds.max[2] > .48) out.push(part('box', [center[0], .006, .48], [width - .3, .008, .035], '#81aaa9', 0, 0, MATERIAL.metal));
  return out;
}
const VERTEX_SOURCE = [
  'attribute vec3 a_position; attribute vec3 a_normal; attribute vec3 a_color; attribute vec2 a_surface;',
  'uniform mat4 u_pv;',
  'varying vec3 v_world; varying vec3 v_normal; varying vec3 v_color; varying vec2 v_surface;',
  'void main() {',
  'v_world = a_position; v_normal = a_normal; v_color = a_color; v_surface = a_surface;',
  'gl_Position = u_pv * vec4(a_position, 1.0); }'
].join('\n');
const FRAGMENT_SOURCE = [
  'precision mediump float;',
  'uniform vec3 u_camera; uniform float u_selected;',
  'varying vec3 v_world; varying vec3 v_normal; varying vec3 v_color; varying vec2 v_surface;',
  'void main() {',
  'if (v_surface.x > 6.5) { gl_FragColor = vec4(.025, .055, .08, v_surface.y); return; }',
  'vec3 n = normalize(v_normal); vec3 view = normalize(u_camera - v_world);',
  'vec3 key = normalize(vec3(-.55, .85, .6)); vec3 fill = normalize(vec3(.7, .4, -.55));',
  'float metal = 1.0 - step(.45, abs(v_surface.x - 1.0));',
  'float glass = 1.0 - step(.45, abs(v_surface.x - 2.0));',
  'float ground = 1.0 - step(.45, abs(v_surface.x - 5.0));',
  'float fresnel = pow(1.0 - max(dot(n, view), 0.0), 4.0);',
  'float gloss = mix(22.0, 76.0, max(metal, glass));',
  'float specular = pow(max(dot(n, normalize(key + view)), 0.0), gloss);',
  'vec3 albedo = pow(v_color, vec3(2.2));',
  'vec3 hemi = mix(vec3(.22, .25, .29), vec3(.56, .68, .8), n.y * .5 + .5);',
  'vec3 light = hemi * .65 + vec3(1.0, .94, .84) * max(dot(n, key), 0.0) * .92 + vec3(.44, .65, .86) * max(dot(n, fill), 0.0) * .3;',
  'vec3 color = albedo * light;',
  'color += specular * mix(vec3(.07), mix(vec3(.32), albedo, .45), metal) * (1.0 - ground);',
  'color += glass * fresnel * vec3(.12, .23, .3); color += albedo * v_surface.y * 1.5;',
  'color += u_selected * vec3(.024, .085, .12); color = color / (vec3(1.0) + color * .3);',
  'gl_FragColor = vec4(pow(max(color, vec3(0.0)), vec3(1.0 / 2.2)), 1.0); }'
].join('\n');
function makeProgram(gl) {
  const shaders = [], program = gl.createProgram();
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SOURCE], [gl.FRAGMENT_SHADER, FRAGMENT_SOURCE]]) {
      const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'Program linking failed');
    return program;
  } catch (error) { gl.deleteProgram(program); throw error; }
  finally { for (const shader of shaders) gl.deleteShader(shader); }
}

/**
 * Native WebGL 1, no external runtime.
 * onFrame, at most every ~100ms: canvas-relative CSS pixels, top-of-mesh anchors.
 * visible means in camera frustum (not an occlusion/HTML collision test).
 * Flow timestamps/durations use milliseconds on the performance.now() clock.
 * Choreography is illustrative; it is not physics, path planning or robot control.
 */
export function createMeshWorld(canvas, options = {}) {
  const noop = { setModel() {}, setSelected() {}, setCamera() {}, setFlowState() {}, beginNodeDrag() { return false; }, focusNode() { return false; }, fit() {}, dispose() {} };
  const gl = canvas?.getContext?.('webgl', { antialias: true, alpha: true, premultipliedAlpha: false });
  if (!gl) return noop;
  const deepDive = Boolean(options.deepDive), listeners = [], staticCache = new Map();
  const state = {
    model: { nodes: [], edges: [] }, nodes: new Map(), selected: null, dirty: true,
    camera: { yaw: .62, pitch: .73, distance: deepDive ? 6 : 15.5, target: [0, .65, 0] },
    flow: { running: false, paused: false, activeNodeId: null, fromNodeId: null, toNodeId: null, durationMs: 1000, startedAt: 0, completedNodeIds: [], stepId: null, queues: {} },
    pauseAt: null, pausedMs: 0, completed: new Set(), cssWidth: 1, cssHeight: 1,
    bounds: { min: [-2, 0, -2], max: [2, 2, 2] }, lastLabels: -Infinity,
    destroyed: false, lost: false, raf: 0
  };
  let program, locations, environment = null, roads = null, shadows = null, dynamic = null, pointer = null, observer;
  const reportError = (error) => { if (typeof options.onError === 'function') options.onError(error); else console.warn('Mesh world:', error); };
  function initialize() {
    program = makeProgram(gl);
    locations = {
      position: gl.getAttribLocation(program, 'a_position'), normal: gl.getAttribLocation(program, 'a_normal'),
      color: gl.getAttribLocation(program, 'a_color'), surface: gl.getAttribLocation(program, 'a_surface'),
      pv: gl.getUniformLocation(program, 'u_pv'), camera: gl.getUniformLocation(program, 'u_camera'), selected: gl.getUniformLocation(program, 'u_selected')
    };
    dynamic = { buffer: gl.createBuffer(), count: 0, capacity: 0, cpu: new Float32Array(0) };
    state.dirty = true;
  }
  try { initialize(); } catch (error) { reportError(error); return noop; }
  function upload(parts) {
    const baked = bakeParts(parts), batch = { buffer: gl.createBuffer(), count: baked.count };
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer); gl.bufferData(gl.ARRAY_BUFFER, baked.data, gl.STATIC_DRAW);
    return batch;
  }
  function release(batch) { if (batch?.buffer) gl.deleteBuffer(batch.buffer); }
  function rebuild() {
    const keep = new Set(), sceneBounds = boundsEmpty();
    state.nodes.clear();
    for (const node of state.model.nodes) {
      if (node?.id == null || keep.has(node.id)) continue;
      keep.add(node.id);
      const origin = nodeWorld(node, deepDive), signature = JSON.stringify([node.visual || 'crate', ...origin]);
      let entry = staticCache.get(node.id);
      if (!entry || entry.signature !== signature) {
        if (entry) { release(entry.body); release(entry.pose); }
        const visual = node.visual || 'crate', p = palette(node), localBody = objectParts(visual, p), localPose = articulationParts(visual, p, 0);
        const body = transformParts(localBody, origin), pose = transformParts(localPose, origin), bounds = boundsForParts([...body, ...pose]);
        // Include the full authored motion envelope so labels stay above the arm.
        if (isArticulated(visual)) for (const progress of [.16, .34, .65, .86, 1]) includeBounds(bounds, boundsForParts(transformParts(articulationParts(visual, p, progress), origin)));
        entry = { node, origin, signature, bounds, body: upload(body), pose: pose.length ? upload(pose) : null };
        staticCache.set(node.id, entry);
      }
      entry.node = node; state.nodes.set(node.id, entry); includeBounds(sceneBounds, entry.bounds);
    }
    for (const [id, entry] of staticCache) if (!keep.has(id)) { release(entry.body); release(entry.pose); staticCache.delete(id); }
    state.bounds = keep.size ? sceneBounds : { min: [-2, 0, -2], max: [2, 2, 2] };
    release(environment); release(roads); release(shadows);
    environment = upload(campusParts(state.bounds, deepDive, state.model.layout));
    const roadParts = [], shadowParts = [];
    if (!deepDive) for (const edge of state.model.edges) {
      const [from, to] = edgeIds(edge), route = routeFor(state.nodes.get(from), state.nodes.get(to));
      if (route) roadParts.push(...segmentParts(route.a, route.b));
    }
    for (const entry of state.nodes.values()) {
      const b = entry.bounds, c = centerOf(b);
      shadowParts.push(part('disc', [c[0], .008, c[2]], [(b.max[0] - b.min[0]) * 1.3, 1, (b.max[2] - b.min[2]) * 1.3], '#07121c', 0, 0, 7));
    }
    roads = upload(roadParts); shadows = upload(shadowParts); state.dirty = false;
  }
  function resize() {
    const ratio = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    state.cssWidth = canvas.clientWidth || 800; state.cssHeight = canvas.clientHeight || 500;
    const width = Math.max(1, Math.round(state.cssWidth * ratio)), height = Math.max(1, Math.round(state.cssHeight * ratio));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    gl.viewport(0, 0, width, height);
  }
  function cameraEye() {
    const c = state.camera, horizontal = Math.cos(c.pitch) * c.distance;
    return [c.target[0] + Math.sin(c.yaw) * horizontal, c.target[1] + Math.sin(c.pitch) * c.distance, c.target[2] + Math.cos(c.yaw) * horizontal];
  }
  function projectionView() {
    const eye = cameraEye(), far = Math.max(100, state.camera.distance + Math.hypot(...sub3(state.bounds.max, state.bounds.min)) * 2);
    return { eye, pv: multiply(perspective(state.cssWidth / state.cssHeight, far), lookAt(eye, state.camera.target)) };
  }
  function project(p, pv) {
    const clip = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) clip[i] = pv[i] * p[0] + pv[i + 4] * p[1] + pv[i + 8] * p[2] + pv[i + 12];
    if (clip[3] <= .00001) return { x: -10000, y: -10000, visible: false, depth: 1 };
    const x = clip[0] / clip[3], y = clip[1] / clip[3], depth = clip[2] / clip[3];
    return { x: (x * .5 + .5) * state.cssWidth, y: (.5 - y * .5) * state.cssHeight, depth, visible: Math.abs(x) <= 1 && Math.abs(y) <= 1 && Math.abs(depth) <= 1 };
  }
  function flowSample(now) {
    const flow = state.flow, engaged = flow.running || flow.paused;
    const elapsedMs = Math.max(0, (state.pauseAt ?? now) - flow.startedAt - state.pausedMs);
    const progress = flow.durationMs === 0 ? 1 : clamp(elapsedMs / flow.durationMs, 0, 1);
    const started = (state.pauseAt ?? now) >= flow.startedAt + state.pausedMs;
    const active = engaged ? state.nodes.get(flow.activeNodeId) : null;
    const route = engaged && started && !deepDive ? routeFor(state.nodes.get(flow.fromNodeId), state.nodes.get(flow.toNodeId)) : null;
    return { engaged, elapsedMs, progress, active, route, started };
  }

  function statusParts(sample) {
    const out = [], activeId = sample.engaged ? state.flow.activeNodeId : null;
    for (const [id, entry] of state.nodes) {
      const active = id === activeId, completed = state.completed.has(id), selected = id === state.selected;
      if (!active && !completed && !selected) continue;
      const b = entry.bounds, center = centerOf(b), diameter = Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2]) + .32;
      const color = active ? (state.flow.paused ? '#ffcb72' : '#65fff0') : completed ? '#79e3a2' : '#83baff';
      out.push(part('ring', [center[0], .05, center[2]], [diameter, .035, diameter], color, 0, active ? .75 : .35, MATERIAL.glow));
      if (active) {
        const radius = diameter * .51, angle = sample.progress * TAU;
        out.push(part('bevel', [center[0] + Math.cos(angle) * radius, .09, center[2] + Math.sin(angle) * radius], [.16, .07, .16], color, 0, 1, MATERIAL.glow));
      }
      if (completed) {
        const at = [b.max[0] - .05, b.max[1] + .12, b.max[2] + .03];
        const check = [beam([at[0] - .13, at[1], at[2]], [at[0] - .035, at[1] - .09, at[2]], .043, color),
          beam([at[0] - .035, at[1] - .09, at[2]], [at[0] + .17, at[1] + .15, at[2]], .043, color)];
        for (const item of check) { item.material = MATERIAL.glow; item.emissive = .6; } out.push(...check);
      }
    }
    return out;
  }
  function dynamicParts(sample) {
    const out = statusParts(sample), flow = state.flow;
    if (sample.active && sample.started && isArticulated(sample.active.node.visual)) out.push(...transformParts(articulationParts(sample.active.node.visual, palette(sample.active.node), sample.progress), sample.active.origin));
    if (sample.route) {
      const route = sample.route, pos = lerp3(route.a, route.b, sample.progress), p = palette(state.nodes.get(flow.fromNodeId).node);
      out.push(...segmentParts(route.a, route.b, true));
      // One visible carrier, never a loop or a vehicle on unrelated edges.
      out.push(...transformParts(amrParts(p, true), [pos[0], .035, pos[2]], route.yaw, .68));
      const count = Math.min(24, Math.max(2, Math.floor(route.length / .48)));
      for (let i = 0; i < count; i++) {
        const t = (i + .4 + sample.progress * .55) / count, point = lerp3(route.a, route.b, t);
        // Chevron pairs on both sides remain visible beneath the carrier.
        for (const side of [-1, 1]) {
          const dx = route.b[0] - route.a[0], dz = route.b[2] - route.a[2];
          out.push(part('arrow', [point[0] - dz / route.length * .24 * side, .085, point[2] + dx / route.length * .24 * side], [.23, .17, .024], '#b5fff1', route.yaw, .95, MATERIAL.glow, -Math.PI / 2));
        }
      }
    }
    // Legacy queue data is parked totes, with no invented motion.
    for (const [id, entry] of state.nodes) {
      const count = clamp(Math.floor(finite(flow.queues?.[id])), 0, 4);
      for (let i = 0; i < count; i++) out.push(...payloadParts(palette(entry.node), [entry.origin[0] + (i - (count - 1) / 2) * .2, .03, entry.bounds.max[2] + .25], .38));
    }
    return out;
  }
  function bindBatch(batch, selected = false) {
    if (!batch?.count) return 0;
    gl.bindBuffer(gl.ARRAY_BUFFER, batch.buffer);
    for (const [location, width, offset] of [[locations.position, 3, 0], [locations.normal, 3, 12], [locations.color, 3, 24], [locations.surface, 2, 36]]) {
      gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, width, gl.FLOAT, false, STRIDE * 4, offset);
    }
    gl.uniform1f(locations.selected, selected ? 1 : 0); gl.drawArrays(gl.TRIANGLES, 0, batch.count);
    return 1;
  }
  function draw(now) {
    if (state.destroyed || state.lost) return;
    state.raf = requestAnimationFrame(draw);
    if (!canvas.clientWidth || !canvas.clientHeight || document.hidden) return;
    resize(); if (state.dirty) rebuild();
    const { eye, pv } = projectionView(), sample = flowSample(now), items = dynamicParts(sample);
    const baked = bakeParts(items, dynamic.cpu); dynamic.cpu = baked.data; dynamic.count = baked.count;
    gl.bindBuffer(gl.ARRAY_BUFFER, dynamic.buffer);
    if (baked.data.byteLength > dynamic.capacity) { gl.bufferData(gl.ARRAY_BUFFER, baked.data.byteLength, gl.DYNAMIC_DRAW); dynamic.capacity = baked.data.byteLength; }
    if (baked.count) gl.bufferSubData(gl.ARRAY_BUFFER, 0, baked.data.subarray(0, baked.count * STRIDE));
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.depthMask(true);
    gl.clearColor(.04, .065, .09, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.useProgram(program);
    gl.uniformMatrix4fv(locations.pv, false, pv); gl.uniform3fv(locations.camera, eye);
    let drawCalls = bindBatch(environment), triangles = environment.count / 3;
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
    drawCalls += bindBatch(shadows); gl.depthMask(true); gl.disable(gl.BLEND);
    drawCalls += bindBatch(roads); triangles += (roads.count + shadows.count) / 3;
    for (const [id, entry] of state.nodes) {
      drawCalls += bindBatch(entry.body, id === state.selected); triangles += entry.body.count / 3;
      if (!(sample.active === entry && sample.started && isArticulated(entry.node.visual))) {
        drawCalls += bindBatch(entry.pose, id === state.selected); triangles += (entry.pose?.count || 0) / 3;
      }
    }
    drawCalls += bindBatch(dynamic); triangles += dynamic.count / 3;
    if (typeof options.onFrame === 'function' && now - state.lastLabels >= 100) {
      state.lastLabels = now;
      const nodes = [...state.nodes].map(([id, entry]) => {
        const center = centerOf(entry.bounds), screen = project([center[0], entry.bounds.max[1] + .2, center[2]], pv);
        return { id, ...screen, active: sample.engaged && id === state.flow.activeNodeId, completed: state.completed.has(id), selected: id === state.selected };
      });
      const payload = sample.route ? { ...project(lerp3(sample.route.a, sample.route.b, sample.progress).map((v, i) => i === 1 ? .84 : v), pv), world: lerp3(sample.route.a, sample.route.b, sample.progress) } : null;
      try {
        options.onFrame({ nodes, width: state.cssWidth, height: state.cssHeight, now, running: state.flow.running, paused: state.flow.paused,
          activeNodeId: state.flow.activeNodeId, fromNodeId: state.flow.fromNodeId, toNodeId: state.flow.toNodeId, stepId: state.flow.stepId,
          progress: sample.progress, elapsedMs: sample.elapsedMs, routeVisible: Boolean(sample.route), payload, drawCalls, triangles });
      } catch (error) { reportError(error); }
    }
  }
  function setFlowState(patch = {}) {
    if (!patch || state.destroyed) return;
    const now = performance.now(), previous = state.flow, owns = (key) => Object.prototype.hasOwnProperty.call(patch, key);
    const next = { ...previous, ...patch };
    next.running = Boolean(next.running); next.paused = Boolean(next.paused);
    next.durationMs = Math.max(0, finite(next.durationMs, 1000));
    const newStep = ['stepId', 'fromNodeId', 'toNodeId', 'activeNodeId'].some((key) => owns(key) && next[key] !== previous[key]);
    const newStart = owns('startedAt') && Number.isFinite(patch.startedAt) && patch.startedAt !== previous.startedAt;
    const restarting = next.running && !previous.running && !previous.paused;
    if (newStep || newStart || restarting) {
      next.startedAt = owns('startedAt') && Number.isFinite(patch.startedAt) ? patch.startedAt : now;
      state.pausedMs = 0; state.pauseAt = next.paused ? now : null;
    } else if (next.paused && !previous.paused) state.pauseAt = now;
    else if (!next.paused && previous.paused) {
      state.pausedMs += Math.max(0, now - (state.pauseAt ?? now)); state.pauseAt = null;
    }
    if (owns('completedNodeIds')) {
      const ids = Array.isArray(patch.completedNodeIds) || patch.completedNodeIds instanceof Set ? [...patch.completedNodeIds] : [];
      next.completedNodeIds = ids; state.completed = new Set(ids);
    }
    if (owns('queues')) next.queues = patch.queues && typeof patch.queues === 'object' ? { ...patch.queues } : {};
    state.flow = next;
  }
  function fitBounds(bounds) {
    resize(); const center = centerOf(bounds), radius = Math.max(.6, Math.hypot(...sub3(bounds.max, bounds.min)) / 2);
    const halfAngle = Math.min(FOV / 2, Math.atan(Math.tan(FOV / 2) * state.cssWidth / state.cssHeight));
    state.camera.target = center; state.camera.distance = clamp(radius / Math.sin(halfAngle) * 1.18, 1.5, MAX_DISTANCE);
  }
  function fit() { if (state.destroyed || state.lost) return; if (state.dirty) rebuild(); fitBounds(state.bounds); }
  function focusNode(id) {
    if (state.destroyed || state.lost) return false;
    if (state.dirty) rebuild(); const entry = state.nodes.get(id); if (!entry) return false;
    fitBounds(entry.bounds); return true;
  }
  function setCamera(camera = {}) {
    const c = state.camera;
    c.yaw = finite(camera.azimuth ?? camera.yaw, c.yaw);
    c.pitch = clamp(finite(camera.elevation ?? camera.pitch, c.pitch), .12, 1.48);
    c.distance = clamp(camera.zoom > 0 ? c.distance / finite(camera.zoom, 1) : finite(camera.distance, c.distance), 1.5, MAX_DISTANCE);
    if (Array.isArray(camera.target) && camera.target.length === 3 && camera.target.every(Number.isFinite)) c.target = [...camera.target];
    c.target[1] = Math.max(0, c.target[1]);
  }
  function listen(target, type, callback, config) { target.addEventListener(type, callback, config); listeners.push(() => target.removeEventListener(type, callback, config)); }
  listen(canvas, 'wheel', (event) => {
    event.preventDefault(); const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? state.cssHeight : 1);
    state.camera.distance = clamp(state.camera.distance * Math.exp(clamp(delta * .001, -.5, .5)), 1.5, MAX_DISTANCE);
  }, { passive: false });
  const previousTouchAction = canvas.style.touchAction; canvas.style.touchAction = 'none';
  function ground(event) {
    const rect=canvas.getBoundingClientRect();
    return screenToGround({x:event.clientX-rect.left,y:event.clientY-rect.top,width:rect.width,height:rect.height,eye:cameraEye(),target:state.camera.target,fov:FOV});
  }
  function beginNodeDrag(id,event) {
    if (pointer || deepDive || event.button !== 0 || event.shiftKey || !options.canMove?.()) return false;
    const node=state.model.nodes.find(n=>n.id===id), anchor=ground(event);
    if (!node || !anchor) return false;
    event.preventDefault(); canvas.setPointerCapture?.(event.pointerId);
    pointer={id:event.pointerId,nodeId:id,x:event.clientX,y:event.clientY,moved:0,anchor,origin:{x:node.x,y:node.y}};
    state.selected=id; options.onMoveStart?.(id); return true;
  }
  listen(canvas, 'contextmenu', (event) => event.preventDefault());
  listen(canvas, 'pointerdown', (event) => {
    if (pointer || event.button > 2) return;
    const id = event.button === 0 && !event.shiftKey ? pick(event) : null;
    if (id && beginNodeDrag(id,event)) return;
    event.preventDefault(); canvas.setPointerCapture?.(event.pointerId);
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: 0, pan: event.shiftKey || event.button === 1 || event.button === 2, yaw: state.camera.yaw, pitch: state.camera.pitch, target: [...state.camera.target] };
  });
  listen(canvas, 'pointermove', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y; pointer.moved = Math.max(pointer.moved, Math.hypot(dx, dy));
    if (pointer.nodeId) {
      if (!options.canMove?.()) return cancelPointer();
      const point=ground(event);
      if (point && pointer.moved >= 4) options.onMove?.(pointer.nodeId,{x:pointer.origin.x+(point[0]-pointer.anchor[0])*105,y:pointer.origin.y+(point[2]-pointer.anchor[2])*62});
      return;
    }
    if (options.getTool?.() === "trail" && !pointer.pan) return;
    if (pointer.pan) {
      const scale = 2 * state.camera.distance * Math.tan(FOV / 2) / state.cssHeight, yaw = pointer.yaw;
      state.camera.target = [pointer.target[0] - dx * Math.cos(yaw) * scale - dy * Math.sin(yaw) * scale, pointer.target[1], pointer.target[2] + dx * Math.sin(yaw) * scale - dy * Math.cos(yaw) * scale];
    } else {
      state.camera.yaw = pointer.yaw - dx * .007; state.camera.pitch = clamp(pointer.pitch + dy * .006, .12, 1.48);
    }
  });
  function pick(event) {
    if (state.dirty) rebuild(); const { pv } = projectionView(), rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * state.cssWidth / Math.max(1, rect.width), y = (event.clientY - rect.top) * state.cssHeight / Math.max(1, rect.height);
    let winner = null, best = Infinity;
    for (const entry of state.nodes.values()) {
      const points = [];
      for (const ix of [0, 1]) for (const iy of [0, 1]) for (const iz of [0, 1]) points.push(project([ix ? entry.bounds.max[0] : entry.bounds.min[0], iy ? entry.bounds.max[1] : entry.bounds.min[1], iz ? entry.bounds.max[2] : entry.bounds.min[2]], pv));
      if (!points.some((p) => p.visible)) continue;
      const left = Math.min(...points.map((p) => p.x)), right = Math.max(...points.map((p) => p.x)), top = Math.min(...points.map((p) => p.y)), bottom = Math.max(...points.map((p) => p.y));
      const center = project(centerOf(entry.bounds), pv);
      if (x >= left - 5 && x <= right + 5 && y >= top - 5 && y <= bottom + 5 && center.depth < best) { winner = entry.node.id; best = center.depth; }
    }
    return winner;
  }
  listen(canvas, 'pointerup', (event) => {
    if (!pointer || pointer.id !== event.pointerId) return;
    const finished=pointer, click = !pointer.pan && pointer.moved < 6; pointer = null;
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (finished.nodeId) options.onMoveEnd?.(finished.nodeId,false);
    else if (click) { const id=pick(event); if (id != null) options.onSelect?.(id); }
  });
  const cancelPointer = () => { const previous=pointer; pointer = null; if(previous?.nodeId) options.onMoveEnd?.(previous.nodeId,true); };
  listen(canvas, 'pointercancel', cancelPointer); listen(canvas, 'lostpointercapture', cancelPointer);
  listen(canvas,'dblclick',event=>{const id=pick(event); if(id!=null) options.onInspect?.(id);});
  listen(window,'keydown',event=>{if(event.key==="Escape") cancelPointer();});
  listen(window, 'resize', resize);
  if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(resize); observer.observe(canvas); }
  listen(canvas, 'webglcontextlost', (event) => { event.preventDefault(); state.lost = true; cancelAnimationFrame(state.raf); pointer = null; });
  listen(canvas, 'webglcontextrestored', () => {
    staticCache.clear(); environment = roads = shadows = null;
    try { initialize(); state.lost = false; state.raf = requestAnimationFrame(draw); } catch (error) { reportError(error); }
  });
  function dispose() {
    if (state.destroyed) return; state.destroyed = true; cancelAnimationFrame(state.raf);
    for (const remove of listeners) remove(); observer?.disconnect(); canvas.style.touchAction = previousTouchAction;
    if (pointer && canvas.hasPointerCapture?.(pointer.id)) canvas.releasePointerCapture(pointer.id); pointer = null;
    for (const entry of staticCache.values()) { release(entry.body); release(entry.pose); }
    for (const batch of [environment, roads, shadows, dynamic]) release(batch);
    staticCache.clear(); gl.deleteProgram(program);
  }
  resize(); state.raf = requestAnimationFrame(draw);
  return {
    setModel(model) {
      if (state.destroyed) return;
      state.model = { ...(model || {}), nodes: Array.isArray(model?.nodes) ? model.nodes : [], edges: Array.isArray(model?.edges) ? model.edges : [] };
      state.dirty = true;
    },
    setSelected(id) { state.selected = id; },
    setCamera, setFlowState, focusNode, fit, dispose, beginNodeDrag
  };
}
