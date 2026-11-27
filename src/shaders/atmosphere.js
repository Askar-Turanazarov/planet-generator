// Atmospheric scattering: single-scattering Rayleigh + Mie, integrated along
// the view ray through the shell (the inner integral towards the sun is a
// precomputed table, see bake.js). Because the integral is physical, the three
// looks the brief asks for fall out on their own:
//   - a bright limb where the view ray is long and sunlit,
//   - an amber-to-crimson band at the terminator (the sun ray is long there,
//     so blue has been scattered away before the light arrives),
//   - black on the night side (the planet blocks the sun ray entirely).
import { GLSL_COMMON } from './chunks.js';

export const ATMO_VERT = /* glsl */ `
precision highp float;

varying vec3 vWorldPos;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const ATMO_FRAG = /* glsl */ `
${GLSL_COMMON}

uniform float uAtmoSun;       // radiance scale of the in-scattered light
uniform sampler2D uAtmoLut;   // optical depth towards the sun: (sun zenith cosine, altitude) -> (Rayleigh, Mie)

varying vec3 vWorldPos;

// Ray / sphere at the origin. Returns (near, far); near > far means a miss.
// Is "pos" inside the planet's shadow (a cylinder behind the terminator)?
bool inShadow(vec3 pos) {
  float along = dot(pos, uSunDir);
  vec3 off = pos - uSunDir * along;
  return along < 0.0 && dot(off, off) < R_PLANET * R_PLANET * 0.996;
}

vec2 raySphere(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) {
    return vec2(1.0, -1.0);
  }
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorldPos - cameraPosition);

  vec2 ta = raySphere(ro, rd, R_ATMO);
  if (ta.x > ta.y || ta.y <= 0.0) {
    discard;
  }
  float t0 = max(ta.x, 0.0);
  float t1 = ta.y;

  // Stop at the ground if the ray hits the planet. Those paths are short
  // (haze over the surface), so they need fewer samples than the limb.
  int viewSteps = 12;
  bool ground = false;
  vec2 tp = raySphere(ro, rd, R_PLANET);
  if (tp.x < tp.y && tp.x > 0.0) {
    t1 = min(t1, tp.x);
    viewSteps = 7;
    ground = true;
  }

  // The shadow is convex: if the path starts and ends inside it, every sample
  // would be dark. That is the whole night side, for free.
  if (inShadow(ro + rd * t0) && inShadow(ro + rd * t1)) {
    discard;
  }

  float len = t1 - t0;
  // Interleaved gradient noise: offsets the samples per pixel to hide banding.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));

  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;
  vec3 extR = uBetaR + uBetaAbs;
  vec3 extM = vec3(uBetaM * 1.1);

  for (int i = 0; i < viewSteps; i++) {
    // Rays that end on the ground spend their samples where the air is: the
    // spacing tightens towards the surface (s = x(2 - x), weight ds/dx).
    float x = (float(i) + jitter) / float(viewSteps);
    float s = ground ? x * (2.0 - x) : x;
    float seg = len / float(viewSteps) * (ground ? 2.0 * (1.0 - x) : 1.0);
    vec3 pos = ro + rd * (t0 + s * len);
    float hgt = max(length(pos) - R_PLANET, 0.0);
    float dR = exp(-hgt / H_RAYLEIGH) * seg;
    float dM = exp(-hgt / H_MIE) * seg;
    odR += dR;
    odM += dM;

    // The planet's shadow: no sunlight reaches this sample.
    if (inShadow(pos)) {
      continue;
    }

    // Optical depth from the sample to the sun. It depends only on the
    // altitude and the sun's zenith angle, so the inner integral is a lookup.
    float muS = dot(pos, uSunDir) / max(length(pos), 1e-4);
    vec2 lutUV = vec2((muS + 0.4) / 1.4, hgt / (R_ATMO - R_PLANET));
    vec2 sunOD = textureLod(uAtmoLut, lutUV, 0.0).rg;

    vec3 att = exp(-(extR * (odR + sunOD.x) + extM * (odM + sunOD.y)));
    sumR += att * dR;
    sumM += att * dM;
  }

  float mu = dot(rd, uSunDir);
  float phaseR = 3.0 / (16.0 * K_PI) * (1.0 + mu * mu);
  float g = 0.76;
  float g2 = g * g;
  float phaseM = 3.0 / (8.0 * K_PI) * ((1.0 - g2) * (1.0 + mu * mu))
      / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));

  vec3 col = uAtmoSun * (sumR * uBetaR * phaseR + sumM * uBetaM * phaseM);
  gl_FragColor = vec4(col, 1.0);
}
`;
