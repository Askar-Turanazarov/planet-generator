// Planetary surface: geology, biomes, oceans, lava, ice, night lights.
//
// The slider-independent terrain fields come from the terrain cache (cube maps
// synthesised from 3D noise, see bake.js). Everything a slider touches (sea
// level, relief, ice, lights, palette) is assembled here from uniforms, so the
// controls never trigger a rebuild of anything.
import { GLSL_COMMON, GLSL_NOISE, GLSL_CLOUDS, GLSL_RINGS } from './chunks.js';

export const PLANET_VERT = /* glsl */ `
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

export const PLANET_FRAG = /* glsl */ `
${GLSL_COMMON}
${GLSL_NOISE}
${GLSL_CLOUDS}
${GLSL_RINGS}

uniform mat4 modelMatrix;

// --- terrain cache ---
uniform samplerCube uTerrainA;   // (base elevation, mountain term, vein mask, ridge value)
uniform samplerCube uTerrainB;   // (climate x, climate y, city lights, land-cover grain)

// --- geology ---
uniform float uSeaLevel;
uniform float uBiomeDatum;   // elevation the biomes are measured from
uniform float uRelief;
uniform float uRidge;
uniform float uEps;          // finite-difference step on the unit sphere
uniform float uBump;
uniform vec3 uDetail;        // weights of the three micro-relief octaves (LOD)
uniform float uVeinMix;
uniform float uVeinEmissive;

// --- climate & surface response ---
uniform float uIce;
uniform float uSnow;
uniform float uMoisture;
uniform float uCityLights;
uniform float uLiquidEmissive;
uniform float uLiquidSpec;
uniform float uCloudShadow;
uniform mat3 uCloudW2O;      // world -> cloud object space

// --- palette ---
uniform vec3 uColDeep;
uniform vec3 uColShallow;
uniform vec3 uColSand;
uniform vec3 uColLowWet;
uniform vec3 uColLowDry;
uniform vec3 uColCold;
uniform vec3 uColRock;
uniform vec3 uColRockB;
uniform vec3 uColSnow;
uniform vec3 uColIce;
uniform vec3 uColVein;
uniform vec3 uColCity;

varying vec3 vObjPos;
varying vec3 vWorldPos;

// Elevation of the unit-sphere point p. Sea level is a threshold on this
// value; the relief slider scales the mountain term live.
float getElevation(vec3 p) {
  vec2 s = texture(uTerrainA, p).xy;
  return s.x + uRelief * uRidge * s.y;
}

float elevationLod(vec3 p, float lod) {
  vec2 s = textureLod(uTerrainA, p, lod).xy;
  return s.x + uRelief * uRidge * s.y;
}

void main() {
  vec3 p = normalize(vObjPos);
  mat3 o2w = mat3(modelMatrix);
  vec3 N = normalize(o2w * p);
  vec3 L = uSunDir;
  vec3 V = normalize(cameraPosition - vWorldPos);
  float mu = dot(N, L);
  float ndv = max(dot(N, V), 0.0);
  float lat = abs(p.y);

  // Tangent frame on the sphere. The reconstructed normal does not depend on
  // which orthonormal frame is used, so the pole switch is invisible.
  vec3 upAxis = abs(p.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(upAxis, p));
  vec3 B = cross(p, T);

  // ---- elevation: three taps in object space ----
  // Tap 1 at p, taps 2 and 3 one step along each tangent. The finite
  // difference is the macro slope that tilts the normal.
  vec4 shape = texture(uTerrainA, p);
  vec4 cover = texture(uTerrainB, p);
  // By-products reused by the biome code: (vein, ridge, climate x, climate y).
  vec4 aux = vec4(shape.z, shape.w, cover.x * 2.0 - 1.0, cover.y * 2.0 - 1.0);

  float h0 = shape.x + uRelief * uRidge * shape.y;
  float hT = getElevation(normalize(p + uEps * T));
  float hB = getElevation(normalize(p + uEps * B));
  vec2 grad = vec2(hT - h0, hB - h0) / uEps;

  // ---- micro-relief: octaves too fine for the cache ----
  // Added only when the camera is close enough to resolve them. Simplex noise
  // has an exact gradient, so the high-frequency bump needs no extra taps.
  // It only shapes sunlit ground, so it fades out past the terminator and the
  // night side skips the noise altogether.
  float micro = 0.0;
  float sunlit = smoothstep(-0.16, -0.06, mu);
  if (uDetail.x > 0.0 && sunlit > 0.0 && h0 - uSeaLevel > -0.012) {
    float rugged = 0.4 + sat01(0.3 + 1.5 * shape.y) * min(uRelief * uRidge, 1.5);
    vec3 dq = p * 200.0 + uSeed.zxy * 2.7;
    float amp = 0.0032 * rugged * sunlit;
    float freq = 200.0;
    vec3 dg = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float w = uDetail[i];
      if (w <= 0.0) {
        break;
      }
      vec4 nd = snoiseD(dq);
      micro += amp * w * nd.w;
      dg += (amp * w * freq) * nd.xyz;
      dq = dq * 2.03 + vec3(17.1, -9.3, 5.7);
      freq *= 2.03;
      amp *= 0.5;
    }
    h0 += micro;
    grad += vec2(dot(dg, T), dot(dg, B));
  }

  float grain = cover.w * 2.0 - 1.0; // fine land-cover mottling
  float landH = h0 - uSeaLevel;      // height above the liquid surface
  float bioH = h0 - uBiomeDatum;     // height the biomes are keyed to

  // Screen-space derivatives must be taken before any branching.
  float shoreWidth = fwidth(h0) * 1.5 + 0.0005;
  float pixelArc = length(fwidth(p));
  float waveFoot = pixelArc * 160.0;
  // Mip level of the terrain cache that matches one pixel (for the taps that
  // are taken inside branches, where the GPU cannot work it out itself).
  float reliefLod = log2(max(pixelArc * 0.7 * float(textureSize(uTerrainA, 0).x) / 1.5708, 1.0));

  float night = smoothstep(0.06, -0.16, mu);

  // Polar caps: latitude threshold with a ragged, elevation-aware edge.
  float iceEdge = mix(1.08, 0.52, uIce);
  float ice = smoothstep(iceEdge - 0.015, iceEdge + 0.02,
      lat + aux.w * 0.10 + max(bioH, 0.0) * 0.35) * step(0.001, uIce);

  vec3 albedo = vec3(0.0);
  vec3 emissive = vec3(0.0);
  vec3 nObj = p;
  float specAmt = 0.0;
  float rough = 0.5;

  if (landH > 0.0) {
    // ===================== LAND =====================
    // The gradient tilts the normal so ridges, craters and coasts catch the sun.
    float slope = length(grad);
    nObj = normalize(p - uBump * (grad.x * T + grad.y * B));

    // Moisture: noise + a dry belt at the horse latitudes + a wet equator.
    float moist = clamp(0.5 + 0.85 * aux.z + 0.24 * grain + (uMoisture - 0.5) * 1.2
        - 0.30 * exp(-sq((lat - 0.42) / 0.13))
        + 0.18 * exp(-sq(lat / 0.16)), 0.0, 1.0);

    vec3 low = mix(uColLowDry, uColLowWet, smoothstep(0.30, 0.62, moist));
    float cold = smoothstep(0.52, 0.86, lat + aux.w * 0.14 + max(bioH, 0.0) * 0.45);
    low = mix(low, uColCold, cold);
    albedo = mix(uColSand, low, smoothstep(0.006, 0.03, bioH + aux.w * 0.008 + grain * 0.005));

    // Stratified rock on high ground and on steep faces.
    float steep = smoothstep(2.2, 5.5, slope);
    float rocky = max(smoothstep(0.24, 0.48, bioH + grain * 0.04),
        0.8 * steep * smoothstep(0.05, 0.20, bioH));
    // Strata follow elevation, bent by the ridge field so they read as
    // folded beds rather than as contour lines.
    // (two incommensurate bed thicknesses, so the banding never looks ruled).
    float strata = 0.5 + 0.33 * sin(bioH * 80.0 + aux.z * 7.0 + aux.y * 5.0)
        + 0.17 * sin(bioH * 217.0 + aux.z * 3.0 - aux.y * 9.0);
    // The beds show on cliffs and scarps; plateaus weather to one tone.
    albedo = mix(albedo, mix(uColRock, uColRockB, strata * mix(0.12, 0.6, steep) + 0.15), rocky);

    // Snow line drops towards the poles; steep faces shed their snow.
    float snowLine = mix(0.46, 0.06, smoothstep(0.15, 0.90, lat));
    float snow = smoothstep(snowLine, snowLine + 0.08, bioH + aux.w * 0.04 + grain * 0.025)
        * (1.0 - 0.75 * steep) * uSnow;
    albedo = mix(albedo, uColSnow, snow);

    // Valleys sit darker than crests, down to the finest visible grain.
    albedo *= (0.80 + 0.38 * aux.y) * (1.0 + 0.16 * grain);
    albedo *= 1.0 + clamp(micro * 34.0, -0.22, 0.22);

    // Veins: tint, and glow if the archetype says they are molten.
    float veinV = clamp(aux.x, 0.0, 1.0);
    albedo = mix(albedo, uColVein, veinV * uVeinMix);
    if (uVeinEmissive > 0.001) {
      float pulse = 0.78 + 0.22 * sin(uTime * 0.7 + aux.z * 24.0);
      emissive += mix(uColVein, uColDeep, veinV * veinV) * veinV * pulse * uVeinEmissive;
    }

    albedo = mix(albedo, uColIce, ice);
    specAmt = ice * 0.5;
    rough = 0.45;

    // Civilisation: the baked pattern of towns, metropolises and highways,
    // admitted only where the land is habitable and only after dark.
    if (uCityLights > 0.001 && night > 0.001) {
      float lowland = (1.0 - smoothstep(0.10, 0.30, bioH)) * smoothstep(0.002, 0.012, landH);
      float coastal = mix(0.45, 1.0, 1.0 - smoothstep(0.0, 0.10, bioH));
      float temperate = (1.0 - smoothstep(0.62, 0.86, lat)) * mix(0.3, 1.0, smoothstep(0.25, 0.55, moist));
      float habitable = lowland * coastal * temperate * (1.0 - ice) * (1.0 - snow);
      emissive += uColCity * (cover.z * 3.0) * habitable * night * uCityLights * 3.0;
    }

    // Anti-aliased shoreline: fade into the shallows over about a pixel.
    albedo = mix(uColShallow, albedo, smoothstep(0.0, shoreWidth, landH));
  } else {
    // ===================== LIQUID =====================
    float depth = -landH;
    albedo = mix(uColShallow, uColDeep, smoothstep(0.0, 0.22, depth));
    albedo = mix(albedo, uColShallow * 1.25, 0.45 * exp(-depth * 45.0));

    // Animated micro-waves. They fade out when they shrink below a pixel and
    // the lost detail is folded into roughness instead. Waves only show in the
    // sun's reflection, so the noise is evaluated around the glint and nowhere
    // else (the reflection of a smooth sphere peaks where N meets the half
    // vector; outside that cone the lobe has decayed to nothing).
    float fade = 1.0 - smoothstep(0.25, 0.9, waveFoot);
    float glint = fade * smoothstep(0.74, 0.86, dot(N, normalize(L + V)));
    if (glint > 0.0) {
      // The slope of one height field (its exact gradient, laid flat on the
      // sphere) tilts the normal in both directions at once.
      float tw = uTime * 0.25;
      vec3 slopeW = snoiseD(p * 160.0 + uSeed + vec3(tw, 0.0, tw * 0.6)).xyz;
      nObj = normalize(p + (0.0048 * glint) * (slopeW - p * dot(slopeW, p)));
    }
    rough = mix(0.36, 0.22, fade);
    specAmt = uLiquidSpec;

    if (uLiquidEmissive > 0.001) {
      // Molten sea: a drifting crust broken by incandescent cracks.
      float crust = fbm(p * 14.0 + uSeed + vec3(0.0, uTime * 0.01, 0.0), 3.0);
      float cracks = max(1.0 - abs(snoise(p * 30.0 + uSeed.yzx + crust)), 0.0);
      float heat = clamp(0.08 + 0.85 * crust + 0.9 * pow(cracks, 6.0) + 0.22 * exp(-depth * 60.0), 0.0, 1.0);
      albedo = mix(vec3(0.02, 0.015, 0.012), uColShallow * 0.2, heat);
      emissive += mix(uColShallow, uColDeep, heat * heat) * heat * heat * 2.6 * uLiquidEmissive;
    }

    // Sea ice.
    albedo = mix(albedo, uColIce, ice);
    specAmt = mix(specAmt, 0.5, ice);
    rough = mix(rough, 0.45, ice);
    nObj = normalize(mix(nObj, p, ice));
  }

  // ===================== LIGHTING =====================
  vec3 Ns = normalize(o2w * nObj);
  float ndl = max(dot(Ns, L), 0.0);
  // Geometric horizon term: bumps cannot be lit once the sun is below ground.
  float horizon = smoothstep(-0.05, 0.12, mu);
  vec3 sunCol = sunTransmit(mu) * uSunPower;

  float shadow = 1.0;
  if (uCloudCover > 0.01 && mu > -0.05) {
    // Project along the sun ray up to the cloud deck, then ask the cloud
    // field how dense it is there.
    vec3 Lt = L - N * mu;
    vec3 sp = normalize(N + Lt * (0.013 / max(mu, 0.22)));
    shadow *= 1.0 - uCloudShadow * cloudDensity(uCloudW2O * sp);
  }
  shadow *= ringShadow(N);

  // Relief shadows: when the sun is low, high ground up-sun hides it. Two
  // taps of the elevation along the sun's ground track, compared against the
  // height of the sun ray there. Only the band near the terminator pays.
  if (landH > 0.0 && mu > -0.03 && mu < 0.42) {
    vec3 Lobj = L * o2w;                          // world -> object for a rotation
    vec3 Lg = normalize(Lobj - p * dot(Lobj, p));
    float rise = mu / sqrt(max(1.0 - mu * mu, 1e-4));
    float d1 = uEps * 2.5;
    float d2 = uEps * 7.0;
    float o1 = uBump * (elevationLod(normalize(p + d1 * Lg), reliefLod) - h0) / d1 - rise;
    float o2 = uBump * (elevationLod(normalize(p + d2 * Lg), reliefLod + 1.0) - h0) / d2 - rise;
    shadow *= 1.0 - 0.85 * smoothstep(0.0, 0.10, max(o1, o2));
  }

  float day = smoothstep(-0.2, 0.4, mu);
  vec3 col = albedo * (sunCol * ndl * horizon * shadow + uAtmoTint * 0.05 * day + vec3(0.0012));

  // Sun glint: strictly water and ice.
  if (specAmt > 0.001 && mu > -0.05) {
    float spec = min(ggxSpec(Ns, V, L, rough, 0.02), 5.0);
    col += sunCol * spec * specAmt * horizon * shadow;
    float fresnel = pow(1.0 - max(dot(Ns, V), 0.0), 5.0);
    col += uAtmoTint * fresnel * 0.22 * specAmt * day;
  }

  col += emissive;
  col *= viewExtinction(ndv);

  // Alpha is the analytic coverage of the silhouette (limb anti-aliasing).
  gl_FragColor = vec4(col, limbCoverage(cameraPosition, -V, R_PLANET));
}
`;
