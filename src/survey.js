// What the probe says about a point: the land-cover class, a few words and a
// few figures, in the user's language.
//
// The probe (probe.js) reports the same land-cover weights the surface shader
// paints with; this turns them into a reading. The worlds are imagined, so
// kilometres and degrees are estimates: every archetype carries a radius, a
// vertical scale and a climate (presets.js, "survey"), and the figures are
// shown with "≈".
//
// It knows nothing about Three.js or the DOM.

const LAPSE = 6.5;                // °C per km of altitude, as in Earth's air
const LAVA_SEA_C = 1100;
const LAVA_FLOW_C = 1050;

/** Land-cover class, before the archetype renames it. */
function classify(s, world) {
  if (s.landH <= 0) {
    if (world.lavaSea) return 'lavaSea';
    if (s.ice > 0.5) return 'seaIce';
    return -s.landH < 0.04 ? 'shallows' : 'ocean';
  }
  if (s.ice > 0.5) return 'glacier';
  if (s.vein > 0.5) {
    if (world.veinEmissive > 0.3) return 'lavaFlow';
    if (world.veinMix > 0.2) return 'faults';
  }
  if (s.snow > 0.5) return 'snow';
  if (s.rock > 0.5) return 'mountains';
  if (s.shore > 0.5) return world.dry ? 'dunes' : 'beach';
  if (s.cold > 0.5) return 'tundra';
  if (s.moist > 0.62) return s.cold > 0.2 ? 'taiga' : 'forest';
  if (s.moist < 0.3) return 'desert';
  return 'grassland';
}

// ---------------------------------------------------------------------------
// "Why is it like this here": the same thresholds as the cover functions in
// GLSL_SURFACE (shaders/chunks.js), turned back into words and figures. The
// probe does not report the per-pixel grain, so the lines below are the
// average ones; a point may sit a little above or below them.
// ---------------------------------------------------------------------------
const clampTo = (x, a, b) => Math.min(Math.max(x, a), b);
const smooth = (a, b, x) => {
  const t = clampTo((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const degreesOf = (sinLat) => Math.round((Math.asin(clampTo(sinLat, -1, 1)) * 180) / Math.PI);

/** Height (terrain units above the biome datum) where snow takes over at this latitude. */
const snowLine = (lat, climY) => 0.46 + (0.06 - 0.46) * smooth(0.15, 0.9, lat) + 0.04 - climY * 0.04;
const ROCK_LINE = 0.36;           // bioH where bare rock takes over (coverRock)
// Polar cap edge: iceEdge = mix(1.08, 0.52, uIce); full ice 0.02 above it, none 0.015 below.
const iceEdge = (ice) => 1.08 - 0.56 * ice;
const iceReach = (s) => s.lat + s.climateY * 0.1 + Math.max(s.bioH, 0) * 0.35;
// Sea level: uSeaLevel = (slider - 0.5) * 1.4 on a world that has a sea.
const seaSlider = (h) => h / 1.4 + 0.5;
const WET_MIN = 0.04;             // below this the sea dries up (state.js)
const SLIDER_STEP = 0.005;
const WHAT_IF_REACH = 0.25;       // largest slider move worth suggesting

// Kinds of ground that have a reason of their own (the archetype's own
// geology); the rest share one per land-cover class, naming the local biome.
const OWN_REASON = new Set([
  'lavaSea', 'lavaFlow', 'lavaShore', 'basalt', 'ash', 'volcanic', 'icePlain', 'iceRidges',
  'frost', 'iceCracks', 'rockyPlain', 'coldDesert', 'canyons', 'dunes',
]);

function reason(raw, biome, s, world, f) {
  const { t } = f;
  const vars = { biome: t(`biome.${biome}`).toLowerCase(), lat: `${degreesOf(s.lat)}°`, height: f.length(Math.abs(f.heightKm)) };
  const lineKm = (bio) => f.km(world.dry ? bio : bio + world.biomeDatum - world.seaLevel);
  // The snow line at this latitude: the reasons for cold ground quote it.
  vars.line = f.length(Math.max(lineKm(snowLine(s.lat, s.climateY)), 0));
  if (raw === 'snow' || raw === 'glacier' || raw === 'seaIce') {
    const edge = iceEdge(world.ice) + 0.0025 - s.climateY * 0.1 - Math.max(s.bioH, 0) * 0.35;
    vars.edge = `${degreesOf(edge)}°`;
  }
  if (raw === 'mountains') vars.line = f.length(Math.max(lineKm(ROCK_LINE), 0));
  if (OWN_REASON.has(biome)) return t(`why.${biome}`, vars);

  switch (raw) {
    case 'ocean':
    case 'shallows':
      return t('why.water', vars);
    case 'seaIce':
      return t('why.seaIce', vars);
    case 'glacier':
      return t(s.bioH > 0.1 ? 'why.glacier.high' : 'why.glacier', vars);
    case 'faults':
      return t('why.faults', vars);
    case 'snow':
      return t('why.snow', vars);
    case 'mountains':
      return t(smooth(0.24, 0.48, s.bioH) > 0.5 ? 'why.mountains.high' : 'why.mountains.steep', vars);
    case 'beach':
      return t('why.beach', vars);
    case 'tundra':
      // Which pushed it over the edge: the latitude or the height?
      return t(Math.max(s.bioH, 0) * 0.45 > 0.12 ? 'why.cold.high' : 'why.cold.lat', vars);
    case 'taiga':
      return t('why.taiga', vars);
    case 'forest':
      // The wet equator (coverMoisture) or just a rainy climate.
      return t(0.18 * Math.exp(-((s.lat / 0.16) ** 2)) > 0.09 ? 'why.wet.equator' : 'why.wet.climate', vars);
    case 'desert':
      // The dry belt around 25° (coverMoisture) or just a dry climate.
      return t(0.3 * Math.exp(-(((s.lat - 0.42) / 0.13) ** 2)) > 0.15 ? 'why.dry.belt' : 'why.dry.climate', vars);
    default:
      return t('why.grassland', vars);
  }
}

/**
 * One slider move that would change this spot, the smallest of those that
 * make sense here: flood it or drain it, freeze it or thaw it, light it up.
 * Returns { key, value, text } or null.
 */
function whatIf(raw, s, world, f) {
  const { t } = f;
  const options = [];
  const offer = (key, value, textKey) => {
    const delta = Math.abs(value - world.target[key]);
    if (value < 0 || value > 1 || delta < 0.01 || delta > WHAT_IF_REACH) return;
    options.push({ key, value, delta, textKey });
  };
  const up = (v) => Math.ceil(v / SLIDER_STEP) * SLIDER_STEP;
  const down = (v) => Math.floor(v / SLIDER_STEP) * SLIDER_STEP;

  // Sea level, on a world that has a sea (not on the dry ones: a sea poured
  // over Arrakis or Europa would change the whole world, not this spot).
  if (!world.dry && raw !== 'glacier' && raw !== 'seaIce') {
    const liquid = s.landH <= 0;
    const target = liquid ? down(seaSlider(s.h0 - 0.004)) : up(seaSlider(s.h0 + 0.004));
    if (target >= WET_MIN) {
      const kind = world.lavaSea ? 'lava' : 'sea';
      offer('seaLevel', target, liquid ? `whatif.${kind}.lower` : `whatif.${kind}.raise`);
    }
  }
  // Polar ice (on worlds that have caps at all).
  if (world.presetIce > 0 || world.target.ice > 0) {
    const reach = iceReach(s);
    if (raw === 'glacier' || raw === 'seaIce') offer('ice', down((1.06 - reach) / 0.56), 'whatif.ice.lower');
    else if (raw !== 'lavaSea' && raw !== 'lavaFlow') offer('ice', up((1.1 - reach) / 0.56), 'whatif.ice.raise');
  }
  // Towns: the ground suits them, the lights are turned down.
  if (s.landH > 0 && s.city > 0.2 && world.target.cityLights < 0.35 && world.presetCity > 0) {
    options.push({ key: 'cityLights', value: 0.8, delta: 0.2, textKey: 'whatif.cities' });
  }
  if (options.length === 0) return null;
  options.sort((a, b) => a.delta - b.delta);
  const best = options[0];
  return { key: best.key, value: best.value, text: t(best.textKey, { v: f.number(best.value, 2) }) };
}

function temperatureWord(c) {
  if (c > 200) return 'word.scorching';
  if (c > 30) return 'word.hot';
  if (c > 15) return 'word.warm';
  if (c > 0) return 'word.cool';
  if (c > -20) return 'word.cold';
  return 'word.frigid';
}

/**
 * @param {object} s      decoded probe sample (probe.js)
 * @param {object} world  { survey, presetIce, presetCity, ice, seaLevel, biomeDatum, lavaSea,
 *                          veinEmissive, veinMix, cityLights, sunElevation (deg),
 *                          target: { seaLevel, ice, cityLights } (slider targets) }
 * @param {object} i18n
 * @returns {{ biome, kicker, title, summary, words, rows, why, whatIf, text, note }}
 */
export function describePoint(s, world, i18n) {
  const { t } = i18n;
  const survey = world.survey;
  const dry = world.seaLevel < world.biomeDatum - 1;
  const ctx = { ...world, dry };
  const raw = classify(s, ctx);
  const biome = (survey.names && survey.names[raw]) || raw;

  // --- figures ---
  const km = (units) => units * survey.kmPerUnit;
  const liquid = s.landH <= 0;
  // On a world without seas, heights are taken from the datum the biomes use.
  const heightKm = liquid ? -km(s.landH) : km(dry ? s.bioH : s.landH);
  const length = (value) => {
    const a = Math.abs(value);
    if (a < 1) return `${value < 0 ? '−' : ''}${Math.round(a * 100) * 10} ${t('unit.m')}`;
    return `${value < 0 ? '−' : ''}${i18n.number(a, 1)} ${t('unit.km')}`;
  };

  let celsius;
  if (raw === 'lavaSea') celsius = LAVA_SEA_C;
  else if (raw === 'lavaFlow') celsius = LAVA_FLOW_C;
  else {
    celsius = survey.t0 - survey.span * (s.lat + s.climateY * 0.14) - 25 * (world.ice - world.presetIce);
    if (!liquid) celsius -= LAPSE * Math.max(heightKm, 0);
    if (raw === 'glacier' || raw === 'seaIce') celsius = Math.min(celsius, -5);
    else if (raw === 'snow' || raw === 'frost') celsius = Math.min(celsius, -2);
    else if (liquid) celsius = Math.max(celsius, -1);
  }
  celsius = Math.round(celsius);
  const temperature = `${celsius < 0 ? '−' : ''}${Math.abs(celsius)} °C`;

  // Humidity means something on soil, not on lava, ice or snow.
  const humid = survey.humidity !== false && !liquid && !['lavaFlow', 'glacier', 'snow'].includes(raw);
  const humidity = `${Math.round(s.moist * 100)} %`;

  const latDeg = (Math.asin(Math.max(-1, Math.min(1, s.dir[1]))) * 180) / Math.PI;
  const lonDeg = (Math.atan2(-s.dir[2], s.dir[0]) * 180) / Math.PI;
  // Each coordinate stays on one line (no-break spaces); the pair may wrap between them.
  const coord = (value, plus, minus) =>
    t(value >= 0 ? plus : minus, { v: i18n.number(Math.abs(value), 1) }).replace(/ /g, ' ');
  const position = `${coord(latDeg, 'coord.n', 'coord.s')} · ${coord(lonDeg, 'coord.e', 'coord.w')}`;

  const sun = world.sunElevation;
  const dayWord = sun > 6 ? 'sun.day' : sun > -6 ? 'sun.twilight' : 'sun.night';
  const sunText = `${sun >= 0 ? '+' : '−'}${Math.abs(Math.round(sun))}° · ${t(dayWord)}`;

  // --- words ---
  const words = [];
  if (liquid) {
    words.push(t(heightKm < 0.25 ? 'word.shallowWater' : heightKm < 3 ? 'word.openOcean' : 'word.abyss'));
  } else {
    words.push(t(heightKm < 0.2 ? 'word.lowland' : heightKm < 1 ? 'word.upland' : heightKm < 3 ? 'word.highland' : 'word.alpine'));
  }
  words.push(t(temperatureWord(celsius)));
  if (humid) words.push(t(s.moist < 0.3 ? 'word.dry' : s.moist < 0.62 ? 'word.moderate' : 'word.humid'));
  words.push(t(dayWord));
  if (world.cityLights > 0.05 && s.city > 0.2) words.push(t('word.cities'));

  const rows = [
    { label: t(liquid ? 'probe.depth' : 'probe.height'), value: `≈ ${length(heightKm)}` },
    { label: t('probe.temperature'), value: `≈ ${temperature}` },
  ];
  if (humid) rows.push({ label: t('probe.humidity'), value: humidity });
  rows.push({ label: t('probe.position'), value: position });
  rows.push({ label: t('probe.sun'), value: sunText });

  const helpers = { t, km, length, heightKm, number: i18n.number };
  return {
    biome,
    kicker: t('probe.kicker'),
    title: t(`biome.${biome}`),
    summary: `≈ ${length(heightKm)} · ${temperature}`,
    words: words.join(' · '),
    rows,
    why: reason(raw, biome, s, ctx, helpers),
    whatIf: whatIf(raw, s, ctx, helpers),
    text: t(`biome.${biome}.text`),
    note: t('probe.note'),
  };
}
