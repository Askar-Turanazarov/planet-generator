// Planet state: the values the user (or an archetype) asked for, the values
// currently on screen, and the mapping from one to the shader uniforms.
// Every number and colour eases towards its target, so sliders and archetype
// changes flow instead of snapping.
import * as THREE from 'three';
import { SLIDER_KEYS, SHAPE_KEYS, COLOR_KEYS } from './presets.js';

// Palette entry -> uniform that receives it directly. "atmo" is absent on
// purpose: it is converted into scattering coefficients instead.
const COLOR_UNIFORMS = {
  deep: 'uColDeep',
  shallow: 'uColShallow',
  sand: 'uColSand',
  lowWet: 'uColLowWet',
  lowDry: 'uColLowDry',
  cold: 'uColCold',
  rock: 'uColRock',
  rockB: 'uColRockB',
  snow: 'uColSnow',
  ice: 'uColIce',
  vein: 'uColVein',
  city: 'uColCity',
  cloudLit: 'uColCloudLit',
  cloudShade: 'uColCloudShade',
  cloudGlow: 'uColCloudGlow',
  ringA: 'uRingColA',
  ringB: 'uRingColB',
};

// Shape parameter -> uniform, for the ones that map one to one.
const SHAPE_UNIFORMS = {
  contFreq: 'uContFreq',
  warp: 'uWarp',
  ridge: 'uRidge',
  veinAmt: 'uVeinAmt',
  veinDepth: 'uVeinDepth',
  veinFreq: 'uVeinFreq',
  veinMix: 'uVeinMix',
  veinEmissive: 'uVeinEmissive',
  dune: 'uDune',
  snow: 'uSnow',
  moisture: 'uMoisture',
  liquidEmissive: 'uLiquidEmissive',
  liquidSpec: 'uLiquidSpec',
  cloudFreq: 'uCloudFreq',
  cloudWarp: 'uCloudWarp',
  cloudStretch: 'uCloudStretch',
  cloudShadow: 'uCloudShadow',
  cloudOpacity: 'uCloudOpacity',
  ringInner: 'uRingInner',
  ringOuter: 'uRingOuter',
  ringOpacity: 'uRingOpacity',
};

const GLOBAL_DEFAULTS = { sunAngle: 32, rotSpeed: 0.18, ringsOn: 0 };
const SMOOTHING = 7.0;            // 1/s; higher is snappier
const SUN_ELEVATION = THREE.MathUtils.degToRad(9);
const RAYLEIGH_SCALE = 15.0;      // blue-channel coefficient at density 1

// Small, fast, well-distributed PRNG (mulberry32).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Accepts a number or any text; text is hashed (FNV-1a) to a seed.
export function parseSeed(input) {
  const text = String(input).trim();
  if (/^\d{1,9}$/.test(text)) return Number(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % 1000000;
}

export class PlanetState {
  constructor(uniforms) {
    this.u = uniforms;
    this.cur = { ...GLOBAL_DEFAULTS };
    this.tgt = { ...GLOBAL_DEFAULTS };
    this.colCur = {};
    this.colTgt = {};
    for (const key of COLOR_KEYS) {
      this.colCur[key] = new THREE.Color();
      this.colTgt[key] = new THREE.Color();
    }
    this.seed = 0;
    this.storms = [0, 1, 2].map(() => ({ dir: new THREE.Vector3(0, 1, 0), spin: 1 }));
    this.ringQuat = new THREE.Quaternion();
    this.ringNormal = new THREE.Vector3(0, 1, 0);
    this.sunDir = new THREE.Vector3(1, 0, 0);
    this._color = new THREE.Color();
    this._euler = new THREE.Euler();
    this.initialised = false;
  }

  /** Point every target at an archetype. The seed is applied immediately. */
  applyPreset(preset) {
    for (const key of SLIDER_KEYS) this.tgt[key] = preset.sliders[key];
    for (const key of SHAPE_KEYS) this.tgt[key] = preset.shape[key];
    for (const key of COLOR_KEYS) this.colTgt[key].set(preset.colors[key]);
    this.tgt.ringsOn = preset.rings ? 1 : 0;
    this.setSeed(preset.seed);
    if (!this.initialised) {
      this.snap();
      this.initialised = true;
    }
  }

  set(key, value) {
    this.tgt[key] = value;
  }

  get(key) {
    return this.tgt[key];
  }

  /** Jump straight to the targets (used on the first frame and mid-transition). */
  snap() {
    Object.assign(this.cur, this.tgt);
    for (const key of COLOR_KEYS) this.colCur[key].copy(this.colTgt[key]);
  }

  /** Everything random about a world hangs off this one integer. */
  setSeed(seed) {
    this.seed = seed >>> 0;
    const rnd = mulberry32(Math.imul(this.seed, 2654435761) + 1013904223);
    this.u.uSeed.value.set(rnd() * 40, rnd() * 40, rnd() * 40);
    this.u.uRingSeed.value = rnd() * 50;

    // Three storm systems at mid latitudes, spinning by hemisphere.
    this.storms.forEach((storm, i) => {
      const hemisphere = i % 2 === 0 ? 1 : -1;
      const lat = THREE.MathUtils.degToRad(14 + rnd() * 34) * hemisphere;
      const lon = rnd() * Math.PI * 2;
      storm.dir.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon));
      storm.spin = hemisphere * (0.65 + 0.35 * rnd());
    });
  }

  /** Ease towards the targets and write the uniforms. Call once per frame. */
  update(dt) {
    const k = 1 - Math.exp(-dt * SMOOTHING);
    const { cur, tgt, u } = this;

    for (const key in tgt) {
      const from = cur[key] ?? tgt[key];
      cur[key] = Math.abs(tgt[key] - from) < 1e-5 ? tgt[key] : from + (tgt[key] - from) * k;
    }
    for (const key of COLOR_KEYS) this.colCur[key].lerp(this.colTgt[key], k);

    // --- direct mappings ---
    for (const key in SHAPE_UNIFORMS) u[SHAPE_UNIFORMS[key]].value = cur[key];
    for (const key in COLOR_UNIFORMS) u[COLOR_UNIFORMS[key]].value.copy(this.colCur[key]);

    // --- surface sliders ---
    // Sea level is a threshold on terrain height; at the very bottom of the
    // slider it drops out of range so no stray lakes survive.
    const dry = 1 - THREE.MathUtils.smoothstep(cur.seaLevel, 0.0, 0.04);
    const shoreline = (cur.seaLevel - 0.5) * 1.4;
    u.uSeaLevel.value = shoreline - 6.0 * dry;
    // Biomes are measured from the shoreline, or from a fixed datum once the
    // sea has drained: dry basins stay dune seas instead of turning to rock.
    u.uBiomeDatum.value = Math.max(shoreline, -0.12);
    u.uRelief.value = cur.relief * 1.6;
    u.uBump.value = cur.bump * (0.5 + 1.0 * cur.relief);
    u.uIce.value = cur.ice;
    u.uCityLights.value = cur.cityLights;
    u.uCloudCover.value = cur.cloudCover;

    // --- atmosphere: colour + density + hue shift -> scattering coefficients ---
    // The palette entry is read as the *ratio* of the scattering coefficients,
    // exactly as written in hex (Earth's Rayleigh ratio is about #2f6bff).
    const c = this._color.copy(this.colCur.atmo).offsetHSL(cur.atmoHue / 360, 0, 0).convertLinearToSRGB();
    const peak = Math.max(c.r, c.g, c.b, 1e-4);
    const r = c.r / peak;
    const g = c.g / peak;
    const b = c.b / peak;
    const density = cur.atmoDensity * 2.0;
    const sR = RAYLEIGH_SCALE * density;
    u.uBetaR.value.set(r * sR, g * sR, b * sR);
    u.uBetaM.value = cur.mie * density;
    // Dusty / smoky air absorbs the colours it does not scatter.
    const sA = RAYLEIGH_SCALE * density * cur.atmoAbsorb;
    u.uBetaAbs.value.set((1 - r) * sA, (1 - g) * sA, (1 - b) * sA);
    const tint = Math.min(density, 1.4);
    u.uAtmoTint.value.set(r * tint, g * tint, b * tint);

    // --- storms ---
    const stormUniforms = [u.uStormA, u.uStormB, u.uStormC];
    this.storms.forEach((storm, i) => {
      stormUniforms[i].value.set(storm.dir.x, storm.dir.y, storm.dir.z, storm.spin * cur.stormTwist);
    });

    // --- sun ---
    const az = THREE.MathUtils.degToRad(cur.sunAngle);
    this.sunDir.set(
      Math.cos(az) * Math.cos(SUN_ELEVATION),
      Math.sin(SUN_ELEVATION),
      Math.sin(az) * Math.cos(SUN_ELEVATION),
    );
    u.uSunDir.value.copy(this.sunDir);

    // --- rings ---
    const tilt = THREE.MathUtils.degToRad(cur.ringTilt);
    // Tilted towards the default sun, so the face seen from the overview is the lit one.
    this.ringQuat.setFromEuler(this._euler.set(tilt * 0.3, 0, -tilt));
    this.ringNormal.set(0, 1, 0).applyQuaternion(this.ringQuat);
    u.uRingNormal.value.copy(this.ringNormal);
    u.uRingsOn.value = cur.ringsOn;
  }
}
