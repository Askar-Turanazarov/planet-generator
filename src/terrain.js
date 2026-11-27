// The planet's surface as a quadtree of patches on a cube-sphere (CDLOD,
// FLIGHT-PLAN.md stage D). One grid of TERRAIN_GRID x TERRAIN_GRID cells is
// drawn once per visible patch (instancing): a patch is split while the
// camera is closer than LOD_K of its edges, down to about a metre per cell, so
// the same mesh serves the orbit view (a few dozen patches) and the flight at
// 150 m (a few hundred).
//
// Everything about a patch that needs more than a float's precision is worked
// out here in doubles: its centre relative to the camera, and the split of the
// centre into a coarse and a fine part for the noise (see GLSL_RELIEF_DETAIL).
import * as THREE from 'three';
import { TERRAIN_VERT, TERRAIN_GRID } from './shaders/terrain.js';
import { PLANET_FRAG } from './shaders/planet.js';
import { LAYER } from './scenePass.js';
import { DETAIL } from './shaders/chunks.js';

// Patches split closer than lodK of their edges (the quality profile may change it).
const LOD_K = 2.5;
const MAX_PATCHES = 1500;
const CELL_METRES = 1.2;       // deepest level: about this much ground per cell
// Height band the relief can reach (km), for culling. Generous on purpose.
const RELIEF_KM = { below: 14, above: 30, grain: 1.5 };
// Most the noise octaves can add to the cache's relief (planet radii): the
// sum of their amplitudes at the steepest (see detailSlope, GLSL_RELIEF_DETAIL).
const DETAIL_REACH = (0.103 / 2.5) * (2 / DETAIL.f0);

// Cube faces: normal, then the in-face axes U and V with U x V = normal
// (the vertex shader keeps the same table).
const FACES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];

function patchGeometry() {
  const n = TERRAIN_GRID;
  const row = n + 1;
  const grid = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) grid.push(i, j, 0);
  const index = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * row + i;
      // Alternate the diagonal so the grid has no directional grain.
      if ((i + j) % 2 === 0) index.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
      else index.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  // Skirt: a copy of the border hanging down, stitched to it.
  const border = [];
  for (let i = 0; i < n; i++) border.push([i, 0]);
  for (let j = 0; j < n; j++) border.push([n, j]);
  for (let i = n; i > 0; i--) border.push([i, n]);
  for (let j = n; j > 0; j--) border.push([0, j]);
  const base = grid.length / 3;
  border.forEach(([i, j]) => grid.push(i, j, 1));
  const count = border.length;
  for (let k = 0; k < count; k++) {
    const [i0, j0] = border[k];
    const [i1, j1] = border[(k + 1) % count];
    const top0 = j0 * row + i0;
    const top1 = j1 * row + i1;
    const low0 = base + k;
    const low1 = base + ((k + 1) % count);
    // Both windings: the skirt is seen from outside the patch either way.
    index.push(top0, low0, top1, top1, low0, low1, top0, top1, low0, top1, low1, low0);
  }
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute('grid', new THREE.Float32BufferAttribute(grid, 3));
  geometry.setIndex(index);
  return geometry;
}

export function createTerrain(uniforms, heightmap = null) {
  const geometry = patchGeometry();
  const buffers = {};
  for (const name of ['aRel', 'aCube', 'aHi', 'aLo']) {
    const attribute = new THREE.InstancedBufferAttribute(new Float32Array(MAX_PATCHES * 4), 4);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, attribute);
    buffers[name] = attribute;
  }
  geometry.instanceCount = 0;

  const material = new THREE.ShaderMaterial({
    name: 'Planet',
    uniforms,
    vertexShader: TERRAIN_VERT,
    fragmentShader: PLANET_FRAG,
    // Opaque in practice: alpha is only the analytic coverage of the limb.
    transparent: true,
    depthWrite: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.layers.set(LAYER.NEAR);

  const camLocal = new THREE.Vector3();
  const toView = new THREE.Matrix4();
  const clip = new THREE.Matrix4();
  const frustum = new THREE.Frustum();
  const tmp = new THREE.Vector3();
  const centre = new THREE.Vector3();
  const unit = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const lowPoint = new THREE.Vector3();
  const highPoint = new THREE.Vector3();
  // Side planes of the view, and a plane through the camera across the view
  // direction (the near plane of the passes is not this one).
  const front = new THREE.Plane();
  const planes = [];
  const stats = { patches: 0, nodes: 0, deepest: 0, maxLevel: 0 };
  const settings = { lodK: LOD_K };
  let lodK = LOD_K;
  // Patches chosen this frame, drawn nearest first so the depth test rejects
  // the hidden ground before it is shaded (the pixel shader is the cost).
  const chosen = [];
  const pool = [];
  let picked = 0;
  let count = 0;
  let maxLevel = 18;
  let lodRadius = 1;
  let horizonCos = -1;
  let camDir = new THREE.Vector3();
  let low = 0;
  let high = 0;
  let slack = 0;

  function emit(face, cube, size, edge, p0) {
    if (count >= MAX_PATCHES) return;
    const o = count * 4;
    const rel = buffers.aRel.array;
    rel[o] = p0.x - camLocal.x;
    rel[o + 1] = p0.y - camLocal.y;
    rel[o + 2] = p0.z - camLocal.z;
    rel[o + 3] = face;
    const c = buffers.aCube.array;
    c[o] = cube.x;
    c[o + 1] = cube.y;
    c[o + 2] = cube.z;
    c[o + 3] = size;
    const hi = buffers.aHi.array;
    const lo = buffers.aLo.array;
    for (let k = 0; k < 3; k++) {
      const v = p0.getComponent(k);
      const h = Math.round(v * 4096) / 4096;
      hi[o + k] = h;
      lo[o + k] = v - h;
    }
    hi[o + 3] = edge;
    lo[o + 3] = lodK * edge * 2;
    count++;
  }

  function visit(face, u0, v0, size, level) {
    stats.nodes++;
    const [n, u, v] = FACES[face];
    const half = size / 2;
    const cu = u0 + half;
    const cv = v0 + half;
    // Scratch vectors: a node either recurses or is stored, never both, so
    // the children may overwrite them.
    const cube = centre.set(
      n[0] + cu * u[0] + cv * v[0], n[1] + cu * u[1] + cv * v[1], n[2] + cu * u[2] + cv * v[2]);
    const p0 = unit.copy(cube).normalize();
    // Half diagonal on the sphere: the farthest corner from the centre.
    let reach = 0;
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const a = cu + su * half;
      const b = cv + sv * half;
      corner.set(n[0] + a * u[0] + b * v[0], n[1] + a * u[1] + b * v[1], n[2] + a * u[2] + b * v[2]).normalize();
      reach = Math.max(reach, corner.distanceTo(p0));
    }
    const edge = reach * Math.SQRT2;

    // Beyond the horizon (of the highest ground it could hold)?
    if (p0.dot(camDir) < horizonCos - reach) return;
    // Outside the view? The four side planes only: depth is the passes' business.
    // Height band of the patch from the coarse height map, widened by what the
    // finer relief can add.
    let pLow = low;
    let pHigh = high;
    const band = heightmap && heightmap.range(face, u0, v0, size);
    if (band) {
      const scale = uniforms.uRealScale.value;
      const sea = uniforms.uSeaLevel.value;
      const datum = uniforms.uBiomeDatum.value;
      pLow = (Math.max(band.lo, sea) - datum) * scale - slack;
      pHigh = (Math.max(band.hi, sea) - datum) * scale + slack;
    }
    // The patch lies within 'reach' of the radial segment between its lowest
    // and highest possible ground: outside if both ends are beyond one plane.
    lowPoint.copy(p0).multiplyScalar(1 + pLow);
    highPoint.copy(p0).multiplyScalar(1 + pHigh);
    for (const plane of planes) {
      if (Math.max(plane.distanceToPoint(lowPoint), plane.distanceToPoint(highPoint)) < -reach) return;
    }

    const dist = tmp.copy(p0).multiplyScalar(lodRadius).distanceTo(camLocal) - reach;
    if (level < maxLevel && dist < lodK * edge) {
      visit(face, u0, v0, half, level + 1);
      visit(face, u0 + half, v0, half, level + 1);
      visit(face, u0, v0 + half, half, level + 1);
      visit(face, u0 + half, v0 + half, half, level + 1);
      return;
    }
    stats.deepest = Math.max(stats.deepest, level);
    if (picked >= MAX_PATCHES) return;
    const patch = pool[picked] || (pool[picked] = { face: 0, cube: new THREE.Vector3(), size: 0, edge: 0, p0: new THREE.Vector3(), dist: 0 });
    patch.face = face;
    patch.cube.copy(cube);
    patch.size = size;
    patch.edge = edge;
    patch.p0.copy(p0);
    patch.dist = dist;
    chosen[picked++] = patch;
  }

  const nearestFirst = (a, b) => a.dist - b.dist;

  return {
    mesh,
    stats,
    settings,
    /**
     * Choose the patches for this frame. "planet" is the object the mesh
     * hangs from, "radiusKm" the planet's radius, "groundRadius" the radius
     * of the ground under the camera (the level of detail is measured from it).
     */
    update(camera, planet, radiusKm, groundRadius = 1) {
      planet.updateMatrixWorld();
      camera.updateMatrixWorld();
      camLocal.copy(camera.position);
      planet.worldToLocal(camLocal);
      lodRadius = groundRadius;
      lodK = settings.lodK;
      low = -RELIEF_KM.below / radiusKm;
      high = RELIEF_KM.above / radiusKm;
      // The finer relief (GLSL_RELIEF_DETAIL) and the cache's own finer grain.
      slack = DETAIL_REACH + RELIEF_KM.grain / radiusKm;
      maxLevel = Math.max(8, Math.round(Math.log2((Math.PI / 2) * radiusKm * 1000 / (TERRAIN_GRID * CELL_METRES))));
      stats.maxLevel = maxLevel;
      const r = Math.max(camLocal.length(), 1 + 1e-9);
      camDir = camLocal.clone().normalize();
      // Angle to the horizon from the camera plus from the highest peak.
      horizonCos = Math.cos(Math.min(Math.acos(1 / r) + Math.acos(1 / (1 + high)), Math.PI));

      // Planet space -> view space, rotation only (the translation is in aRel).
      toView.multiplyMatrices(camera.matrixWorldInverse.copy(camera.matrixWorld).invert(), planet.matrixWorld);
      uniforms.uLocalToView.value.setFromMatrix4(toView);
      // Frustum in planet space (the planet is at the origin, turned only).
      frustum.setFromProjectionMatrix(clip.multiplyMatrices(camera.projectionMatrix, toView));
      const forward = tmp.set(-toView.elements[2], -toView.elements[6], -toView.elements[10]).normalize();
      front.setFromNormalAndCoplanarPoint(forward, camLocal);
      planes.length = 0;
      planes.push(frustum.planes[0], frustum.planes[1], frustum.planes[2], frustum.planes[3], front);
      uniforms.uLodRadius.value = lodRadius;
      uniforms.uLodK.value = lodK;

      count = 0;
      stats.nodes = 0;
      stats.deepest = 0;
      picked = 0;
      for (let face = 0; face < 6; face++) visit(face, -1, -1, 2, 0);
      chosen.length = picked;
      chosen.sort(nearestFirst);
      for (const patch of chosen) emit(patch.face, patch.cube, patch.size, patch.edge, patch.p0);
      stats.patches = count;
      geometry.instanceCount = count;
      for (const name in buffers) {
        buffers[name].clearUpdateRanges();
        buffers[name].addUpdateRange(0, count * 4);
        buffers[name].needsUpdate = true;
      }
    },
  };
}
