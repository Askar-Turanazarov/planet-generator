// Descent, flight and ascent (FLIGHT-PLAN.md stage H).
//
// Drives the FlightCamera (flightCamera.js) from the keyboard, the mouse and
// the touch screen, and draws the flight's own interface: the telemetry strip
// at the top, the flight panel at the bottom, the touch controls, and the
// "Flight" group of the View tab (descend, quick targets).
//
//   descent  one button: from the orbit to a few hundred metres over the point
//            in the middle of the screen (or the probe's marker), the height
//            falling along its logarithm, the view turning from straight down
//            to the horizon below the clouds.
//   flight   two characters, F switches: the plane (always forward, banks in
//            turns, levels itself) and the drone (hovers, strafes, turns on
//            the spot: for pictures). Speed follows the height above the
//            ground (about the height per second, Shift x4).
//   ascent   back up through the clouds and the air to the orbit, where the
//            orbit controls take over again.
//
// The ground: the GPU probe measures the drawn ground under the camera and a
// second and three seconds ahead along the course; the camera stays at least
// the minimum clearance above the highest of them, climbing smoothly.
// Units: planet radii unless a name says metres; angles in radians.
import * as THREE from 'three';
import { localFrame } from './flightCamera.js';

const STYLE_KEY = 'pg.flight.style';
const TOUCH_KEY = 'pg.flight.touch';
const DESCENT_TIME = 12;
const ASCENT_TIME = 9;
const ORBIT_DIST = 3.6;
const PITCH_MAX = 1.2;
const LOOK = 0.0035;           // rad per pixel of a drag
const DEG = THREE.MathUtils.DEG2RAD;

const read = (key, fallback, allowed) => {
  try {
    const value = window.localStorage.getItem(key);
    return allowed.includes(value) ? value : fallback;
  } catch (error) {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    // Not remembering the choice is not worth an error.
  }
};
const flEl = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const ease = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const smoothFl = THREE.MathUtils.smoothstep;

/**
 * @param {object} o
 *   flight   FlightCamera
 *   camera, canvas, rig (CameraRig), i18n, toast(key)
 *   env      { radiusKm(), minClearanceM(), clouds() -> {base, top, cover},
 *              groundAhead() -> radius | null, target(kind) -> {dir, radius} | null,
 *              nightAt(dir), markerDir() -> world dir | null, changed() }
 */
export function createFlightControl({ flight, camera, canvas, rig, i18n, toast, env }) {
  const t = i18n.t;
  const touchDevice = window.matchMedia('(pointer: coarse)').matches;
  let style = read(STYLE_KEY, 'plane', ['plane', 'drone']);
  let scheme = read(TOUCH_KEY, 'stick', ['stick', 'tilt', 'tap']);

  // --- pilot state ---
  const pilot = {
    heading: 0,
    pitch: 0,
    roll: 0,
    throttle: 1,                 // speed in heights above the ground per second
    vel: new THREE.Vector3(),    // drone velocity (radii / s)
    climb: 0,                    // wheel: pending change of height (fraction)
    lastR: 0,
    vs: 0,                       // vertical speed (radii / s), smoothed
    speed: 0,                    // ground speed (radii / s)
    guard: false,                // the ground guard is lifting the camera
    target: null,                // tap autopilot: world direction
  };
  let leg = null;                // descent / ascent in progress

  // --- input ---
  const keys = new Set();
  const stick = { x: 0, y: 0, lift: 0 };   // touch: joystick and the right slider
  const tilt = { on: false, x: 0, y: 0, zero: null };
  let drag = null;
  let lookX = 0;
  let lookY = 0;

  const frameUp = new THREE.Vector3();
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const v = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const m = new THREE.Matrix4();

  const metre = () => 1 / (env.radiusKm() * 1000);
  const minClear = () => env.minClearanceM() * metre();

  /** Heading of a world vector in the local frame at "up". */
  function headingOf(vec, up) {
    localFrame(up, east, north);
    return Math.atan2(vec.dot(east), vec.dot(north));
  }

  /** Forward unit vector for heading / pitch in the frame at the camera. */
  function forward(heading, pitch, out) {
    localFrame(frameUp.copy(flight.pos).normalize(), east, north);
    return out.copy(north).multiplyScalar(Math.cos(heading)).addScaledVector(east, Math.sin(heading))
      .multiplyScalar(Math.cos(pitch)).addScaledVector(frameUp, Math.sin(pitch));
  }

  // ---------------------------------------------------------------------------
  // Descent and ascent

  function descend() {
    if (leg?.kind === 'descent' || (flight.active && flight.mode === 'flight')) return;
    if (!flight.active) flight.takeOver('descent');
    flight.mode = 'descent';
    const startDir = flight.pos.clone().normalize();
    // The point in the middle of the screen, or the marker.
    let targetDir = env.markerDir();
    if (!targetDir) {
      const ray = new THREE.Ray(camera.position.clone(), new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion));
      const hit = ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), 1), new THREE.Vector3());
      targetDir = hit ? hit.normalize() : startDir.clone();
    }
    // The screen's up becomes the course, so the turn to the horizon is a nod.
    const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(flight.quat);
    const tangent = screenUp.addScaledVector(targetDir, -screenUp.dot(targetDir));
    const heading = tangent.lengthSq() > 1e-8 ? headingOf(tangent.normalize(), targetDir) : 0;
    leg = {
      kind: 'descent',
      t: 0,
      startDir,
      targetDir,
      startQuat: flight.quat.clone(),
      c0: Math.max(flight.pos.length() - flight.groundRadius, 1e-6),
      c1: Math.max(minClear() * 2, 300 * metre()),
      heading,
    };
    pilot.target = null;
    syncUi();
  }

  function ascend() {
    if (!flight.active || leg?.kind === 'ascent') return;
    flight.mode = 'ascent';
    const dir = flight.pos.clone().normalize();
    // Final pose: the orbit camera's (looking at the centre, world up).
    const end = dir.clone().multiplyScalar(ORBIT_DIST);
    const endQuat = new THREE.Quaternion().setFromRotationMatrix(m.lookAt(end, v.set(0, 0, 0), v2.set(0, 1, 0)));
    leg = {
      kind: 'ascent',
      t: 0,
      dir,
      startQuat: flight.quat.clone(),
      endQuat,
      c0: Math.max(flight.pos.length() - flight.groundRadius, 1e-6),
      pitch0: pilot.pitch,
      heading: pilot.heading,
    };
    pilot.target = null;
    syncUi();
  }

  function updateLeg(dt) {
    settle = null;
    leg.t = Math.min(leg.t + dt / (leg.kind === 'descent' ? DESCENT_TIME : ASCENT_TIME), 1);
    const s = ease(leg.t);
    if (leg.kind === 'descent') {
      // Across first (while high), then down.
      const k = ease(smoothFl(leg.t, 0, 0.55));
      q.setFromUnitVectors(leg.startDir, leg.targetDir);
      const dir = v.copy(leg.startDir).applyQuaternion(new THREE.Quaternion().slerp(q, k));
      const c = Math.exp(THREE.MathUtils.lerp(Math.log(leg.c0), Math.log(leg.c1), s));
      flight.pos.copy(dir).multiplyScalar(flight.groundRadius + c);
      // Straight down from high up, the horizon once under the clouds.
      const km = c / metre() / 1000;
      const nod = 1 - smoothFl(Math.log(km), Math.log(1.2), Math.log(40));
      pilot.heading = leg.heading;
      pilot.pitch = THREE.MathUtils.lerp(-89.5 * DEG, -8 * DEG, nod);
      pilot.roll = 0;
      flight.orient(pilot.heading, pilot.pitch);
      if (leg.t < 0.2) flight.quat.slerpQuaternions(leg.startQuat, flight.quat.clone(), smoothFl(leg.t, 0, 0.2));
      if (leg.t >= 1) {
        leg = null;
        flight.mode = 'flight';
        pilot.throttle = 1;
        pilot.vel.set(0, 0, 0);
        syncUi();
        env.changed();
      }
    } else {
      const c = Math.exp(THREE.MathUtils.lerp(Math.log(leg.c0), Math.log(ORBIT_DIST - 1), s));
      flight.pos.copy(leg.dir).multiplyScalar(flight.groundRadius + c);
      const km = c / metre() / 1000;
      const nod = smoothFl(Math.log(km), Math.log(2), Math.log(60));
      pilot.pitch = THREE.MathUtils.lerp(leg.pitch0, -89.5 * DEG, nod);
      flight.orient(leg.heading, pilot.pitch);
      // Hand the roll over to the orbit camera's up in the last stretch.
      const k = smoothFl(leg.t, 0.7, 1);
      if (k > 0) flight.quat.slerp(leg.endQuat, k);
      if (leg.t >= 1) {
        leg = null;
        flight.release();
        rig.jumpTo(flight.pos.clone().normalize(), ORBIT_DIST);
        rig.controls.enabled = true;
        syncUi();
        env.changed();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Flying

  function axis(neg, pos) {
    return (keys.has(pos) ? 1 : 0) - (keys.has(neg) ? 1 : 0);
  }

  function updateFlight(dt) {
    const r = flight.pos.length();
    const up = frameUp.copy(flight.pos).normalize();
    const minC = minClear();
    const clearance = Math.max(r - flight.groundRadius, 0);
    const fast = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 4 : 1;
    const base = Math.min(Math.max(clearance, minC), 60000 * metre());

    // Inputs in [-1, 1].
    let turn = axis('KeyA', 'KeyD') + axis('ArrowLeft', 'ArrowRight') * (style === 'plane' ? 1 : 0);
    let nod = axis('ArrowDown', 'ArrowUp');
    let yaw = style === 'drone' ? axis('ArrowLeft', 'ArrowRight') : 0;
    let move = axis('KeyS', 'KeyW');
    let lift = axis('KeyQ', 'KeyE');
    if (scheme === 'tilt' && tilt.on) {
      turn += tilt.x;
      if (style === 'plane') nod -= tilt.y;
      else move -= tilt.y;
    } else {
      turn += stick.x;
      if (style === 'plane') nod -= stick.y;
      else move -= stick.y;
    }
    if (style === 'drone') lift += stick.lift;
    // Tap autopilot: steer towards the target at the present height.
    if (pilot.target) {
      const toT = v.copy(pilot.target).addScaledVector(up, -pilot.target.dot(up));
      const want = headingOf(toT.normalize(), up);
      const diff = THREE.MathUtils.euclideanModulo(want - pilot.heading + Math.PI, Math.PI * 2) - Math.PI;
      const dist = Math.acos(THREE.MathUtils.clamp(pilot.target.dot(up), -1, 1));
      if (dist < Math.max(clearance * 1.5, 300 * metre())) {
        pilot.target = null;
      } else if (style === 'plane') {
        turn = THREE.MathUtils.clamp(diff * 2, -1, 1);
        nod = THREE.MathUtils.clamp(-pilot.pitch * 3, -1, 1);
      } else {
        yaw = THREE.MathUtils.clamp(diff * 2, -1, 1);
        move = Math.abs(diff) < 0.5 ? 1 : 0;
      }
    }
    turn = THREE.MathUtils.clamp(turn, -1, 1);
    nod = THREE.MathUtils.clamp(nod, -1, 1);

    // Mouse / finger drag: look around (both characters).
    pilot.heading += lookX * LOOK;
    pilot.pitch = THREE.MathUtils.clamp(pilot.pitch - lookY * LOOK, -PITCH_MAX, PITCH_MAX);
    const dragTurn = lookX;
    lookX = 0;
    lookY = 0;

    if (style === 'plane') {
      // W / S set the speed; it holds.
      pilot.throttle = THREE.MathUtils.clamp(pilot.throttle * Math.exp(move * 0.9 * dt), 0.25, 4);
      const bank = turn * 0.6 + THREE.MathUtils.clamp(dragTurn * 0.02, -0.4, 0.4);
      pilot.roll += (bank - pilot.roll) * (1 - Math.exp(-3 * dt));
      pilot.heading += Math.sin(pilot.roll) * 0.9 * dt;
      if (nod !== 0) pilot.pitch = THREE.MathUtils.clamp(pilot.pitch + nod * 0.6 * dt, -PITCH_MAX, PITCH_MAX);
      else pilot.pitch *= Math.exp(-0.35 * dt);
      const speed = pilot.throttle * fast * base;
      forward(pilot.heading, pilot.pitch, fwd);
      flight.pos.addScaledVector(fwd, speed * dt);
      pilot.speed = speed * Math.cos(pilot.pitch);
    } else {
      pilot.roll *= Math.exp(-4 * dt);
      pilot.heading += yaw * 1.1 * dt;
      if (nod !== 0) pilot.pitch = THREE.MathUtils.clamp(pilot.pitch + nod * 0.8 * dt, -PITCH_MAX, PITCH_MAX);
      const speed = fast * base;
      localFrame(up, east, north);
      fwd.copy(north).multiplyScalar(Math.cos(pilot.heading)).addScaledVector(east, Math.sin(pilot.heading));
      right.crossVectors(fwd, up);
      const want = v.copy(fwd).multiplyScalar(THREE.MathUtils.clamp(move, -1, 1) * speed)
        .addScaledVector(right, THREE.MathUtils.clamp(turn, -1, 1) * speed)
        .addScaledVector(up, THREE.MathUtils.clamp(lift, -1, 1) * speed * 0.6);
      pilot.vel.lerp(want, 1 - Math.exp(-4 * dt));
      flight.pos.addScaledVector(pilot.vel, dt);
      pilot.speed = Math.hypot(pilot.vel.dot(fwd), pilot.vel.dot(right));
    }

    // Wheel: a share of the height, spread over a few frames.
    if (pilot.climb !== 0) {
      const step = pilot.climb * (1 - Math.exp(-8 * dt));
      pilot.climb -= step;
      if (Math.abs(pilot.climb) < 1e-4) pilot.climb = 0;
      const h = Math.max(flight.pos.length() - flight.groundRadius, minC);
      flight.pos.setLength(flight.pos.length() + h * step);
    }

    // Keep the course across the sphere: re-read the heading from the
    // forward vector carried over to the new position (no pole flips).
    const newUp = v2.copy(flight.pos).normalize();
    forward(pilot.heading, 0, fwd);
    const carried = fwd.addScaledVector(newUp, -fwd.dot(newUp));
    if (carried.lengthSq() > 1e-12) pilot.heading = headingOf(carried.normalize(), newUp);

    // The ground guard.
    const ahead = env.groundAhead();
    const ground = Math.max(flight.groundRadius, ahead ?? 0);
    const floor = ground + minC;
    let rNow = flight.pos.length();
    pilot.guard = rNow < floor;
    if (pilot.guard) {
      rNow += (floor - rNow) * (1 - Math.exp(-5 * dt));
      rNow = Math.max(rNow, flight.groundRadius + minC * 0.5);
      flight.pos.setLength(rNow);
      if (style === 'plane') pilot.pitch = Math.max(pilot.pitch, 0.05);
      if (style === 'drone' && pilot.vel.dot(newUp) < 0) pilot.vel.addScaledVector(newUp, -pilot.vel.dot(newUp));
    }
    // After a quick jump: the coarse grid placed the camera, the probe (a few
    // frames late) knows the real ground; ease onto the wanted clearance.
    if (settle) {
      settle.t += dt;
      if (settle.t > 0.25) {
        const want = flight.groundRadius + settle.agl;
        if (!settle.down || rNow > want) {
          rNow += (want - rNow) * (1 - Math.exp(-4 * dt));
          flight.pos.setLength(rNow);
        }
      }
      if (settle.t > 2.5) settle = null;
    }
    // High enough: the orbit takes over.
    if (rNow > 1.3) {
      flight.release();
      rig.jumpTo(flight.pos.clone().normalize(), rNow);
      rig.controls.enabled = true;
      syncUi();
      return;
    }
    flight.orient(pilot.heading, pilot.pitch, pilot.roll);
  }

  /** A light shake while the camera is inside the cloud layer. */
  let shakeT = 0;
  function updateShake(dt) {
    const { base, top, cover } = env.clouds();
    const r = flight.pos.length();
    const pad = 300 * metre();
    const inside = smoothFl(r, base - pad, base) * (1 - smoothFl(r, top, top + pad)) * Math.min(cover * 2, 1);
    const fast = Math.min(pilot.speed / (120 * metre()), 1);
    const a = 0.004 * inside * (0.3 + 0.7 * fast) * (leg ? 0.5 : 1);
    shakeT += dt;
    if (a < 1e-5) {
      flight.shake.identity();
      return;
    }
    const s = shakeT;
    v.set(
      a * (Math.sin(s * 13.1) + 0.6 * Math.sin(s * 23.7 + 1.3)),
      a * (Math.sin(s * 11.3 + 2.1) + 0.5 * Math.sin(s * 19.1)),
      a * 0.6 * Math.sin(s * 7.7 + 0.4),
    );
    flight.shake.setFromEuler(new THREE.Euler(v.x, v.y, v.z));
  }

  function update(dt) {
    dt = Math.min(dt, 0.1);
    if (leg) updateLeg(dt);
    else if (flight.mode === 'flight') updateFlight(dt);
    if (!flight.active) {
      flight.shake.identity();
      paintStrip();
      return;
    }
    updateShake(dt);
    const r = flight.pos.length();
    if (pilot.lastR) pilot.vs += ((r - pilot.lastR) / Math.max(dt, 1e-3) - pilot.vs) * (1 - Math.exp(-4 * dt));
    pilot.lastR = r;
    paintStrip();
  }

  /** Planet-space points the ground probe should measure ahead (world dirs). */
  function aheadDirs(out) {
    const up = frameUp.copy(flight.pos).normalize();
    const speed = Math.max(pilot.speed, 0);
    forward(pilot.heading, 0, fwd);
    for (let i = 0; i < out.length; i++) {
      const s = speed * (i + 1) * 1.5;
      out[i].copy(up).addScaledVector(fwd, s).normalize();
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Quick targets

  let settle = null;   // { agl, t, down }: easing onto the probe's ground after goTo (down: only lower)
  function goTo(kind) {
    const found = env.target(kind);
    if (!found) {
      toast(kind === 'city' ? 'flight.noCity' : 'flight.noTarget');
      return;
    }
    {
      if (!flight.active) flight.takeOver('flight');
      leg = null;
      flight.mode = 'flight';
      const m1 = metre();
      const { dir, radius } = found;
      const up = dir.clone();
      if (kind === 'peak') {
        // A few kilometres off the summit, above it, facing it. A cell of the
        // coarse grid is tens of kilometres wide, so its summit can be kilometres
        // off the real ground either way: start high (never inside the slope),
        // then ease down to 2.5 km over the real ground once the probe reads it.
        localFrame(up, east, north);
        const back = north.clone().multiplyScalar(-8000 * m1);
        const pos = up.clone().add(back).normalize();
        flight.pos.copy(pos).multiplyScalar(radius + 5000 * m1);
        pilot.heading = 0;
        pilot.pitch = -4 * DEG;
        settle = { agl: 2500 * m1, t: 0, down: true };
      } else {
        const agl = (kind === 'city' ? 2000 : 1200) * m1;
        flight.pos.copy(up).multiplyScalar(radius + agl);
        settle = { agl, t: 0 };
        pilot.heading = 0;
        pilot.pitch = (kind === 'city' ? -28 : -15) * DEG;
        if (kind === 'city') env.nightAt(dir);
      }
      flight.groundRadius = Math.min(flight.groundRadius, radius);
      pilot.roll = 0;
      pilot.vel.set(0, 0, 0);
      pilot.target = null;
      if (kind === 'peak' && style === 'plane') pilot.throttle = 0.6;
      flight.orient(pilot.heading, pilot.pitch);
      flight.apply();
      syncUi();
      env.changed();
    }
  }

  // ---------------------------------------------------------------------------
  // Input listeners

  const FLIGHT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight']);
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (target instanceof HTMLInputElement && target.type === 'text') return;
    if (!flight.active) return;
    if (FLIGHT_KEYS.has(e.code)) {
      keys.add(e.code);
      if (e.code.startsWith('Arrow')) {
        e.preventDefault();
        e.stopPropagation();   // not the tours' previous / next
      }
      if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') pilot.target = null;
    } else if (e.code === 'KeyF' && !e.repeat) {
      setStyle(style === 'plane' ? 'drone' : 'plane');
    } else if (e.code === 'KeyO' && !e.repeat) {
      ascend();
    }
  }, { capture: true });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', (e) => {
    if (flight.mode !== 'flight') return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, time: performance.now() };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || drag.id !== e.pointerId || flight.mode !== 'flight') return;
    lookX += e.clientX - drag.x;
    lookY += e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const endDrag = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
    const quick = performance.now() - drag.time < 350;
    drag = null;
    if (e.type === 'pointerup' && touchDevice && scheme === 'tap' && moved < 10 && quick) tapTarget(e);
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (flight.mode !== 'flight') return;
    e.preventDefault();
    pilot.climb += Math.sign(e.deltaY) * 0.25;
  }, { passive: false });

  /** Tap autopilot: the ground under the finger becomes the target. */
  function tapTarget(e) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hit = ray.ray.intersectSphere(new THREE.Sphere(new THREE.Vector3(), flight.groundRadius), new THREE.Vector3());
    if (!hit) return;
    pilot.target = hit.normalize();
    toast('flight.tapSet');
  }

  // ---------------------------------------------------------------------------
  // Interface

  const painters = [];
  const paint = (fn) => {
    painters.push(fn);
    fn();
  };
  const label = (node, key) => paint(() => { node.textContent = t(key); });
  i18n.onChange(() => painters.forEach((fn) => fn()));

  const hud = document.getElementById('hud');

  // The "Flight" group of the View tab.
  const group = flEl('div', 'group group-flight');
  group.dataset.tab = 'view';
  const title = flEl('div', 'group-title');
  const titleText = flEl('span');
  label(titleText, 'flight.group');
  const titleHint = flEl('span');
  label(titleHint, 'flight.groupHint');
  title.append(titleText, titleHint);
  const descendBtn = flEl('button', 'btn flight-go');
  descendBtn.type = 'button';
  const descendText = flEl('span');
  descendBtn.append(descendText);
  descendBtn.addEventListener('click', () => (flight.active ? ascend() : descend()));
  const quick = flEl('div', 'grid2 flight-targets');
  ['peak', 'coast', 'city'].forEach((kind) => {
    const button = flEl('button', 'btn compact');
    button.type = 'button';
    label(button, `flight.target.${kind}`);
    button.addEventListener('click', () => goTo(kind));
    quick.append(button);
  });
  group.append(title, descendBtn, quick);
  document.getElementById('camera-list').parentElement.after(group);

  // Telemetry strip (top) and flight panel (bottom).
  const strip = flEl('div', 'flight-strip');
  strip.setAttribute('aria-live', 'off');
  const fields = {};
  ['phase', 'alt', 'vs', 'ground', 'speed'].forEach((key) => {
    const cell = flEl('div', `fs-cell fs-${key}`);
    const name = flEl('span', 'fs-name');
    if (key !== 'phase') label(name, `flight.tm.${key}`);
    const value = flEl('span', 'fs-value');
    cell.append(name, value);
    strip.append(cell);
    fields[key] = value;
  });
  const panel = flEl('div', 'flight-panel');
  const styleSwitch = flEl('div', 'switch');
  const plane = flEl('button', 'btn');
  const drone = flEl('button', 'btn');
  plane.type = 'button';
  drone.type = 'button';
  label(plane, 'flight.plane');
  label(drone, 'flight.drone');
  plane.addEventListener('click', () => setStyle('plane'));
  drone.addEventListener('click', () => setStyle('drone'));
  styleSwitch.append(plane, drone);
  const orbitBtn = flEl('button', 'btn flight-orbit');
  orbitBtn.type = 'button';
  label(orbitBtn, 'flight.toOrbit');
  orbitBtn.addEventListener('click', () => ascend());
  panel.append(styleSwitch, orbitBtn);
  let schemeSwitch = null;
  const schemeButtons = {};
  if (touchDevice) {
    schemeSwitch = flEl('div', 'switch three');
    ['stick', 'tilt', 'tap'].forEach((id) => {
      const button = flEl('button', 'btn');
      button.type = 'button';
      label(button, `flight.touch.${id}`);
      button.addEventListener('click', () => setScheme(id));
      schemeSwitch.append(button);
      schemeButtons[id] = button;
    });
    panel.append(schemeSwitch);
  } else {
    const keysHint = flEl('div', 'flight-keys');
    paint(() => { keysHint.textContent = t(style === 'plane' ? 'flight.keys.plane' : 'flight.keys.drone'); });
    panel.append(keysHint);
  }
  hud.append(strip, panel);

  // Touch controls: joystick (left) and the speed / height slider (right).
  const touch = flEl('div', 'flight-touch');
  const pad = flEl('div', 'ft-stick');
  const knob = flEl('div', 'ft-knob');
  pad.append(knob);
  const slider = flEl('div', 'ft-slider');
  const thumb = flEl('div', 'ft-thumb');
  const sliderName = flEl('span', 'ft-name');
  slider.append(thumb, sliderName);
  touch.append(pad, slider);
  hud.append(touch);
  paint(() => { sliderName.textContent = t(style === 'plane' ? 'flight.tm.speed' : 'flight.lift'); });

  function bindPad(node, onMove, onEnd) {
    let id = null;
    const at = (e) => {
      const r = node.getBoundingClientRect();
      onMove((e.clientX - r.left) / r.width * 2 - 1, (e.clientY - r.top) / r.height * 2 - 1);
    };
    node.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      node.setPointerCapture(id);
      pilot.target = null;
      at(e);
      e.preventDefault();
    });
    node.addEventListener('pointermove', (e) => { if (e.pointerId === id) at(e); });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      onEnd();
    };
    node.addEventListener('pointerup', end);
    node.addEventListener('pointercancel', end);
  }
  bindPad(pad, (x, y) => {
    const len = Math.hypot(x, y);
    const k = len > 1 ? 1 / len : 1;
    stick.x = x * k;
    stick.y = y * k;
    knob.style.transform = `translate(${stick.x * 32}px, ${stick.y * 32}px)`;
  }, () => {
    stick.x = 0;
    stick.y = 0;
    knob.style.transform = '';
  });
  bindPad(slider, (x, y) => {
    const a = THREE.MathUtils.clamp(y, -1, 1);
    thumb.style.transform = `translateY(${a * 44}px)`;
    if (style === 'plane') pilot.throttle = 2 ** (-a * 2);
    else stick.lift = -a;
  }, () => {
    if (style === 'drone') {
      stick.lift = 0;
      thumb.style.transform = '';
    }
  });

  // Tilt: the phone's attitude relative to how it was held when switched on.
  function onOrientation(e) {
    if (e.beta === null || e.gamma === null) return;
    const angle = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    let x = e.gamma;
    let y = e.beta;
    if (angle === 90) [x, y] = [e.beta, -e.gamma];
    else if (angle === -90 || angle === 270) [x, y] = [-e.beta, e.gamma];
    if (!tilt.zero) tilt.zero = { x, y };
    tilt.x = THREE.MathUtils.clamp((x - tilt.zero.x) / 25, -1, 1);
    tilt.y = THREE.MathUtils.clamp((y - tilt.zero.y) / 25, -1, 1);
    tilt.on = true;
  }
  async function startTilt() {
    tilt.zero = null;
    tilt.on = false;
    try {
      const D = window.DeviceOrientationEvent;
      if (!D) throw new Error('none');
      if (typeof D.requestPermission === 'function' && (await D.requestPermission()) !== 'granted') throw new Error('denied');
      window.addEventListener('deviceorientation', onOrientation);
      window.setTimeout(() => {
        if (scheme === 'tilt' && !tilt.on) {
          window.removeEventListener('deviceorientation', onOrientation);
          setScheme('stick');
          toast('flight.tiltFail');
        }
      }, 1500);
    } catch (error) {
      setScheme('stick');
      toast('flight.tiltFail');
    }
  }

  function setStyle(next) {
    if (style === next) return;
    style = next;
    write(STYLE_KEY, style);
    pilot.vel.set(0, 0, 0);
    stick.lift = 0;
    thumb.style.transform = '';
    painters.forEach((fn) => fn());
    syncUi();
    toast(style === 'plane' ? 'flight.plane' : 'flight.drone');
  }

  function setScheme(next) {
    if (scheme === 'tilt' && next !== 'tilt') {
      window.removeEventListener('deviceorientation', onOrientation);
      tilt.on = false;
    }
    scheme = next;
    write(TOUCH_KEY, scheme);
    if (scheme === 'tilt') startTilt();
    if (scheme !== 'tap') pilot.target = null;
    syncUi();
  }

  function syncUi() {
    const active = flight.active;
    document.body.classList.toggle('flying', active);
    document.body.dataset.flightStyle = style;
    if (touchDevice) document.body.dataset.flightTouch = scheme;
    descendText.textContent = t(active ? 'flight.toOrbit' : 'flight.descend');
    plane.setAttribute('aria-pressed', String(style === 'plane'));
    drone.setAttribute('aria-pressed', String(style === 'drone'));
    for (const id in schemeButtons) schemeButtons[id].setAttribute('aria-pressed', String(id === scheme));
    touch.hidden = !(active && touchDevice && flight.mode === 'flight' && scheme !== 'tap');
    pad.hidden = scheme === 'tilt';
  }
  paint(syncUi);

  // Telemetry text.
  const fmtLen = (radii) => {
    const metres = radii / metre();
    if (Math.abs(metres) >= 10000) return t('flight.km', { v: i18n.number(metres / 1000, 1) });
    return t('flight.m', { v: i18n.number(metres, 0) });
  };
  let lastPaint = 0;
  function paintStrip() {
    const now = performance.now();
    if (now - lastPaint < 120) return;
    lastPaint = now;
    if (!flight.active) return;
    const r = flight.pos.length();
    const { base, top } = env.clouds();
    const clearance = Math.max(r - flight.groundRadius, 0);
    let phase = 'low';
    if (r > 1.065) phase = 'orbit';
    else if (r > top + 500 * metre()) phase = 'entry';
    else if (r > base - 300 * metre()) phase = 'clouds';
    if (leg?.kind === 'descent' && phase === 'low') phase = 'landing';
    fields.phase.textContent = t(`flight.phase.${phase}`) + (pilot.guard ? ` · ${t('flight.guard')}` : '');
    fields.alt.textContent = fmtLen(clearance);
    const vsM = pilot.vs / metre();
    fields.vs.textContent = t('flight.ms', { v: (vsM > 0 ? '+' : '') + i18n.number(vsM, Math.abs(vsM) < 10 ? 1 : 0) });
    fields.ground.textContent = fmtLen(flight.groundRadius - 1);
    fields.speed.textContent = t('flight.ms', { v: i18n.number(pilot.speed / metre(), 0) });
  }

  return {
    update,
    descend,
    ascend,
    goTo,
    aheadDirs,
    setStyle,
    get style() {
      return style;
    },
    get pilot() {
      return pilot;
    },
    /** After a pose was set from outside (a link): take the heading and pitch from it. */
    adopt() {
      const pose = flight.getPose();
      pilot.heading = pose.heading * DEG;
      pilot.pitch = pose.pitch * DEG;
      pilot.roll = 0;
      leg = null;
      syncUi();
    },
    syncUi,
  };
}
