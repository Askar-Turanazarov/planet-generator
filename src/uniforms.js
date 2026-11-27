// One registry of uniforms shared by every material. Because each entry is a
// single { value } object referenced from all shaders, changing a parameter is
// one assignment: no material rebuilds, no geometry rebuilds, no allocations.
import * as THREE from 'three';

export function createUniforms() {
  const num = (v = 0) => ({ value: v });
  const vec3 = (x = 0, y = 0, z = 0) => ({ value: new THREE.Vector3(x, y, z) });
  const vec4 = () => ({ value: new THREE.Vector4(0, 1, 0, 0) });
  const col = () => ({ value: new THREE.Color(0, 0, 0) });
  const tex = () => ({ value: null });   // filled in by the baker

  return {
    // --- global ---
    uTime: num(0),
    uSunDir: vec3(1, 0, 0),
    uSeed: vec3(),
    uSunPower: num(1.0),
    uSunColor: { value: new THREE.Color(1.0, 0.96, 0.9) },

    // --- atmosphere (derived from density / hue / archetype colour) ---
    uBetaR: vec3(),
    uBetaM: num(0),
    uBetaAbs: vec3(),
    uAtmoTint: vec3(),
    uAtmoSun: num(8.0),

    // --- geology ---
    uSeaLevel: num(0),
    uBiomeDatum: num(0),          // elevation the biomes are measured from
    uRelief: num(1),
    uRidge: num(1),
    uContFreq: num(1.35),
    uWarp: num(0.5),
    uOct: num(7),                 // octaves synthesised into the terrain cache
    uEps: num(0.0024),
    uDetail: vec3(),              // micro-relief octave weights (distance LOD)
    uTerrainA: tex(),
    uTerrainB: tex(),
    uBump: num(0.06),
    uVeinAmt: num(0),
    uVeinDepth: num(0),
    uVeinFreq: num(3),
    uVeinMix: num(0),
    uVeinEmissive: num(0),
    uDune: num(0),

    // --- climate & surface response ---
    uIce: num(0.4),
    uSnow: num(1),
    uMoisture: num(0.5),
    uCityLights: num(0.8),
    uLiquidEmissive: num(0),
    uLiquidSpec: num(1),

    // --- palette ---
    uColDeep: col(),
    uColShallow: col(),
    uColSand: col(),
    uColLowWet: col(),
    uColLowDry: col(),
    uColCold: col(),
    uColRock: col(),
    uColRockB: col(),
    uColSnow: col(),
    uColIce: col(),
    uColVein: col(),
    uColCity: col(),

    // --- clouds ---
    uCloudCover: num(0.5),
    uCloudFreq: num(2.2),
    uCloudWarp: num(0.8),
    uCloudStretch: num(1.6),
    uCloudShadow: num(0.6),
    uCloudOpacity: num(1),
    uCloudW2O: { value: new THREE.Matrix3() },
    uCloudA: tex(),
    uCloudB: tex(),
    uCloudBlend: num(0),
    uCloudDetail: num(0),
    uCloudRadius: num(1.012),
    uStormA: vec4(),
    uStormB: vec4(),
    uStormC: vec4(),
    uColCloudLit: col(),
    uColCloudShade: col(),
    uColCloudGlow: col(),

    // --- rings ---
    uRingsOn: num(0),
    uRingInner: num(1.4),
    uRingOuter: num(2.4),
    uRingNormal: vec3(0, 1, 0),
    uRingSeed: num(0),
    uRingOpacity: num(1.6),
    uRingColA: col(),
    uRingColB: col(),
    uRingTex: tex(),

    // --- lookup textures ---
    uSkyTex: tex(),
    uAtmoLut: tex(),
  };
}
