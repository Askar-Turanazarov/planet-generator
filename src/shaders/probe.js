// Probe: what the ground is at one point of the planet, read from the same
// caches and with the same land-cover rules (GLSL_SURFACE) as the surface
// shader, so a reading never disagrees with the picture.
//
// Draws three pixels per point into a small 8-bit target (one row per point,
// the directions come from a data texture); probe.js reads them back.
//   px 0  (height hi, height lo, moisture, steepness)
//   px 1  (cold, snow, ice, rock)
//   px 2  (shore, vein, city lights, climate y)
// The height is stored as (h + 4) / 8 in 16 bits: about 2 m on Earth's scale.
import { GLSL_COMMON, GLSL_SURFACE } from './chunks.js';

export const PROBE_VERT = /* glsl */ `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const PROBE_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_SURFACE}

uniform samplerCube uTerrainA;
uniform samplerCube uTerrainB;
uniform float uSeaLevel;
uniform float uBiomeDatum;
uniform float uRelief;
uniform float uRidge;
uniform float uEps;
uniform sampler2D uProbeDirs; // row i: direction of point i, planet object space

float probeElevation(vec3 p) {
  vec2 s = textureLod(uTerrainA, p, 0.0).xy;
  return s.x + uRelief * uRidge * s.y;
}

void main() {
  vec3 p = normalize(texelFetch(uProbeDirs, ivec2(int(gl_FragCoord.y), 0), 0).xyz);
  float lat = abs(p.y);
  vec3 upAxis = abs(p.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(upAxis, p));
  vec3 B = cross(p, T);

  vec4 shape = textureLod(uTerrainA, p, 0.0);
  vec4 cover = textureLod(uTerrainB, p, 0.0);
  float climX = cover.x * 2.0 - 1.0;
  float climY = cover.y * 2.0 - 1.0;
  float grain = cover.w * 2.0 - 1.0;

  float h0 = shape.x + uRelief * uRidge * shape.y;
  float hT = probeElevation(normalize(p + uEps * T));
  float hB = probeElevation(normalize(p + uEps * B));
  float slope = length(vec2(hT - h0, hB - h0) / uEps);
  float landH = h0 - uSeaLevel;
  float bioH = h0 - uBiomeDatum;

  float moist = coverMoisture(lat, climX, grain);
  float steep = coverSteep(slope);
  float cold = coverCold(lat, climY, bioH);
  float snow = coverSnow(lat, bioH, climY, grain, steep);
  float ice = coverIce(lat, climY, bioH);
  float rock = coverRock(bioH, grain, steep);
  float shore = 1.0 - coverInland(bioH, climY, grain);
  float city = sat01(cover.z * 3.0 * coverHabitable(lat, bioH, landH, moist, ice, snow));

  int px = int(gl_FragCoord.x);
  if (px == 0) {
    float v = floor(clamp((h0 + 4.0) / 8.0, 0.0, 1.0) * 65535.0 + 0.5);
    float hi = floor(v / 256.0);
    gl_FragColor = vec4(hi / 255.0, (v - hi * 256.0) / 255.0, moist, steep);
  } else if (px == 1) {
    gl_FragColor = vec4(cold, snow, ice, rock);
  } else {
    gl_FragColor = vec4(shore, sat01(shape.z), city, climY * 0.5 + 0.5);
  }
}
`;
