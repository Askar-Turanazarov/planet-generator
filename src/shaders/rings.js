// Planetary rings: micro-banded radial profile, analytic planet shadow,
// forward scattering when backlit.
import { GLSL_COMMON, GLSL_RINGS } from './chunks.js';

export const RINGS_VERT = /* glsl */ `
precision highp float;

varying vec3 vWorldPos;
varying vec2 vRingXY;

void main() {
  vRingXY = position.xy;   // RingGeometry lies in its local XY plane
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const RINGS_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_RINGS}

uniform float uRingPass;   // +1 = half nearer than the planet centre, -1 = far half
uniform vec3 uRingColA;
uniform vec3 uRingColB;

varying vec3 vWorldPos;
varying vec2 vRingXY;

void main() {
  float r = length(vRingXY);
  float u = ringCoord(r);
  // Radial profile: (optical density, hue). Mip-mapped, so the micro-banding
  // dissolves into its average instead of shimmering when seen from afar.
  // (Sampled before any discard: the lookup needs screen-space derivatives.)
  vec2 profile = texture(uRingTex, vec2(u, 0.5)).rg;

  // The ring is drawn twice so that it sorts correctly against the additive
  // atmosphere: far half first, atmosphere, then near half.
  if (dot(vWorldPos, cameraPosition) * uRingPass < 0.0) {
    discard;
  }

  float dens = profile.r;
  if (u <= 0.0 || u >= 1.0 || dens < 0.002) {
    discard;
  }

  vec3 Nr = uRingNormal;
  vec3 L = uSunDir;
  vec3 rd = normalize(vWorldPos - cameraPosition);
  float cosV = max(abs(dot(Nr, rd)), 0.05);
  float cosL = max(abs(dot(Nr, L)), 0.05);

  float tau = dens * uRingOpacity;
  float alpha = 1.0 - exp(-tau / cosV);       // edge-on views are more opaque
  float hit = 1.0 - exp(-tau / cosL);         // share of sunlight intercepted

  // Are we looking at the face the sun shines on, or through the ring?
  float sameSide = step(0.0, dot(Nr, L) * dot(Nr, -rd));
  float mu = dot(rd, L);                      // +1 = looking straight at the sun

  float reflected = hit * (0.72 + 0.28 * (0.5 - 0.5 * mu));
  // Seen from the unlit side: single scattering through thin lanes, plus a
  // little light that diffused through the dense ones.
  float transmitted = (tau / cosL) * exp(-tau / cosL) * 1.5 + 0.10 * hit * exp(-tau * 0.5);
  float bright = mix(transmitted, reflected, sameSide);

  // Icy grains scatter strongly forward: the rings flare when backlit.
  float gf = 0.82;
  float hg = (1.0 - gf * gf) / pow(1.0 + gf * gf - 2.0 * gf * mu, 1.5) * 0.25;
  bright += min(hg, 6.0) * dens * exp(-tau * 0.5) * 0.3;

  // Analytic planet shadow: closest approach of the sun ray to the planet.
  float shadow = 1.0;
  vec3 tint = vec3(1.0);
  float along = dot(vWorldPos, L);
  if (along < 0.0) {
    float dist = sqrt(max(dot(vWorldPos, vWorldPos) - along * along, 0.0));
    float pen = 0.004 + 0.012 * (-along);     // penumbra widens with distance
    shadow = smoothstep(R_PLANET - pen, R_PLANET + pen, dist);
    // Light that grazed the atmosphere on its way here has been reddened.
    float column = 0.275 * exp(-max(dist - R_PLANET, 0.0) / H_RAYLEIGH);
    tint = exp(-(uBetaR + uBetaAbs) * column);
  }

  vec3 base = mix(uRingColA, uRingColB, profile.g);

  vec3 col = base * (uSunPower * bright * shadow * tint + 0.003 * alpha);

  // Premultiplied output: radiance is already scaled by how much light the
  // ring intercepts, alpha only says how much of the background it hides.
  gl_FragColor = vec4(col * uRingsOn, alpha * uRingsOn);
}
`;
