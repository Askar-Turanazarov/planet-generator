// Shared GLSL building blocks. Each shader is assembled from these strings.
//
// The expensive procedural fields (terrain, clouds, ring profile, nebula) are
// synthesised by the *_FIELD chunks into cube maps / lookup textures, and the
// per-frame shaders read them back through the lookup chunks. The surface, the
// clouds and the rings therefore all see *the same* data, which is what makes
// cloud shadows and ring shadows line up exactly.

// Atmosphere geometry, in planet radii. Shared by the shaders (as #defines)
// and by the optical-depth table that is integrated on the CPU.
export const ATMOSPHERE = {
  planetRadius: 1.0,
  shellRadius: 1.065,
  scaleHeightRayleigh: 0.012,
  scaleHeightMie: 0.005,
};

// ---------------------------------------------------------------------------
// Precision, constants and the uniforms every pass understands.
// ---------------------------------------------------------------------------
export const GLSL_COMMON = /* glsl */ `
precision highp float;
precision highp int;

#define K_PI 3.14159265359
#define R_PLANET ${ATMOSPHERE.planetRadius.toFixed(4)}
#define R_ATMO ${ATMOSPHERE.shellRadius.toFixed(4)}
#define H_RAYLEIGH ${ATMOSPHERE.scaleHeightRayleigh.toFixed(4)}
#define H_MIE ${ATMOSPHERE.scaleHeightMie.toFixed(4)}

uniform float uTime;
uniform vec3 uSunDir;     // world space, unit length, points at the sun
uniform vec3 uSeed;       // noise-space offset derived from the seed
uniform vec3 uBetaR;      // Rayleigh scattering coefficients
uniform float uBetaM;     // Mie scattering coefficient
uniform vec3 uBetaAbs;    // absorption by dust / smoke
uniform vec3 uAtmoTint;   // sky colour used for ambient fill and reflections
uniform float uSunPower;

float sat01(float x) {
  return clamp(x, 0.0, 1.0);
}

float sq(float x) {
  return x * x;
}

// Colour of direct sunlight after it has crossed the atmosphere, for a sun
// zenith cosine "mu". Normalised so that the sun overhead is white; towards the
// terminator the path gets long and the light turns amber, then crimson.
vec3 sunTransmit(float mu) {
  float airmass = 1.0 / (clamp(mu, 0.0, 1.0) + 0.09) - 0.917;
  vec3 ext = uBetaR + uBetaAbs + vec3(uBetaM * 1.1);
  return exp(-ext * H_RAYLEIGH * airmass * 0.85);
}

// Extinction along the view path, relative to looking straight down. Darkens
// and warms the surface towards the limb (aerial perspective).
vec3 viewExtinction(float ndv) {
  vec3 ext = uBetaR + uBetaAbs + vec3(uBetaM);
  return exp(-ext * H_RAYLEIGH * (1.0 / (ndv + 0.12) - 0.893) * 0.3);
}

// Analytic anti-aliasing of a sphere silhouette: coverage of the pixel by a
// sphere of the given radius centred on the origin, from the distance between
// the view ray and the centre. Replaces multisampling for the two limbs.
float limbCoverage(vec3 rayOrigin, vec3 rayDir, float radius) {
  float miss = length(cross(rayOrigin, rayDir));
  return clamp((radius - miss) / max(fwidth(miss), 1e-6), 0.0, 1.0);
}

// GGX specular lobe with Schlick Fresnel and a Smith-Schlick visibility term.
float ggxSpec(vec3 n, vec3 v, vec3 l, float roughness, float f0) {
  vec3 hv = normalize(v + l);
  float a = roughness * roughness;
  float a2 = a * a;
  float ndh = max(dot(n, hv), 0.0);
  float ndv = max(dot(n, v), 0.001);
  float ndl = max(dot(n, l), 0.0);
  float vdh = max(dot(v, hv), 0.0);
  float dd = ndh * ndh * (a2 - 1.0) + 1.0;
  float dTerm = a2 / (K_PI * dd * dd);
  float k = a * 0.5;
  float vis = 1.0 / ((ndv * (1.0 - k) + k) * (ndl * (1.0 - k) + k));
  float fTerm = f0 + (1.0 - f0) * pow(1.0 - vdh, 5.0);
  return dTerm * vis * fTerm * 0.25 * ndl;
}
`;

// ---------------------------------------------------------------------------
// Noise: 3D simplex (with analytic gradient), fBm, ridged multifractal,
// cellular. All of it is sampled with 3D positions on the unit sphere, so
// there are no UV seams and no pinching at the poles.
// ---------------------------------------------------------------------------
export const GLSL_NOISE = /* glsl */ `
// --- 3D simplex noise (Ian McEwan / Ashima Arts, MIT licence) ---
vec3 sn_mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 sn_mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 sn_permute(vec4 x) {
  return sn_mod289(((x * 34.0) + 1.0) * x);
}

vec4 sn_taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

// Returns (gradient, value). The gradient is exact (analytic), which the
// surface uses for micro-relief without paying for extra taps.
vec4 snoiseD(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  // First corner
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  // Other corners
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  // Permutations
  i = sn_mod289(i);
  vec4 p = sn_permute(sn_permute(sn_permute(
        i.z + vec4(0.0, i1.z, i2.z, 1.0))
      + i.y + vec4(0.0, i1.y, i2.y, 1.0))
      + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  // Gradients: 7x7 points over a square, mapped onto an octahedron.
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  // Normalise gradients
  vec4 norm = sn_taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  // Radial falloff kernel (0.5 keeps the field continuous across cells).
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 t3 = m2 * m * pdotx;
  vec3 grad = -8.0 * (t3.x * x0 + t3.y * x1 + t3.z * x2 + t3.w * x3)
      + m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  return 105.0 * vec4(grad, dot(m4, pdotx));
}

float snoise(vec3 v) {
  return snoiseD(v).w;
}

// Fractional Brownian motion. "octaves" is a float: the last octave is faded
// in, so the octave count can follow the resolution it is rendered at.
float fbm(vec3 p, float octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 9; i++) {
    float w = clamp(octaves - float(i), 0.0, 1.0);
    if (w <= 0.0) {
      break;
    }
    sum += amp * w * snoise(p);
    p = p * 2.03 + vec3(17.1, -9.3, 5.7);
    amp *= 0.5;
  }
  return sum;
}

// Ridged multifractal (Musgrave): sharp crests, each octave weighted by the
// one before it so detail gathers on the ridges and valleys stay smooth.
float ridgedMF(vec3 p, float octaves) {
  float sum = 0.0;
  float amp = 0.5;
  float prev = 1.0;
  for (int i = 0; i < 9; i++) {
    float w = clamp(octaves - float(i), 0.0, 1.0);
    if (w <= 0.0) {
      break;
    }
    float n = 1.0 - abs(snoise(p));
    n *= n;
    sum += n * amp * prev * w;
    prev = clamp(n * 1.6, 0.0, 1.0);
    p = p * 2.07 + vec3(-3.7, 11.9, 7.3);
    amp *= 0.5;
  }
  return sum;
}

// Hash without sine (Dave Hoskins): stable across GPUs.
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// Cellular noise. Returns (F1, F2, random id of the nearest cell).
vec3 voronoi(vec3 x) {
  vec3 cell = floor(x);
  vec3 f = fract(x);
  float f1 = 8.0;
  float f2 = 8.0;
  float id = 0.0;
  for (int k = -1; k <= 1; k++) {
    for (int j = -1; j <= 1; j++) {
      for (int i = -1; i <= 1; i++) {
        vec3 g = vec3(float(i), float(j), float(k));
        vec3 o = hash33(cell + g);
        vec3 r = g + o - f;
        float d = dot(r, r);
        if (d < f1) {
          f2 = f1;
          f1 = d;
          id = o.z;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}
`;

// ---------------------------------------------------------------------------
// Cube-map baking helper: unit direction for the texel being written.
// Follows the OpenGL cube-map convention exactly, so that a later
// texture(samplerCube, dir) returns what was computed for "dir". Everything
// that is baked is therefore still evaluated from 3D positions on the sphere:
// no UV seams, no polar pinching.
// ---------------------------------------------------------------------------
export const GLSL_CUBE_FACE = /* glsl */ `
uniform int uFace;
uniform float uFaceSize;

vec3 faceDirection() {
  vec2 st = gl_FragCoord.xy / uFaceSize * 2.0 - 1.0;
  float a = st.x;
  float b = st.y;
  vec3 d;
  if (uFace == 0) {
    d = vec3(1.0, -b, -a);
  } else if (uFace == 1) {
    d = vec3(-1.0, -b, a);
  } else if (uFace == 2) {
    d = vec3(a, 1.0, b);
  } else if (uFace == 3) {
    d = vec3(a, -1.0, -b);
  } else if (uFace == 4) {
    d = vec3(a, -b, 1.0);
  } else {
    d = vec3(-a, -b, -1.0);
  }
  return normalize(d);
}
`;

// ---------------------------------------------------------------------------
// Terrain synthesis (bake time). Produces every field that does not depend on
// a slider, so sea level, relief, ice and the palette stay live uniforms.
// ---------------------------------------------------------------------------
export const GLSL_TERRAIN_FIELD = /* glsl */ `
uniform float uContFreq;
uniform float uWarp;
uniform float uOct;          // octaves that fit the cache resolution
uniform float uVeinAmt;      // canyons / ice fractures / lava rivers
uniform float uVeinDepth;
uniform float uVeinFreq;
uniform float uDune;

// Low-frequency vector field that bends the sampling space. This is what turns
// round noise blobs into tectonic-looking coastlines, peninsulas and arcs.
vec3 terrainWarp(vec3 q) {
  return vec3(
    fbm(q + vec3(1.7, 9.2, 3.4), 2.0),
    fbm(q + vec3(8.3, -2.8, 5.1), 2.0),
    fbm(q + vec3(-4.1, 6.6, 0.3), 2.0));
}

// Returns (base elevation, mountain term, vein mask, ridge value).
// Final elevation = base + relief * mountain, assembled at run time.
vec4 terrainFields(vec3 p) {
  vec3 q = p * uContFreq + uSeed;
  vec3 w = terrainWarp(q);
  vec3 qw = q + uWarp * w;

  // Continental base. The warp bends the large shapes in full and relaxes
  // towards the fine octaves: coastlines keep their tectonic sweep, but the
  // detail on top is not sheared into streaks.
  float cont = 0.0;
  {
    vec3 qo = q;
    vec3 wo = uWarp * w;
    float amp = 0.5;
    float bend = 1.0;
    for (int i = 0; i < 9; i++) {
      float wt = clamp(uOct - float(i), 0.0, 1.0);
      if (wt <= 0.0) {
        break;
      }
      cont += amp * wt * snoise(qo + wo * bend);
      qo = qo * 2.03 + vec3(17.1, -9.3, 5.7);
      wo *= 2.03;
      bend = max(bend * 0.76, 0.28);
      amp *= 0.5;
    }
  }

  // Mountain belts: ridged multifractal, confined to the interior of land
  // masses so oceans keep smooth abyssal plains.
  // (Bent a little less than the continents: ranges curve, they do not smear.)
  float rm = ridgedMF((q + 0.6 * uWarp * w) * 1.9 + vec3(11.5, 3.1, -7.2), uOct - 1.0);
  float inland = smoothstep(-0.15, 0.45, cont);
  float base = cont * 0.85;
  float mountain = inland * (rm - 0.22) * 0.9;

  // Veins: razor-thin channels where a warped noise crosses zero.
  float vein = 0.0;
  if (uVeinAmt > 0.001) {
    vec3 qv = qw * uVeinFreq + w * 0.6;
    float v1 = max(1.0 - abs(snoise(qv + vec3(31.7, 0.0, 0.0))), 0.0);
    float v2 = max(1.0 - abs(snoise(qv * 2.3 + vec3(0.0, 17.3, 5.5))), 0.0);
    vein = max(pow(v1, 14.0), 0.6 * pow(v2, 18.0)) * uVeinAmt;
    base -= uVeinDepth * vein;
  }

  // Dune fields: anisotropic ridges, strongest in the basins.
  if (uDune > 0.001) {
    vec3 qd = (p + 0.04 * w) * vec3(46.0, 18.0, 46.0) + uSeed;
    float dn = 1.0 - abs(snoise(qd));
    base += uDune * 0.03 * dn * dn * (1.0 - 0.6 * inland);
  }

  return vec4(base, mountain, vein, rm);
}
`;

// ---------------------------------------------------------------------------
// Cloud field (bake time): animated, domain-warped fBm wound into cyclones.
// The value is stored *before* the coverage threshold, so the coverage slider
// stays a plain uniform.
// ---------------------------------------------------------------------------
export const GLSL_CLOUD_FIELD = /* glsl */ `
uniform float uCloudTime;   // time stamp of the snapshot being baked
uniform float uCloudFreq;
uniform float uCloudWarp;
uniform float uCloudStretch;
uniform vec4 uStormA;       // xyz = storm centre (cloud object space), w = twist in radians
uniform vec4 uStormB;
uniform vec4 uStormC;

// Rotate the sampling position around a storm centre. The angle falls off
// with distance, which winds the surrounding noise into spiral arms.
vec3 swirl(vec3 p, vec4 storm, inout float boost) {
  float d = 1.0 - dot(p, storm.xyz);
  float f = exp(-d * 60.0);
  float a = storm.w * f;
  float c = cos(a);
  float s = sin(a);
  boost += f * abs(storm.w) * 0.03;
  return p * c + cross(storm.xyz, p) * s + storm.xyz * dot(storm.xyz, p) * (1.0 - c);
}

float cloudFieldSynth(vec3 p) {
  float boost = 0.0;
  p = swirl(p, uStormA, boost);
  p = swirl(p, uStormB, boost);
  p = swirl(p, uStormC, boost);

  float t = uCloudTime * 0.012;
  vec3 q = p * uCloudFreq + uSeed.zxy * 1.37;
  q.y *= uCloudStretch;   // zonal bands: features are longer along latitude

  // Animated domain warp: the flow field that carries the cloud mass.
  // It is kept broad (low frequency): large displacements bend the systems
  // into fronts and commas without shearing them into streaks.
  vec3 qf = q * 0.38;
  vec3 w = vec3(
    snoise(qf + vec3(0.0, t, 3.1)),
    snoise(qf + vec3(13.7, -t, 4.1)),
    snoise(qf + vec3(-7.9, 2.3, t)));
  q += uCloudWarp * w;

  // Weather systems. The octaves roll off slowly, so the fine billows are
  // strong enough to survive the coverage threshold and break up the edges.
  // Each octave drifts at its own pace (a little faster the finer it is), so
  // two snapshots a few seconds apart differ by a small shift at every scale
  // and blend into each other without the fine detail pulsing.
  vec3 qa = q;
  vec3 drift = vec3(t * 0.6, 0.0, -t * 0.4);
  float n = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 7; i++) {
    n += amp * snoise(qa + drift);
    qa = qa * 2.07 + vec3(17.1, -9.3, 5.7);
    drift *= 1.4;
    amp *= 0.58;
  }
  // Wispy cirrus streaks riding the jet streams.
  n += 0.06 * snoise(q * vec3(2.2, 6.0, 2.2) + vec3(-t, 0.0, t));
  return 0.85 * n + boost + 0.1 * w.x;
}
`;

// ---------------------------------------------------------------------------
// Cloud lookup (run time). Two snapshots of the field, a moment apart, are
// blended so the deck evolves continuously while only a sliver of it is
// re-baked each frame. Used by the cloud shell and by the ground shadows.
// ---------------------------------------------------------------------------
export const GLSL_CLOUDS = /* glsl */ `
uniform samplerCube uCloudA;   // earlier snapshot
uniform samplerCube uCloudB;   // later snapshot
uniform float uCloudBlend;     // 0..1 between them
uniform float uCloudCover;

float cloudField(vec3 p) {
  return mix(textureLod(uCloudA, p, 0.0).r, textureLod(uCloudB, p, 0.0).r, uCloudBlend);
}

float cloudCoverage(float n) {
  float threshold = mix(0.74, -0.62, uCloudCover);
  return smoothstep(threshold, threshold + 0.26, n) * smoothstep(0.0, 0.06, uCloudCover);
}

float cloudDensity(vec3 p) {
  return cloudCoverage(cloudField(p));
}
`;

// ---------------------------------------------------------------------------
// Ring radial profile (bake time): (optical density, hue) along the radius.
// ---------------------------------------------------------------------------
export const GLSL_RING_FIELD = /* glsl */ `
uniform float uRingSeed;

vec2 ringField(float u) {
  float s = uRingSeed;
  float n1 = snoise(vec3(u * 5.0, s, 1.3));
  float n2 = snoise(vec3(u * 23.0, s, 7.7));
  float n3 = snoise(vec3(u * 97.0, s, 3.9));
  float n4 = snoise(vec3(u * 390.0, s, 5.1));   // micro-banding
  float dens = 0.58 + 0.30 * n1 + 0.24 * n2 + 0.16 * n3 + 0.10 * n4;

  // Cassini-style divisions: one wide gap and two narrow ones.
  float g1 = 0.60 + 0.08 * sin(s * 3.1);
  float g2 = 0.27 + 0.05 * sin(s * 5.7 + 1.0);
  dens *= 1.0 - 0.96 * (1.0 - smoothstep(0.014, 0.024, abs(u - g1)));
  dens *= 1.0 - 0.85 * (1.0 - smoothstep(0.004, 0.009, abs(u - g2)));
  dens *= 1.0 - 0.90 * (1.0 - smoothstep(0.003, 0.007, abs(u - (g1 + 0.19))));

  // Dust lanes where the ringlet noise bottoms out.
  dens *= smoothstep(-0.62, -0.30, n2 + 0.4 * n3);

  // Faint inner ring, bright main ring, soft edges.
  dens *= mix(0.30, 1.0, smoothstep(0.10, 0.26, u));
  dens *= smoothstep(0.0, 0.02, u) * (1.0 - smoothstep(0.93, 1.0, u));

  float hue = 0.5 + 0.5 * snoise(vec3(u * 9.0, s, 2.0));
  return vec2(clamp(dens, 0.0, 1.0), hue);
}
`;

// ---------------------------------------------------------------------------
// Ring lookup (run time) and the shadow the rings cast on the planet.
// ---------------------------------------------------------------------------
export const GLSL_RINGS = /* glsl */ `
uniform sampler2D uRingTex;  // r = optical density, g = hue, along the radius
uniform float uRingsOn;      // 0..1 fade
uniform float uRingInner;
uniform float uRingOuter;
uniform vec3 uRingNormal;    // world space
uniform float uRingOpacity;

float ringCoord(float r) {
  return (r - uRingInner) / (uRingOuter - uRingInner);
}

// Normal optical depth from the baked density. Saturn's rings are contrasty:
// the B ring reaches tau 2-5 (its shadow on the planet is nearly black), the
// A ring 0.4-0.9, the C ring and the Cassini Division only about 0.1. A
// straight dens * opacity squeezes that range, so dense bands get extra depth.
float ringTau(float dens) {
  return uRingOpacity * dens * (0.35 + 1.9 * dens);
}

// Fraction of sunlight reaching world-space point P on the planet once the
// rings have had their say: intersect the sun ray with the ring plane.
float ringShadow(vec3 P) {
  if (uRingsOn < 0.01) {
    return 1.0;
  }
  float dn = dot(uSunDir, uRingNormal);
  if (abs(dn) < 0.0001) {
    return 1.0;
  }
  float t = -dot(P, uRingNormal) / dn;
  if (t <= 0.0) {
    return 1.0;
  }
  float u = ringCoord(length(P + uSunDir * t));
  if (u <= 0.0 || u >= 1.0) {
    return 1.0;
  }
  // A slightly blurred level: the sun is not a point, so shadows are soft
  // (but only just: seen from a planet, the sun is a small disc).
  float dens = textureLod(uRingTex, vec2(u, 0.5), 1.5).r;
  // Sunlight crosses the ring along a slant path: the lower the sun stands
  // over the rings, the darker their shadow.
  float occ = 1.0 - exp(-ringTau(dens) / max(abs(dn), 0.04));
  return 1.0 - occ * uRingsOn;
}
`;

// ---------------------------------------------------------------------------
// Land cover: the rules that decide what the ground is made of. The surface
// shader paints with them and the probe (probe.js) reports them, so what a
// probe says always matches what is on screen. Heights are those of the
// surface shader: bioH above the biome datum, landH above the liquid.
// ---------------------------------------------------------------------------
export const GLSL_SURFACE = /* glsl */ `
uniform float uIce;
uniform float uSnow;
uniform float uMoisture;

// Moisture: noise + a dry belt at the horse latitudes + a wet equator.
float coverMoisture(float lat, float climX, float grain) {
  return clamp(0.5 + 0.85 * climX + 0.24 * grain + (uMoisture - 0.5) * 1.2
      - 0.30 * exp(-sq((lat - 0.42) / 0.13))
      + 0.18 * exp(-sq(lat / 0.16)), 0.0, 1.0);
}

// Cold lowland (tundra) towards the poles and up the slopes.
float coverCold(float lat, float climY, float bioH) {
  return smoothstep(0.52, 0.86, lat + climY * 0.14 + max(bioH, 0.0) * 0.45);
}

// 0 on the beach (sand), 1 inland.
float coverInland(float bioH, float climY, float grain) {
  return smoothstep(0.006, 0.03, bioH + climY * 0.008 + grain * 0.005);
}

float coverSteep(float slope) {
  return smoothstep(2.2, 5.5, slope);
}

// Rock on high ground and on steep faces.
float coverRock(float bioH, float grain, float steep) {
  return max(smoothstep(0.24, 0.48, bioH + grain * 0.04),
      0.8 * steep * smoothstep(0.05, 0.20, bioH));
}

// Snow line drops towards the poles; steep faces shed their snow.
float coverSnow(float lat, float bioH, float climY, float grain, float steep) {
  float snowLine = mix(0.46, 0.06, smoothstep(0.15, 0.90, lat));
  return smoothstep(snowLine, snowLine + 0.08, bioH + climY * 0.04 + grain * 0.025)
      * (1.0 - 0.75 * steep) * uSnow;
}

// Polar caps: latitude threshold with a ragged, elevation-aware edge.
float coverIce(float lat, float climY, float bioH) {
  float iceEdge = mix(1.08, 0.52, uIce);
  return smoothstep(iceEdge - 0.015, iceEdge + 0.02, lat + climY * 0.10 + max(bioH, 0.0) * 0.35)
      * step(0.001, uIce);
}

// Where towns may stand: low, near the coast, temperate, not frozen.
float coverHabitable(float lat, float bioH, float landH, float moist, float ice, float snow) {
  float lowland = (1.0 - smoothstep(0.10, 0.30, bioH)) * smoothstep(0.002, 0.012, landH);
  float coastal = mix(0.45, 1.0, 1.0 - smoothstep(0.0, 0.10, bioH));
  float temperate = (1.0 - smoothstep(0.62, 0.86, lat)) * mix(0.3, 1.0, smoothstep(0.25, 0.55, moist));
  return lowland * coastal * temperate * (1.0 - ice) * (1.0 - snow);
}
`;

// ---------------------------------------------------------------------------
// Relief finer than the terrain cache (FLIGHT-PLAN.md, stage D). Octaves of
// simplex noise from a ~25 km wavelength (Terran) down to metres. The terrain
// vertex shader puts the ones its grid can carry into the geometry; the
// fragment shader adds the finer ones to the normal.
//
// Precision: a float has 0.76 m of resolution at the planet's radius, and a
// noise lattice at millions of cycles per radius needs more. The point is
// therefore split as hi + lo + rel: hi is the patch centre rounded to 1/4096
// (so hi * F is exact for these power-of-two frequencies), lo the rest of the
// centre, rel the offset from the centre (small, so exact). The simplex noise
// repeats every 867 units along each axis (289 lattice cells, skewed), which
// lets hi * F be wrapped before the small parts are added.
//
// Heights are in elevation units, gradients in elevation units per planet
// radius (object space); uRealScale turns elevation units into radii.
// ---------------------------------------------------------------------------
export const DETAIL = { octaves: 15, f0: 256 };

export const GLSL_RELIEF_DETAIL = /* glsl */ `
#define DETAIL_OCTAVES ${DETAIL.octaves}
#define DETAIL_F0 ${DETAIL.f0.toFixed(1)}
#define NOISE_PERIOD 867.0

uniform float uRealScale;    // planet radii per elevation unit (kmPerUnit / radiusKm)

// Sum of the octaves' values the last reliefDetail call evaluated, weighted
// like the relief (about -1..1): a tone for the albedo at the same scales.
float gDetailTone;

// Noise coordinate of the point (hi + lo + rel) at frequency "freq", exact at
// metre scale. freq must be DETAIL_F0 times a power of two (see the octaves).
vec3 detailCoord(vec3 hi, vec3 lo, vec3 rel, float freq) {
  return mod(hi * freq, NOISE_PERIOD) + lo * freq + rel * freq;
}

// Weight of a pattern of the given frequency seen through pixels of size px
// (radii): 0 while it spans under 2.5 pixels, 1 from 5 pixels on.
float nearFade(float freq, float px) {
  return smoothstep(2.5, 5.0, 1.0 / (freq * px));
}

// Slope one octave contributes, from the cache's mountain term: plains stay
// gentle, mountains break into crags (real slopes, not exaggerated).
float detailSlope(vec4 shape, float relief) {
  float mount = sat01(0.3 + 1.5 * shape.y) * min(relief, 1.5);
  return 0.018 + 0.085 * mount;
}

// Sum of the octaves whose wavelength is resolved by "fine" (spacing of the
// samples: grid or pixel) and not already carried at "coarse". Returns
// (gradient xyz, height).
vec4 reliefDetail(vec3 hi, vec3 lo, vec3 rel, float fine, float coarse, float slope, float ridged) {
  vec4 acc = vec4(0.0);
  gDetailTone = 0.0;
  float freq = DETAIL_F0;
  float amp = slope / (2.5 * uRealScale);
  for (int i = 0; i < DETAIL_OCTAVES; i++) {
    float lambda = 1.0 / freq;
    if (lambda < 1.5 * fine) {
      break;
    }
    float w = smoothstep(1.5, 3.0, lambda / fine) * (1.0 - smoothstep(2.0, 4.0, lambda / coarse));
    if (w > 0.001) {
      vec3 q = detailCoord(hi, lo, rel, freq) + uSeed.zxy * 2.7 + vec3(float(i) * 17.1, float(i) * -9.3, float(i) * 5.7);
      vec4 n = snoiseD(q);
      // Ridged on mountains: crests instead of rounded hills.
      float s = n.w < 0.0 ? -1.0 : 1.0;
      float v = mix(n.w, 0.55 - 1.5 * abs(n.w), ridged);
      vec3 g = mix(n.xyz, -1.5 * s * n.xyz, ridged);
      acc.w += w * amp * lambda * v;
      acc.xyz += w * amp * g;
      gDetailTone += w * v;
    }
    freq *= 2.0;
  }
  return acc;
}
`;
