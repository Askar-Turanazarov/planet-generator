// Deep-space backdrop: multi-scale stars, a faint galactic dust band, the sun.
// The dust band is static, so it is synthesised once into a cube map; the
// stars stay procedural because they must stay pin-sharp at any resolution.
import { GLSL_COMMON, GLSL_NOISE, GLSL_CUBE_FACE } from './chunks.js';

// Bake pass: galactic band (nebular glow cut by dark dust lanes).
export const SKY_BAKE_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_CUBE_FACE}

void main() {
  vec3 dir = faceDirection();
  vec3 galN = normalize(vec3(0.34, 0.86, -0.38));
  float gLat = dot(dir, galN);
  float band = exp(-gLat * gLat * 13.0);
  float n = fbm(dir * 2.4 + 3.0, 6.0);
  float lanes = fbm(dir * 5.5 + 20.0 + n * 0.7, 5.0);
  float cloud = band * clamp(0.5 + 0.9 * n, 0.0, 1.0);
  float dust = smoothstep(-0.25, 0.35, lanes);       // dark lanes cut through it
  vec3 col = vec3(0.50, 0.58, 0.86) * 0.020 * cloud * dust;
  col += vec3(1.0, 0.78, 0.55) * 0.016 * exp(-gLat * gLat * 70.0) * clamp(0.6 + n, 0.0, 1.0) * dust;
  // Alpha carries the band profile: stars crowd together inside it.
  gl_FragColor = vec4(col, band);
}
`;

export const SKY_VERT = /* glsl */ `
precision highp float;

varying vec3 vDir;

void main() {
  vDir = position;
  // Rotation only: the sky is infinitely far away and never translates.
  vec4 pos = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = pos.xyww;
}
`;

export const SKY_FRAG = /* glsl */ `
${GLSL_COMMON}

uniform samplerCube uSkyTex;   // rgb = galactic band radiance, a = band profile
uniform vec3 uSunColor;

varying vec3 vDir;

// Hash without sine (Dave Hoskins): stable across GPUs.
vec3 starHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// One layer of stars: a jittered point per cell of a 3D grid, seen where the
// view sphere slices through it. "pixel" keeps every star at least a pixel
// wide (dimming it to conserve energy) so the field does not shimmer.
vec3 starLayer(vec3 dir, float scale, float density, float size, float pixel) {
  vec3 x = dir * scale;
  vec3 cell = floor(x);
  vec3 f = fract(x);
  vec3 h1 = starHash(cell + 3.7);
  vec3 h2 = starHash(cell + 71.3);
  vec3 starPos = 0.2 + 0.6 * h1;
  float d = length(f - starPos);

  float radius = max(size, pixel * scale * 0.85);
  float core = smoothstep(radius, 0.0, d);
  core *= core * (size * size) / (radius * radius);

  float present = step(1.0 - density, h2.x);
  float magnitude = 0.05 + 1.3 * pow(h2.y, 6.0);   // many dim, few bright

  // Colour temperature: blue-white giants through to warm gold dwarfs.
  vec3 tint = mix(vec3(0.62, 0.75, 1.0), vec3(1.0, 0.82, 0.56), h2.z);
  tint = mix(tint, vec3(1.0), 0.4);

  return tint * core * present * magnitude;
}

void main() {
  vec3 dir = normalize(vDir);
  float pixel = length(fwidth(dir));

  // Behind the planet there is no sky to compute. (Slightly inside the
  // silhouette, so the anti-aliased limb still has stars to blend with.)
  float along = -dot(cameraPosition, dir);
  if (along > 0.0 && dot(cameraPosition, cameraPosition) - along * along < 0.992 * 0.992) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  // --- galactic band (baked) ---
  vec4 galaxy = textureLod(uSkyTex, dir, 0.0);
  vec3 col = galaxy.rgb;

  // --- stars: denser inside the band ---
  float crowd = 0.75 + 0.9 * galaxy.a;
  col += starLayer(dir, 70.0, 0.50 * crowd, 0.11, pixel) * 1.2;
  col += starLayer(dir, 150.0, 0.45 * crowd, 0.13, pixel) * 0.75;
  col += starLayer(dir, 310.0, 0.40 * crowd, 0.15, pixel) * 0.45;

  // --- sun: hard disc plus a tight corona; bloom does the rest ---
  float sd = dot(dir, uSunDir);
  if (sd > 0.5) {
    float disc = smoothstep(0.99988, 0.99996, sd);
    col += uSunColor * (disc * 38.0 + pow(sd, 3000.0) * 3.0 + pow(sd, 220.0) * 0.22 + pow(sd, 14.0) * 0.02);
  }

  gl_FragColor = vec4(col, 1.0);
}
`;
