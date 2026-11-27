// Cloud shell: animated cyclonic flow with self-shadowing.
// The flow field itself lives in the cloud cache (see bake.js); this shader
// thresholds it by the coverage slider, adds fine erosion for close-ups and
// lights the result.
import { GLSL_COMMON, GLSL_NOISE, GLSL_CLOUDS, GLSL_RINGS } from './chunks.js';

export const CLOUDS_VERT = /* glsl */ `
precision highp float;

varying vec3 vObjPos;
varying vec3 vWorldPos;

void main() {
  vObjPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const CLOUDS_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_CLOUDS}
${GLSL_RINGS}

uniform mat4 modelMatrix;
uniform vec3 uColCloudLit;
uniform vec3 uColCloudShade;
uniform vec3 uColCloudGlow;   // light from below (lava worlds)
uniform float uCloudOpacity;
uniform float uCloudFreq;
uniform float uCloudDetail;   // 0 from orbit, 1 in close-ups
uniform float uCloudRadius;

varying vec3 vObjPos;
varying vec3 vWorldPos;

void main() {
  vec3 p = normalize(vObjPos);
  mat3 o2w = mat3(modelMatrix);
  vec3 N = normalize(o2w * p);
  vec3 L = uSunDir;
  vec3 V = normalize(cameraPosition - vWorldPos);
  float mu = dot(N, L);
  float ndv = max(dot(N, V), 0.0);

  // Silhouette coverage (screen-space derivatives: before any discard).
  float edge = limbCoverage(cameraPosition, -V, uCloudRadius);

  float n = cloudField(p);
  float threshold = mix(0.74, -0.62, uCloudCover);
  if (n - threshold < -0.16) {
    discard;
  }
  // Close-up erosion: the cache holds the weather systems, this adds the
  // billows along their edges once the camera is near enough to see them.
  // (Faded out on the night side, where the deck is only a dark silhouette.)
  float billow = uCloudDetail * smoothstep(-0.24, -0.10, mu);
  if (billow > 0.0) {
    vec3 dq = p * (uCloudFreq * 11.0) + uSeed.yzx + vec3(0.0, uTime * 0.004, 0.0);
    n += billow * (0.085 * snoise(dq) + 0.045 * snoise(dq * 2.3 + 5.0));
  }
  // From orbit the soft ramp of the cache is right; up close it reads as
  // out of focus, so the ramp tightens with the camera.
  float d = smoothstep(threshold, threshold + mix(0.26, 0.17, uCloudDetail), n)
      * smoothstep(0.0, 0.06, uCloudCover);
  if (d < 0.003) {
    discard;
  }

  // Self-shadowing: sample the field a little way towards the sun. The field
  // is read as the height of the cloud tops, so its slope along the sun's
  // ground track is relief: sun-facing flanks are bright, the far sides sit in
  // shade. Unlike the coverage, the raw field keeps varying inside a deck, so
  // the whole deck is modelled, not just its rim.
  vec3 Lobj = normalize(L * o2w);               // world -> object for a rotation
  vec3 Lt = Lobj - p * dot(Lobj, p);
  float n2 = cloudField(normalize(p + Lt * 0.014));
  float d2 = cloudCoverage(n2);
  float tall = sat01((n - threshold) * 1.1);    // 0 at the rim, 1 in the towers
  float lit = clamp(0.60 + (d - d2) * 1.2 + (n - n2) * 3.4 + 0.14 * tall, 0.0, 1.0);
  lit *= mix(1.0, 0.80, smoothstep(0.5, 1.0, d2));   // thick decks shade themselves
  vec3 base = mix(uColCloudShade, uColCloudLit, lit);

  // Clouds ride above the surface, so they hold the light slightly past the
  // ground terminator and take the full sunset colour.
  float muHigh = mu + 0.03;
  float diffuse = clamp((muHigh + 0.12) / 1.12, 0.0, 1.0);
  float horizon = smoothstep(-0.06, 0.10, muHigh);
  vec3 sunCol = sunTransmit(muHigh) * uSunPower;
  float day = smoothstep(-0.2, 0.4, mu);

  vec3 col = base * (sunCol * diffuse * horizon * ringShadow(N) + uAtmoTint * 0.05 * day + vec3(0.0012));
  col += uColCloudGlow * d;
  col *= viewExtinction(ndv);

  // Slant paths through the deck are more opaque towards the limb.
  float alpha = smoothstep(0.0, 0.62, d);
  alpha = 1.0 - pow(1.0 - alpha, 1.0 / max(ndv, 0.35));
  alpha *= uCloudOpacity * edge;

  gl_FragColor = vec4(col, alpha);
}
`;
