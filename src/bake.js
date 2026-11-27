// The baker: turns the expensive procedural fields into textures so that the
// per-frame shaders only have to read them.
//
//   terrain A/B   cube maps, re-synthesised when the seed or archetype changes
//                 (hidden behind the exposure dip; sliders never trigger it)
//   clouds        three cube-map snapshots of the flow field; a few rows of
//                 the next snapshot are baked each frame and the shaders blend
//                 between the previous two, so the weather evolves smoothly
//   ring profile  1D strip, re-synthesised with the seed
//   nebula        cube map, synthesised once
//   atmosphere    optical-depth table, integrated once on the CPU
//
// Everything is still computed from 3D positions on the unit sphere; the cube
// maps are just a cache of those values (no UV seams, no polar pinching).
import * as THREE from 'three';
import { ATMOSPHERE } from './shaders/chunks.js';
import {
  BAKE_VERT,
  TERRAIN_SHAPE_FRAG,
  TERRAIN_COVER_FRAG,
  CLOUD_BAKE_FRAG,
  RING_BAKE_FRAG,
} from './shaders/bake.js';
import { SKY_BAKE_FRAG } from './shaders/sky.js';

const CLOUD_PERIOD = 3.0;      // seconds between cloud snapshots

// Relative GPU cost of the bake jobs, used to spread a world bake over frames.
const COST_TERRAIN_SHAPE = 3;
const COST_TERRAIN_COVER = 2;
const COST_CLOUD_FACE = 1;

/** Optical depth towards the sun as a function of (sun zenith cosine, altitude). */
function createAtmosphereLut() {
  const width = 128;
  const height = 64;
  const { planetRadius, shellRadius, scaleHeightRayleigh, scaleHeightMie } = ATMOSPHERE;
  const data = new Uint16Array(width * height * 4);
  const steps = 48;
  for (let j = 0; j < height; j++) {
    const r = planetRadius + ((j + 0.5) / height) * (shellRadius - planetRadius);
    for (let i = 0; i < width; i++) {
      const mu = -0.4 + 1.4 * ((i + 0.5) / width);
      const sinMu = Math.sqrt(Math.max(1 - mu * mu, 0));
      // Distance along the ray from (0, r) to where it leaves the shell.
      const far = -r * mu + Math.sqrt(Math.max(r * r * mu * mu - r * r + shellRadius * shellRadius, 0));
      const ds = far / steps;
      let depthR = 0;
      let depthM = 0;
      for (let k = 0; k < steps; k++) {
        const t = (k + 0.5) * ds;
        const x = sinMu * t;
        const y = r + mu * t;
        const altitude = Math.max(Math.hypot(x, y) - planetRadius, 0);
        depthR += Math.exp(-altitude / scaleHeightRayleigh);
        depthM += Math.exp(-altitude / scaleHeightMie);
      }
      const o = (j * width + i) * 4;
      data[o] = THREE.DataUtils.toHalfFloat(Math.min(depthR * ds, 60000));
      data[o + 1] = THREE.DataUtils.toHalfFloat(Math.min(depthM * ds, 60000));
      data[o + 2] = 0;
      data[o + 3] = THREE.DataUtils.toHalfFloat(1);
    }
  }
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.HalfFloatType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

/**
 * @param {object} sizes  cache sizes from the quality tier (see quality.js):
 *                        terrain / clouds / sky are cube-map faces, ring is a strip
 */
export function createBaker(renderer, uniforms, sizes) {
  // At 1024 a terrain texel is about 1.5 mrad of the surface.
  const TERRAIN_SIZE = sizes.terrain;
  const CLOUD_SIZE = sizes.clouds;
  const SKY_SIZE = sizes.sky;
  const RING_SIZE = sizes.ring;

  // ---- one full-screen triangle, re-used by every pass ----
  const scene = new THREE.Scene();
  const camera = new THREE.Camera();
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(triangle);
  quad.frustumCulled = false;
  scene.add(quad);

  const faceIndex = { value: 0 };
  const faceSize = { value: 1 };
  const cloudTime = { value: 0 };
  const makeMaterial = (name, fragmentShader) => new THREE.ShaderMaterial({
    name,
    uniforms: { ...uniforms, uFace: faceIndex, uFaceSize: faceSize, uCloudTime: cloudTime },
    vertexShader: BAKE_VERT,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
  const materials = {
    shape: makeMaterial('BakeTerrainShape', TERRAIN_SHAPE_FRAG),
    cover: makeMaterial('BakeTerrainCover', TERRAIN_COVER_FRAG),
    cloud: makeMaterial('BakeClouds', CLOUD_BAKE_FRAG),
    ring: makeMaterial('BakeRing', RING_BAKE_FRAG),
    sky: makeMaterial('BakeSky', SKY_BAKE_FRAG),
  };

  // ---- targets ----
  const cube = (size, options) => new THREE.WebGLCubeRenderTarget(size, {
    depthBuffer: false,
    magFilter: THREE.LinearFilter,
    minFilter: THREE.LinearFilter,
    ...options,
  });
  const mipped = { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter };
  const terrainA = cube(TERRAIN_SIZE, { type: THREE.HalfFloatType, ...mipped });
  const terrainB = cube(TERRAIN_SIZE, { type: THREE.UnsignedByteType, ...mipped });
  const cloudTargets = [0, 1, 2].map(() => cube(CLOUD_SIZE, { type: THREE.HalfFloatType, format: THREE.RedFormat }));
  const sky = cube(SKY_SIZE, { type: THREE.HalfFloatType });
  const ring = new THREE.WebGLRenderTarget(RING_SIZE, 1, {
    depthBuffer: false,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    magFilter: THREE.LinearFilter,
    ...mipped,
  });
  ring.texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const atmosphereLut = createAtmosphereLut();

  uniforms.uTerrainA.value = terrainA.texture;
  uniforms.uTerrainB.value = terrainB.texture;
  uniforms.uSkyTex.value = sky.texture;
  uniforms.uRingTex.value = ring.texture;
  uniforms.uAtmoLut.value = atmosphereLut;

  /** Render one pass into (a horizontal band of) a target. */
  function draw(target, material, face, size, y = 0, height = size) {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;   // every texel is overwritten anyway
    faceIndex.value = face;
    faceSize.value = size;
    quad.material = material;
    target.viewport.set(0, 0, target.width, target.height);
    target.scissor.set(0, y, target.width, height);
    target.scissorTest = true;
    renderer.setRenderTarget(target, face);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.autoClear = autoClear;
  }

  /** Bake all six faces; mip maps are generated once, after the last face. */
  function cubeJobs(target, material, size, cost) {
    const hasMips = target.texture.minFilter === THREE.LinearMipmapLinearFilter;
    return [0, 1, 2, 3, 4, 5].map((face) => ({
      cost,
      run() {
        if (hasMips) target.texture.generateMipmaps = face === 5;
        draw(target, material, face, size);
      },
    }));
  }

  // ---- cloud snapshots ----
  // Shown: mix(previous, current). Being baked: next, stamped one period ahead.
  let [previous, current, next] = cloudTargets;
  let currentTime = 0;
  // The next snapshot is baked a few texel rows per frame (all six faces laid
  // end to end), in step with the clock: the cost is the same every frame, so
  // it never shows up as a periodic hitch.
  let rowsDone = 0;
  const rowsTotal = 6 * CLOUD_SIZE;
  // Right after a world bake only one snapshot exists; it stands in for both
  // until the next one is ready (the weather simply starts a moment later).
  let single = false;

  function showClouds(blend) {
    uniforms.uCloudA.value = (single ? current : previous).texture;
    uniforms.uCloudB.value = current.texture;
    uniforms.uCloudBlend.value = blend;
  }

  function cloudSnapshotJobs(target, time) {
    return [0, 1, 2, 3, 4, 5].map((face) => ({
      cost: COST_CLOUD_FACE,
      run() {
        cloudTime.value = time;
        draw(target, materials.cloud, face, CLOUD_SIZE);
      },
    }));
  }

  // ---- world bake queue ----
  let queue = [];

  return {
    cloudPeriod: CLOUD_PERIOD,

    get busy() {
      return queue.length > 0;
    },

    /** Synthesised once: the galactic dust band behind the stars. */
    bakeSky() {
      for (let face = 0; face < 6; face++) draw(sky, materials.sky, face, SKY_SIZE);
    },

    /**
     * Queue a full re-synthesis of the world (new seed or archetype). Reads
     * the current uniforms, so call it after the state has been written.
     */
    requestWorld(time) {
      // As many octaves as the cache can hold: the finest one spans ~3 texels.
      const texel = (Math.PI / 2) / TERRAIN_SIZE;
      const octaves = 1 + Math.log2(1 / (3 * texel * uniforms.uContFreq.value));
      uniforms.uOct.value = THREE.MathUtils.clamp(octaves, 4, 9);

      currentTime = time;
      rowsDone = 0;
      single = true;
      queue = [
        ...cubeJobs(terrainA, materials.shape, TERRAIN_SIZE, COST_TERRAIN_SHAPE),
        ...cubeJobs(terrainB, materials.cover, TERRAIN_SIZE, COST_TERRAIN_COVER),
        { cost: 0.1, run: () => draw(ring, materials.ring, 0, RING_SIZE, 0, 1) },
        ...cloudSnapshotJobs(current, time),
      ];
      showClouds(0);
    },

    /** Run queued bake jobs worth up to "budget". Returns true when idle. */
    step(budget = Infinity) {
      let spent = 0;
      while (queue.length > 0 && spent < budget) {
        const job = queue.shift();
        job.run();
        spent += job.cost;
      }
      return queue.length === 0;
    },

    /** Advance the cloud snapshots. Call once per frame, outside a world bake. */
    updateClouds(time) {
      if (queue.length > 0) return;
      let phase = (time - currentTime) / CLOUD_PERIOD;
      if (phase < 0 || phase > 2) {
        // Time jumped: restart the cycle from here.
        currentTime = time;
        phase = 0;
      }
      const due = Math.min(rowsTotal, Math.ceil(phase * rowsTotal));
      cloudTime.value = currentTime + CLOUD_PERIOD;
      while (rowsDone < due) {
        const face = Math.floor(rowsDone / CLOUD_SIZE);
        const row = rowsDone % CLOUD_SIZE;
        const rows = Math.min(due - rowsDone, CLOUD_SIZE - row);
        draw(next, materials.cloud, face, CLOUD_SIZE, row, rows);
        rowsDone += rows;
      }
      if (phase >= 1) {
        // "next" is complete: it becomes the newest snapshot.
        [previous, current, next] = [current, next, previous];
        currentTime += CLOUD_PERIOD;
        rowsDone = 0;
        single = false;
        phase -= 1;
      }
      showClouds(THREE.MathUtils.clamp(phase, 0, 1));
    },
  };
}
