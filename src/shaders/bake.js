// Bake passes: full-screen shaders that synthesise the procedural fields into
// cube maps and lookup textures. They run once per world (terrain, rings),
// once per session (nebula) or a sliver per frame (clouds); the per-frame
// shaders then only read the results.
import {
  GLSL_COMMON,
  GLSL_NOISE,
  GLSL_CUBE_FACE,
  GLSL_TERRAIN_FIELD,
  GLSL_CLOUD_FIELD,
  GLSL_RING_FIELD,
} from './chunks.js';

// One oversized triangle covering the viewport.
export const BAKE_VERT = /* glsl */ `
precision highp float;

void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Terrain cache A: (base elevation, mountain term, vein mask, ridge value).
export const TERRAIN_SHAPE_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_CUBE_FACE}
${GLSL_TERRAIN_FIELD}

void main() {
  gl_FragColor = terrainFields(faceDirection());
}
`;

// Terrain cache B: (climate noise x, climate noise y, city lights, land-cover grain).
export const TERRAIN_COVER_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_CUBE_FACE}
${GLSL_TERRAIN_FIELD}

void main() {
  vec3 p = faceDirection();

  // The first two components of the continental warp double as the climate
  // noise behind moisture, snow lines and the ragged edge of the ice caps.
  vec3 q = p * uContFreq + uSeed;
  float wx = fbm(q + vec3(1.7, 9.2, 3.4), 2.0);
  float wy = fbm(q + vec3(8.3, -2.8, 5.1), 2.0);

  // --- civilisation pattern (masked by habitability at run time) ---
  // Regional population density.
  float region = fbm(p * 7.0 + uSeed.yzx + 9.0, 3.0);
  float cluster = smoothstep(-0.05, 0.45, region);
  // Street level: a dense grid of point lights about a texel across, each
  // with its own brightness and a good share of them dark. Everything below
  // is built out of these points, so a city reads as a swarm of lights.
  vec3 v0 = voronoi(p * 230.0 + uSeed.yzx);
  float bead = smoothstep(0.50, 0.12, v0.x);
  float lamp = bead * step(0.38, v0.z) * (0.45 + 0.9 * v0.z);
  // Towns: a bright centre and a handful of lights around it.
  vec3 v1 = voronoi(p * 64.0 + uSeed);
  float town = step(0.45, v1.z)
      * (0.9 * smoothstep(0.13, 0.0, v1.x) + smoothstep(0.42, 0.10, v1.x) * lamp);
  // Metropolises on a coarser grid; its cell borders are the highways. The
  // outline is ragged and the lights thin out towards the edge.
  vec3 v2 = voronoi(p * 21.0 + uSeed.zxy);
  float reach = v2.x * (1.0 + 0.45 * snoise(p * 85.0 + uSeed.zxy));
  float sprawl = smoothstep(0.50, 0.04, reach);
  float metro = step(0.3, v2.z)
      * (1.5 * smoothstep(0.15, 0.0, reach) + 1.7 * sprawl * sprawl * lamp + 0.25 * sprawl * sprawl);
  // Highways: strings of beads rather than drawn lines.
  float road = (1.0 - smoothstep(0.0, 0.035, v2.y - v2.x)) * (0.25 + 0.75 * bead);
  float lights = cluster * (town * 1.15 + road * 0.5)
      + metro * (0.7 + 0.8 * cluster);

  // --- land-cover grain ---
  // Fine mottling, down to the texel: it frays the borders between biomes and
  // varies the tone inside them, so land does not look airbrushed from orbit.
  float mottle = fbm(p * 15.0 + uSeed.zxy + 4.0, 5.0)
      + 0.35 * (ridgedMF(p * 34.0 + uSeed + 2.0, 3.0) - 0.3);

  gl_FragColor = vec4(0.5 + 0.5 * wx, 0.5 + 0.5 * wy, lights / 3.0, clamp(0.5 + 0.8 * mottle, 0.0, 1.0));
}
`;

// Cloud snapshot: raw field value, before the coverage threshold.
export const CLOUD_BAKE_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_CUBE_FACE}
${GLSL_CLOUD_FIELD}

void main() {
  gl_FragColor = vec4(cloudFieldSynth(faceDirection()), 0.0, 0.0, 1.0);
}
`;

// Ring profile: a 1D strip, (optical density, hue) against normalised radius.
export const RING_BAKE_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_RING_FIELD}

uniform float uFaceSize;

void main() {
  gl_FragColor = vec4(ringField(gl_FragCoord.x / uFaceSize), 0.0, 1.0);
}
`;
