// Curated archetypes. Each one is a full description of a world:
//   sliders  - the values exposed in the HUD (0..1 unless noted)
//   shape    - hidden art-direction parameters for geology, clouds, air, rings
//   colors   - the palette, written in sRGB hex
//   survey   - what the probe needs to speak in kilometres and degrees: the
//              radius, km per unit of terrain height, the climate (equator
//              temperature t0 and its drop to the pole, "span", in °C), and
//              local names for the land-cover classes (see survey.js)
// Everything here ends up in shader uniforms; switching archetype never
// rebuilds a mesh or a material. The display name, class tag and description
// of each world live in i18n.js under preset.<id>.*, one set per language.

export const PRESETS = [
  {
    id: 'terran',
    seed: 4217,
    rings: false,
    survey: { radiusKm: 6371, kmPerUnit: 18, t0: 30, span: 46 },
    sliders: {
      seaLevel: 0.56,
      relief: 0.62,
      ice: 0.46,
      cityLights: 0.8,
      cloudCover: 0.52,
      atmoDensity: 0.5,
      atmoHue: 0,
      ringTilt: 18,
    },
    shape: {
      contFreq: 1.35, warp: 0.55, ridge: 1.0, bump: 0.055,
      veinAmt: 0.0, veinDepth: 0.0, veinFreq: 3.0, veinMix: 0.0, veinEmissive: 0.0,
      dune: 0.0, snow: 1.0, moisture: 0.6,
      liquidEmissive: 0.0, liquidSpec: 1.0,
      cloudFreq: 2.3, cloudWarp: 0.42, cloudStretch: 1.3, cloudShadow: 0.62, cloudOpacity: 0.96, stormTwist: 3.4,
      atmoAbsorb: 0.0, mie: 2.2,
      ringInner: 1.45, ringOuter: 2.35, ringOpacity: 1.5,
    },
    colors: {
      deep: '#04193d', shallow: '#1b8ea6', sand: '#c8b283',
      lowWet: '#2c5a26', lowDry: '#a3884f', cold: '#55654a',
      rock: '#6b5f55', rockB: '#8b7b69', snow: '#f3f6fa', ice: '#e4edf5',
      vein: '#1b6f8c', city: '#ffbe62',
      cloudLit: '#ffffff', cloudShade: '#8a95a8', cloudGlow: '#000000',
      atmo: '#2f6bff', ringA: '#cdbfa6', ringB: '#8f8676',
    },
  },
  {
    id: 'arrakis',
    seed: 10191,
    rings: false,
    survey: {
      radiusKm: 5900, kmPerUnit: 16, t0: 58, span: 50,
      names: { forest: 'rockyPlain', grassland: 'rockyPlain', taiga: 'coldDesert', tundra: 'coldDesert', faults: 'canyons' },
    },
    sliders: {
      seaLevel: 0.0,
      relief: 0.78,
      ice: 0.0,
      cityLights: 0.12,
      cloudCover: 0.34,
      atmoDensity: 0.3,
      atmoHue: 0,
      ringTilt: 12,
    },
    shape: {
      contFreq: 1.6, warp: 0.75, ridge: 1.1, bump: 0.07,
      veinAmt: 0.9, veinDepth: 0.22, veinFreq: 2.2, veinMix: 0.75, veinEmissive: 0.0,
      dune: 1.0, snow: 0.0, moisture: 0.42,
      liquidEmissive: 0.0, liquidSpec: 0.0,
      cloudFreq: 1.7, cloudWarp: 0.8, cloudStretch: 2.0, cloudShadow: 0.4, cloudOpacity: 0.72, stormTwist: 2.2,
      atmoAbsorb: 0.55, mie: 5.0,
      ringInner: 1.5, ringOuter: 2.2, ringOpacity: 1.2,
    },
    colors: {
      deep: '#3a1c0e', shallow: '#6b3a1c', sand: '#e3c183',
      lowWet: '#b8763a', lowDry: '#dba85c', cold: '#a8693a',
      rock: '#8a4a2a', rockB: '#c58049', snow: '#ead9b9', ice: '#f1e7d3',
      vein: '#4a2412', city: '#ffb657',
      cloudLit: '#e6b676', cloudShade: '#8c5c31', cloudGlow: '#000000',
      atmo: '#e0a060', ringA: '#c9a67a', ringB: '#7d6247',
    },
  },
  {
    id: 'mustafar',
    seed: 66,
    rings: false,
    survey: {
      radiusKm: 4200, kmPerUnit: 14, t0: 120, span: 60, humidity: false,
      names: {
        grassland: 'basalt', forest: 'basalt', taiga: 'basalt', desert: 'basalt', tundra: 'basalt',
        snow: 'ash', beach: 'lavaShore', mountains: 'volcanic', faults: 'lavaFlow',
      },
    },
    sliders: {
      seaLevel: 0.35,
      relief: 0.85,
      ice: 0.0,
      cityLights: 0.0,
      cloudCover: 0.44,
      atmoDensity: 0.42,
      atmoHue: 0,
      ringTilt: 8,
    },
    shape: {
      contFreq: 1.75, warp: 0.8, ridge: 1.25, bump: 0.075,
      veinAmt: 1.0, veinDepth: 0.10, veinFreq: 1.7, veinMix: 0.3, veinEmissive: 1.3,
      dune: 0.0, snow: 0.35, moisture: 0.5,
      liquidEmissive: 0.62, liquidSpec: 0.15,
      cloudFreq: 2.0, cloudWarp: 0.7, cloudStretch: 1.3, cloudShadow: 0.7, cloudOpacity: 0.9, stormTwist: 2.6,
      atmoAbsorb: 0.7, mie: 4.0,
      ringInner: 1.4, ringOuter: 2.1, ringOpacity: 1.3,
    },
    colors: {
      deep: '#ffb23a', shallow: '#ff3d08', sand: '#3d1a10',
      lowWet: '#1b1716', lowDry: '#2a2321', cold: '#161517',
      rock: '#2b2a2e', rockB: '#3f3532', snow: '#4d4849', ice: '#5a5556',
      vein: '#ff4d0f', city: '#ffb657',
      cloudLit: '#5c504a', cloudShade: '#1a1412', cloudGlow: '#200502',
      atmo: '#c9552a', ringA: '#6b5d55', ringB: '#3a302c',
    },
  },
  {
    id: 'europa',
    seed: 1610,
    rings: true,
    survey: {
      radiusKm: 1561, kmPerUnit: 4, t0: -130, span: 40, humidity: false,
      names: {
        grassland: 'icePlain', forest: 'icePlain', taiga: 'icePlain', desert: 'icePlain', tundra: 'icePlain',
        dunes: 'icePlain', beach: 'icePlain', mountains: 'iceRidges', snow: 'frost', faults: 'iceCracks',
      },
    },
    sliders: {
      seaLevel: 0.0,
      relief: 0.3,
      ice: 0.3,
      cityLights: 0.0,
      cloudCover: 0.07,
      atmoDensity: 0.12,
      atmoHue: 0,
      ringTilt: 22,
    },
    shape: {
      contFreq: 1.5, warp: 0.9, ridge: 0.6, bump: 0.06,
      veinAmt: 1.0, veinDepth: 0.2, veinFreq: 3.4, veinMix: 0.92, veinEmissive: 0.0,
      dune: 0.0, snow: 0.6, moisture: 0.5,
      liquidEmissive: 0.0, liquidSpec: 1.0,
      cloudFreq: 2.6, cloudWarp: 0.45, cloudStretch: 2.2, cloudShadow: 0.3, cloudOpacity: 0.5, stormTwist: 1.0,
      atmoAbsorb: 0.0, mie: 1.0,
      ringInner: 1.42, ringOuter: 2.5, ringOpacity: 1.7,
    },
    colors: {
      deep: '#052637', shallow: '#1c7a8e', sand: '#9fcfd8',
      lowWet: '#c2e2e8', lowDry: '#e9f1f4', cold: '#b4dce4',
      rock: '#9dbccb', rockB: '#d2e2e8', snow: '#ffffff', ice: '#f3fbff',
      vein: '#0b3550', city: '#ffbe62',
      cloudLit: '#ffffff', cloudShade: '#9fb4c4', cloudGlow: '#000000',
      atmo: '#7fc8ff', ringA: '#d8cdb8', ringB: '#9a8f7e',
    },
  },
  {
    id: 'kepler',
    seed: 452,
    rings: true,
    survey: {
      radiusKm: 10200, kmPerUnit: 26, t0: 34, span: 48,
      names: { forest: 'violetForest', taiga: 'violetForest', grassland: 'emeraldPlain', desert: 'emeraldPlain' },
    },
    sliders: {
      seaLevel: 0.5,
      relief: 0.7,
      ice: 0.3,
      cityLights: 0.3,
      cloudCover: 0.58,
      atmoDensity: 0.56,
      atmoHue: 0,
      ringTilt: 14,
    },
    shape: {
      contFreq: 1.15, warp: 0.95, ridge: 0.9, bump: 0.05,
      veinAmt: 0.0, veinDepth: 0.0, veinFreq: 3.0, veinMix: 0.0, veinEmissive: 0.0,
      dune: 0.0, snow: 0.8, moisture: 0.58,
      liquidEmissive: 0.0, liquidSpec: 1.0,
      cloudFreq: 1.9, cloudWarp: 0.85, cloudStretch: 1.7, cloudShadow: 0.6, cloudOpacity: 0.97, stormTwist: 5.0,
      atmoAbsorb: 0.0, mie: 2.6,
      ringInner: 1.32, ringOuter: 2.95, ringOpacity: 1.35,
    },
    colors: {
      deep: '#0a0e3f', shallow: '#17a79c', sand: '#b79fc9',
      lowWet: '#5a1f8c', lowDry: '#1d8a59', cold: '#2a6e6a',
      rock: '#4a3d5d', rockB: '#6c5a7e', snow: '#f2ebff', ice: '#e8e4f7',
      vein: '#1b6f8c', city: '#ffc778',
      cloudLit: '#f5eeff', cloudShade: '#7a6c99', cloudGlow: '#000000',
      atmo: '#6a5cff', ringA: '#bdb2d2', ringB: '#74698c',
    },
  },
];

// Keys that are smoothed every frame (sliders + shape + the global controls).
export const SLIDER_KEYS = Object.keys(PRESETS[0].sliders);
export const SHAPE_KEYS = Object.keys(PRESETS[0].shape);
export const COLOR_KEYS = Object.keys(PRESETS[0].colors);
