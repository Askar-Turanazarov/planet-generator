// Reads the ground under one point of the planet back from the GPU.
//
// One tiny draw (three pixels, see shaders/probe.js) and an asynchronous
// read: the frame never waits for the GPU. Requests are not queued; while a
// read is in flight only the newest request is kept, so a finger dragging the
// marker around never builds up a backlog.
//
// sampleMany() reads up to MAX_POINTS points in one draw (the photo
// expedition judges a picture by a grid of points on the planet). It has a
// target of its own and is never dropped for a newer request.
import * as THREE from 'three';
import { PROBE_VERT, PROBE_FRAG } from './shaders/probe.js';

export const MAX_POINTS = 64;

export function createProbe(renderer, uniforms) {
  const makeTarget = (rows) => new THREE.WebGLRenderTarget(3, rows, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
  const target = makeTarget(1);
  const batchTarget = makeTarget(MAX_POINTS);
  // Directions, one texel per point. Each draw uploads it afresh; the draws
  // are issued in order, so a later one never changes what an earlier one read.
  const dirData = new Float32Array(MAX_POINTS * 4);
  const dirs = new THREE.DataTexture(dirData, MAX_POINTS, 1, THREE.RGBAFormat, THREE.FloatType);
  dirs.magFilter = THREE.NearestFilter;
  dirs.minFilter = THREE.NearestFilter;
  dirs.generateMipmaps = false;
  const material = new THREE.ShaderMaterial({
    name: 'Probe',
    uniforms: { ...uniforms, uProbeDirs: { value: dirs } },
    vertexShader: PROBE_VERT,
    fragmentShader: PROBE_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  // One triangle that covers the whole target.
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(triangle, material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.Camera();
  const pixels = new Uint8Array(12);
  const batchPixels = new Uint8Array(12 * MAX_POINTS);

  let busy = false;
  let waiting = null;     // { dir, resolve } of the newest request while busy

  function decode(dir, b = pixels, row = 0) {
    const n = (i) => b[row * 12 + i] / 255;
    const h0 = ((b[row * 12] * 256 + b[row * 12 + 1]) / 65535) * 8 - 4;
    return {
      dir: [dir.x, dir.y, dir.z],
      lat: Math.abs(dir.y),
      h0,
      moist: n(2),
      steep: n(3),
      cold: n(4),
      snow: n(5),
      ice: n(6),
      rock: n(7),
      shore: n(8),
      vein: n(9),
      city: n(10),
      climateY: n(11) * 2 - 1,
    };
  }

  /** Draw the points into a target and read them back. */
  async function draw(list, into, buffer) {
    list.forEach((d, i) => dirData.set([d.x, d.y, d.z, 0], i * 4));
    dirs.needsUpdate = true;
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(into);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    if (typeof renderer.readRenderTargetPixelsAsync === 'function') {
      await renderer.readRenderTargetPixelsAsync(into, 0, 0, 3, list.length, buffer);
    } else {
      renderer.readRenderTargetPixels(into, 0, 0, 3, list.length, buffer);
    }
  }

  async function read(dir) {
    const unit = dir.clone().normalize();
    await draw([unit], target, pixels);
    return decode(unit);
  }

  return {
    material,
    /** A scene holding the probe material, for compiling it ahead of use. */
    compileScene() {
      return scene;
    },
    /**
     * Sample the ground at a direction in planet space. Resolves with the
     * reading, or with null when a newer request took its place.
     */
    sample(dir) {
      const wanted = dir.clone();
      if (busy) {
        if (waiting) waiting.resolve(null);
        return new Promise((resolve) => { waiting = { dir: wanted, resolve }; });
      }
      busy = true;
      const run = async (d) => {
        let result = null;
        try {
          result = await read(d);
        } catch (error) {
          // A lost context or a refused read: no reading this time.
          result = null;
        }
        if (waiting) {
          const next = waiting;
          waiting = null;
          run(next.dir).then(next.resolve);
        } else {
          busy = false;
        }
        return result;
      };
      return run(wanted);
    },
    /**
     * Sample up to MAX_POINTS directions at once. Resolves with one reading
     * per direction, or with null if the read failed (a lost context).
     */
    async sampleMany(list) {
      const units = list.slice(0, MAX_POINTS).map((d) => d.clone().normalize());
      if (units.length === 0) return [];
      try {
        await draw(units, batchTarget, batchPixels);
      } catch (error) {
        return null;
      }
      return units.map((unit, i) => decode(unit, batchPixels, i));
    },
    dispose() {
      target.dispose();
      batchTarget.dispose();
      dirs.dispose();
      material.dispose();
      triangle.dispose();
    },
  };
}
