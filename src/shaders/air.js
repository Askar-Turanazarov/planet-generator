// Light scattered by the air along a ray, shared by the atmosphere shell
// (atmosphere.js: the sky, and the haze over the planet seen from orbit) and
// by the terrain close to the ground (planet.js: aerial perspective over the
// exact distance to each point, FLIGHT-PLAN.md stage F).
//
// Single scattering, Rayleigh + Mie + a thin ground haze: the inner integral
// towards the sun is the precomputed table (bake.js). The haze sits in the
// lowest kilometres (scale height uHazeH); its vertical optical depth is a
// quarter of the air above it, so airless worlds have none. From orbit it is
// thinner than a pixel; near the ground it is what makes far ridges fade.
// Needs GLSL_COMMON and GLSL_RINGS before it.

export const GLSL_AIR = /* glsl */ `
uniform float uAtmoSun;       // radiance scale of the in-scattered light
uniform sampler2D uAtmoLut;   // optical depth towards the sun: (sun zenith cosine, altitude) -> (Rayleigh, Mie)
uniform float uHazeH;         // scale height of the ground haze (radii)

// Ray / sphere at the origin. Returns (near, far); near > far means a miss.
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

// Is "pos" inside the planet's shadow (a cylinder behind the terminator)?
bool inShadow(vec3 pos) {
  float along = dot(pos, uSunDir);
  vec3 off = pos - uSunDir * along;
  return along < 0.0 && dot(off, off) < R_PLANET * R_PLANET * 0.996;
}

// Scattering coefficient of the haze (per radius).
float hazeBeta() {
  return 0.25 * (uBetaR.z * H_RAYLEIGH + uBetaM * H_MIE) / max(uHazeH, 1e-7);
}

// Light scattered towards ro along ro + rd t for t in [t0, t1], and the
// transmittance of that stretch. "bias" crowds the samples: +1 towards t1
// (rays that end on the ground), -1 towards t0 (rays that start in the low
// air), 0 evenly.
vec3 airLight(vec3 ro, vec3 rd, float t0, float t1, int steps, float bias, float jitter, out vec3 trans) {
  float len = t1 - t0;
  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;
  float odH = 0.0;
  float bH = hazeBeta();
  vec3 extR = uBetaR + uBetaAbs;
  float extM = uBetaM * 1.1;
  float extH = bH * 1.1;

  for (int i = 0; i < 16; i++) {
    if (i >= steps) {
      break;
    }
    float x = (float(i) + jitter) / float(steps);
    float s = x + bias * x * (1.0 - x);
    float seg = len / float(steps) * (1.0 + bias * (1.0 - 2.0 * x));
    vec3 pos = ro + rd * (t0 + s * len);
    float r = length(pos);
    float hgt = max(r - R_PLANET, 0.0);
    float dR = exp(-hgt / H_RAYLEIGH) * seg;
    float dM = exp(-hgt / H_MIE) * seg;
    float dH = exp(-hgt / uHazeH) * seg;
    odR += dR;
    odM += dM;
    odH += dH;

    // The planet's shadow: no sunlight reaches this sample.
    if (inShadow(pos)) {
      continue;
    }

    // Optical depth from the sample to the sun: a lookup for the air, the
    // plane-parallel slab for the haze.
    float muS = dot(pos, uSunDir) / max(r, 1e-4);
    vec2 lutUV = vec2((muS + 0.4) / 1.4, hgt / (R_ATMO - R_PLANET));
    vec2 sunOD = textureLod(uAtmoLut, lutUV, 0.0).rg;
    float sunH = dH / seg * uHazeH / (max(muS, 0.0) + 0.05);

    // The rings shade the air too, or their shadow would sit under a sunlit
    // blue haze.
    vec3 att = exp(-(extR * (odR + sunOD.x) + extM * (odM + sunOD.y) + extH * (odH + sunH))) * ringShadow(pos);
    sumR += att * dR;
    sumM += att * (dM * uBetaM + dH * bH);
  }

  trans = exp(-(extR * odR + extM * odM + extH * odH));

  float mu = dot(rd, uSunDir);
  float phaseR = 3.0 / (16.0 * K_PI) * (1.0 + mu * mu);
  float g = 0.76;
  float g2 = g * g;
  float phaseM = 3.0 / (8.0 * K_PI) * ((1.0 - g2) * (1.0 + mu * mu))
      / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
  return uAtmoSun * (sumR * uBetaR * phaseR + sumM * phaseM);
}

// Interleaved gradient noise: offsets the samples per pixel to hide banding.
float airJitter() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}
`;
