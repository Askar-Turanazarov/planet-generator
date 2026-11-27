// Height of the drawn ground at a few points, from the GPU (FLIGHT-PLAN.md,
// stages D and H).
//
// The coarse height map (heightmap.js) is a cell of tens of kilometres: in the
// mountains the real ground can stand a kilometre above it. The flight needs
// the ground the terrain mesh actually draws, so this probe evaluates the same
// height as the terrain's vertex shader (cache at the matching mip level plus
// the octaves of fine relief the grid carries there) for up to PROBE_SLOTS
// directions, into a row of float pixels that is read back without stalling.
// The answer is one to three frames old, which the flight's clearance covers.
import * as THREE from 'three';
import { GLSL_NOISE, GLSL_RELIEF_DETAIL } from './shaders/chunks.js';

export const PROBE_SLOTS = 4;

const GROUND_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const GROUND_FRAG = /* glsl */ `
precision highp float;
precision highp int;
uniform vec3 uSeed;
float sat01(float x) {
  return clamp(x, 0.0, 1.0);
}
${GLSL_NOISE}
${GLSL_RELIEF_DETAIL}
uniform samplerCube uTerrainA;
uniform float uSeaLevel;
uniform float uRelief;
uniform float uRidge;
uniform vec3 uProbeHi[${PROBE_SLOTS}];
uniform vec3 uProbeLo[${PROBE_SLOTS}];
uniform float uProbeFine[${PROBE_SLOTS}];
void main() {
  int i = int(gl_FragCoord.x);
  vec3 hi = uProbeHi[i];
  vec3 lo = uProbeLo[i];
  float fine = uProbeFine[i];
  vec3 p = normalize(hi + lo);
  float texel = 1.5708 / float(textureSize(uTerrainA, 0).x);
  vec4 shape = textureLod(uTerrainA, p, log2(max(fine / texel, 1.0)));
  float h = shape.x + uRelief * uRidge * shape.y;
  if (h > uSeaLevel - 0.03) {
    float ridged = sat01(0.3 + 1.5 * shape.y) * sat01(uRelief * uRidge);
    h += reliefDetail(hi, lo, vec3(0.0), fine, 1e30, detailSlope(shape, uRelief * uRidge), ridged).w;
  }
  gl_FragColor = vec4(h, 0.0, 0.0, 1.0);
}
`;

export function createGroundProbe(renderer) {
  const gl = renderer.getContext();
  if (!gl.getExtension('EXT_color_buffer_float')) return null;
  const target = new THREE.WebGLRenderTarget(PROBE_SLOTS, 1, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestFilter,
    depthBuffer: false,
    generateMipmaps: false,
  });
  const hi = Array.from({ length: PROBE_SLOTS }, () => new THREE.Vector3());
  const lo = Array.from({ length: PROBE_SLOTS }, () => new THREE.Vector3());
  const fine = new Float32Array(PROBE_SLOTS);
  let material = null;
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const quad = new THREE.Mesh(triangle);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.Camera();
  const pixels = new Float32Array(PROBE_SLOTS * 4);
  const values = new Float32Array(PROBE_SLOTS);
  let pending = false;
  let generation = 0;
  let valid = false;

  function setup(uniforms) {
    if (material) return;
    material = new THREE.ShaderMaterial({
      name: 'GroundProbe',
      uniforms: {
        uSeed: uniforms.uSeed,
        uTerrainA: uniforms.uTerrainA,
        uSeaLevel: uniforms.uSeaLevel,
        uRelief: uniforms.uRelief,
        uRidge: uniforms.uRidge,
        uRealScale: uniforms.uRealScale,
        uProbeHi: { value: hi },
        uProbeLo: { value: lo },
        uProbeFine: { value: fine },
      },
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    quad.material = material;
  }

  /** Points to measure: unit directions in planet space and the grid spacing there (radii). */
  function place(samples) {
    for (let i = 0; i < PROBE_SLOTS; i++) {
      const s = samples[Math.min(i, samples.length - 1)];
      for (let k = 0; k < 3; k++) {
        const v = s.dir.getComponent(k);
        const h = Math.round(v * 4096) / 4096;
        hi[i].setComponent(k, h);
        lo[i].setComponent(k, v - h);
      }
      fine[i] = s.fine;
    }
  }

  function draw() {
    const previous = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previous);
  }

  return {
    /** Elevations (elevation units, before the sea is levelled) of the last answer, or null. */
    get values() {
      return valid ? values : null;
    },
    /** The world changed: drop answers about the old one. */
    invalidate() {
      generation++;
      valid = false;
    },
    /** Ask again if the last question has been answered (non-blocking). */
    request(uniforms, samples) {
      if (pending) return;
      setup(uniforms);
      place(samples);
      draw();
      pending = true;
      const asked = generation;
      renderer.readRenderTargetPixelsAsync(target, 0, 0, PROBE_SLOTS, 1, pixels).then(() => {
        pending = false;
        if (asked !== generation) return;
        for (let i = 0; i < PROBE_SLOTS; i++) values[i] = pixels[i * 4];
        valid = true;
      }, () => {
        pending = false;
      });
    },
    /** Measure now and wait for it (stalls the GPU: for jumps and checks, not every frame). */
    measure(uniforms, samples) {
      setup(uniforms);
      place(samples);
      draw();
      renderer.readRenderTargetPixels(target, 0, 0, PROBE_SLOTS, 1, pixels);
      for (let i = 0; i < PROBE_SLOTS; i++) values[i] = pixels[i * 4];
      valid = true;
      return values;
    },
  };
}
