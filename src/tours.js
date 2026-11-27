// Guided tours: routes through the worlds, as data. The texts live in i18n.js
// under tour.<id>.*:
//   tour.<id>.title, tour.<id>.lead          the route in the panel
//   tour.<id>.s<n>.title, tour.<id>.s<n>     step n (from 1)
//   tour.<id>.q<n>, tour.<id>.q<n>.a<k>,     question n, its answers (from 1)
//   tour.<id>.q<n>.why                       and why the right one is right
//
// A route names its world (an archetype, optionally a seed, slider values and
// rings); a step may change any of that, and says where to look:
//   look:  { lat, lon, dist }   the camera above a point of the ground
//          sun                  where the sun stands for that point, in degrees
//                               of longitude east of it: 0 noon, ±90 the
//                               terminator, 180 midnight
//   orbit: { az, el, dist }     the camera relative to the sun: az degrees round
//          sunAngle             from it, el above the equator; sunAngle (the
//                               slider) sets the sun itself
//   mark:  { lat, lon }         a marker on the ground
// Every step is complete in itself (a step reached from a link looks the same
// as one reached by "Next"); sliders a step leaves out take the route's values.
//
// quiz: one entry per question: the number of answers and which one is right
// (from 0).

export const TOURS = [
  {
    id: 'sky',
    preset: 'terran',
    steps: [
      { orbit: { az: 38, el: 8, dist: 3.7 }, sunAngle: 32 },
      { orbit: { az: 55, el: 12, dist: 2.9 }, sunAngle: 32 },
      // From behind the planet: the sunset ring along the terminator.
      { orbit: { az: 140, el: 6, dist: 2.8 }, sunAngle: 32 },
      { orbit: { az: 140, el: 6, dist: 2.8 }, sunAngle: 32, sliders: { atmoDensity: 0.95 } },
      { orbit: { az: 140, el: 6, dist: 2.8 }, sunAngle: 32, sliders: { atmoDensity: 0.08 } },
      { preset: 'arrakis', orbit: { az: 140, el: 6, dist: 2.8 }, sunAngle: 32 },
    ],
    quiz: [
      { answers: 3, right: 0 },
      { answers: 3, right: 1 },
      { answers: 3, right: 2 },
    ],
  },
  {
    id: 'rings',
    preset: 'kepler',
    steps: [
      { orbit: { az: 40, el: 22, dist: 5.2 }, sunAngle: 32 },
      { orbit: { az: 58, el: 1, dist: 5.6 }, sunAngle: 32 },
      // The shadow falls on the side of the ring plane away from the sun, so
      // the camera looks from there. The sun stands about 19° over the rings:
      // any higher and the dense ring's shadow (from 1.7 R out) misses the
      // planet's day side.
      { orbit: { az: 30, el: -16, dist: 4.6 }, sunAngle: 32, sliders: { ringTilt: 10 } },
      { orbit: { az: 150, el: 26, dist: 5.4 }, sunAngle: 32, sliders: { ringTilt: 28 } },
      // About -9° puts the sun (at 32°, 9° above the equator) in the ring plane.
      { orbit: { az: 20, el: 30, dist: 4.6 }, sunAngle: 32, sliders: { ringTilt: -9 } },
      // The sun 57° over the rings: they shine, and their shadow has slid
      // towards the pole, off the visible disc.
      { orbit: { az: 30, el: -16, dist: 4.6 }, sunAngle: 32, sliders: { ringTilt: 48 } },
    ],
    quiz: [
      { answers: 3, right: 0 },
      { answers: 3, right: 2 },
      { answers: 3, right: 1 },
    ],
  },
  {
    id: 'climate',
    preset: 'terran',
    steps: [
      { orbit: { az: 14, el: 10, dist: 3.5 }, sunAngle: 32 },
      { look: { lat: 62, lon: 40, dist: 2.2 }, sun: -10, mark: { lat: 74, lon: 40 } },
      { look: { lat: 52, lon: 40, dist: 2.5 }, sun: -10, sliders: { ice: 0.86 } },
      { look: { lat: 24, lon: 0, dist: 2.0 }, sun: -15 },
      { look: { lat: 0, lon: -40, dist: 2.0 }, sun: -15 },
      // A snow-capped range of the default seed.
      { look: { lat: 30, lon: 120, dist: 1.8 }, sun: -35, mark: { lat: 30, lon: 120 } },
    ],
    quiz: [
      { answers: 3, right: 2 },
      { answers: 3, right: 1 },
      { answers: 3, right: 0 },
    ],
  },
  {
    id: 'people',
    preset: 'terran',
    steps: [
      { look: { lat: 20, lon: 0, dist: 2.7 }, sun: 170 },
      { look: { lat: 25, lon: 30, dist: 1.85 }, sun: 160 },
      { look: { lat: 55, lon: 30, dist: 2.2 }, sun: 160 },
      // A dry patch of the default seed, dark among the lights.
      { look: { lat: 26, lon: 55, dist: 2.0 }, sun: 165, mark: { lat: 26, lon: 55 } },
      { look: { lat: 22, lon: -20, dist: 2.0 }, sun: 165, sliders: { cityLights: 0.1 } },
      { look: { lat: 20, lon: 0, dist: 2.7 }, sun: 170, sliders: { cityLights: 1 } },
    ],
    quiz: [
      { answers: 3, right: 1 },
      { answers: 3, right: 2 },
      { answers: 3, right: 0 },
    ],
  },
  {
    id: 'worlds',
    preset: 'terran',
    steps: [
      { orbit: { az: 38, el: 12, dist: 3.6 }, sunAngle: 32 },
      { preset: 'arrakis', orbit: { az: 38, el: 12, dist: 3.6 }, sunAngle: 32 },
      { preset: 'mustafar', orbit: { az: 70, el: 12, dist: 3.4 }, sunAngle: 32 },
      { preset: 'europa', orbit: { az: 38, el: 18, dist: 4.4 }, sunAngle: 32 },
      { preset: 'kepler', orbit: { az: 38, el: 18, dist: 4.6 }, sunAngle: 32 },
      { orbit: { az: 38, el: 12, dist: 3.6 }, sunAngle: 32 },
    ],
    quiz: [
      { answers: 3, right: 2 },
      { answers: 3, right: 0 },
      { answers: 3, right: 1 },
    ],
  },
];
