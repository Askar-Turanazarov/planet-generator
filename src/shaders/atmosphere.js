// Atmospheric scattering: single-scattering Rayleigh + Mie, integrated along
// the view ray through the shell (air.js; the inner integral towards the sun
// is a precomputed table, see bake.js). Because the integral is physical, the
// three looks the brief asks for fall out on their own:
//   - a bright limb where the view ray is long and sunlit,
//   - an amber-to-crimson band at the terminator (the sun ray is long there,
//     so blue has been scattered away before the light arrives),
//   - black on the night side (the planet blocks the sun ray entirely).
// From inside the shell the same integral is the sky: blue overhead, paler and
// hazier towards the horizon, red at sunset.
//
// Blending: colour = shell + behind * alpha. Rays that end on the ground leave
// what is behind as it is (alpha 1: the surface applies its own extinction);
// rays into space dim it by the air's transmittance and by the sky's own
// brightness, so stars fade in daylight and the sun and rings redden low down.
import { GLSL_COMMON, GLSL_RINGS } from './chunks.js';
import { GLSL_AIR } from './air.js';

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
${GLSL_RINGS}
${GLSL_AIR}

// Radius the rays stop at: the planet, or in flight the ground under the
// camera when that is lower (in a basin the sphere R = 1 would cut the sky).
uniform float uGroundR;

varying vec3 vWorldPos;

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
  float bias = 0.0;
  bool ground = false;
  vec2 tp = raySphere(ro, rd, uGroundR);
  if (tp.x < tp.y && tp.x > 0.0) {
    t1 = min(t1, tp.x);
    viewSteps = 7;
    bias = 1.0;
    ground = true;
  } else if (ta.x <= 0.0) {
    // From inside the air the samples crowd near the camera, where the
    // ground haze is.
    bias = -1.0;
  }

  // The shadow is convex: if the path starts and ends inside it, every sample
  // would be dark. That is the whole night side, for free.
  if (inShadow(ro + rd * t0) && inShadow(ro + rd * t1)) {
    discard;
  }

  vec3 trans;
  vec3 col = airLight(ro, rd, t0, t1, viewSteps, bias, airJitter(), trans);
  float behind = 1.0;
  if (!ground) {
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    behind = dot(trans, vec3(0.2126, 0.7152, 0.0722)) * exp(-20.0 * lum);
  }
  gl_FragColor = vec4(col, behind);
}
`;
