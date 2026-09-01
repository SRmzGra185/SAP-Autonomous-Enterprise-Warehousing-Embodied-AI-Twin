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
const MATERIAL = { solid: 0, metal: 1, glass: 2, data: 3, warning: 4, ground: 5, glow: 6 };
function hex(value) { const n = parseInt(String(value).replace("#", ""), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function identity() { return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
function multiply(a, b) { const out = new Float32Array(16); for (let column = 0; column < 4; column += 1) for (let row = 0; row < 4; row += 1) out[column * 4 + row] = a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1] + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3]; return out; }
function perspective(fov, aspect, near, far) { const f = 1 / Math.tan(fov / 2), out = new Float32Array(16); out[0] = f / aspect; out[5] = f; out[10] = (far + near) / (near - far); out[11] = -1; out[14] = (2 * far * near) / (near - far); return out; }
function lookAt(eye, target) { const forward = norm3(sub3(target, eye)), right = norm3(cross3(forward, [0, 1, 0])), up = cross3(right, forward), out = identity(); out[0] = right[0]; out[1] = up[0]; out[2] = -forward[0]; out[4] = right[1]; out[5] = up[1]; out[6] = -forward[1]; out[8] = right[2]; out[9] = up[2]; out[10] = -forward[2]; out[12] = -dot3(right, eye); out[13] = -dot3(up, eye); out[14] = dot3(forward, eye); return out; }
function modelMatrix(position, size, rotation = 0, tilt = 0) { const cy = Math.cos(rotation), sy = Math.sin(rotation), cx = Math.cos(tilt), sx = Math.sin(tilt), out = identity(); out[0] = cy * size[0]; out[1] = sy * sx * size[0]; out[2] = -sy * cx * size[0]; out[4] = 0; out[5] = cx * size[1]; out[6] = sx * size[1]; out[8] = sy * size[2]; out[9] = -cy * sx * size[2]; out[10] = cy * cx * size[2]; out[12] = position[0]; out[13] = position[1]; out[14] = position[2]; return out; }
function meshFromFaces(faces) { const data = []; for (const face of faces) { const uv = [[0, 0], [1, 0], [1, 1], [0, 1]], order = [0, 1, 2, 0, 2, 3]; for (const index of order) data.push(...face.vertices[index], ...face.normal, ...uv[index]); } return { data: new Float32Array(data), count: data.length / 8 }; }
function cubeMesh() { const n = 0.5; return meshFromFaces([{ vertices: [[-n, -n, n], [n, -n, n], [n, n, n], [-n, n, n]], normal: [0, 0, 1] }, { vertices: [[n, -n, -n], [-n, -n, -n], [-n, n, -n], [n, n, -n]], normal: [0, 0, -1] }, { vertices: [[-n, -n, -n], [-n, -n, n], [-n, n, n], [-n, n, -n]], normal: [-1, 0, 0] }, { vertices: [[n, -n, n], [n, -n, -n], [n, n, -n], [n, n, n]], normal: [1, 0, 0] }, { vertices: [[-n, n, n], [n, n, n], [n, n, -n], [-n, n, -n]], normal: [0, 1, 0] }, { vertices: [[-n, -n, -n], [n, -n, -n], [n, -n, n], [-n, -n, n]], normal: [0, -1, 0] }]); }
function cylinderMesh(segments = 16, topRadius = 0.5, bottomRadius = 0.5) { const data = [], push = (p, n, uv) => data.push(...p, ...n, ...uv); for (let i = 0; i < segments; i += 1) { const a0 = (i / segments) * TAU, a1 = ((i + 1) / segments) * TAU, x0 = Math.cos(a0), z0 = Math.sin(a0), x1 = Math.cos(a1), z1 = Math.sin(a1), n0 = norm3([x0, (bottomRadius - topRadius) * 0.4, z0]), n1 = norm3([x1, (bottomRadius - topRadius) * 0.4, z1]); const b0 = [x0 * bottomRadius, -0.5, z0 * bottomRadius], b1 = [x1 * bottomRadius, -0.5, z1 * bottomRadius], t0 = [x0 * topRadius, 0.5, z0 * topRadius], t1 = [x1 * topRadius, 0.5, z1 * topRadius]; push(b0, n0, [i / segments, 0]); push(b1, n1, [(i + 1) / segments, 0]); push(t1, n1, [(i + 1) / segments, 1]); push(b0, n0, [i / segments, 0]); push(t1, n1, [(i + 1) / segments, 1]); push(t0, n0, [i / segments, 1]); push([0, -0.5, 0], [0, -1, 0], [0.5, 0.5]); push(b1, [0, -1, 0], [0.5 + x1 * 0.5, 0.5 + z1 * 0.5]); push(b0, [0, -1, 0], [0.5 + x0 * 0.5, 0.5 + z0 * 0.5]); push([0, 0.5, 0], [0, 1, 0], [0.5, 0.5]); push(t0, [0, 1, 0], [0.5 + x0 * 0.5, 0.5 + z0 * 0.5]); push(t1, [0, 1, 0], [0.5 + x1 * 0.5, 0.5 + z1 * 0.5]); } return { data: new Float32Array(data), count: data.length / 8 }; }
function sphereMesh(rows = 12, columns = 20) { const data = [], push = (p, n, uv) => data.push(...p, ...n, ...uv); for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) { const v0 = row / rows, v1 = (row + 1) / rows, u0 = column / columns, u1 = (column + 1) / columns, q = (p, u) => [Math.sin(p) * Math.cos(u * TAU), Math.cos(p), Math.sin(p) * Math.sin(u * TAU)], a = q(v0 * Math.PI, u0), b = q(v0 * Math.PI, u1), c = q(v1 * Math.PI, u1), d = q(v1 * Math.PI, u0); push(a, a, [u0, v0]); push(b, b, [u1, v0]); push(c, c, [u1, v1]); push(a, a, [u0, v0]); push(c, c, [u1, v1]); push(d, d, [u0, v1]); } return { data: new Float32Array(data), count: data.length / 8 }; }
function torusMesh(major = 0.34, minor = 0.08, rows = 12, columns = 24) { const data = [], push = (p, n, uv) => data.push(...p, ...n, ...uv); for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) { const v0 = row / rows, v1 = (row + 1) / rows, u0 = column / columns, u1 = (column + 1) / columns, q = (u, v) => { const a = u * TAU, b = v * TAU, r = major + minor * Math.cos(b); return { p: [r * Math.cos(a), minor * Math.sin(b), r * Math.sin(a)], n: [Math.cos(b) * Math.cos(a), Math.sin(b), Math.cos(b) * Math.sin(a)] }; }, a = q(u0, v0), b = q(u1, v0), c = q(u1, v1), d = q(u0, v1); push(a.p, a.n, [u0, v0]); push(b.p, b.n, [u1, v0]); push(c.p, c.n, [u1, v1]); push(a.p, a.n, [u0, v0]); push(c.p, c.n, [u1, v1]); push(d.p, d.n, [u0, v1]); } return { data: new Float32Array(data), count: data.length / 8 }; }
function coneMesh(segments = 8) { return cylinderMesh(segments, 0.08, 0.5); }
function extrudeMesh(points, depth = 1) {
  const data = [], push = (p, n, uv) => data.push(...p, ...n, ...uv), front = depth / 2, back = -depth / 2;
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[0], b = points[i], c = points[i + 1];
    push([a[0], a[1], front], [0, 0, 1], [a[0] + .5, a[1] + .5]); push([b[0], b[1], front], [0, 0, 1], [b[0] + .5, b[1] + .5]); push([c[0], c[1], front], [0, 0, 1], [c[0] + .5, c[1] + .5]);
    push([a[0], a[1], back], [0, 0, -1], [a[0] + .5, a[1] + .5]); push([c[0], c[1], back], [0, 0, -1], [c[0] + .5, c[1] + .5]); push([b[0], b[1], back], [0, 0, -1], [b[0] + .5, b[1] + .5]);
  }
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length], normal = norm3([b[1] - a[1], a[0] - b[0], 0]);
    push([a[0], a[1], back], normal, [0, 0]); push([b[0], b[1], back], normal, [1, 0]); push([b[0], b[1], front], normal, [1, 1]);
    push([a[0], a[1], back], normal, [0, 0]); push([b[0], b[1], front], normal, [1, 1]); push([a[0], a[1], front], normal, [0, 1]);
  }
  return { data: new Float32Array(data), count: data.length / 8 };
}
function latheMesh(profile, segments = 24) {
  const data = [], push = (p, n, uv) => data.push(...p, ...n, ...uv);
  const point = (entry, angle) => [entry[0] * Math.cos(angle), entry[1], entry[0] * Math.sin(angle)];
  for (let row = 0; row < profile.length - 1; row += 1) for (let column = 0; column < segments; column += 1) {
    const a0 = column / segments * TAU, a1 = (column + 1) / segments * TAU, low = profile[row], high = profile[row + 1], dr = high[0] - low[0], dy = high[1] - low[1];
    const n0 = norm3([Math.cos(a0) * dy, -dr, Math.sin(a0) * dy]), n1 = norm3([Math.cos(a1) * dy, -dr, Math.sin(a1) * dy]);
    const a = point(low, a0), b = point(low, a1), c = point(high, a1), d = point(high, a0), u0 = column / segments, u1 = (column + 1) / segments, v0 = row / (profile.length - 1), v1 = (row + 1) / (profile.length - 1);
    push(a, n0, [u0, v0]); push(b, n1, [u1, v0]); push(c, n1, [u1, v1]); push(a, n0, [u0, v0]); push(c, n1, [u1, v1]); push(d, n0, [u0, v1]);
  }
  return { data: new Float32Array(data), count: data.length / 8 };
}
function customMesh(shape) {
  if (shape === "hangar") return extrudeMesh([[-.5, -.5], [.5, -.5], [.5, .14], [.16, .5], [-.16, .5], [-.5, .14]]);
  if (shape === "towerShell") return latheMesh([[.46, -.5], [.5, -.38], [.38, .34], [.28, .5]], 8);
  if (shape === "vessel") return latheMesh([[.16, -.5], [.42, -.36], [.48, -.18], [.48, .25], [.38, .42], [.16, .5]], 24);
  if (shape === "hopper") return latheMesh([[.2, -.5], [.46, -.18], [.46, .35], [.34, .5]], 20);
  if (shape === "vault") return extrudeMesh([[-.36, -.5], [.36, -.5], [.5, -.25], [.5, .28], [.3, .5], [-.3, .5], [-.5, .28], [-.5, -.25]], .92);
  if (shape === "capsule") return latheMesh([[.16, -.5], [.38, -.35], [.43, 0], [.38, .35], [.16, .5]], 18);
  if (shape === "truss") return extrudeMesh([[-.5, -.36], [.5, -.36], [0, .5]], .7);
  if (shape === "chassis") return extrudeMesh([[-.42, -.5], [.36, -.5], [.5, -.24], [.5, .26], [.34, .5], [-.34, .5], [-.5, .26], [-.5, -.24]], .82);
  if (shape === "cameraPod") return extrudeMesh([[-.5, -.3], [-.25, -.5], [.38, -.42], [.5, -.12], [.42, .38], [.12, .5], [-.42, .34]], .72);
  return null;
}
const meshCache = new Map();
function meshFor(shape) { if (!meshCache.has(shape)) meshCache.set(shape, customMesh(shape) || (shape === "cube" ? cubeMesh() : shape === "cylinder" ? cylinderMesh() : shape === "hex" ? cylinderMesh(6) : shape === "sphere" ? sphereMesh() : shape === "torus" ? torusMesh() : coneMesh())); return meshCache.get(shape); }
function part(shape, position, size, color, rotation = 0, emissive = 0, material = MATERIAL.solid, tilt = 0) { return { shape, position, size, color: hex(color), rotation, emissive, material, tilt }; }
function nodeWorld(node, deepDive) { if (deepDive) return [0, 0, 0]; return [(Number(node.x || 0) - 530) / 105, (Number(node.y || 0) - 315) / 62, 0]; }

function objectParts(node, deepDive = false, time = 0) {
  const visual = node.visual || "crate", p = PALETTES[visual] || PALETTES.crate, [x, z] = nodeWorld(node, deepDive), out = [];
  const add = (shape, local, size, color = p.base, rotation = 0, emissive = 0, material = MATERIAL.solid, tilt = 0) => out.push(part(shape, [x + local[0], local[1], z + local[2]], size, color, rotation, emissive, material, tilt));
  const pad = () => { add("cube", [0, 0.05, 0], [1.72, 0.1, 1.38], p.dark, 0, 0, MATERIAL.metal); add("cube", [0, 0.115, 0], [1.52, 0.035, 1.18], p.metal, 0, 0, MATERIAL.metal); };
  if (visual === "posTerminal") {
    pad();
    add("vault", [0, .43, 0], [.82, .65, .72], p.dark, 0, 0, MATERIAL.metal);
    add("capsule", [0, .92, 0], [.16, .68, .16], p.metal, 0, 0, MATERIAL.metal);
    add("cameraPod", [0, 1.38, .02], [.92, .68, .38], p.base, 0, 0, MATERIAL.metal);
    add("cube", [0, 1.42, .23], [.66, .39, .035], p.glass, 0, .34, MATERIAL.data);
    add("cube", [-.31, .66, .38], [.18, .08, .18], p.accent, 0, .24, MATERIAL.glow);
    add("sphere", [.34, 1.62, .2], [.08, .08, .08], p.accent, 0, .7, MATERIAL.glow);
  } else if (visual === "retailShelf") {
    pad();
    for (const dx of [-.68, .68]) add("cube", [dx, .92, 0], [.08, 1.72, 1.0], p.metal, 0, 0, MATERIAL.metal);
    for (const y of [.3, .72, 1.14, 1.56]) {
      add("cube", [0, y, 0], [1.42, .07, 1.0], p.trim, 0, 0, MATERIAL.metal);
      for (let i = -2; i <= 2; i += 1) {
        const productColor = i % 2 ? p.accent : p.base;
        add(i % 2 ? "capsule" : "vault", [i * .25, y + .16, .22], [.16, .25, .22], productColor, 0, .05, MATERIAL.data);
      }
    }
    add("cube", [0, 1.93, 0], [1.55, .17, 1.05], p.dark, 0, 0, MATERIAL.metal);
    add("cube", [0, 1.94, .55], [.82, .11, .04], p.glass, 0, .3, MATERIAL.data);
    add("cameraPod", [.86, 1.52, .18], [.22, .28, .28], p.dark, -.3, 0, MATERIAL.metal);
  } else if (visual === "rack") {
    pad();
    for (const dx of [-.72, .72]) for (const dz of [-.45, .45]) add("cube", [dx, 1.0, dz], [.08, 1.82, .08], p.metal, 0, 0, MATERIAL.metal);
    for (const y of [.32, .78, 1.24, 1.7]) {
      add("cube", [0, y, -.45], [1.52, .08, .08], p.trim, 0, 0, MATERIAL.metal);
      add("cube", [0, y, .45], [1.52, .08, .08], p.trim, 0, 0, MATERIAL.metal);
      for (const dx of [-.45, 0, .45]) add("vault", [dx, y + .18, 0], [.34, .3, .72], dx === 0 ? p.accent : p.base, 0, .04, MATERIAL.metal);
    }
    add("cube", [0, 2.03, 0], [1.62, .12, 1.02], p.dark, 0, 0, MATERIAL.metal);
  } else if (visual === "mobileManipulator") {
    const swing = Math.sin(time * .9) * .12;
    pad();
    add("chassis", [0, .28, 0], [1.15, .42, .86], p.dark, 0, 0, MATERIAL.metal);
    for (const dx of [-.42, .42]) for (const dz of [-.38, .38]) add("torus", [dx, .2, dz], [.19, .065, .19], p.trim, 0, 0, MATERIAL.metal, Math.PI / 2);
    add("cylinder", [0, .55, 0], [.42, .22, .42], p.base, 0, 0, MATERIAL.metal);
    add("torus", [0, .7, 0], [.42, .06, .42], p.accent, 0, .35, MATERIAL.glow);
    add("sphere", [0, .78, 0], [.22, .22, .22], p.trim, 0, 0, MATERIAL.metal);
    add("capsule", [.24 + swing, 1.15, 0], [.19, .82, .19], p.base, 0, 0, MATERIAL.metal, -.55 + swing);
    add("sphere", [.5 + swing, 1.48, 0], [.2, .2, .2], p.trim, 0, 0, MATERIAL.metal);
    add("capsule", [.7 + swing, 1.73, 0], [.16, .64, .16], p.base, 0, 0, MATERIAL.metal, -.75 - swing);
    add("sphere", [.9 + swing, 1.96, 0], [.15, .15, .15], p.accent, 0, .35, MATERIAL.glow);
    add("cube", [.98 + swing, 1.98, -.12], [.3, .06, .05], p.dark, 0, 0, MATERIAL.metal);
    add("cube", [.98 + swing, 1.98, .12], [.3, .06, .05], p.dark, 0, 0, MATERIAL.metal);
    add("cylinder", [-.36, .72, 0], [.12, .34, .12], p.glass, 0, .45, MATERIAL.data);
  } else if (visual === "safetyZone") {
    pad();
    for (const dx of [-.67, .67]) {
      add("vault", [dx, .95, 0], [.22, 1.72, .34], p.base, 0, 0, MATERIAL.metal);
      add("capsule", [dx, 1.7, .2], [.13, .24, .13], p.glass, 0, .4, MATERIAL.data);
    }
    add("truss", [0, 1.82, 0], [1.58, .34, .46], p.trim, 0, 0, MATERIAL.metal);
    for (const y of [.55, .9, 1.25]) add("cube", [0, y, .08], [1.25, .018, .025], p.accent, 0, .6, MATERIAL.glow);
    add("cube", [0, .16, 0], [1.35, .03, 1.0], p.accent, 0, .12, MATERIAL.warning);
    add("sphere", [0, 2.12, 0], [.13, .13, .13], p.accent, 0, .65, MATERIAL.glow);
  } else if (visual === "sensorMast") {
    const scan = time * .35;
    pad();
    add("vault", [0, .3, 0], [.86, .42, .72], p.dark, 0, 0, MATERIAL.metal);
    add("cylinder", [0, 1.12, 0], [.14, 1.55, .14], p.metal, 0, 0, MATERIAL.metal);
    add("torus", [0, 1.48, 0], [.44, .06, .44], p.accent, scan, .35, MATERIAL.glow);
    add("cameraPod", [.02, 1.78, .08], [.62, .38, .48], p.base, scan, 0, MATERIAL.metal);
    add("sphere", [.22, 1.82, .28], [.12, .12, .12], p.glass, 0, .55, MATERIAL.data);
    add("capsule", [-.34, 1.72, 0], [.14, .28, .14], p.trim, 0, 0, MATERIAL.metal, -.35);
    add("sphere", [0, 2.15, 0], [.09, .09, .09], p.accent, 0, .7, MATERIAL.glow);
  } else if (visual === "amr") {
    pad();
    add("chassis", [0, .34, 0], [1.3, .48, .92], p.dark, 0, 0, MATERIAL.metal);
    add("vault", [0, .56, 0], [1.02, .3, .78], p.base, 0, 0, MATERIAL.metal);
    for (const dx of [-.48, .48]) for (const dz of [-.42, .42]) add("torus", [dx, .24, dz], [.2, .06, .2], p.trim, 0, 0, MATERIAL.metal, Math.PI / 2);
    add("cylinder", [0, .82, 0], [.24, .22, .24], p.glass, 0, .42, MATERIAL.data);
    add("torus", [0, .9, 0], [.34, .045, .34], p.accent, 0, .4, MATERIAL.glow);
    add("cube", [0, 1.08, 0], [.94, .11, .7], p.metal, 0, 0, MATERIAL.metal);
    add("vault", [0, 1.38, 0], [.82, .5, .64], p.accent, 0, .08, MATERIAL.data);
    add("cube", [.69, .45, 0], [.12, .1, .66], p.glass, 0, .5, MATERIAL.glow);
  } else if (visual === "cobotCell") {
    const swing = Math.sin(time * .75) * .16;
    pad();
    for (const dx of [-.72, .72]) for (const dz of [-.48, .48]) add("cube", [dx, .78, dz], [.05, 1.35, .05], p.trim, 0, 0, MATERIAL.metal);
    add("cube", [0, .34, 0], [1.25, .22, .95], p.dark, 0, 0, MATERIAL.metal);
    add("cylinder", [-.28, .58, 0], [.32, .42, .32], p.base, 0, 0, MATERIAL.metal);
    add("sphere", [-.28, .86, 0], [.22, .22, .22], p.trim, 0, 0, MATERIAL.metal);
    add("capsule", [-.02 + swing, 1.19, 0], [.18, .76, .18], p.base, 0, 0, MATERIAL.metal, -.58 + swing);
    add("sphere", [.22 + swing, 1.5, 0], [.19, .19, .19], p.trim, 0, 0, MATERIAL.metal);
    add("capsule", [.48 + swing, 1.73, 0], [.16, .64, .16], p.base, 0, 0, MATERIAL.metal, -.82 - swing);
    add("sphere", [.68 + swing, 1.95, 0], [.13, .13, .13], p.accent, 0, .38, MATERIAL.glow);
    add("cube", [.82 + swing, 1.96, 0], [.27, .07, .12], p.dark, 0, 0, MATERIAL.metal);
    add("cube", [.88 + swing, 1.84, -.09], [.08, .24, .04], p.trim, 0, 0, MATERIAL.metal);
    add("cube", [.88 + swing, 1.84, .09], [.08, .24, .04], p.trim, 0, 0, MATERIAL.metal);
    add("cube", [0, 1.58, -.52], [1.3, .05, .05], p.glass, 0, .22, MATERIAL.glass);
  } else if (visual === "conveyor") {
    pad();
    for (const dx of [-.68, .68]) for (const dz of [-.46, .46]) add("cube", [dx, .42, dz], [.08, .62, .08], p.metal, 0, 0, MATERIAL.metal);
    add("cube", [0, .72, 0], [1.48, .18, .9], p.dark, 0, 0, MATERIAL.metal);
    add("cube", [0, .84, 0], [1.4, .05, .78], p.base, 0, 0, MATERIAL.metal);
    for (let dx = -.58; dx <= .58; dx += .19) add("cylinder", [dx, .86, 0], [.055, .72, .055], p.trim, Math.PI / 2, 0, MATERIAL.metal, Math.PI / 2);
    add("vault", [Math.sin(time) * .35, 1.12, 0], [.45, .42, .5], p.accent, 0, .12, MATERIAL.data);
    add("cameraPod", [.62, 1.45, 0], [.22, .28, .28], p.glass, 0, .35, MATERIAL.data);
  } else if (visual === "inspectionCell") {
    pad();
    for (const dx of [-.68, .68]) add("vault", [dx, 1.0, 0], [.22, 1.82, .38], p.base, 0, 0, MATERIAL.metal);
    add("truss", [0, 1.85, 0], [1.55, .34, .48], p.trim, 0, 0, MATERIAL.metal);
    add("torus", [0, 1.45, 0], [1.05, .08, 1.05], p.glass, Math.PI / 2, .35, MATERIAL.glass);
    add("cameraPod", [0, 1.88, .22], [.46, .28, .28], p.dark, 0, 0, MATERIAL.metal);
    add("sphere", [0, 1.9, .38], [.1, .1, .1], p.accent, 0, .7, MATERIAL.glow);
    add("cube", [0, .22, 0], [1.3, .03, 1.0], p.accent, 0, .12, MATERIAL.warning);
  } else if (visual === "loadingDock") {
    pad();
    add("hangar", [0, .96, -.12], [1.45, 1.65, 1.0], p.trim, 0, 0, MATERIAL.metal);
    add("hangar", [0, .94, -.08], [1.3, 1.5, .92], p.dark, 0, 0, MATERIAL.metal);
    add("cube", [0, .68, .46], [1.05, .94, .05], p.glass, 0, .12, MATERIAL.glass);
    add("cube", [0, .28, .78], [1.18, .12, .56], p.base, 0, 0, MATERIAL.metal, -.1);
    add("cube", [0, .18, 1.02], [1.35, .06, .16], p.accent, 0, .25, MATERIAL.warning);
    for (const dx of [-.44, .44]) add("cylinder", [dx, .22, .72], [.13, .24, .13], p.trim, 0, 0, MATERIAL.metal);
  } else if (visual === "partsFeeder") {
    pad();
    add("vessel", [-.2, .86, 0], [1.05, 1.2, 1.05], p.trim, 0, 0, MATERIAL.metal);
    add("vessel", [-.2, .86, 0], [.92, 1.06, .92], p.base, 0, 0, MATERIAL.metal);
    add("torus", [-.2, 1.36, 0], [1.02, .09, 1.02], p.accent, time * .25, .18, MATERIAL.glow);
    add("cube", [.64, .62, 0], [.72, .14, .52], p.dark, 0, 0, MATERIAL.metal);
    for (let i = 0; i < 4; i += 1) add("vault", [.42 + i * .16, .82, 0], [.12, .16, .16], i % 2 ? p.accent : p.trim, 0, .08, MATERIAL.data);
    add("cameraPod", [.65, 1.22, .05], [.32, .28, .3], p.glass, 0, .3, MATERIAL.data);
  } else if (visual === "assemblyFixture") {
    pad();
    add("cube", [0, .34, 0], [1.38, .24, 1.0], p.dark, 0, 0, MATERIAL.metal);
    add("cube", [0, .55, 0], [.95, .12, .72], p.base, 0, 0, MATERIAL.metal);
    for (const [dx, dz] of [[-.48, -.3], [.48, -.3], [-.48, .3], [.48, .3]]) {
      add("cylinder", [dx, .76, dz], [.11, .4, .11], p.trim, 0, 0, MATERIAL.metal);
      add("cube", [dx * .72, .96, dz], [.32, .09, .13], p.accent, 0, .16, MATERIAL.warning);
    }
    add("vault", [0, .78, 0], [.62, .34, .48], p.glass, 0, .22, MATERIAL.glass);
    add("sphere", [0, 1.18, 0], [.1, .1, .1], p.accent, 0, .55, MATERIAL.glow);
  } else if (visual === "torqueStation") {
    pad();
    add("vault", [-.36, .88, 0], [.68, 1.5, .84], p.base, 0, 0, MATERIAL.metal);
    add("cube", [-.36, 1.15, .45], [.46, .38, .04], p.glass, 0, .3, MATERIAL.data);
    add("cylinder", [.46, 1.32, 0], [.18, .84, .18], p.trim, 0, 0, MATERIAL.metal);
    add("capsule", [.46, .82, 0], [.16, .64, .16], p.dark, 0, 0, MATERIAL.metal);
    add("cameraPod", [.46, .48, 0], [.34, .32, .34], p.accent, time * .2, .18, MATERIAL.warning);
    add("torus", [.46, .24, 0], [.36, .07, .36], p.trim, 0, 0, MATERIAL.metal);
  } else if (visual === "robotDock") {
    pad();
    add("vault", [0, .35, -.18], [1.2, .48, .72], p.dark, 0, 0, MATERIAL.metal);
    add("cube", [0, .28, .44], [.86, .06, .42], p.base, 0, 0, MATERIAL.metal, -.12);
    add("towerShell", [0, 1.02, -.26], [.64, 1.32, .5], p.base, 0, 0, MATERIAL.metal);
    add("cube", [0, 1.12, .03], [.38, .5, .04], p.glass, 0, .35, MATERIAL.data);
    for (const dx of [-.26, .26]) add("capsule", [dx, .5, .32], [.1, .28, .1], p.accent, 0, .4, MATERIAL.glow);
    add("torus", [0, 1.72, -.26], [.42, .06, .42], p.accent, time * .4, .35, MATERIAL.glow);
  } else if (visual === "quadruped") {
    const gait = Math.sin(time * 2.1) * .14;
    pad();
    add("chassis", [0, .94, 0], [1.14, .55, .72], p.dark, 0, 0, MATERIAL.metal);
    add("capsule", [0, 1.18, 0], [.9, .35, .55], p.base, 0, 0, MATERIAL.metal);
    for (const [index, dx, dz] of [[0, -.42, -.3], [1, .42, -.3], [2, -.42, .3], [3, .42, .3]]) {
      const phase = (index % 2 ? gait : -gait);
      add("sphere", [dx, .84, dz], [.15, .15, .15], p.trim, 0, 0, MATERIAL.metal);
      add("capsule", [dx + phase, .58, dz], [.13, .48, .13], p.base, 0, 0, MATERIAL.metal, phase * 1.8);
      add("sphere", [dx + phase * 1.5, .34, dz], [.12, .12, .12], p.trim, 0, 0, MATERIAL.metal);
      add("capsule", [dx - phase * .5, .18, dz], [.11, .34, .11], p.dark, 0, 0, MATERIAL.metal, -phase * 2.2);
    }
    add("cameraPod", [.7, 1.22, 0], [.46, .34, .52], p.base, 0, 0, MATERIAL.metal);
    add("sphere", [.9, 1.25, .18], [.09, .09, .09], p.glass, 0, .65, MATERIAL.data);
    add("sphere", [.9, 1.25, -.18], [.09, .09, .09], p.glass, 0, .65, MATERIAL.data);
    add("cylinder", [-.48, 1.48, 0], [.06, .4, .06], p.accent, 0, .45, MATERIAL.glow);
  } else if (visual === "processMachine") {
    pad();
    add("vault", [-.38, .82, 0], [.78, 1.28, .9], p.base, 0, 0, MATERIAL.metal);
    add("cylinder", [.42, .74, 0], [.64, 1.0, .64], p.trim, 0, 0, MATERIAL.metal, Math.PI / 2);
    add("torus", [.42, .74, 0], [.72, .1, .72], p.accent, 0, .18, MATERIAL.glow, Math.PI / 2);
    add("cylinder", [.84, .74, 0], [.18, .86, .18], p.dark, 0, 0, MATERIAL.metal, Math.PI / 2);
    add("cube", [-.38, 1.12, .48], [.48, .42, .04], p.glass, 0, .25, MATERIAL.data);
    add("cameraPod", [0, 1.66, .1], [.4, .3, .38], p.dark, 0, 0, MATERIAL.metal);
    add("sphere", [.15, 1.7, .32], [.09, .09, .09], p.accent, 0, .6, MATERIAL.glow);
  } else if (visual === "warehouse") {
    pad(); add("hangar", [0, 0.72, 0], [1.48, 1.22, 1.12], p.trim, 0, 0, MATERIAL.metal); add("hangar", [0, 0.7, 0.015], [1.37, 1.13, 1.06], p.base, 0, 0, MATERIAL.metal); add("cube", [0, 0.68, 0.55], [1.08, 0.48, 0.035], p.glass, 0, 0.1, MATERIAL.glass); add("cube", [-0.57, 0.28, 0.59], [0.24, 0.34, 0.12], p.dark, 0, 0, MATERIAL.metal); add("cube", [0.57, 0.28, 0.59], [0.24, 0.34, 0.12], p.dark, 0, 0, MATERIAL.metal); add("truss", [0, 0.46, 0.7], [0.78, 0.24, 0.34], p.trim, 0, 0, MATERIAL.metal); add("cylinder", [-0.47, 1.19, -0.25], [0.15, 0.54, 0.15], p.metal, 0, 0, MATERIAL.metal); add("cylinder", [0.47, 1.19, -0.25], [0.15, 0.54, 0.15], p.metal, 0, 0, MATERIAL.metal); add("cube", [0.82, 0.18, 0.02], [0.4, 0.1, 0.46], p.accent, 0, 0.1, MATERIAL.data); add("torus", [0.82, 0.29, 0.02], [0.34, 0.07, 0.34], p.trim, 0, 0, MATERIAL.metal);
  } else if (visual === "tower") {
    pad(); add("towerShell", [0, 1.02, 0], [1.16, 1.78, 1.0], p.trim, 0, 0, MATERIAL.metal); add("towerShell", [0, 1.0, 0], [1.04, 1.68, 0.88], p.base, 0, 0, MATERIAL.metal); for (const y of [.58, .9, 1.22, 1.54]) add("torus", [0, y, 0], [1.04, .045, .86], p.glass, 0, .08, MATERIAL.glass); add("sphere", [0, 1.95, 0], [0.78, 0.48, 0.78], p.glass, 0, .18, MATERIAL.glass); add("truss", [0, 2.25, 0], [1.0, .44, .92], p.trim, 0, 0, MATERIAL.metal); add("cylinder", [0, 2.61, 0], [.07, .46, .07], p.accent, 0, .4, MATERIAL.glow); add("cube", [-.7, .72, 0], [.48, .12, .66], p.dark, -.12, 0, MATERIAL.metal); add("cube", [.7, .72, 0], [.48, .12, .66], p.dark, .12, 0, MATERIAL.metal);
  } else if (visual === "reactor") {
    pad(); add("vessel", [0, .84, 0], [1.2, 1.48, 1.2], p.trim, 0, 0, MATERIAL.metal); add("vessel", [0, .84, 0], [1.08, 1.38, 1.08], p.base, 0, 0, MATERIAL.metal); add("capsule", [0, .86, 0], [.72, .8, .72], p.glass, 0, .24, MATERIAL.glass); add("torus", [0, .47, 0], [1.28, .12, 1.28], p.trim, 0, 0, MATERIAL.metal); add("torus", [0, 1.18, 0], [1.28, .12, 1.28], p.trim, 0, 0, MATERIAL.metal); add("torus", [0, .82, 0], [1.18, .05, 1.18], p.accent, 0, .3, MATERIAL.glow); add("cylinder", [-.72, .66, 0], [.17, 1.1, .17], p.metal, 0, 0, MATERIAL.metal, .16); add("cylinder", [.72, .66, 0], [.17, 1.1, .17], p.metal, 0, 0, MATERIAL.metal, -.16); add("hex", [0, 1.62, 0], [.34, .14, .34], p.dark, 0, 0, MATERIAL.metal);
  } else if (visual === "silo") {
    pad(); add("hopper", [0, .94, 0], [1.18, 1.7, 1.18], p.trim, 0, 0, MATERIAL.metal); add("hopper", [0, .95, 0], [1.07, 1.58, 1.07], p.base, 0, 0, MATERIAL.metal); add("cone", [0, 1.86, 0], [1.16, .46, 1.16], p.trim, 0, 0, MATERIAL.metal); add("torus", [0, .95, 0], [1.24, .075, 1.24], p.accent, 0, 0, MATERIAL.metal); add("torus", [0, 1.23, 0], [1.2, .045, 1.2], p.trim, 0, 0, MATERIAL.metal); add("cylinder", [.68, .65, 0], [.16, 1.24, .16], p.metal, 0, 0, MATERIAL.metal); add("cube", [.67, .28, 0], [.3, .12, .42], p.glass, 0, .08, MATERIAL.glass); add("cylinder", [0, 2.2, 0], [.11, .34, .11], p.dark, 0, 0, MATERIAL.metal);
  } else if (visual === "crate") {
    pad(); add("vault", [-.38, .33, 0], [.72, .52, .66], p.base, -.08, 0, MATERIAL.metal); add("vault", [.34, .34, .03], [.7, .54, .68], p.dark, .1, 0, MATERIAL.metal); add("vault", [-.03, .82, -.02], [.82, .5, .7], p.base, .05, 0, MATERIAL.metal); add("cube", [-.03, .82, .36], [.56, .07, .035], p.trim, .05, 0, MATERIAL.metal); add("cube", [-.03, .82, -.36], [.56, .07, .035], p.trim, .05, 0, MATERIAL.metal); add("capsule", [0, 1.25, 0], [.5, .5, .5], p.glass, 0, .35, MATERIAL.data); add("torus", [0, 1.25, 0], [.56, .045, .56], p.accent, 0, .22, MATERIAL.glow);
  } else if (visual === "pavilion") {
    pad(); for (const [dx, dz] of [[-.55, -.42], [.55, -.42], [-.55, .42], [.55, .42]]) add("capsule", [dx, .72, dz], [.15, 1.34, .15], p.trim, 0, 0, MATERIAL.metal); add("capsule", [0, .76, 0], [1.02, 1.02, 1.02], p.glass, 0, .22, MATERIAL.glass); add("truss", [0, 1.52, 0], [1.48, .42, 1.18], p.trim, 0, 0, MATERIAL.metal); add("torus", [0, 1.34, 0], [1.22, .07, 1.22], p.accent, 0, .22, MATERIAL.glow); add("vault", [0, .3, .51], [.62, .34, .18], p.base, 0, 0, MATERIAL.metal); add("cube", [-.21, .34, .61], [.07, .13, .035], p.glass, 0, .2, MATERIAL.data); add("cube", [.21, .34, .61], [.07, .13, .035], p.glass, 0, .2, MATERIAL.data);
  } else if (visual === "robot") {
    pad(); add("capsule", [0, .2, 0], [.96, .3, .72], p.dark, 0, 0, MATERIAL.metal); add("torus", [-.31, .18, .39], [.18, .065, .18], p.trim, Math.PI / 2, 0, MATERIAL.metal); add("torus", [.31, .18, .39], [.18, .065, .18], p.trim, Math.PI / 2, 0, MATERIAL.metal); add("capsule", [0, .82, 0], [.78, .96, .6], p.base, 0, 0, MATERIAL.metal); add("vault", [0, 1.42, 0], [.68, .5, .58], p.dark, 0, 0, MATERIAL.metal); add("cube", [0, 1.45, .31], [.4, .2, .035], p.glass, 0, .38, MATERIAL.data); add("capsule", [-.54, .78, 0], [.16, .68, .16], p.trim, 0, 0, MATERIAL.metal, -.36); add("capsule", [.54, .78, 0], [.16, .68, .16], p.trim, 0, 0, MATERIAL.metal, .36); add("cylinder", [0, 1.82, 0], [.055, .42, .055], p.accent, 0, .4, MATERIAL.glow); add("sphere", [0, 2.04, 0], [.12, .12, .12], p.accent, 0, .6, MATERIAL.glow);
  } else {
    pad(); add("vault", [-.58, .9, 0], [.28, 1.58, .38], p.base, 0, 0, MATERIAL.metal); add("vault", [.58, .9, 0], [.28, 1.58, .38], p.base, 0, 0, MATERIAL.metal); add("truss", [0, 1.66, 0], [1.48, .34, .42], p.trim, 0, 0, MATERIAL.metal); add("cube", [0, .64, 0], [1.05, .11, .1], p.accent, -.06, .45, MATERIAL.warning, .08); add("capsule", [-.37, .96, .22], [.2, .3, .1], p.glass, 0, .3, MATERIAL.data); add("capsule", [.37, .96, .22], [.2, .3, .1], p.glass, 0, .3, MATERIAL.data); add("sphere", [0, 1.98, 0], [.18, .18, .18], p.accent, 0, .5, MATERIAL.glow);
  }
  return out;
}

function segmentParts(a, b, color, material = MATERIAL.data) {
  const dx = b[0] - a[0], dz = b[2] - a[2], length = Math.hypot(dx, dz) || 1, angle = Math.atan2(dz, dx), mid = [(a[0] + b[0]) / 2, 0.08, (a[2] + b[2]) / 2];
  return [part("cube", mid, [length, 0.08, 0.24], "#263c4d", angle, 0, MATERIAL.metal), part("cube", [mid[0], 0.14, mid[2]], [length, 0.035, 0.055], color, angle, 0.15, material), part("cube", [mid[0], 0.19, mid[2]], [length * 0.94, 0.025, 0.025], "#d9eff2", angle, 0.08, MATERIAL.glow)];
}
function workerParts(node, index, time, deepDive) {
  const p = PALETTES[node.visual] || PALETTES.crate, [x, z] = nodeWorld(node, deepDive), count = Math.max(1, Number(node.capacity || 1)), angle = time * (0.28 + index * 0.02) + (index / count) * TAU, radius = 0.36 + (index % 2) * 0.08, bob = Math.sin(time * 2.4 + index) * 0.025, px = x + Math.cos(angle) * radius, pz = z + Math.sin(angle) * radius;
  return [part("cylinder", [px, 0.17 + bob, pz], [0.16, 0.18, 0.16], p.dark, 0, 0, MATERIAL.metal), part("cube", [px, 0.35 + bob, pz], [0.18, 0.26, 0.15], p.trim, angle, 0, MATERIAL.metal), part("sphere", [px, 0.55 + bob, pz], [0.16, 0.16, 0.16], p.glass, 0, 0.24, MATERIAL.data)];
}
function agvParts(a, b, t, color) {
  const pos = lerp3(a, b, t), angle = Math.atan2(b[2] - a[2], b[0] - a[0]), side = [Math.sin(angle) * .16, 0, -Math.cos(angle) * .16];
  return [
    part("vault", [pos[0], .27, pos[2]], [.42, .22, .28], "#263c4d", angle, 0, MATERIAL.metal),
    part("capsule", [pos[0], .42, pos[2]], [.24, .2, .2], color, angle, .18, MATERIAL.data),
    part("torus", [pos[0] + side[0], .18, pos[2] + side[2]], [.13, .045, .13], "#9bb3bf", angle, 0, MATERIAL.metal, Math.PI / 2),
    part("torus", [pos[0] - side[0], .18, pos[2] - side[2]], [.13, .045, .13], "#9bb3bf", angle, 0, MATERIAL.metal, Math.PI / 2),
    part("sphere", [pos[0] + Math.cos(angle) * .22, .35, pos[2] + Math.sin(angle) * .22], [.08, .08, .08], "#bff9ef", 0, .7, MATERIAL.glow)
  ];
}
function dynamicFlowParts(model, time, flowState, deepDive) {
  if (deepDive || !flowState?.running || !model?.edges?.length) return [];
  const out = [], nodes = new Map((model.nodes || []).map((node) => [node.id, node]));
  model.edges.forEach(([fromId, toId], edgeIndex) => { const from = nodes.get(fromId), to = nodes.get(toId); if (!from || !to) return; const a = nodeWorld(from, false), b = nodeWorld(to, false), phase = (time * 0.33 + edgeIndex * 0.23) % 1; for (let packet = 0; packet < 3; packet += 1) { const t = (phase + packet * 0.28) % 1, pos = lerp3(a, b, t); out.push(part("sphere", [pos[0], 0.32 + Math.sin(time * 4 + packet) * 0.03, pos[2]], [0.13, 0.13, 0.13], "#bff9ef", 0, 0.8, MATERIAL.glow)); out.push(part("vault", [pos[0] - (b[0] - a[0]) * 0.08, 0.27, pos[2] - (b[2] - a[2]) * 0.08], [0.09, 0.09, 0.09], "#56c7e9", 0, 0.35, MATERIAL.data)); } if (edgeIndex % 2 === 0) out.push(...agvParts(a, b, (phase * .72 + .12) % 1, (PALETTES[from.visual] || PALETTES.crate).accent)); });
  const queue = flowState.queues || {};
  (model.nodes || []).forEach((node) => { const n = Math.min(3, Math.max(0, Number(queue[node.id] || 0))); for (let i = 0; i < n; i += 1) { const p = PALETTES[node.visual] || PALETTES.crate, [x, z] = nodeWorld(node, false), shift = (i - (n - 1) / 2) * 0.18; out.push(part("cube", [x + shift, 0.2, z + 0.7], [0.13, 0.13, 0.13], p.accent, 0, 0.4, MATERIAL.data)); } });
  return out;
}
function campusParts(model, deepDive) {
  const out = [];
  if (deepDive) { out.push(part("cylinder", [0, -0.1, 0], [5.4, 0.16, 5.4], "#182a39", 0, 0, MATERIAL.ground)); out.push(part("torus", [0, 0.02, 0], [2.35, 0.035, 2.35], "#3e7480", 0, 0.2, MATERIAL.glow)); out.push(part("torus", [0, 0.025, 0], [3.25, 0.025, 3.25], "#344e60", 0, 0, MATERIAL.metal)); out.push(part("cube", [0, -0.02, -2.35], [4.6, 0.06, 0.05], "#32576a", 0, 0, MATERIAL.metal)); out.push(part("cube", [-2.35, -0.02, 0], [0.05, 0.06, 4.6], "#32576a", 0, 0, MATERIAL.metal)); return out; }
  if (model?.layout === "unified-campus") {
    out.push(part("cube", [0, -0.2, 0], [12.8, 0.28, 9.65], "#172735", 0, 0, MATERIAL.ground));
    out.push(part("cube", [0, -0.035, -2.05], [12.15, 0.07, 4.65], "#263d4b", 0, 0, MATERIAL.ground));
    out.push(part("cube", [0, -0.025, 2.75], [12.15, 0.08, 3.55], "#293c42", 0, 0, MATERIAL.ground));
    out.push(part("cube", [0, 0.015, 0.48], [11.8, 0.035, 0.26], "#3b6670", 0, .12, MATERIAL.data));
    out.push(part("cube", [0, 0.035, 0.48], [7.8, 0.025, 0.06], "#69d0c4", 0, .42, MATERIAL.glow));
    out.push(part("cube", [0, 0.02, -4.22], [11.95, 0.04, 0.06], "#4b6a79", 0, 0, MATERIAL.metal));
    out.push(part("cube", [0, 0.02, 4.32], [11.95, 0.04, 0.06], "#7a684b", 0, 0, MATERIAL.metal));
    for (let x = -5.4; x <= 5.4; x += 1.2) {
      out.push(part("cube", [x, 0.012, -2.05], [0.022, 0.018, 4.15], "#35515d", 0, 0, MATERIAL.ground));
      out.push(part("cube", [x, 0.012, 2.75], [0.022, 0.018, 3.05], "#465148", 0, 0, MATERIAL.ground));
    }
    return out;
  }
  if (model?.layout === "platform-campus") {
    out.push(part("cube", [0, -0.2, -1.2], [12.8, 0.28, 7.1], "#172735", 0, 0, MATERIAL.ground));
    out.push(part("cube", [0, -0.03, -1.2], [12.15, 0.07, 6.55], "#263d4b", 0, 0, MATERIAL.ground));
    for (let x = -5.4; x <= 5.4; x += 1.2) out.push(part("cube", [x, 0.012, -1.2], [0.022, 0.018, 6.1], "#35515d", 0, 0, MATERIAL.ground));
    return out;
  }
  out.push(part("cube", [0, -0.18, 0], [11.8, 0.26, 6.2], "#172735", 0, 0, MATERIAL.ground)); out.push(part("cube", [0, -0.02, 0], [11.3, 0.05, 5.7], "#233746", 0, 0, MATERIAL.ground)); out.push(part("cube", [0, 0.02, -2.45], [10.9, 0.04, 0.06], "#3f6272", 0, 0, MATERIAL.metal)); out.push(part("cube", [0, 0.02, 2.45], [10.9, 0.04, 0.06], "#3f6272", 0, 0, MATERIAL.metal)); for (let x = -5; x <= 5; x += 1) out.push(part("cube", [x, 0.045, 0], [0.025, 0.02, 5.25], "#314b58", 0, 0, MATERIAL.ground)); return out;
}
function makeProgram(gl, vertexSource, fragmentSource) {
  const compile = (type, source) => { const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader)); return shader; };
  const program = gl.createProgram(); gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource)); gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource)); gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program)); return program;
}

export function createMeshWorld(canvas, options = {}) {
  const deepDive = Boolean(options.deepDive), noop = { setModel() {}, setSelected() {}, setCamera() {}, setFlowState() {} }, gl = canvas?.getContext?.("webgl", { antialias: true, alpha: true });
  if (!gl) return noop;
  const vertexSource = "attribute vec3 a_position; attribute vec3 a_normal; attribute vec2 a_uv; uniform mat4 u_mvp; uniform mat4 u_model; varying vec3 v_normal; varying vec3 v_world; varying vec2 v_uv; void main(){ vec4 world=u_model*vec4(a_position,1.0); v_world=world.xyz; v_normal=normalize(mat3(u_model)*a_normal); v_uv=a_uv; gl_Position=u_mvp*vec4(a_position,1.0); }";
  const fragmentSource = "precision mediump float; uniform vec3 u_color; uniform vec3 u_camera; uniform float u_material; uniform float u_time; uniform float u_emissive; uniform float u_selected; varying vec3 v_normal; varying vec3 v_world; varying vec2 v_uv; float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);} void main(){ vec3 n=normalize(v_normal); vec3 view=normalize(u_camera-v_world); vec3 sun=normalize(vec3(-0.45,0.9,0.5)); float diffuse=max(dot(n,sun),0.0); float light=0.32+0.68*diffuse; float edge=pow(1.0-max(dot(n,view),0.0),2.2); float spec=pow(max(dot(n,normalize(sun+view)),0.0),30.0); vec3 c=u_color; float panel=step(0.8,fract(v_uv.x*9.0))*0.045; float grain=(hash(v_uv*48.0)-0.5)*0.025; if(u_material>0.5 && u_material<1.5){c*=0.9+panel+grain; c+=spec*vec3(.24,.27,.28);} if(u_material>1.5 && u_material<2.5){c=mix(c,vec3(0.58,0.86,0.9),0.32); c+=edge*vec3(0.15,0.25,0.28)+spec*.35;} if(u_material>2.5 && u_material<3.5){float stream=smoothstep(.82,.96,fract(v_uv.y*15.0-u_time*.65)); c+=stream*vec3(.04,.28,.3)+edge*.14;} if(u_material>3.5 && u_material<4.5){float stripe=step(.52,fract((v_uv.x+v_uv.y)*7.0)); c=mix(c,c*.62,stripe*.4);} if(u_material>4.5 && u_material<5.5){c*=.82+.04*sin(v_world.x*9.0+v_world.z*7.0); spec=0.0;} if(u_material>5.5){c+=vec3(.04,.28,.3)+edge*.18;} c*=light; c+=spec*.12; c+=c*u_emissive*(.62+.38*sin(u_time*2.0+v_world.y*4.0)); if(u_selected>.5)c+=vec3(.1,.22,.16); gl_FragColor=vec4(c,1.0);}";
  let program;
  try { program = makeProgram(gl, vertexSource, fragmentSource); } catch { return noop; }
  const locations = { position: gl.getAttribLocation(program, "a_position"), normal: gl.getAttribLocation(program, "a_normal"), uv: gl.getAttribLocation(program, "a_uv"), mvp: gl.getUniformLocation(program, "u_mvp"), model: gl.getUniformLocation(program, "u_model"), color: gl.getUniformLocation(program, "u_color"), camera: gl.getUniformLocation(program, "u_camera"), material: gl.getUniformLocation(program, "u_material"), time: gl.getUniformLocation(program, "u_time"), emissive: gl.getUniformLocation(program, "u_emissive"), selected: gl.getUniformLocation(program, "u_selected") };
  const buffers = new Map(), state = { model: { nodes: [], edges: [] }, selected: null, flow: { running: false, queues: {} }, camera: { yaw: 0.62, pitch: 0.73, distance: deepDive ? 6.6 : 14.8, target: [0, 0.65, 0] }, width: 1, height: 1 };
  const bufferFor = (shape) => { if (!buffers.has(shape)) { const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, meshFor(shape).data, gl.STATIC_DRAW); buffers.set(shape, buffer); } return buffers.get(shape); };
  const resize = () => { const ratio = window.devicePixelRatio || 1, width = Math.max(1, Math.floor((canvas.clientWidth || 800) * ratio)), height = Math.max(1, Math.floor((canvas.clientHeight || 500) * ratio)); if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; } state.width = width; state.height = height; gl.viewport(0, 0, width, height); };
  const cameraEye = () => { const c = state.camera, horizontal = Math.cos(c.pitch) * c.distance; return [c.target[0] + Math.sin(c.yaw) * horizontal, c.target[1] + Math.sin(c.pitch) * c.distance, c.target[2] + Math.cos(c.yaw) * horizontal]; };
  const nodeScreen = (node, projectionView) => { const p = nodeWorld(node, deepDive), cx = projectionView[0] * p[0] + projectionView[4] * 0.45 + projectionView[8] * p[2] + projectionView[12], cy = projectionView[1] * p[0] + projectionView[5] * 0.45 + projectionView[9] * p[2] + projectionView[13], cw = projectionView[3] * p[0] + projectionView[7] * 0.45 + projectionView[11] * p[2] + projectionView[15]; return { x: (cx / cw * 0.5 + 0.5) * (canvas.clientWidth || 800), y: (1 - (cy / cw * 0.5 + 0.5)) * (canvas.clientHeight || 500) }; };
  const draw = (timeMs) => {
    resize();
    const time = timeMs * 0.001, eye = cameraEye(), view = lookAt(eye, state.camera.target), projection = perspective(0.82, state.width / state.height, 0.1, 60), pv = multiply(projection, view), selectedNode = (state.model.nodes || []).find((node) => node.id === state.selected), selectedPosition = selectedNode ? nodeWorld(selectedNode, deepDive) : null;
    gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.clearColor(0.035, 0.065, 0.09, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.useProgram(program); gl.uniform3fv(locations.camera, new Float32Array(eye)); gl.uniform1f(locations.time, time);
    const items = [...campusParts(state.model, deepDive)];
    for (const node of state.model.nodes || []) items.push(...objectParts(node, deepDive, time));
    if (!deepDive) {
      const nodeMap = new Map((state.model.nodes || []).map((node) => [node.id, node]));
      for (const [fromId, toId] of state.model.edges || []) { const from = nodeMap.get(fromId), to = nodeMap.get(toId); if (from && to) items.push(...segmentParts(nodeWorld(from, false), nodeWorld(to, false), from.zone !== to.zone ? "#69d0c4" : (PALETTES[from.visual] || PALETTES.crate).accent)); }
      (state.model.nodes || []).forEach((node) => { const count = Math.min(3, Math.max(1, Number(node.capacity || 1))); for (let i = 0; i < count; i += 1) items.push(...workerParts(node, i, time, false)); });
    }
    items.push(...dynamicFlowParts(state.model, time, state.flow, deepDive));
    for (const item of items) {
      const mesh = meshFor(item.shape), model = modelMatrix(item.position, item.size, item.rotation, item.tilt), mvp = multiply(pv, model), buffer = bufferFor(item.shape), selected = selectedPosition && Math.abs(item.position[0] - selectedPosition[0]) < 0.05 && Math.abs(item.position[2] - selectedPosition[2]) < 0.05 && item.position[1] > 0.1 ? 1 : 0;
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.enableVertexAttribArray(locations.position); gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 32, 0); gl.enableVertexAttribArray(locations.normal); gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 32, 12); gl.enableVertexAttribArray(locations.uv); gl.vertexAttribPointer(locations.uv, 2, gl.FLOAT, false, 32, 24); gl.uniformMatrix4fv(locations.model, false, model); gl.uniformMatrix4fv(locations.mvp, false, mvp); gl.uniform3fv(locations.color, new Float32Array(item.color)); gl.uniform1f(locations.material, item.material); gl.uniform1f(locations.emissive, item.emissive); gl.uniform1f(locations.selected, selected); gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    }
    requestAnimationFrame(draw);
  };
  canvas.addEventListener("wheel", (event) => { event.preventDefault(); state.camera.distance = Math.max(deepDive ? 3.8 : 8, Math.min(deepDive ? 11 : 21, state.camera.distance + event.deltaY * 0.008)); }, { passive: false });
  let pointer = null;
  canvas.addEventListener("pointerdown", (event) => { canvas.setPointerCapture?.(event.pointerId); pointer = { x: event.clientX, y: event.clientY, yaw: state.camera.yaw, pitch: state.camera.pitch }; });
  canvas.addEventListener("pointermove", (event) => { if (!pointer) return; state.camera.yaw = pointer.yaw + (event.clientX - pointer.x) * 0.008; state.camera.pitch = Math.max(0.32, Math.min(1.22, pointer.pitch + (event.clientY - pointer.y) * 0.006)); });
  canvas.addEventListener("pointerup", (event) => { if (!pointer) return; const moved = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y); if (moved < 7 && typeof options.onSelect === "function") { const eye = cameraEye(), pv = multiply(perspective(0.82, state.width / state.height, 0.1, 60), lookAt(eye, state.camera.target)), x = event.offsetX, y = event.offsetY; let winner = null, best = 62; for (const node of state.model.nodes || []) { const screen = nodeScreen(node, pv), distance = Math.hypot(screen.x - x, screen.y - y); if (distance < best) { winner = node; best = distance; } } if (winner) options.onSelect(winner.id); } pointer = null; });
  canvas.addEventListener("pointercancel", () => { pointer = null; }); window.addEventListener("resize", resize); resize(); requestAnimationFrame(draw);
  return {
    setModel(model) { state.model = model || { nodes: [], edges: [] }; },
    setSelected(id) { state.selected = id; },
    setCamera(camera = {}) { state.camera = { ...state.camera, ...camera, yaw: camera.azimuth ?? camera.yaw ?? state.camera.yaw, pitch: camera.elevation ?? camera.pitch ?? state.camera.pitch, distance: camera.zoom ? state.camera.distance / camera.zoom : camera.distance ?? state.camera.distance }; },
    setFlowState(flow) { state.flow = { ...state.flow, ...(flow || {}) }; }
  };
}
