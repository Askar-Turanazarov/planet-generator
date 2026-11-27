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
 * @param {object} world  { survey, presetIce, ice, seaLevel, biomeDatum, lavaSea,
 *                          veinEmissive, veinMix, cityLights, sunElevation (deg) }
 * @param {object} i18n
 * @returns {{ biome, kicker, title, summary, words, rows, text }}
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

  return {
    biome,
    kicker: t('probe.kicker'),
    title: t(`biome.${biome}`),
    summary: `≈ ${length(heightKm)} · ${temperature}`,
    words: words.join(' · '),
    rows,
    text: t(`biome.${biome}.text`),
    note: t('probe.note'),
  };
}
