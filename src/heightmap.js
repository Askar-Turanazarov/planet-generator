// A coarse copy of the terrain cache on the CPU (FLIGHT-PLAN.md, stages D and H).
//
// Once per world (after the bake) the two relief terms of the cache, base
// elevation and mountain term, are drawn into a small grid per cube face and
// read back. The elevation itself is assembled here as the shaders do it
// (base + relief * ridge * mountain), so moving the relief slider needs no
// new read. The terrain quadtree culls with the height range of each patch,
// the flight knows roughly how high the ground is, and the quick targets
// (stage H) search it for peaks and coasts.
//
// The grid uses the face table of terrain.js: point = n + a u + b v, a and b
// in [-1, 1], sampled at cell centres.
import * as THREE from 'three';

export const HEIGHTMAP_SIZE = 256;

// Same table as terrain.js (normal, U, V).
const FACE_AXES = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
];

const READ_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const READ_FRAG = /* glsl */ `
precision highp float;
uniform samplerCube uTerrainA;
uniform float uSize;
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  float face = floor(cell.y / uSize);
  vec2 ab = (vec2(cell.x, cell.y - face * uSize) + 0.5) / uSize * 2.0 - 1.0;
  vec3 n, u, v;
  if (face < 0.5) { n = vec3(1.0, 0.0, 0.0); u = vec3(0.0, 0.0, -1.0); v = vec3(0.0, 1.0, 0.0); }
  else if (face < 1.5) { n = vec3(-1.0, 0.0, 0.0); u = vec3(0.0, 0.0, 1.0); v = vec3(0.0, 1.0, 0.0); }
  else if (face < 2.5) { n = vec3(0.0, 1.0, 0.0); u = vec3(1.0, 0.0, 0.0); v = vec3(0.0, 0.0, -1.0); }
  else if (face < 3.5) { n = vec3(0.0, -1.0, 0.0); u = vec3(1.0, 0.0, 0.0); v = vec3(0.0, 0.0, 1.0); }
  else if (face < 4.5) { n = vec3(0.0, 0.0, 1.0); u = vec3(1.0, 0.0, 0.0); v = vec3(0.0, 1.0, 0.0); }
  else { n = vec3(0.0, 0.0, -1.0); u = vec3(-1.0, 0.0, 0.0); v = vec3(0.0, 1.0, 0.0); }
  vec3 dir = normalize(n + ab.x * u + ab.y * v);
  gl_FragColor = vec4(textureLod(uTerrainA, dir, 0.0).xy, 0.0, 1.0);
}
`;

export function createHeightmap(renderer, uniforms) {
  const size = HEIGHTMAP_SIZE;
  const gl = renderer.getContext();
  const floatRead = !!gl.getExtension('EXT_color_buffer_float');
  const target = new THREE.WebGLRenderTarget(size, size * 6, {
    type: floatRead ? THREE.FloatType : THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
  const material = new THREE.ShaderMaterial({
    name: 'HeightRead',
    uniforms: { uTerrainA: uniforms.uTerrainA, uSize: { value: size } },
    vertexShader: READ_VERT,
    fragmentShader: READ_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(triangle, material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.Camera();
  const raw = floatRead ? new Float32Array(size * size * 6 * 4) : new Uint16Array(size * size * 6 * 4);

  const base = new Float32Array(size * size * 6);
  const mount = new Float32Array(size * size * 6);
  const elevation = new Float32Array(size * size * 6);
  // Min / max pyramids per face, built for the current relief factor.
  let pyramid = null;
  let factor = NaN;
  let ready = false;

  function read() {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(target, 0, 0, size, size * 6, raw);
    renderer.setRenderTarget(previous);
    const decode = floatRead ? (x) => x : THREE.DataUtils.fromHalfFloat;
    for (let i = 0; i < base.length; i++) {
      base[i] = decode(raw[i * 4]);
      mount[i] = decode(raw[i * 4 + 1]);
    }
    factor = NaN;
    ready = true;
  }

  /** Elevation grid and min / max pyramids for relief * ridge = k. */
  function refresh() {
    const k = uniforms.uRelief.value * uniforms.uRidge.value;
    if (Math.abs(k - factor) < 1e-4) return;
    factor = k;
    for (let i = 0; i < base.length; i++) elevation[i] = base[i] + k * mount[i];
    pyramid = [];
    for (let face = 0; face < 6; face++) {
      const levels = [];
      let n = size;
      let lo = elevation.slice(face * size * size, (face + 1) * size * size);
      let hi = lo;
      levels.push({ n, lo, hi });
      while (n > 1) {
        const m = n / 2;
        const nlo = new Float32Array(m * m);
        const nhi = new Float32Array(m * m);
        for (let y = 0; y < m; y++) {
          for (let x = 0; x < m; x++) {
            const a = 2 * y * n + 2 * x;
            nlo[y * m + x] = Math.min(lo[a], lo[a + 1], lo[a + n], lo[a + n + 1]);
            nhi[y * m + x] = Math.max(hi[a], hi[a + 1], hi[a + n], hi[a + n + 1]);
          }
        }
        levels.push({ n: m, lo: nlo, hi: nhi });
        lo = nlo;
        hi = nhi;
        n = m;
      }
      pyramid.push(levels);
    }
  }

  const out = { lo: 0, hi: 0 };
  return {
    get ready() {
      return ready;
    },
    read,
    /** The cache was rebuilt: read it again before the next use. */
    invalidate() {
      ready = false;
    },
    /**
     * Elevation range (elevation units) over the square [a0, a0+size] x [b0, b0+size]
     * of a face, in face coordinates. Widened by one cell, since the grid is
     * coarser than the cache.
     */
    range(face, a0, b0, span) {
      if (!ready) return null;
      refresh();
      const levels = pyramid[face];
      // Level whose cells are at least as large as the square.
      const cells = (span / 2) * size;
      const level = Math.min(Math.max(Math.ceil(Math.log2(Math.max(cells, 1))), 0), levels.length - 1);
      const { n, lo, hi } = levels[level];
      const toCell = (t) => ((t + 1) / 2) * n;
      const x0 = Math.max(Math.floor(toCell(a0)) - 1, 0);
      const x1 = Math.min(Math.ceil(toCell(a0 + span)), n - 1);
      const y0 = Math.max(Math.floor(toCell(b0)) - 1, 0);
      const y1 = Math.min(Math.ceil(toCell(b0 + span)), n - 1);
      let mn = Infinity;
      let mx = -Infinity;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          mn = Math.min(mn, lo[y * n + x]);
          mx = Math.max(mx, hi[y * n + x]);
        }
      }
      out.lo = mn;
      out.hi = mx;
      return out;
    },
    /** Elevation (elevation units) in planet-space direction "dir" (bilinear), or null. */
    elevationAt(dir) {
      if (!ready) return null;
      refresh();
      const ax = Math.abs(dir.x);
      const ay = Math.abs(dir.y);
      const az = Math.abs(dir.z);
      let face;
      if (ax >= ay && ax >= az) face = dir.x > 0 ? 0 : 1;
      else if (ay >= az) face = dir.y > 0 ? 2 : 3;
      else face = dir.z > 0 ? 4 : 5;
      const [n, u, v] = FACE_AXES[face];
      const along = dir.x * n[0] + dir.y * n[1] + dir.z * n[2];
      const a = (dir.x * u[0] + dir.y * u[1] + dir.z * u[2]) / along;
      const b = (dir.x * v[0] + dir.y * v[1] + dir.z * v[2]) / along;
      const fx = THREE.MathUtils.clamp(((a + 1) / 2) * size - 0.5, 0, size - 1.001);
      const fy = THREE.MathUtils.clamp(((b + 1) / 2) * size - 0.5, 0, size - 1.001);
      const x = Math.floor(fx);
      const y = Math.floor(fy);
      const tx = fx - x;
      const ty = fy - y;
      const o = face * size * size;
      const e = (i, j) => elevation[o + (y + j) * size + (x + i)];
      return (e(0, 0) * (1 - tx) + e(1, 0) * tx) * (1 - ty) + (e(0, 1) * (1 - tx) + e(1, 1) * tx) * ty;
    },
    /** The raw grids (for searches): elevation per face, row-major, after refresh. */
    grid() {
      if (!ready) return null;
      refresh();
      return { size, elevation };
    },
  };
}
