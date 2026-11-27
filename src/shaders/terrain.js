// Vertex stage of the planet's surface: one patch of the terrain quadtree
// (terrain.js), a grid of TERRAIN_GRID x TERRAIN_GRID cells on a face of the
// cube, pushed out onto the sphere and displaced by the relief at its real
// scale. Positions are built relative to the camera from small numbers only,
// so nothing shakes at metre scale. The fragment stage is planet.js.
import { GLSL_NOISE, GLSL_RELIEF_DETAIL } from './chunks.js';

export const TERRAIN_GRID = 32;

export const TERRAIN_VERT = /* glsl */ `
precision highp float;
precision highp int;

// What the shared chunks need of GLSL_COMMON (which holds fragment-only code).
uniform vec3 uSeed;
float sat01(float x) {
  return clamp(x, 0.0, 1.0);
}

${GLSL_NOISE}
${GLSL_RELIEF_DETAIL}

#define GRID ${TERRAIN_GRID.toFixed(1)}

uniform samplerCube uTerrainA;
uniform float uSeaLevel;
uniform float uBiomeDatum;
uniform float uRelief;
uniform float uRidge;
uniform float uLodRadius;    // radius of the sphere the level of detail is measured on
uniform float uLodK;         // patches split closer than uLodK edges
uniform mat3 uLocalToView;   // planet space -> view space (rotation only)

attribute vec3 grid;         // column, row (0..GRID); z = 1 on the skirt
attribute vec4 aRel;         // xyz = patch centre (unit sphere) - camera, planet space; w = face
attribute vec4 aCube;        // xyz = patch centre on the cube; w = patch size (face units)
attribute vec4 aHi;          // xyz = patch centre rounded to 1/4096; w = edge length (radii)
attribute vec4 aLo;          // xyz = the rest of the centre; w = distance where morphing ends

varying vec3 vObjPos;
varying vec3 vToCam;         // world space, vertex -> camera
varying vec4 vDetail;        // relief detail carried by the grid (gradient, height)
varying vec3 vRel;
flat varying vec3 vHi;
flat varying vec3 vLo;

// Face axes: U x V is the outward normal, so every patch winds the same way.
void faceAxes(float f, out vec3 u, out vec3 v) {
  if (f < 0.5) { u = vec3(0.0, 0.0, -1.0); v = vec3(0.0, 1.0, 0.0); }
  else if (f < 1.5) { u = vec3(0.0, 0.0, 1.0); v = vec3(0.0, 1.0, 0.0); }
  else if (f < 2.5) { u = vec3(1.0, 0.0, 0.0); v = vec3(0.0, 0.0, -1.0); }
  else if (f < 3.5) { u = vec3(1.0, 0.0, 0.0); v = vec3(0.0, 0.0, 1.0); }
  else if (f < 4.5) { u = vec3(1.0, 0.0, 0.0); v = vec3(0.0, 1.0, 0.0); }
  else { u = vec3(-1.0, 0.0, 0.0); v = vec3(0.0, 1.0, 0.0); }
}

// normalize(c0 + d) - normalize(c0), without the cancellation of the plain
// difference (d is tiny next to c0 on a deep patch).
vec3 sphereOffset(vec3 c0, vec3 d) {
  float c2 = dot(c0, c0);
  float e = (2.0 * dot(c0, d) + dot(d, d)) / c2;
  float s = sqrt(1.0 + e);
  float k = 1.0 / s;                       // |c0| / |c0 + d|
  float km1 = -e / (s * (1.0 + s));        // k - 1
  return (c0 * km1 + d * k) / sqrt(c2);
}

void main() {
  vec3 fu, fv;
  faceAxes(aRel.w, fu, fv);
  float size = aCube.w;
  vec2 g = grid.xy;
  vec3 p0 = normalize(aCube.xyz);

  // Morph towards the parent's grid as the patch nears the end of its range
  // (CDLOD): odd vertices slide onto their even neighbours, so the switch to
  // the coarser patch shows nothing.
  vec2 d2 = (g / GRID - 0.5) * size;
  vec3 rel = sphereOffset(aCube.xyz, d2.x * fu + d2.y * fv);
  float dist = length(aRel.xyz + rel + (uLodRadius - 1.0) * (p0 + rel));
  float morph = clamp((dist / aLo.w - 0.72) / 0.26, 0.0, 1.0);
  g -= fract(g * 0.5) * 2.0 * morph;
  d2 = (g / GRID - 0.5) * size;
  vec3 d = d2.x * fu + d2.y * fv;
  rel = sphereOffset(aCube.xyz, d);
  vec3 p = normalize(aCube.xyz + d);
  dist = length(aRel.xyz + rel + (uLodRadius - 1.0) * (p0 + rel));

  // Large forms from the cache, at the mip level that matches the grid. The
  // level follows the vertex's own distance (as the morph does), not the
  // patch's size, so neighbouring patches of different levels agree on their
  // shared edge.
  float spacing = aHi.w / GRID;
  float texel = 1.5708 / float(textureSize(uTerrainA, 0).x);
  float lodSpacing = dist / (GRID * uLodK) * 1.3333;
  vec4 shape = textureLod(uTerrainA, p, log2(max(lodSpacing / texel, 1.0)));
  float h = shape.x + uRelief * uRidge * shape.y;

  // Finer forms from noise: as many octaves as the grid can carry here.
  vec4 det = vec4(0.0);
  if (h > uSeaLevel - 0.03) {
    float ridged = sat01(0.3 + 1.5 * shape.y) * sat01(uRelief * uRidge);
    det = reliefDetail(aHi.xyz, aLo.xyz, rel, dist / (GRID * uLodK) * 1.3333, 1e30,
        detailSlope(shape, uRelief * uRidge), ridged);
  }
  h += det.w;

  // Seas are flat; the skirt hangs below the edge to hide cracks between levels.
  float disp = (max(h, uSeaLevel) - uBiomeDatum) * uRealScale;
  // (A few cells deep: the levels agree but for the morph's last fraction.)
  disp -= grid.z * (spacing * 3.0 + 0.002 * uRealScale);

  vec3 toVertex = aRel.xyz + rel + p * disp;          // planet space, from the camera
  vObjPos = p * (1.0 + disp);
  vToCam = -(mat3(modelMatrix) * toVertex);
  vDetail = det;
  vRel = rel;
  vHi = aHi.xyz;
  vLo = aLo.xyz;
  gl_Position = projectionMatrix * vec4(uLocalToView * toVertex, 1.0);
}
`;
