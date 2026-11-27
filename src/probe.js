// Reads the ground under one point of the planet back from the GPU.
//
// One tiny draw (three pixels, see shaders/probe.js) and an asynchronous
// read: the frame never waits for the GPU. Requests are not queued; while a
// read is in flight only the newest request is kept, so a finger dragging the
// marker around never builds up a backlog.
import * as THREE from 'three';
import { PROBE_VERT, PROBE_FRAG } from './shaders/probe.js';

export function createProbe(renderer, uniforms) {
  const target = new THREE.WebGLRenderTarget(3, 1, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
  const probeDir = { value: new THREE.Vector3(0, 1, 0) };
  const material = new THREE.ShaderMaterial({
    name: 'Probe',
    uniforms: { ...uniforms, uProbeDir: probeDir },
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

  let busy = false;
  let waiting = null;     // { dir, resolve } of the newest request while busy

  function decode(dir) {
    const b = pixels;
    const n = (i) => b[i] / 255;
    const h0 = ((b[0] * 256 + b[1]) / 65535) * 8 - 4;
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

  async function read(dir) {
    probeDir.value.copy(dir).normalize();
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
    if (typeof renderer.readRenderTargetPixelsAsync === 'function') {
      await renderer.readRenderTargetPixelsAsync(target, 0, 0, 3, 1, pixels);
    } else {
      renderer.readRenderTargetPixels(target, 0, 0, 3, 1, pixels);
    }
    return decode(probeDir.value);
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
    dispose() {
      target.dispose();
      material.dispose();
      triangle.dispose();
    },
  };
}
