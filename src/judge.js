// The judge of the photo expedition: what is in a picture, from data the
// generator already has, and how many stars it earns (missions.js).
//
// A picture is described by its "shot": the camera that took it (always
// looking at the planet's centre, so the planet sits in the middle of the
// frame), the sun, the rings, the storms and a few world figures. From that:
//   - geometry alone: the phase angle, how large the planet is in the frame,
//     the rings and the planet's shadow on them, the storms, the terminator;
//   - a grid of rays over the planet's disc, each hit read by the probe
//     (probe.js, sampleMany): ocean, lava, ice, day or night there, and
//     whether the rings shade it;
//   - the picture itself (reduced): night lights, and cloud on a storm's spiral.
//
// Screen positions are in "half-height units": the frame spans
// [-aspect, aspect] across and [-1, 1] up, with the planet's centre at 0.
import * as THREE from 'three';
import { classify } from './survey.js';

export const GRID = 16;             // rays per side over the disc (read in batches of the probe's MAX_POINTS)
// Night glow in the picture: pixels darker than the twilight (sine of the
// sun's height below GLOW_NIGHT) that are brighter than GLOW_LUMA (0–255).
const GLOW_NIGHT = -0.12;
const GLOW_LUMA = 30;
export const GLOW_WIDTH = 640;      // width of the reduced copy of the still
const GLOW_GRAZE = 0.25;            // skip the rim: cosine of the view angle below this
const GLOW_MIN_NIGHT = 600;         // fewer night pixels than this: too little night to judge
const STORM_LUMA = 150;             // a pixel this bright on the spiral is cloud
const STORM_CLOUD = 0.25;           // share of cloud on the spiral for the storm to count
const DAY = 0.05;                  // sine of the sun's height: day above, night below NIGHT
const NIGHT = -0.08;
const TWILIGHT = 0.15;              // |sine| within which it is dawn or dusk
const RING_ANGLES = 48;
const RING_BANDS = 4;
const THIRD_TOLERANCE = 0.05;       // of the frame's width or height

const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();
const inverse = new THREE.Quaternion();
const toPlanet = new THREE.Quaternion();

/** Distance along a ray (unit direction) to the unit sphere, or -1. */
function hitSphere(origin, dir) {
  const b = origin.dot(dir);
  const c = origin.lengthSq() - 1;
  const d = b * b - c;
  if (d < 0) return -1;
  const t = -b - Math.sqrt(d);
  return t > 0 ? t : -1;
}

function frameOf(shot) {
  const { camera } = shot;
  const tanHalf = Math.tan(camera.fovY / 2);
  const dist = camera.position.length();
  const discR = Math.tan(Math.asin(Math.min(1 / dist, 1))) / tanHalf;
  inverse.copy(camera.quaternion).invert();
  return { tanHalf, dist, discR, aspect: camera.aspect };
}

/** Ray direction (world) through a screen point. */
function rayThrough(shot, frame, x, y) {
  return new THREE.Vector3(x * frame.tanHalf, y * frame.tanHalf, -1).normalize().applyQuaternion(shot.camera.quaternion);
}

/** Screen position of a world point, or null behind the camera. */
function project(shot, frame, point) {
  v1.copy(point).sub(shot.camera.position).applyQuaternion(inverse);
  if (v1.z >= -1e-6) return null;
  return { x: v1.x / -v1.z / frame.tanHalf, y: v1.y / -v1.z / frame.tanHalf };
}

const inFrame = (frame, p) => p && Math.abs(p.x) <= frame.aspect && Math.abs(p.y) <= 1;
const central = (frame, p) => Math.abs(p.x) <= frame.aspect / 3 && Math.abs(p.y) <= 1 / 3;

/** Is a point outside the planet hidden from the camera by it? */
function occluded(shot, point) {
  v2.copy(shot.camera.position).sub(point);
  const length = v2.length();
  v2.divideScalar(length);
  const t = hitSphere(point, v2);
  return t > 0 && t < length;
}

/**
 * The rays to sample: a GRID × GRID grid over the part of the frame the
 * planet's disc covers. Each hit carries its screen point, its world point
 * and the direction in planet space (for the probe).
 */
export function planRays(shot) {
  const frame = frameOf(shot);
  toPlanet.copy(shot.planetQuat).invert();
  const halfW = Math.min(frame.discR, frame.aspect);
  const halfH = Math.min(frame.discR, 1);
  const rays = [];
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const x = -halfW + ((i + 0.5) * 2 * halfW) / GRID;
      const y = -halfH + ((j + 0.5) * 2 * halfH) / GRID;
      const dir = rayThrough(shot, frame, x, y);
      const t = hitSphere(shot.camera.position, dir);
      if (t < 0) continue;
      const world = shot.camera.position.clone().addScaledVector(dir, t);
      const local = world.clone().applyQuaternion(toPlanet);
      rays.push({ x, y, world, local });
    }
  }
  return { rays, box: { halfW, halfH } };
}

/** Where the terminator crosses the line through the centre towards the sun. */
function terminatorCrossing(shot, frame) {
  const sun = v1.copy(shot.sun).applyQuaternion(inverse);
  const len = Math.hypot(sun.x, sun.y);
  if (len < 0.05) return { at: null, third: false };       // sun straight behind or ahead
  const ux = sun.x / len;
  const uy = sun.y / len;
  const reach = Math.min(frame.discR, Math.hypot(frame.aspect, 1));
  const steps = 240;
  let previous = null;
  for (let k = 0; k <= steps; k++) {
    const s = -reach + (2 * reach * k) / steps;
    const x = s * ux;
    const y = s * uy;
    if (Math.abs(x) > frame.aspect || Math.abs(y) > 1) { previous = null; continue; }
    const dir = rayThrough(shot, frame, x, y);
    const t = hitSphere(shot.camera.position, dir);
    if (t < 0) { previous = null; continue; }
    const elevation = shot.camera.position.clone().addScaledVector(dir, t).dot(shot.sun);
    if (previous && Math.sign(previous.e) !== Math.sign(elevation)) {
      const f = previous.e / (previous.e - elevation);
      const cx = previous.x + (x - previous.x) * f;
      const cy = previous.y + (y - previous.y) * f;
      const across = Math.abs(ux) >= Math.abs(uy);
      const at = across ? 0.5 + cx / (2 * frame.aspect) : 0.5 - cy / 2;
      const third = Math.min(Math.abs(at - 1 / 3), Math.abs(at - 2 / 3)) <= THIRD_TOLERANCE;
      return { at, third };
    }
    previous = { x, y, e: elevation };
  }
  return { at: null, third: false };
}

/**
 * Everything the checks look at.
 * @param {object} shot     see the top of this file
 * @param {object} plan     from planRays
 * @param {Array}  samples  probe readings, one per ray (or null)
 * @param {ImageData} [image]  the still reduced to GLOW_WIDTH across (night lights)
 */
export function measure(shot, plan, samples, image = null) {
  const frame = frameOf(shot);
  const world = shot.world;
  const phase = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(
    v1.copy(shot.camera.position).normalize().dot(shot.sun), -1, 1)));

  const m = {
    phase,
    discR: frame.discR,
    whole: frame.discR * 1.03 <= 1 && frame.discR * 1.03 <= frame.aspect,
    closeUp: frame.discR >= 1,
    hits: plan.rays.length,
    day: 0, night: 0, ocean: 0, lava: 0, ice: 0,
    nightLava: 0, twilightOcean: 0,
    ringShadowPlanet: 0, ringShadowCentral: false,
    ringsVisible: false, ringPoints: 0, shadowOnRings: 0,
    storm: { visible: false, lit: false, central: false },
    terminator: { at: null, third: false },
  };
  const box = plan.box;
  m.fill = (plan.rays.length / (GRID * GRID)) * ((box.halfW * box.halfH) / frame.aspect);

  // ---- the ground under the grid ----
  const ring = shot.ring;
  const sunOnRing = ring.normal.dot(shot.sun);
  plan.rays.forEach((ray, i) => {
    const elevation = ray.world.dot(shot.sun);
    const isDay = elevation > DAY;
    const isNight = elevation < NIGHT;
    if (isDay) m.day++;
    if (isNight) m.night++;
    const s = samples && samples[i];
    if (s) {
      const ground = { ...s, landH: s.h0 - world.seaLevel };
      const kind = classify(ground, world);
      const ocean = ground.landH <= 0 && !world.lavaSea;
      const lava = kind === 'lavaSea' || kind === 'lavaFlow';
      if (ocean) m.ocean++;
      if (lava) m.lava++;
      if (ground.ice > 0.5 || ground.snow > 0.5) m.ice++;
      if (isNight && lava) m.nightLava++;
      if (Math.abs(elevation) < TWILIGHT && ocean) m.twilightOcean++;
    }
    // The rings' shadow: follow the light back from the ground to the ring plane.
    if (ring.on && isDay && Math.abs(sunOnRing) > 1e-3) {
      const t = -ray.world.dot(ring.normal) / sunOnRing;
      if (t > 0) {
        const r = v2.copy(ray.world).addScaledVector(shot.sun, t).length();
        if (r >= ring.inner && r <= ring.outer) {
          m.ringShadowPlanet++;
          if (central(frame, ray)) m.ringShadowCentral = true;
        }
      }
    }
  });
  const share = (n) => (m.hits > 0 ? n / m.hits : 0);
  m.dayShare = share(m.day);
  m.nightShare = share(m.night);
  m.iceShare = share(m.ice);

  // ---- the rings, and the planet's shadow on them ----
  if (ring.on) {
    const u = new THREE.Vector3(1, 0, 0);
    if (Math.abs(u.dot(ring.normal)) > 0.9) u.set(0, 0, 1);
    u.addScaledVector(ring.normal, -u.dot(ring.normal)).normalize();
    const v = new THREE.Vector3().crossVectors(ring.normal, u);
    const edgeOn = Math.abs(v1.copy(shot.camera.position).normalize().dot(ring.normal)) < Math.sin(THREE.MathUtils.degToRad(1.5));
    const point = new THREE.Vector3();
    for (let b = 0; b < RING_BANDS; b++) {
      const r = ring.inner + ((ring.outer - ring.inner) * (b + 0.5)) / RING_BANDS;
      for (let a = 0; a < RING_ANGLES; a++) {
        const angle = (a / RING_ANGLES) * Math.PI * 2;
        point.copy(u).multiplyScalar(Math.cos(angle) * r).addScaledVector(v, Math.sin(angle) * r);
        const p = project(shot, frame, point);
        if (!inFrame(frame, p) || occluded(shot, point)) continue;
        m.ringPoints++;
        const along = point.dot(shot.sun);
        if (along < 0 && v2.copy(point).addScaledVector(shot.sun, -along).length() < 1) m.shadowOnRings++;
      }
    }
    m.ringsVisible = m.ringPoints >= 8 && !edgeOn;
    if (edgeOn) m.shadowOnRings = 0;
  }

  // ---- storms (cloud deck) ----
  if (shot.cloudCover >= 0.2) {
    for (const dir of shot.storms) {
      const point = dir.clone().multiplyScalar(shot.cloudRadius);
      const facing = v2.copy(shot.camera.position).sub(point).normalize().dot(dir);
      const p = project(shot, frame, point);
      if (facing < 0.3 || !inFrame(frame, p)) continue;
      // The spiral winds whatever cloud is there; over clear sky it does not show.
      if (image && stormCloud(shot, frame, image, dir) < STORM_CLOUD) continue;
      const lit = dir.dot(shot.sun) > 0.15;
      const candidate = { visible: true, lit, central: central(frame, p) };
      // Keep the best one: lit beats unlit, central beats off-centre.
      const score = (s) => (s.visible ? 1 : 0) + (s.lit ? 2 : 0) + (s.central ? 1 : 0);
      if (score(candidate) > score(m.storm)) m.storm = candidate;
    }
  }

  m.terminator = terminatorCrossing(shot, frame);
  if (image) Object.assign(m, measureNightGlow(shot, frame, image));
  return m;
}

/**
 * Lights on the night side, read from the picture itself: a city or a lava
 * river is a few pixels wide, far below the probe grid, but the eye finds it
 * at once. Every pixel of a reduced copy of the still that falls on the
 * planet's night side is checked for brightness.
 * @param {ImageData} image   the still, reduced (see expedition.js)
 */
function measureNightGlow(shot, frame, image) {
  const { width, height, data } = image;
  const origin = shot.camera.position;
  const dir = new THREE.Vector3();
  const point = new THREE.Vector3();
  let nightPixels = 0;
  let litPixels = 0;
  for (let sy = 0; sy < height; sy++) {
    const y = 1 - ((sy + 0.5) / height) * 2;
    if (Math.abs(y) > frame.discR) continue;
    for (let sx = 0; sx < width; sx++) {
      const x = (((sx + 0.5) / width) * 2 - 1) * frame.aspect;
      if (x * x + y * y > frame.discR * frame.discR) continue;
      dir.set(x * frame.tanHalf, y * frame.tanHalf, -1).normalize().applyQuaternion(shot.camera.quaternion);
      const t = hitSphere(origin, dir);
      if (t < 0) continue;
      point.copy(origin).addScaledVector(dir, t);
      if (point.dot(shot.sun) > GLOW_NIGHT) continue;
      // Near the limb the air itself glows: leave the grazing rim out.
      if (-dir.dot(point) < GLOW_GRAZE) continue;
      nightPixels++;
      const i = (sy * width + sx) * 4;
      const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      if (luma >= GLOW_LUMA) litPixels++;
    }
  }
  const enough = nightPixels >= GLOW_MIN_NIGHT;
  return { nightPixels, litPixels, litShare: enough ? litPixels / nightPixels : 0 };
}

/**
 * Share of bright (cloud) pixels on the spiral's arms: rings 3°–12° around
 * the storm's centre, read from the reduced still.
 */
function stormCloud(shot, frame, image, dir) {
  const { width, height, data } = image;
  const side = new THREE.Vector3(0, 1, 0).cross(dir);
  if (side.lengthSq() < 1e-6) side.set(1, 0, 0).cross(dir);
  side.normalize();
  const other = new THREE.Vector3().crossVectors(dir, side);
  const point = new THREE.Vector3();
  let seen = 0;
  let bright = 0;
  for (let ring = 0; ring < 4; ring++) {
    const arc = THREE.MathUtils.degToRad(3 + ring * 3);
    for (let a = 0; a < 24; a++) {
      const angle = (a / 24) * Math.PI * 2;
      point.copy(dir).multiplyScalar(Math.cos(arc))
        .addScaledVector(side, Math.sin(arc) * Math.cos(angle))
        .addScaledVector(other, Math.sin(arc) * Math.sin(angle))
        .multiplyScalar(shot.cloudRadius);
      const p = project(shot, frame, point);
      if (!inFrame(frame, p)) continue;
      const sx = Math.floor(((p.x / frame.aspect + 1) / 2) * width);
      const sy = Math.floor(((1 - p.y) / 2) * height);
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
      const i = (sy * width + sx) * 4;
      seen++;
      if (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2] >= STORM_LUMA) bright++;
    }
  }
  return seen > 0 ? bright / seen : 0;
}

const pct = (x) => Math.round(x * 100);

/** Each check: (metrics, spec) -> { ok, vars } (vars fill the texts). */
export const CHECKS = {
  terminator: (m) => ({ ok: m.dayShare >= 0.1 && m.nightShare >= 0.1 }),
  nightCities: (m, c) => ({ ok: m.litShare * 100 >= c.min }),
  twilightOcean: (m, c) => ({ ok: m.twilightOcean >= c.min }),
  phaseRange: (m, c) => ({ ok: m.phase >= c.min && m.phase <= c.max, vars: { phase: Math.round(m.phase) } }),
  phaseMin: (m, c) => ({ ok: m.phase >= c.min, vars: { phase: Math.round(m.phase) } }),
  whole: (m) => ({ ok: m.whole }),
  closeUp: (m) => ({ ok: m.closeUp }),
  ringsVisible: (m) => ({ ok: m.ringsVisible }),
  shadowOnRings: (m, c) => ({ ok: m.ringsVisible && m.shadowOnRings >= c.min }),
  ringShadow: (m, c) => ({ ok: m.ringShadowPlanet >= c.min }),
  ringShadowCentral: (m) => ({ ok: m.ringShadowCentral }),
  stormLit: (m) => ({ ok: m.storm.visible && m.storm.lit }),
  stormCentral: (m) => ({ ok: m.storm.visible && m.storm.lit && m.storm.central }),
  nightLava: (m, c) => ({ ok: m.nightLava >= c.min && m.litShare * 100 >= c.glow }),
  nightShare: (m, c) => ({ ok: pct(m.nightShare) >= c.min, vars: { share: pct(m.nightShare) } }),
  daySliver: (m, c) => ({ ok: pct(m.dayShare) >= c.min && pct(m.dayShare) <= c.max, vars: { share: pct(m.dayShare) } }),
  terminatorThird: (m) => ({ ok: m.terminator.third, vars: { at: m.terminator.at === null ? '—' : pct(m.terminator.at) } }),
};

/**
 * Stars for a picture: tier n when every check of tiers 1..n holds.
 * @returns {{ stars: number, results: Array<{ spec, ok, vars }> }}
 */
export function judge(mission, metrics) {
  const results = mission.checks.map((spec) => {
    const { ok, vars } = CHECKS[spec.id](metrics, spec);
    return { spec, ok, vars: { ...spec, ...(vars || {}) } };
  });
  let stars = 0;
  for (let tier = 1; tier <= 3; tier++) {
    const tierChecks = results.filter((r) => r.spec.star <= tier);
    if (tierChecks.length === 0 || !tierChecks.every((r) => r.ok)) break;
    stars = tier;
  }
  return { stars, results };
}
