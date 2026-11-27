// Photo expedition (idea И1): the missions, as data. The player (expedition.js)
// puts a mission's world on screen and unlocks only the sliders it allows;
// the judge (judge.js) checks a picture against the mission's conditions.
//
//   world    archetype the mission is set on, or null: any world, the user's own
//   rings    true: rings on for the mission
//   allow    sliders the user may move (the camera is always free); '*' for all
//   camera   viewpoint the mission starts from (main.js, cameraPose)
//   flight   a mission in the air (FLIGHT-PLAN.md stage J): the camera is
//            taken down to the quick target { target: 'peak' | 'coast' | 'city' }
//            (flight.js) and the picture is judged from the air (judge.js,
//            measureAir); heights in km, the sun's height in degrees
//   checks   conditions, each worth a star tier:
//              star 1 — the subject is in the picture,
//              star 2 — the light is right,
//              star 3 — the composition.
//            A picture earns tier n when every check of tiers 1..n holds.
//            Other fields are the check's own figures (see judge.js); shares
//            and fractions are in percent (nightCities: of the night side
//            that glows in the picture; nightLava: probe points, glow percent).
//
// Texts: mission.<id>.title / .task / .hint, check.<check id> and
// check.<check id>.fail (src/i18n.js).

export const MISSIONS = [
  {
    id: 'dawn',
    world: 'terran',
    allow: ['sunAngle', 'cityLights', 'cloudCover'],
    camera: 'overview',
    checks: [
      { id: 'terminator', star: 1 },
      { id: 'nightCities', star: 1, min: 0.5 },
      { id: 'twilightOcean', star: 2, min: 2 },
      { id: 'phaseRange', star: 2, min: 65, max: 115 },
      { id: 'whole', star: 3 },
    ],
  },
  {
    id: 'ringShadow',
    world: 'kepler',
    rings: true,
    allow: ['sunAngle', 'ringTilt'],
    camera: 'overview',
    checks: [
      { id: 'ringsVisible', star: 1 },
      { id: 'shadowOnRings', star: 2, min: 3 },
      { id: 'phaseRange', star: 3, min: 60, max: 130 },
      { id: 'whole', star: 3 },
    ],
  },
  {
    id: 'ringBand',
    world: 'kepler',
    rings: true,
    allow: ['sunAngle', 'ringTilt'],
    camera: 'overview',
    checks: [
      { id: 'ringShadow', star: 1, min: 2 },
      { id: 'ringShadowCentral', star: 2 },
      { id: 'ringsVisible', star: 3 },
    ],
  },
  {
    id: 'cyclone',
    world: 'terran',
    allow: ['sunAngle', 'cloudCover'],
    camera: 'overview',
    checks: [
      { id: 'stormLit', star: 1 },
      { id: 'closeUp', star: 2 },
      { id: 'stormCentral', star: 3 },
    ],
  },
  {
    id: 'iceBacklit',
    world: 'europa',
    allow: ['sunAngle', 'ringTilt'],
    camera: 'overview',
    checks: [
      { id: 'phaseMin', star: 1, min: 110 },
      { id: 'phaseMin', star: 2, min: 140 },
      { id: 'whole', star: 3 },
    ],
  },
  {
    id: 'lavaNight',
    world: 'mustafar',
    allow: ['sunAngle', 'relief'],
    camera: 'overview',
    checks: [
      { id: 'nightLava', star: 1, min: 3, glow: 2 },
      { id: 'nightShare', star: 2, min: 60 },
      { id: 'daySliver', star: 3, min: 4, max: 35 },
    ],
  },
  {
    id: 'crescent',
    world: null,
    allow: '*',
    camera: 'overview',
    checks: [
      { id: 'phaseMin', star: 1, min: 130 },
      { id: 'phaseMin', star: 2, min: 155 },
      { id: 'whole', star: 3 },
    ],
  },
  {
    id: 'thirds',
    world: null,
    allow: '*',
    camera: 'overview',
    checks: [
      { id: 'terminator', star: 1 },
      { id: 'terminatorThird', star: 2 },
      { id: 'whole', star: 3 },
    ],
  },
  // ---- in the air -------------------------------------------------------
  {
    id: 'ridgeSunset',
    world: 'terran',
    allow: ['sunAngle', 'cloudCover'],
    camera: 'overview',
    flight: { target: 'peak' },
    checks: [
      { id: 'inAir', star: 1, max: 10 },
      { id: 'centerPeak', star: 1 },
      { id: 'altRange', star: 2, min: 1, max: 3 },
      { id: 'sunHeight', star: 2, min: -2, max: 6 },
      { id: 'horizonThird', star: 3 },
    ],
  },
  {
    id: 'underDeck',
    world: 'terran',
    allow: ['sunAngle', 'cloudCover'],
    camera: 'overview',
    flight: { target: 'coast' },
    checks: [
      { id: 'inAir', star: 1, max: 10 },
      { id: 'belowClouds', star: 1, min: 35 },
      { id: 'sunHeight', star: 2, min: 5, max: 90 },
      { id: 'horizonThird', star: 3 },
    ],
  },
  {
    id: 'cityNight',
    world: 'terran',
    allow: ['sunAngle', 'cityLights'],
    camera: 'overview',
    flight: { target: 'city' },
    checks: [
      { id: 'inAir', star: 1, max: 10 },
      { id: 'groundGlow', star: 1, min: 0.5 },
      { id: 'altRange', star: 2, min: 1, max: 3.5 },
      { id: 'sunHeight', star: 2, min: -90, max: -8 },
      { id: 'horizonThird', star: 3 },
    ],
  },
  {
    id: 'duneLight',
    world: 'arrakis',
    allow: ['sunAngle'],
    camera: 'overview',
    flight: { target: 'peak' },
    checks: [
      { id: 'inAir', star: 1, max: 10 },
      { id: 'centerDunes', star: 1 },
      { id: 'sunHeight', star: 2, min: 2, max: 15 },
      { id: 'altRange', star: 3, min: 0.1, max: 2 },
      { id: 'horizonThird', star: 3 },
    ],
  },
  {
    id: 'lavaClose',
    world: 'mustafar',
    allow: ['sunAngle', 'relief'],
    camera: 'overview',
    flight: { target: 'coast' },
    checks: [
      { id: 'inAir', star: 1, max: 10 },
      { id: 'centerLava', star: 1 },
      { id: 'sunHeight', star: 2, min: -90, max: -6 },
      { id: 'altRange', star: 3, min: 0.1, max: 3 },
      { id: 'groundGlow', star: 3, min: 2 },
    ],
  },
  {
    id: 'ringRise',
    world: 'kepler',
    rings: true,
    allow: ['sunAngle', 'ringTilt'],
    camera: 'overview',
    flight: { target: 'peak' },
    checks: [
      { id: 'inAir', star: 1, max: 10 },
      { id: 'ringsInSky', star: 1 },
      { id: 'sunHeight', star: 2, min: -6, max: 25 },
      { id: 'horizonThird', star: 3 },
    ],
  },
];
