import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  MATERIAL, meshFor, axesFor, transformParts, objectParts, articulationParts,
  isArticulated, unitreeParts, unitreeHumanoidParts, flowCarrierParts,
  UNITREE_HUMANOID_CONCEPT_NOTICE
} from '../public/mesh-assets.js';

const visual = 'unitreeHumanoid', EPS = 1e-6;
const palette = { base: '#eeeeee', dark: '#222222', trim: '#cccccc', metal: '#777777', glass: '#99bbdd', accent: '#55ccaa' };
const rest = unitreeHumanoidParts(), samples = Array.from({ length: 101 }, (_, i) => i / 100);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < EPS, `${message}: ${actual} vs ${expected}`);
const subtract = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const distance = (a, b) => Math.hypot(...subtract(a, b));
const named = (parts, name) => { const item = parts.find(p => p.name === name); assert.ok(item, name); return item; };

// Same column-major position transform as webgl-world's boundsForParts/bakeParts.
function bounds(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const item of parts) {
    const { data } = meshFor(item.shape), axes = axesFor(item);
    for (let i = 0; i < data.length; i += 6) for (let row = 0; row < 3; row++) {
      let value = item.position[row];
      for (let col = 0; col < 3; col++) value += axes[col][row] * data[i + col] * item.size[col];
      min[row] = Math.min(min[row], value); max[row] = Math.max(max[row], value);
    }
  }
  return { min, max };
}
function checkRigidLink(parts, name, start, end, length) {
  const item = named(parts, name), axis = axesFor(item)[1];
  near(item.size[1], length, name + ' rigid length');
  const a = item.position.map((v, i) => v - axis[i] * item.size[1] / 2);
  const b = item.position.map((v, i) => v + axis[i] * item.size[1] / 2);
  near(distance(a, start), 0, name + ' start joint');
  near(distance(b, end), 0, name + ' end joint');
}

test('finite, cached, volumetric triangle meshes with unit normals', () => {
  for (const shape of new Set(rest.map(p => p.shape))) {
    const mesh = meshFor(shape);
    assert.equal(meshFor(shape), mesh, 'geometry cache');
    assert.ok(mesh.data instanceof Float32Array);
    assert.equal(mesh.count, mesh.data.length / 6);
    assert.equal(mesh.count % 3, 0);
    assert.ok(mesh.count >= 36);
    assert.ok(mesh.data.every(Number.isFinite), shape);
    for (let i = 0; i < mesh.data.length; i += 6) near(Math.hypot(...mesh.data.subarray(i + 3, i + 6)), 1, shape + ' normal');
    const b = bounds([{ shape, position: [0, 0, 0], size: [1, 1, 1] }]);
    assert.ok(b.max.every((v, i) => v - b.min[i] > .5), shape + ' is not a billboard');
  }
});

test('authored chest and foot shells are closed, outward-wound nondegenerate solids', () => {
  for (const shape of ['humanoidChest', 'humanoidFoot']) {
    const { data } = meshFor(shape), edges = new Map(); let volume = 0;
    for (let i = 0; i < data.length; i += 18) {
      const [a, b, c] = [0, 6, 12].map(offset => Array.from(data.subarray(i + offset, i + offset + 3)));
      const normal = cross(subtract(b, a), subtract(c, a));
      assert.ok(Math.hypot(...normal) > 1e-8, shape + ' nondegenerate triangle');
      assert.ok(dot(normal, Array.from(data.subarray(i + 3, i + 6))) > 0, shape + ' normal winding');
      volume += dot(a, cross(b, c)) / 6;
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = [u.join(','), v.join(',')].sort().join('|');
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
    assert.ok([...edges.values()].every(count => count === 2), shape + ' manifold edges');
    assert.ok(volume > .5 && volume < 1, shape + ' positive enclosed volume');
  }
});

test('renderer-compatible materials, positive scales, unique names and orthonormal axes', () => {
  for (const t of [0, .16, .34, .65, .86, 1]) {
    const parts = unitreeHumanoidParts(t);
    assert.equal(new Set(parts.map(p => p.name)).size, parts.length);
    for (const item of parts) {
      assert.equal(item.position.length, 3); assert.equal(item.size.length, 3);
      assert.ok(item.position.every(Number.isFinite));
      assert.ok(item.size.every(v => Number.isFinite(v) && v > 0));
      assert.match(item.color, /^#[0-9a-f]{6}$/i);
      assert.ok(Object.values(MATERIAL).includes(item.material));
      assert.ok([item.rotation, item.tilt, item.emissive].every(Number.isFinite));
      const axes = axesFor(item);
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) near(dot(axes[a], axes[b]), a === b ? 1 : 0, item.name + ' axes');
      near(dot(cross(axes[0], axes[1]), axes[2]), 1, item.name + ' handedness');
    }
  }
});

test('humanoid registration and complete preview agree with renderer static/dynamic split', () => {
  assert.equal(isArticulated(visual), true);
  for (const t of [0, .16, .34, .65, .86, 1]) {
    const assembly = unitreeHumanoidParts(t), body = objectParts(visual, palette), pose = articulationParts(visual, palette, t);
    assert.deepEqual(assembly, [...body, ...pose]);
    assert.deepEqual(flowCarrierParts(visual, t), assembly);
    assert.ok(body.length && pose.length);
    assert.ok(body.every(p => !pose.some(q => q.name === p.name)), 'no double-rendered pieces');
  }
  assert.deepEqual(objectParts(visual), objectParts(visual, palette), 'white/graphite palette is independent of catalog fallback');
  assert.equal(named(rest, 'chest-shell').concept, UNITREE_HUMANOID_CONCEPT_NOTICE);
  assert.match(UNITREE_HUMANOID_CONCEPT_NOTICE, /not official Unitree CAD/);
  assert.match(UNITREE_HUMANOID_CONCEPT_NOTICE, /non-physical/);
});

test('distinct upright biped silhouette with separate legs, feet, shoulders, head and hands', () => {
  const b = bounds(rest), height = b.max[1] - b.min[1], width = b.max[2] - b.min[2];
  assert.ok(height > 1.8 && height < 2);
  assert.ok(height / width > 2.4);
  assert.ok(height > bounds(unitreeParts()).max[1] * 1.6, 'not the quadruped silhouette');
  assert.equal(rest.filter(p => p.name.endsWith('-sole')).length, 2);
  assert.equal(rest.filter(p => p.name.endsWith('-thigh')).length, 2);
  assert.equal(rest.filter(p => p.name.endsWith('-palm')).length, 2);
  const chest = bounds([named(rest, 'chest-shell')]), head = bounds([named(rest, 'head-shell')]);
  assert.ok(head.min[1] > chest.max[1], 'distinct neck/head');
  assert.ok(head.max[2] - head.min[2] < (chest.max[2] - chest.min[2]) * .5, 'compact sensor head');
  for (const label of ['left', 'right']) {
    const side = label === 'left' ? 1 : -1;
    for (const suffix of ['sole', 'foot', 'shin', 'thigh']) {
      const limb = bounds([named(rest, label + '-' + suffix)]);
      assert.ok(side > 0 ? limb.min[2] > .06 : limb.max[2] < -.06, 'clear gap between ' + suffix + ' pair');
    }
    const arm = bounds([named(rest, label + '-upper-arm')]);
    assert.ok(side > 0 ? arm.min[2] > chest.max[2] : arm.max[2] < chest.min[2], 'arms separate from chest');
    assert.equal(rest.filter(p => p.name.startsWith(label + '-finger-')).length, 4);
    named(rest, label + '-thumb'); named(rest, label + '-hand-plate');
  }
  assert.equal(rest.filter(p => p.name.startsWith('camera-lens-')).length, 2);
  named(rest, 'lidar-window'); named(rest, 'backpack');
});

test('101 motion samples remain on Y=0 and inside the renderer keyframe bounds', () => {
  const rendererEnvelope = bounds([objectParts(visual, palette), ...[0, .16, .34, .65, .86, 1].map(t => articulationParts(visual, palette, t))].flat());
  for (const t of samples) {
    const parts = unitreeHumanoidParts(t), b = bounds(parts);
    near(b.min[1], 0, 'floor at t=' + t);
    assert.ok([...b.min, ...b.max].every(Number.isFinite));
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(b.min[axis] >= rendererEnvelope.min[axis] - EPS, 'minimum envelope at t=' + t);
      assert.ok(b.max[axis] <= rendererEnvelope.max[axis] + EPS, 'maximum envelope at t=' + t);
    }
    for (const label of ['left', 'right']) {
      const sole = named(parts, label + '-sole');
      assert.deepEqual(sole, named(rest, label + '-sole'), 'stationary sole');
      near(bounds([sole]).min[1], 0, label + ' grounded');
    }
  }
});

test('articulation preserves rigid links, joint connections, attached hands and planted legs', () => {
  const moving = unitreeHumanoidParts(.34);
  assert.ok(distance(named(rest, 'left-wrist').position, named(moving, 'left-wrist').position) > .3);
  assert.notDeepEqual(axesFor(named(rest, 'head-shell')), axesFor(named(moving, 'head-shell')));
  for (const t of samples) for (const label of ['left', 'right']) {
    const parts = unitreeHumanoidParts(t), shoulder = named(parts, label + '-shoulder').position;
    const elbow = named(parts, label + '-elbow').position, wrist = named(parts, label + '-wrist').position;
    checkRigidLink(parts, label + '-upper-arm', shoulder, elbow, .275);
    checkRigidLink(parts, label + '-forearm', elbow, wrist, .255);
    checkRigidLink(parts, label + '-thigh', named(parts, label + '-hip').position, named(parts, label + '-knee').position, .45);
    checkRigidLink(parts, label + '-shin', named(parts, label + '-knee').position, named(parts, label + '-ankle').position, .45);
    near(distance(wrist, named(parts, label + '-palm').position), .055, 'hand follows wrist');
    assert.deepEqual(axesFor(named(parts, label + '-palm')), axesFor(named(parts, label + '-forearm')));
    for (const suffix of ['hip', 'knee', 'ankle', 'foot']) assert.deepEqual(named(parts, label + '-' + suffix), named(rest, label + '-' + suffix));
  }
  assert.deepEqual(unitreeHumanoidParts(1), rest, 'one-shot returns to rest');
});

test('progress sanitization, deterministic poses, continuity and no shared mutable parts', () => {
  for (const t of [undefined, NaN, Infinity, -Infinity, null, 'invalid', {}, -2, 2]) {
    assert.deepEqual(unitreeHumanoidParts(t), rest);
    assert.deepEqual(articulationParts(visual, palette, t), articulationParts(visual, palette, 0));
  }
  for (const t of [.16, .34, .65, .86]) {
    assert.deepEqual(unitreeHumanoidParts(t), unitreeHumanoidParts(t));
    const before = unitreeHumanoidParts(t - 1e-7), after = unitreeHumanoidParts(t + 1e-7);
    for (let i = 0; i < before.length; i++) assert.ok(distance(before[i].position, after[i].position) < 1e-5, 'keyframe continuity');
  }
  const changed = unitreeHumanoidParts(.5); changed[0].position[1] = -100;
  assert.ok(unitreeHumanoidParts(.5)[0].position[1] > 0);
});

test('world yaw, origin and scale preserve ground contact and renderer-compatible frames', () => {
  for (const yaw of [0, .7, Math.PI / 2, Math.PI]) {
    const parts = transformParts(rest, [3, .4, -2], yaw, 1.7), b = bounds(parts);
    near(b.min[1], .4, 'translated floor'); near(b.max[1], .4 + 1.8665 * 1.7, 'scaled height');
    for (const item of parts) near(dot(cross(...axesFor(item).slice(0, 2)), axesFor(item)[2]), 1, 'transformed handedness');
  }
});

test('pre-change quadruped, Joule, UR5/cobot and shared geometry regression fingerprints', () => {
  // Captured from the untouched assemblies before adding the humanoid.
  const expected = {
    unitree: '061606cc48a4f6a425834ceb2b6b624e94b090206f54c7d46e2aa89231f84cd2',
    quadruped: '061606cc48a4f6a425834ceb2b6b624e94b090206f54c7d46e2aa89231f84cd2',
    joule: 'c7d4a3416b48239143e6ae747e7173d354ba1e5ac357e8567b69dfac8331b378',
    robot: '6227cd72577eeced9d77b3ff448d9cbcd99f9cf42c4cc713947ab75b76de36e4',
    cobotCell: '6227cd72577eeced9d77b3ff448d9cbcd99f9cf42c4cc713947ab75b76de36e4',
    mobileManipulator: '033141615433d0029fb4d62948d7f746d41761f8e8d6ae4db91aeedd25756963'
  };
  for (const [v, hash] of Object.entries(expected)) assert.equal(digest([objectParts(v, palette), ...[0, .16, .34, .5, .65, .86, 1].map(t => articulationParts(v, palette, t))]), hash, v);
  assert.equal(digest([0, .5, 1].flatMap(t => ['unitree', 'quadruped', 'robot'].map(v => flowCarrierParts(v, t)))), '1e480e91020ebbbac8716153417cb8a96588e3e0c8e617bdea4f6c9ed6a81a94');
  assert.equal(digest(['box', 'bevel', 'chassis', 'joint', 'link', 'cylinder', 'jouleStar'].map(meshFor)), 'eb4e9671e00b3661654fa0dc41029090373499f32a03d617e0168cd7da11b61d');
});

console.log('Humanoid mesh evidence:', JSON.stringify({ parts: rest.length, triangles: rest.reduce((sum, p) => sum + meshFor(p.shape).count / 3, 0), restBounds: bounds(rest), groundedMotionSamples: samples.length }));
