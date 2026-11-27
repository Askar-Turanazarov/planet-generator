// Cloud layer as a volume, for the camera close to it (FLIGHT-PLAN.md stage G).
//
// From orbit the clouds are the shell of clouds.js, a sheet in the middle of
// the layer. Below a few tens of kilometres the layer has to have a thickness:
// a screen-covering quad marches each view ray through the slab between the
// base and the top of the layer (2-6 km), so the camera can fly under the
// deck, through it (the march starts at the camera: a veil) and over it.
//
// Density: the coverage of the weather cache (the same field the shell and
// the cloud shadows read) sets where the clouds stand and how tall they grow;
// two octaves of 3D noise of about a kilometre erode the billows. Light: one
// step towards the sun, Beer's law with a softer multiple-scattering tail.
// The clouds take the air in front of them like the terrain does (air.js).
//
// No depth texture: the fragment writes the depth of the point where the ray
// has become mostly opaque, so ground in front of a cloud hides it and a cloud
// in front of the ground covers it.
import { GLSL_COMMON, GLSL_NOISE, GLSL_CLOUDS, GLSL_RINGS } from './chunks.js';
import { GLSL_AIR } from './air.js';

export const CLOUD_VOLUME_VERT = /* glsl */ `
precision highp float;

varying vec3 vDir;

void main() {
  // The quad is the screen; its rays come from the projection of this draw
  // (offsets for the framing included).
  vec2 ndc = position.xy;
  vec3 view = vec3((ndc.x + projectionMatrix[2][0]) / projectionMatrix[0][0],
                   (ndc.y + projectionMatrix[2][1]) / projectionMatrix[1][1], -1.0);
  vDir = (vec4(view, 0.0) * viewMatrix).xyz;
  gl_Position = vec4(ndc, 1.0, 1.0);
}
`;

export const CLOUD_VOLUME_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_CLOUDS}
${GLSL_RINGS}
${GLSL_AIR}

uniform mat4 projectionMatrix;
uniform mat3 uCloudW2O;
uniform vec3 uColCloudLit;
uniform vec3 uColCloudShade;
uniform vec3 uColCloudGlow;
uniform float uCloudOpacity;
uniform float uCloudBase;      // radius of the bottom of the layer
uniform float uCloudTop;       // radius of the top
uniform float uCloudVol;       // fade-in of the volume (0..1)
uniform float uCloudSteps;     // march steps (quality profile)
uniform float uCloudSigma;     // extinction inside a cloud, per radius
uniform float uCloudNoise;     // frequency of the detail noise, per radius
uniform float uGroundR;
uniform float uMetre;          // planet radii per metre

varying vec3 vDir;

float cloudThreshold() {
  return mix(0.74, -0.62, uCloudCover);
}

// Density at "pos" (|pos| = r). "detail" 0 skips the noise (light samples).
float cloudVolumeDensity(vec3 pos, float r, float detail) {
  float hf = (r - uCloudBase) / (uCloudTop - uCloudBase);
  if (hf < 0.0 || hf > 1.0) {
    return 0.0;
  }
  vec3 obj = uCloudW2O * pos;
  float cov = cloudField(obj / r) - cloudThreshold();
  if (cov < -0.25) {
    return 0.0;
  }
  // Cells of about 6 km break a weather system into separate clouds; they are
  // never faded, so even the far, long march steps see the gaps.
  float cell = snoise(obj * (uCloudNoise * 0.22) + uSeed.zxy * 3.0);
  cov += 0.12 * cell;
  // Deep in a weather system the towers reach the top; at its rim they are low.
  float top = clamp(0.3 + cov * 2.2, 0.15, 1.0);
  float shape = smoothstep(0.0, 0.08, hf) * (1.0 - smoothstep(top * 0.55, top, hf));
  float d = clamp(cov * 5.0 + 0.25 + 0.5 * cell, 0.0, 1.0) * shape;
  // Erosion by the billows; "detail" fades their noise out where the march
  // steps are longer than they are (it would only add speckle).
  d -= 0.3;
  if (detail > 0.0 && d > -0.3) {
    vec3 q = obj * uCloudNoise + uSeed.yzx * 7.0 + vec3(0.0, uTime * 0.02, 0.0);
    float n = 0.62 * snoise(q);
    if (detail > 0.5) {
      n += 0.3 * snoise(q * 2.31 + 3.7) * (detail - 0.5) * 2.0;
    }
    d += 0.55 * n * min(detail * 2.0, 1.0);
  }
  return clamp(d, 0.0, 1.0) * smoothstep(0.0, 0.06, uCloudCover);
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vDir);
  float r0 = length(ro);

  vec2 tT = raySphere(ro, rd, uCloudTop);
  if (tT.x > tT.y || tT.y <= 0.0) {
    discard;
  }
  float t0 = max(tT.x, 0.0);
  float t1 = tT.y;
  vec2 tB = raySphere(ro, rd, uCloudBase);
  if (r0 < uCloudBase) {
    // Under the deck: rays into the ground see none of it.
    vec2 tG = raySphere(ro, rd, uGroundR);
    if (tG.x < tG.y && tG.x > 0.0) {
      discard;
    }
    t0 = max(t0, tB.y);
  } else if (tB.x < tB.y && tB.x > 0.0) {
    t1 = min(t1, tB.x);
  }
  // Long grazing paths: the far part is lost in the air anyway.
  float len = min(t1 - t0, 40000.0 * uMetre);
  if (len <= 0.0) {
    discard;
  }

  int steps = int(uCloudSteps);
  // White-noise offset of the samples: grain instead of the diagonal hatching
  // a structured pattern leaves on the long steps.
  vec3 h3 = fract(vec3(gl_FragCoord.xyx) * vec3(0.1031, 0.1030, 0.0973));
  h3 += dot(h3, h3.yxz + 33.33);
  float jitter = fract((h3.x + h3.y) * h3.z);
  vec3 L = uSunDir;
  vec3 mid = normalize(ro + rd * (t0 + 0.5 * len));
  float mu = dot(mid, L);
  vec3 sunCol = sunTransmit(mu + 0.02) * uSunPower * smoothstep(-0.06, 0.10, mu + 0.02) * ringShadow(mid);
  float day = smoothstep(-0.2, 0.4, mu);
  vec3 ambient = uAtmoTint * 0.06 * day + vec3(0.0012);
  float lightLen = (uCloudTop - uCloudBase) * 0.15;
  // Forward scattering: brighter towards the sun.
  float cosSun = dot(rd, L);
  float phase = 0.8 + 0.9 * pow(max(cosSun, 0.0), 6.0);

  float trans = 1.0;
  vec3 acc = vec3(0.0);
  float tHit = -1.0;
  for (int i = 0; i < 32; i++) {
    if (i >= steps) {
      break;
    }
    // Samples spread quadratically: dense near the camera, sparse where a
    // grazing ray crosses the layer far away (and the clouds are small).
    float x0 = (float(i) + jitter) / uCloudSteps;
    float x1 = (float(i) + 1.0 + jitter) / uCloudSteps;
    float t = t0 + len * x0 * x0;
    float dt = len * (x1 * x1 - x0 * x0);
    vec3 pos = ro + rd * t;
    float r = length(pos);
    float d = cloudVolumeDensity(pos, r, 1.0 - smoothstep(0.3, 1.2, dt * uCloudNoise));
    if (d <= 0.0) {
      continue;
    }
    float hf = (r - uCloudBase) / (uCloudTop - uCloudBase);
    vec3 lp = pos + L * lightLen;
    float dl = cloudVolumeDensity(lp, length(lp), 0.0);
    float tau = dl * uCloudSigma * lightLen;
    float beer = max(exp(-tau), 0.7 * exp(-0.25 * tau));
    vec3 lightCol = uColCloudLit * sunCol * beer * phase
        + uColCloudShade * ambient * (0.5 + 0.8 * hf)
        + uColCloudGlow * (1.0 - hf);
    float a = 1.0 - exp(-d * uCloudSigma * dt);
    acc += trans * a * lightCol;
    trans *= 1.0 - a;
    if (tHit < 0.0 && trans < 0.5) {
      tHit = t;
    }
    if (trans < 0.02) {
      break;
    }
  }
  float alpha = (1.0 - trans) * uCloudOpacity * uCloudVol;
  if (alpha < 0.002) {
    discard;
  }
  if (tHit < 0.0) {
    tHit = t0 + 0.5 * len;
  }

  // The air between the camera and the cloud.
  vec2 ta = raySphere(ro, rd, R_ATMO);
  vec3 col = acc;
  if (ta.y > 0.0) {
    vec3 airTrans;
    vec3 air = airLight(ro, rd, max(ta.x, 0.0), min(tHit, ta.y), 4, 0.0, jitter, airTrans);
    col = col * airTrans + air * (1.0 - trans);
  }
  col *= uCloudOpacity * uCloudVol;

  vec4 clip = projectionMatrix * viewMatrix * vec4(ro + rd * tHit, 1.0);
  gl_FragDepth = clamp(0.5 * clip.z / clip.w + 0.5, 0.0, 1.0);
  gl_FragColor = vec4(col, alpha);
}
`;

// The half-resolution march put over the full frame: colour filtered, the
// depth of the nearest texel, so the depth test against the ground works at
// full resolution (at worst a cloud's edge along a ridge is half-res).
export const CLOUD_COMPOSITE_VERT = /* glsl */ `
varying vec2 vUv;

void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 1.0, 1.0);
}
`;

export const CLOUD_COMPOSITE_FRAG = /* glsl */ `
precision highp float;

uniform sampler2D tCloud;
uniform sampler2D tCloudDepth;
varying vec2 vUv;

void main() {
  vec4 cloud = texture2D(tCloud, vUv);
  if (cloud.a < 0.002) {
    discard;
  }
  gl_FragDepth = texture2D(tCloudDepth, vUv).r;
  gl_FragColor = cloud;
}
`;
