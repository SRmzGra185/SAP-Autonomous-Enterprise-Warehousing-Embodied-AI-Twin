// Authored, code-native industrial assemblies. Units are illustrative, Y is up.
// No downloaded assets, textures, renderer dependency, or physical simulation.
export const MATERIAL = Object.freeze({ solid: 0, metal: 1, glass: 2, data: 3, warning: 4, ground: 5, glow: 6 });
const TAU = Math.PI * 2;
const cache = new Map();
const normalize = (a) => { const l = Math.hypot(...a) || 1; return a.map((v) => v / l); };
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function triangle(out, a, b, c, normals) {
  const n = normalize(cross(subtract(b, a), subtract(c, a)));
  [a, b, c].forEach((p, i) => out.push(...p, ...(normals ? normals[i] : n)));
}
function quad(out, a, b, c, d) { triangle(out, a, b, c); triangle(out, a, c, d); }
function rectangleRing(y, radius = .5, corner = .09) {
  return [[-radius + corner, y, -radius], [radius - corner, y, -radius], [radius, y, -radius + corner], [radius, y, radius - corner], [radius - corner, y, radius], [-radius + corner, y, radius], [-radius, y, radius - corner], [-radius, y, -radius + corner]];
}
function loft(rings, capBottom = true, capTop = true) {
  const out = [], count = rings[0].length;
  for (let r = 0; r < rings.length - 1; r++) for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    quad(out, rings[r][i], rings[r + 1][i], rings[r + 1][j], rings[r][j]);
  }
  const cap = (ring, top) => { const center = [0, ring[0][1], 0]; for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    triangle(out, center, ring[top ? j : i], ring[top ? i : j]);
  } };
  if (capBottom) cap(rings[0], false);
  if (capTop) cap(rings[rings.length - 1], true);
  return out;
}
function lathe(profile, segments = 24) {
  const out = [];
  for (let r = 0; r < profile.length - 1; r++) for (let i = 0; i < segments; i++) {
    const low = profile[r], high = profile[r + 1], a = i / segments * TAU, b = (i + 1) / segments * TAU;
    const point = (p, angle) => [p[0] * Math.cos(angle), p[1], p[0] * Math.sin(angle)];
    const normal = (angle) => normalize([(high[1] - low[1]) * Math.cos(angle), low[0] - high[0], (high[1] - low[1]) * Math.sin(angle)]);
    const p = point(low, a), q = point(high, a), s = point(high, b), t = point(low, b), n = normal(a), m = normal(b);
    triangle(out, p, q, s, [n, n, m]); triangle(out, p, s, t, [n, m, m]);
  }
  return out;
}
// Convex XY profiles extruded along Z; recessed/open shapes use lofts instead.
function extrude(points) {
  const out = [];
  for (let i = 1; i < points.length - 1; i++) {
    triangle(out, [...points[0], .5], [...points[i], .5], [...points[i + 1], .5]);
    triangle(out, [...points[0], -.5], [...points[i + 1], -.5], [...points[i], -.5]);
  }
  for (let i = 0; i < points.length; i++) { const a = points[i], b = points[(i + 1) % points.length]; quad(out, [...a, -.5], [...b, -.5], [...b, .5], [...a, .5]); }
  return out;
}
export function meshFor(shape) {
  if (cache.has(shape)) return cache.get(shape);
  let data;
  if (shape === 'disc') {
    data = [];
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * TAU, b = (i + 1) / 48 * TAU;
      triangle(data, [0, 0, 0], [.5 * Math.cos(b), 0, .5 * Math.sin(b)], [.5 * Math.cos(a), 0, .5 * Math.sin(a)]);
    }
  } else if (shape === 'box') data = loft([rectangleRing(-.5, .5, 0), rectangleRing(.5, .5, 0)]);
  else if (shape === 'bevel') data = loft([rectangleRing(-.5, .455, .06), rectangleRing(-.42), rectangleRing(.42), rectangleRing(.5, .455, .06)]);
  else if (shape === 'chassis') data = loft([rectangleRing(-.5, .4, .12), rectangleRing(-.32, .5, .14), rectangleRing(.18, .5, .14), rectangleRing(.5, .41, .12)]);
  else if (shape === 'bin') data = loft([rectangleRing(-.5, .4), rectangleRing(.4), rectangleRing(.5), rectangleRing(.5, .43, .08), rectangleRing(-.36, .34, .06)], true, true);
  else if (shape === 'roof') data = extrude([[-.5, -.5], [.5, -.5], [.5, -.22], [0, .5], [-.5, -.22]]);
  else if (shape === 'arrow') data = extrude([[-.5, -.5], [.5, 0], [-.5, .5]]);
  else if (shape === 'cylinder') data = lathe([[0, -.5], [.46, -.5], [.5, -.44], [.5, .44], [.46, .5], [0, .5]]);
  else if (shape === 'joint') data = lathe([[0, -.5], [.34, -.5], [.48, -.33], [.5, -.14], [.5, .14], [.48, .33], [.34, .5], [0, .5]], 20);
  else if (shape === 'link') data = lathe([[0, -.5], [.27, -.5], [.48, -.39], [.48, -.26], [.33, .28], [.29, .43], [.18, .5], [0, .5]], 16);
  else if (shape === 'vessel') data = lathe([[0, -.5], [.18, -.5], [.37, -.43], [.49, -.26], [.5, .22], [.42, .4], [.22, .5], [0, .5]], 32);
  else if (shape === 'hopper') data = lathe([[.1, -.5], [.14, -.5], [.5, .16], [.5, .5], [.45, .5], [.45, .2], [.1, -.4]], 32);
  else if (shape === 'ring') data = lathe([[.44, -.5], [.5, -.5], [.5, .5], [.44, .5], [.44, -.5]], 48);
  else throw new Error('Unknown mesh: ' + shape);
  const result = { data: new Float32Array(data), count: data.length / 6 };
  cache.set(shape, result); return result;
}

export function part(shape, position, size, color, rotation = 0, emissive = 0, material = MATERIAL.solid, tilt = 0) {
  return { shape, position, size, color, rotation, emissive, material, tilt };
}
// Columns of a Y-up rotation matrix: Ry(yaw) * Rx(tilt). Local +X faces travel.
export function axesFor(item) {
  if (item.axes) return item.axes;
  const c = Math.cos(item.rotation || 0), s = Math.sin(item.rotation || 0), ct = Math.cos(item.tilt || 0), st = Math.sin(item.tilt || 0);
  return [[c, 0, -s], [s * st, ct, c * st], [s * ct, -st, c * ct]];
}
export function beam(a, b, thickness, color, shape = 'bevel', material = MATERIAL.metal) {
  const y = normalize(subtract(b, a)), x = normalize(cross(Math.abs(y[2]) < .9 ? [0, 0, 1] : [1, 0, 0], y)), z = cross(x, y);
  return { ...part(shape, a.map((v, i) => (v + b[i]) / 2), [thickness, Math.hypot(...subtract(b, a)), thickness], color, 0, 0, material), axes: [x, y, z] };
}
export function transformParts(parts, origin, yaw = 0, scale = 1) {
  const c = Math.cos(yaw), s = Math.sin(yaw), rotate = (p) => [c * p[0] + s * p[2], p[1], -s * p[0] + c * p[2]];
  return parts.map((p) => ({ ...p, position: rotate(p.position).map((v, i) => origin[i] + scale * v), size: p.size.map((v) => v * scale), axes: axesFor(p).map(rotate) }));
}
function builder(p) {
  const out = [];
  const add = (shape, at, size, color = p.base, rotation = 0, emissive = 0, material = MATERIAL.solid, tilt = 0) => out.push(part(shape, at, size, color, rotation, emissive, material, tilt));
  const box = (at, size, color = p.base, material = MATERIAL.metal) => add('bevel', at, size, color, 0, 0, material);
  const rod = (a, b, width = .035, color = p.metal) => out.push(beam(a, b, width, color));
  const pad = () => { box([0, .04, 0], [1.52, .08, 1.16], p.dark); box([0, .093, 0], [1.43, .026, 1.07], '#697e89'); };
  const screen = (at, width = .28, height = .2) => { box(at, [width + .05, height + .05, .06], p.dark); add('box', [at[0], at[1], at[2] + .035], [width, height, .009], p.glass, 0, .14, MATERIAL.data); for (let i = 0; i < 3; i++) add('box', [at[0] - width * .12, at[1] + (i - 1) * height * .23, at[2] + .042], [width * (.6 - .12 * i), .012, .005], p.accent, 0, .32, MATERIAL.glow); };
  const beacon = (x, y, z) => { add('cylinder', [x, y, z], [.04, .28, .04], p.dark); for (let i = 0; i < 3; i++) add('cylinder', [x, y + .12 + i * .07, z], [.07, .058, .07], ['#66dfb1', '#f4bd62', '#c67b76'][i], 0, i === 0 ? .3 : 0, MATERIAL.glass); };
  return { out, add, box, rod, pad, screen, beacon };
}
export function payloadParts(p, center = [0, 0, 0], scale = 1) {
  const { out, add, box } = builder(p);
  // Open reusable tote, raised rim, recessed interior, grasp handles, ID plate.
  add('bin', [0, .16, 0], [.45, .3, .34], p.accent);
  box([0, .115, 0], [.27, .09, .19], p.dark);
  for (const z of [-.176, .176]) { box([0, .225, z], [.13, .044, .012], p.dark); box([.125, .14, z], [.075, .055, .014], '#e6eee9'); }
  return transformParts(out, center, 0, scale);
}
function pallet(p, x, y, z, scale = 1) {
  const { out, box } = builder(p);
  for (const dx of [-.18, 0, .18]) box([dx, .03, 0], [.06, .06, .4], '#866c4d');
  for (const dz of [-.15, -.05, .05, .15]) box([0, .078, dz], [.48, .036, .07], '#b6986d');
  return transformParts(out, [x, y, z], 0, scale);
}
export function amrParts(p, loaded = true) {
  const { out, add, box } = builder(p);
  // Tires touch Y=0. Actual axles run along Z; inset alloy hubs and low bumper.
  for (const x of [-.38, .38]) for (const z of [-.34, .34]) {
    add('cylinder', [x, .14, z], [.28, .09, .28], '#18232c', 0, 0, MATERIAL.solid, Math.PI / 2);
    add('joint', [x, .14, z + Math.sign(z) * .052], [.14, .016, .14], '#8b9ba5', 0, 0, MATERIAL.metal, Math.PI / 2);
  }
  add('chassis', [0, .28, 0], [1.13, .32, .75], p.dark, 0, 0, MATERIAL.metal);
  add('chassis', [0, .43, 0], [1.04, .16, .68], p.base, 0, 0, MATERIAL.metal);
  box([0, .535, 0], [.83, .055, .6], '#adbcc4');
  for (const z of [-.27, .27]) box([-.06, .581, z], [.62, .028, .034], '#394b58');
  for (const z of [-.23, .23]) add('bevel', [.526, .35, z], [.024, .058, .16], '#b6fff0', 0, .9, MATERIAL.glow);
  box([-.49, .37, 0], [.07, .065, .29], '#1b2932');
  add('cylinder', [.34, .576, 0], [.16, .055, .16], '#202f3a');
  add('cylinder', [.34, .617, 0], [.13, .034, .13], p.glass, 0, .4, MATERIAL.glass);
  box([0, .32, .382], [.3, .082, .01], '#b9d6dd');
  for (const x of [-.2, -.1, 0, .1]) box([x, .39, -.367], [.055, .055, .013], p.dark);
  if (loaded) out.push(...pallet(p, -.08, .57, 0), ...payloadParts(p, [-.08, .67, 0], 1.15));
  return out;
}

export function isArticulated(visual) { return ['cobotCell', 'mobileManipulator', 'robot', 'conveyor', 'torqueStation', 'inspectionCell', 'assemblyFixture', 'sensorMast', 'quadruped'].includes(visual); }
// Explicit one-shot keyframe choreography; never driven by a wall-clock sine wave.
export function articulationParts(visual, p, progress = 0) {
  const { out, add, box, rod } = builder(p), t = Math.max(0, Math.min(1, progress));
  if (['cobotCell', 'mobileManipulator', 'robot'].includes(visual)) {
    const mobile = visual === 'mobileManipulator', baseY = mobile ? .66 : .71;
    const keys = [[0, .42, 1.31, .18], [.16, .46, .92, .22], [.34, .35, 1.53, .1], [.65, -.04, 1.51, -.23], [.86, -.03, 1.06, -.28], [1, .2, 1.4, -.05]];
    let index = 0; while (index < keys.length - 2 && t > keys[index + 1][0]) index++;
    const a = keys[index], b = keys[index + 1], u = (t - a[0]) / (b[0] - a[0]), smooth = u * u * (3 - 2 * u);
    const wrist = a.slice(1).map((v, i) => v + (b[i + 1] - v) * smooth), shoulder = [-.38, baseY + .15, 0];
    // Two rigid links with shared endpoints, solved geometrically in the reach plane.
    const delta = subtract(wrist, shoulder), d = Math.hypot(...delta), direction = normalize(delta), length = .66;
    const bend = normalize(cross(direction, [0, 0, 1])), midpoint = shoulder.map((v, i) => v + delta[i] * .5), h = Math.sqrt(Math.max(0, length * length - d * d * .25));
    const elbow = midpoint.map((v, i) => v + bend[i] * h);
    out.push(beam(shoulder, elbow, .18, p.base, 'link'), beam(elbow, wrist, .145, '#c2d4dc', 'link'));
    for (const [j, at] of [shoulder, elbow, wrist].entries()) {
      add('joint', at, [j === 2 ? .17 : .24, .19, j === 2 ? .17 : .24], p.dark, 0, 0, MATERIAL.metal, Math.PI / 2);
      add('cylinder', [at[0], at[1], at[2] + .1], [.13, .025, .13], p.accent, 0, 0, MATERIAL.metal, Math.PI / 2);
    }
    rod([shoulder[0] - .06, shoulder[1], .12], [elbow[0] - .06, elbow[1], elbow[2] + .12], .034, '#182c3b');
    rod([elbow[0] - .06, elbow[1], elbow[2] + .12], [wrist[0], wrist[1], wrist[2] + .12], .025, '#182c3b');
    const gripping = t >= .16 && t < .86, spread = gripping ? .08 : .14;
    box([wrist[0], wrist[1] - .095, wrist[2]], [.22, .08, .14], p.dark);
    for (const sign of [-1, 1]) { box([wrist[0] + sign * spread, wrist[1] - .19, wrist[2]], [.032, .16, .08], '#b9c9d0'); box([wrist[0] + sign * (spread - .02), wrist[1] - .26, wrist[2]], [.07, .024, .08], p.dark); }
    const cargo = gripping ? [wrist[0], wrist[1] - .32, wrist[2]] : (t < .16 ? [.46, .6, .22] : [-.03, .74, -.28]);
    out.push(...payloadParts(p, cargo, .46));
  } else if (visual === 'conveyor') {
    out.push(...payloadParts(p, [-.57 + 1.14 * t, .765, 0], .95));
  } else if (visual === 'torqueStation') {
    const stroke = t < .3 ? t / .3 : t < .7 ? 1 : (1 - t) / .3;
    add('link', [.27, 1.22 - stroke * .21, 0], [.17, .46, .17], p.trim);
    add('cylinder', [.27, .94 - stroke * .21, 0], [.045, .18, .045], p.dark);
  } else if (visual === 'inspectionCell') {
    // A visible inspection head traverses the real gantry only while this step runs.
    box([-.48 + .96 * t, 1.27, 0], [.2, .18, .23], p.dark);
    add('cylinder', [-.48 + .96 * t, 1.145, 0], [.12, .065, .12], p.glass, 0, .55, MATERIAL.glass);
  } else if (visual === 'assemblyFixture') {
    const clamp = Math.min(1, t * 4) * .1;
    for (const x of [-1, 1]) box([x * (.33 - clamp), .72, 0], [.22, .1, .36], p.accent);
  } else if (visual === 'sensorMast') {
    add('bevel', [0, 1.66, 0], [.37, .24, .29], p.trim, -.75 + t * 1.5, 0, MATERIAL.metal);
    const yaw = -.75 + t * 1.5;
    out.push(...transformParts([part('cylinder', [0, 1.66, .17], [.13, .06, .13], p.glass, 0, .35, MATERIAL.glass, Math.PI / 2)], [0, 0, 0], yaw));
  } else if (visual === 'quadruped') {
    for (const x of [-.4, .4]) for (const z of [-.3, .3]) {
      const shift = .1 * Math.sin(t * TAU * 2 + (x * z > 0 ? 0 : Math.PI));
      const hip = [x, .69, z], knee = [x + .16 + shift, .36, z], foot = [x - .08, .06, z];
      out.push(beam(hip, knee, .09, p.trim, 'link'), beam(knee, foot, .065, p.dark, 'link'));
      add('joint', knee, [.13, .12, .13], p.base); box(foot, [.16, .1, .13], '#17242e');
    }
  }
  return out;
}

export function objectParts(visual, p) {
  const { out, add, box, rod, pad, screen, beacon } = builder(p);
  if (visual === 'amr') return amrParts(p);
  if (visual === 'mobileManipulator') { out.push(...amrParts(p, false)); add('cylinder', [-.38, .66, 0], [.3, .21, .3], p.trim); return out; }
  if (visual === 'quadruped') {
    add('chassis', [0, .79, 0], [1.13, .32, .63], p.base); box([.59, .84, 0], [.19, .2, .43], p.dark);
    for (const z of [-.13, .13]) add('cylinder', [.7, .84, z], [.08, .035, .08], p.glass, Math.PI / 2, .3, MATERIAL.glass, Math.PI / 2);
    add('cylinder', [-.3, 1.02, 0], [.19, .13, .19], p.trim); return out;
  }
  pad();
  if (visual === 'rack' || visual === 'retailShelf') {
    // Flanged steel uprights, bolted footplates, cross-braces and open shelf bays.
    for (const x of [-.64, .64]) for (const z of [-.43, .43]) {
      box([x, .14, z], [.19, .065, .18], p.dark);
      box([x, 1.01, z], [.055, 1.76, .11], '#56768e');
      for (const side of [-1, 1]) box([x + side * .038, 1.01, z], [.025, 1.76, .12], '#7593a4');
      for (const y of [.36, .78, 1.2, 1.62]) box([x, y, z + .062], [.025, .045, .008], '#202f3a');
    }
    for (const x of [-.64, .64]) for (let i = 0; i < 3; i++) {
      rod([x, .22 + i * .53, -.4], [x, .75 + i * .53, .4], .025, p.trim);
      rod([x, .22 + i * .53, .4], [x, .75 + i * .53, -.4], .025, p.trim);
    }
    for (const y of [.27, .83, 1.39]) {
      for (const z of [-.43, .43]) box([0, y, z], [1.3, .1, .055], '#d78c41');
      for (let i = -3; i <= 3; i++) box([i * .175, y + .053, 0], [.1, .025, .8], '#81949c');
      for (const x of [-.31, .3]) {
        out.push(...pallet(p, x, y + .064, 0, .95));
        if (visual === 'rack') out.push(...payloadParts(p, [x, y + .16, 0], 1.04));
        else for (const dx of [-.12, .1]) add('bevel', [x + dx, y + .26, .07], [.15, .3, .32], dx < 0 ? p.accent : p.trim);
      }
      box([.39, y, .468], [.15, .055, .012], '#edf0e5');
    }
    box([0, 1.94, -.43], [1.35, .1, .065], p.dark);
  } else if (visual === 'conveyor') {
    for (const x of [-.62, .62]) for (const z of [-.35, .35]) { box([x, .37, z], [.07, .51, .07], p.metal); box([x, .14, z], [.19, .065, .16], p.dark); }
    for (const z of [-.39, .39]) { box([0, .665, z], [1.48, .15, .075], '#99adb7'); box([0, .81, z], [1.49, .055, .028], p.accent); }
    for (let i = 0; i < 13; i++) add('cylinder', [-.66 + i * .11, .713, 0], [.092, .71, .092], i % 2 ? '#9caeb8' : '#bfccd2', 0, 0, MATERIAL.metal, Math.PI / 2);
    add('cylinder', [-.56, .55, .52], [.22, .26, .22], p.base, 0, 0, MATERIAL.metal, Math.PI / 2);
    box([-.56, .67, .5], [.06, .22, .065], p.dark);
    rod([-.61, .21, -.35], [.61, .58, -.35], .035); screen([.42, .47, .46], .19, .15);
    box([.45, .88, -.39], [.13, .12, .12], p.dark); beacon(-.66, .97, -.42);
  } else if (['cobotCell', 'robot', 'assemblyFixture', 'torqueStation', 'inspectionCell'].includes(visual)) {
    for (const x of [-.58, .58]) for (const z of [-.4, .4]) box([x, .34, z], [.08, .47, .08], p.metal);
    box([0, .585, 0], [1.3, .1, .91], '#b3c2c8');
    for (let x = -.4; x <= .4; x += .2) for (const z of [-.24, 0, .24]) add('cylinder', [x, .64, z], [.025, .009, .025], p.dark);
    if (visual === 'cobotCell' || visual === 'robot') {
      add('cylinder', [-.38, .71, 0], [.32, .17, .32], p.metal); box([-.03, .69, -.28], [.31, .09, .28], p.dark);
      for (const x of [-.69, .69]) { box([x, .79, -.48], [.04, 1.3, .04], p.trim); box([x, .79, .46], [.04, 1.3, .04], p.trim); }
      rod([-.69, 1.44, -.48], [.69, 1.44, -.48], .035);
      for (let x = -.56; x < .6; x += .14) rod([x, .66, -.48], [x, 1.4, -.48], .01, '#65818e');
    } else if (visual === 'inspectionCell' || visual === 'torqueStation') {
      for (const x of [-.59, .59]) box([x, 1.03, -.07], [.1, .85, .14], p.base);
      box([0, 1.49, -.07], [1.35, .17, .22], p.trim); box([0, 1.385, 0], [1.2, .04, .06], p.dark);
      box([.05, .685, 0], [.43, .1, .35], p.accent);
    } else box([0, .69, 0], [.47, .1, .4], p.dark);
    screen([.63, .91, .5], .21, .17); beacon(-.65, 1.46, -.46);
  } else if (visual === 'warehouse' || visual === 'loadingDock') {
    box([0, .66, -.08], [1.35, 1.1, .9], p.base);
    add('roof', [0, 1.31, -.08], [1.47, .33, 1.04], '#91a8b4', 0, 0, MATERIAL.metal);
    // Recessed dock faces, framed clerestory windows and real roof vents.
    for (const x of [-.38, .35]) {
      box([x, .51, .386], [.49, .75, .032], p.dark);
      box([x, .66, .41], [.37, .43, .027], '#8da1ab');
      for (let y = .49; y < .88; y += .095) box([x, y, .427], [.36, .011, .01], '#586f7d');
      for (const dx of [-.23, .23]) box([x + dx, .42, .443], [.045, .6, .075], p.trim);
      for (const dx of [-.17, .17]) box([x + dx, .19, .49], [.065, .15, .12], '#1c2c37');
      box([x, 1.055, .389], [.44, .13, .027], p.glass, MATERIAL.glass);
    }
    box([0, .115, .62], [1.35, .055, .35], p.metal);
    for (const x of [-.53, .53]) { add('cylinder', [x, .23, .77], [.065, .25, .065], '#dcb45b'); box([x, .28, .77], [.07, .055, .07], p.dark); }
    for (const x of [-.4, .33]) { box([x, 1.47, -.19], [.21, .12, .27], p.dark); for (const z of [-.27, -.19, -.11]) box([x, 1.539, z], [.18, .015, .025], p.trim); }
    for (const z of [-.35, -.05, .25]) box([.69, .72, z], [.022, .45, .16], p.glass, MATERIAL.glass);
  } else if (visual === 'tower' || visual === 'pavilion') {
    const floors = visual === 'tower' ? 4 : 2;
    // Stepped glazed office / control building, exposed mullions, cantilevered slabs.
    for (let level = 0; level < floors; level++) {
      const y = .18 + level * .4, width = 1.21 - level * .07;
      box([0, y, 0], [width + .12, .08, .95], p.trim);
      box([0, y + .2, 0], [width - .06, .32, .79], p.glass, MATERIAL.glass);
      box([0, y + .2, -.1], [.33, .35, .64], p.base);
      for (const x of [-.45, -.15, .15, .45]) for (const z of [-.411, .411]) box([x * width, y + .2, z], [.027, .34, .025], p.metal);
      for (const x of [-1, 1]) box([x * width / 2, y + .2, 0], [.045, .34, .84], p.dark);
    }
    const top = .2 + floors * .4;
    box([-.12, top, 0], [1.13, .09, 1.04], p.dark); box([-.21, top + .12, -.13], [.41, .18, .38], p.metal);
    for (const x of [-.31, -.12]) add('cylinder', [x, top + .22, -.13], [.12, .026, .12], p.dark);
    box([.24, .29, .436], [.3, .3, .035], p.dark); box([.24, .29, .461], [.23, .24, .011], p.glass, MATERIAL.glass);
    box([.25, .48, .56], [.64, .045, .35], p.trim);
    for (let i = 0; i < 3; i++) box([.25, .1 + i * .025, .78 - i * .095], [.6, .03, .11], p.metal);
  } else if (visual === 'reactor' || visual === 'silo' || visual === 'partsFeeder') {
    const feeder = visual === 'partsFeeder', height = feeder ? .8 : 1.35;
    for (const x of [-.34, .34]) for (const z of [-.3, .3]) box([x, .34, z], [.075, .46, .075], p.metal);
    add(feeder ? 'hopper' : 'vessel', [0, .46 + height / 2, 0], [.95, height, .95], '#9fbbc5', 0, 0, MATERIAL.metal);
    for (const y of [.65, .46 + height * .72]) add('ring', [0, y, 0], [.97, .05, .97], p.base, 0, 0, MATERIAL.metal);
    if (!feeder) {
      add('cylinder', [0, height + .52, 0], [.22, .16, .22], p.dark);
      rod([.47, .78, 0], [.65, .78, 0], .09, p.trim); rod([.65, .78, 0], [.65, .18, 0], .09, p.trim);
      for (const x of [-.18, .18]) rod([x, .17, .57], [x, height + .5, .57], .025, p.metal);
      for (let y = .28; y < height + .5; y += .17) rod([-.18, y, .57], [.18, y, .57], .023, p.trim);
      screen([-.53, .78, .3], .16, .2);
    } else { box([.54, .66, 0], [.53, .05, .26], p.metal); for (const z of [-.14, .14]) box([.54, .72, z], [.55, .1, .025], p.trim); }
  } else if (visual === 'crate') {
    for (const x of [-.35, .32]) { out.push(...pallet(p, x, .11, 0, 1.05), ...payloadParts(p, [x, .22, 0], 1.35)); }
    out.push(...payloadParts(p, [-.35, .63, 0], 1.35));
  } else if (visual === 'sensorMast') {
    box([0, .23, 0], [.53, .23, .43], p.dark); add('cylinder', [0, .94, 0], [.09, 1.3, .09], p.metal); beacon(.25, 1.45, 0);
  } else if (visual === 'robotDock' || visual === 'posTerminal') {
    box([0, .39, -.16], [.69, .53, .48], p.dark); box([0, .98, -.22], [.46, 1.03, .24], p.base); screen([0, 1.21, -.07], .33, .31);
    if (visual === 'robotDock') { box([0, .14, .37], [.96, .06, .7], p.metal); for (const x of [-.28, .28]) box([x, .28, .13], [.095, .22, .09], '#d5b579'); }
    else { box([0, .83, .15], [.65, .1, .43], p.trim); screen([.25, .67, .38], .16, .12); }
  } else if (visual === 'processMachine') {
    box([-.28, .79, -.03], [.84, 1.32, .86], p.base); box([.37, .66, 0], [.49, 1.06, .83], p.dark);
    box([-.26, .91, .419], [.57, .61, .036], p.trim); box([-.26, .94, .444], [.44, .43, .022], p.glass, MATERIAL.glass);
    box([.42, .36, .43], [.34, .27, .035], p.metal); screen([.4, 1.14, .45], .22, .24); beacon(-.48, 1.56, -.25);
  } else {
    // Safety / governance portal: posts, light curtains, hinged barrier, controller.
    for (const x of [-.59, .59]) { box([x, .83, 0], [.12, 1.43, .15], p.trim); box([x, .87, .084], [.05, 1.11, .022], p.accent); }
    box([0, 1.59, 0], [1.4, .16, .27], p.base);
    for (const y of [.42, .64, .86, 1.08]) add('box', [0, y, 0], [1.1, .012, .015], p.glass, 0, .22, MATERIAL.glow);
    box([0, .63, .19], [1.12, .085, .085], '#d9b563'); screen([.62, 1.1, .16], .18, .2); beacon(-.59, 1.75, 0);
  }
  return out;
}
