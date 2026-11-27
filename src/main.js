// Planet Generator 3D — entry point.
// Sets up the renderer and post-processing chain, builds the world, wires the
// HUD, and runs the frame loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createUniforms } from './uniforms.js';
import { PRESETS, SLIDER_KEYS } from './presets.js';
import { PlanetState, parseSeed } from './state.js';
import { decodeView, encodeView, isModified, createLinkWriter } from './link.js';
import { createCards } from './cards.js';
import { createTours } from './tour.js';
import { createExpedition } from './expedition.js';
import { createCapture } from './capture.js';
import { createProbe, MAX_POINTS } from './probe.js';
import { describePoint } from './survey.js';
import { createWorld } from './world.js';
import { CameraRig } from './camera.js';
import { createHud } from './hud.js';
import { createI18n } from './i18n.js';
import { createBaker } from './bake.js';
import { pickQuality } from './quality.js';

const EXPOSURE = 1.05;
const FOV = 40;                   // vertical field of view the scene is composed for
// The composed field must fit the free part of the screen in both directions:
// its height, and this many times its width (the planet with a margin).
const FIELD_ASPECT = 1.16;
const BAKE_BUDGET = 6;            // bake work per frame while the screen is dark
const MIN_AUTO_SCALE = 0.5;
const GPU_SHARE = 0.8;            // part of a refresh interval the scene may spend on the GPU
// Refresh rates the display estimate snaps to.
const REFRESH_RATES = [30, 48, 50, 60, 72, 75, 90, 100, 120, 144, 165, 180, 240];

// Camera presets; their names come from the dictionary (camera.<id>).
const CAMERAS = [{ id: 'overview' }, { id: 'terminator' }, { id: 'night' }, { id: 'ring' }];

// Created first, so that even a start-up failure is reported in the user's language.
const i18n = createI18n();

const bootOverlay = document.getElementById('boot');
const bootMessage = document.getElementById('boot-msg');
let bootFailed = false;
bootMessage.textContent = i18n.t('boot.compiling');

function fail(message) {
  bootFailed = true;
  bootOverlay.classList.remove('done');
  bootMessage.textContent = message;
}

async function start() {
  const canvas = document.getElementById('view');

  // ------------------------------------------------------------------
  // Renderer + HDR post-processing chain
  // ------------------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,               // silhouettes are anti-aliased analytically
    powerPreference: 'high-performance',
    // The scene is drawn into the composer's targets; the canvas only ever
    // receives the final full-screen pass. An opaque canvas without depth is
    // cheaper to clear and cheaper for the browser to composite.
    alpha: false,
    depth: false,
    stencil: false,
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = EXPOSURE;
  renderer.setClearColor(0x000000, 1);

  // The scene and every cache are floating-point targets.
  const gl = renderer.getContext();
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
    fail(i18n.t('boot.floatTargets'));
    return;
  }
  const quality = pickQuality(renderer.capabilities.maxCubemapSize);

  renderer.debug.onShaderError = (gl, program, vs, fs) => {
    const log = [gl.getProgramInfoLog(program), gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs)]
      .filter(Boolean)
      .join('\n');
    console.error(`Shader compilation failed:\n${log}`);
    fail(`${i18n.t('boot.shaderFailed')}\n${log}`);
  };

  const uniforms = createUniforms();
  const state = new PlanetState(uniforms);
  const baker = createBaker(renderer, uniforms, quality);
  const world = createWorld(uniforms);

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);
  const rig = new CameraRig(camera, canvas);

  // Scene is rendered into a half-float target (linear HDR), bloomed, then
  // tone mapped (ACES) and converted to sRGB by OutputPass.
  const hdrTarget = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
  const composer = new EffectComposer(renderer, hdrTarget);
  composer.addPass(new RenderPass(world.scene, camera));
  // Tight threshold: only the sun, the lit limb, lava and city lights bloom.
  const bloom = new UnrealBloomPass(new THREE.Vector2(4, 4), 0.35, 0.4, 0.85);
  // The glow is low-frequency by nature: build its blur pyramid from half
  // resolution, which halves the cost of the pass.
  const setBloomSize = bloom.setSize.bind(bloom);
  bloom.setSize = (width, height) => setBloomSize(Math.ceil(width / 2), Math.ceil(height / 2));
  roundBloomKernels(bloom);
  composer.addPass(bloom);
  const output = new OutputPass();
  composer.addPass(output);
  mergeBloomIntoOutput(bloom, output);

  let renderScale = 1.0;      // chosen by the user (upper bound)
  let autoScale = 1.0;        // chosen by the governor to hold the frame rate
  let viewWidth = 1;
  let viewHeight = 1;

  // ------------------------------------------------------------------
  // Framing: keep the planet inside the part of the screen the interface
  // leaves free
  // ------------------------------------------------------------------
  // The stylesheet knows the layout, so it stretches an invisible element,
  // #frame, over the free area (between the panels on a desktop, above the
  // sheet on a phone...). Two things follow that rectangle:
  //   - the picture is shifted so that the planet sits in its centre. This is
  //     a lens shift (a view offset), not a turn of the camera: the camera
  //     keeps looking straight at the planet, so the disc stays a circle;
  //   - the field of view opens up until the field the scene was composed for
  //     fits the rectangle, in height and in width.
  const FIELD = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
  const frameNode = document.getElementById('frame');
  const framing = {
    x: 0, y: 0, span: 1,            // shown now: centre offset and field height, CSS px
    toX: 0, toY: 0, toSpan: 1,      // where the layout wants them
    snap: true,
  };
  function measureFraming() {
    const rect = frameNode.getBoundingClientRect();
    const width = Math.max(rect.width, 1);
    const height = Math.max(rect.height, 1);
    framing.toX = rect.left + rect.width / 2 - viewWidth / 2;
    framing.toY = rect.top + rect.height / 2 - viewHeight / 2;
    // Never open the lens beyond ~100 degrees, however little room is left.
    framing.toSpan = Math.max(Math.min(height, width * FIELD_ASPECT), viewHeight * 0.3);
  }
  function applyFraming() {
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan((FIELD * viewHeight) / framing.span));
    camera.aspect = viewWidth / viewHeight;
    camera.setViewOffset(viewWidth, viewHeight, -framing.x, -framing.y, viewWidth, viewHeight);
  }
  function updateFraming(dt) {
    const dx = framing.toX - framing.x;
    const dy = framing.toY - framing.y;
    const ds = framing.toSpan - framing.span;
    if (!framing.snap && dx === 0 && dy === 0 && ds === 0) return;
    if (framing.snap || (Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25 && Math.abs(ds) < 0.25)) {
      framing.x = framing.toX;
      framing.y = framing.toY;
      framing.span = framing.toSpan;
      framing.snap = false;
    } else {
      // Glide after the sheet as it opens and closes.
      const k = 1 - Math.exp(-dt * 10);
      framing.x += dx * k;
      framing.y += dy * k;
      framing.span += ds * k;
    }
    applyFraming();
  }

  function resize() {
    viewWidth = Math.max(canvas.clientWidth || window.innerWidth, 1);
    viewHeight = Math.max(canvas.clientHeight || window.innerHeight, 1);
    const pixelRatio = Math.min(window.devicePixelRatio || 1, quality.pixelRatio) * renderScale * autoScale;
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(viewWidth, viewHeight, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(viewWidth, viewHeight);
    // A new window size is not animated: the picture is simply laid out again.
    measureFraming();
    framing.snap = true;
    updateFraming(0);
  }
  window.addEventListener('resize', resize);
  // Catches what a resize event does not: a rotated phone settling, the
  // browser's bars sliding away, a sheet opening.
  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(() => {
      if (canvas.clientWidth !== viewWidth || canvas.clientHeight !== viewHeight) resize();
      else measureFraming();
    });
    observer.observe(canvas);
    observer.observe(frameNode);
  }

  // ------------------------------------------------------------------
  // Camera viewpoints (defined relative to the sun and the ring plane)
  // ------------------------------------------------------------------
  const UP = new THREE.Vector3(0, 1, 0);
  function cameraPose(id) {
    const sun = state.sunDir.clone();
    const side = new THREE.Vector3().crossVectors(UP, sun).normalize();
    const dir = new THREE.Vector3();
    switch (id) {
      case 'terminator':
        dir.addScaledVector(side, 1.0).addScaledVector(sun, 0.1).addScaledVector(UP, 0.2);
        return { dir: dir.normalize(), dist: 1.85 };
      case 'night':
        dir.addScaledVector(sun, -0.92).addScaledVector(side, 0.36).addScaledVector(UP, 0.14);
        return { dir: dir.normalize(), dist: 2.7 };
      case 'ring': {
        // Just above the ring plane, looking across the lit face.
        const n = state.ringNormal;
        const inPlane = sun.clone().addScaledVector(n, -sun.dot(n)).normalize();
        inPlane.applyAxisAngle(n, THREE.MathUtils.degToRad(58));
        dir.copy(inPlane).addScaledVector(n, 0.09 * Math.sign(sun.dot(n) || 1));
        return { dir: dir.normalize(), dist: 4.6 };
      }
      case 'overview':
      default:
        dir.addScaledVector(sun, 0.78).addScaledVector(side, 0.58).addScaledVector(UP, 0.26);
        return { dir: dir.normalize(), dist: 3.6 };
    }
  }

  // ------------------------------------------------------------------
  // Transitions: a short exposure dip hides hard changes (seed, archetype)
  // ------------------------------------------------------------------
  // The world is re-synthesised into its caches while the screen is dark.
  let dip = null;
  let worldDirty = false;
  // A lost GPU context takes the caches with it; synthesise them again once
  // the browser hands the context back.
  let cachesLost = false;
  canvas.addEventListener('webglcontextrestored', () => { cachesLost = true; });
  function dipTransition(action, duration) {
    // A change requested mid-transition picks up at the same brightness.
    const t = dip ? (dip.fired ? 1 - Math.min(dip.t, 1) : dip.t) : 0;
    dip = { t, duration, action, fired: false, held: 0 };
  }

  // ------------------------------------------------------------------
  // Resolution governor: trades pixels for frame rate on slow GPUs and
  // gives them back when there is headroom.
  // ------------------------------------------------------------------
  // It aims at the refresh rate of the display, whatever that is (60, 120,
  // 144 Hz...), and prefers to judge the load by the GPU time of the frame,
  // which a timer query reports exactly. Frame intervals are only the
  // fallback: they also grow when the browser throttles a window nobody is
  // looking at, which says nothing about the GPU.
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const gpu = { active: null, pending: [], sum: 0, count: 0, ms: 0 };
  canvas.addEventListener('webglcontextlost', () => {
    gpu.active = null;
    gpu.pending.length = 0;
  });
  function gpuBegin() {
    if (!timerExt || gpu.active || gpu.pending.length >= 4) return;
    gpu.active = gl.createQuery();
    gl.beginQuery(timerExt.TIME_ELAPSED_EXT, gpu.active);
  }
  function gpuEnd() {
    if (!gpu.active) return;
    gl.endQuery(timerExt.TIME_ELAPSED_EXT);
    gpu.pending.push(gpu.active);
    gpu.active = null;
  }
  function gpuCollect() {
    while (gpu.pending.length > 0) {
      const query = gpu.pending[0];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      if (!gl.getParameter(timerExt.GPU_DISJOINT_EXT)) {
        gpu.sum += gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6;
        gpu.count++;
      }
      gl.deleteQuery(query);
      gpu.pending.shift();
    }
  }

  const governor = {
    locked: false,            // debugging: freeze the automatic scale
    time: 0,
    intervals: [],
    refresh: 1 / 60,          // estimated refresh interval of the display
    slowerFor: 0,
    halfRate: false,          // on fast displays a weak GPU aims at every other refresh
    over: 0,
    under: 0,
    patience: 4,
    sinceRaise: 99,
  };
  function setAutoScale(scale) {
    scale = THREE.MathUtils.clamp(scale, MIN_AUTO_SCALE, 1);
    if (Math.abs(scale - autoScale) < 0.001) return;
    if (scale > autoScale) governor.sinceRaise = 0;
    autoScale = scale;
    resize();
  }
  function govern(dt) {
    gpuCollect();
    // Ignore frames that say nothing about the GPU: the tab in the background,
    // bakes, and pauses of a second or more (the page was frozen or stopped
    // in a debugger). Slow frames short of that are exactly what this is for.
    if (dt >= 1 || dt <= 0 || document.hidden || dip) return;
    governor.time += dt;
    governor.intervals.push(dt);
    if (governor.time < 0.5) return;

    // --- display refresh: the short end of the frame intervals ---
    const sorted = governor.intervals.sort((a, b) => a - b);
    const frameTime = governor.time / sorted.length;
    let seen = sorted[Math.floor(sorted.length * 0.1)];
    const snapped = REFRESH_RATES.find((rate) => Math.abs(seen * rate - 1) < 0.06);
    if (snapped) seen = 1 / snapped;
    governor.time = 0;
    governor.intervals = [];
    if (seen < governor.refresh * 0.97) {
      governor.refresh = seen;
      governor.slowerFor = 0;
    } else if (seen > governor.refresh * 1.03 && seen < 1 / 28 && timerExt && ++governor.slowerFor >= 20) {
      // A slower display for ten seconds running: the window moved screens.
      // (No display refreshes below 30 Hz: slower frames are the GPU's own.)
      governor.refresh = seen;
      governor.slowerFor = 0;
    } else if (seen <= governor.refresh * 1.03) {
      governor.slowerFor = 0;
    }

    if (timerExt && gpu.count >= 6) {
      gpu.ms = gpu.sum / gpu.count;
      gpu.sum = 0;
      gpu.count = 0;
    } else if (timerExt) {
      return;
    }
    if (governor.locked) return;
    governor.sinceRaise++;

    // --- how far is the frame from its budget? ---
    // "ideal" is the scale that would just fit, assuming cost ~ pixel count.
    let ideal;
    if (timerExt) {
      // Frames arriving slowly while the GPU sits idle between them: the
      // browser is throttling the window (or the CPU is busy). Fewer pixels
      // would not help, and an idling GPU clocks down, which inflates its times.
      const idle = gpu.ms < frameTime * 1000 * 0.5 && frameTime > governor.refresh * (governor.halfRate ? 3.2 : 1.6);
      if (idle) return;
      const budget = governor.refresh * 1000 * GPU_SHARE;
      const costAtFull = gpu.ms / (autoScale * autoScale);
      ideal = Math.sqrt(budget / costAtFull);
      // Above ~100 Hz a slow GPU is better off holding half the refresh rate
      // at a decent resolution than chasing every refresh at a blurry one.
      if (governor.refresh < 1 / 100) {
        if (ideal < 0.7) governor.halfRate = true;
        else if (ideal > 0.82) governor.halfRate = false;
        if (governor.halfRate) ideal = Math.sqrt((2 * budget) / costAtFull);
      } else {
        governor.halfRate = false;
      }
    } else {
      // No timer (Safari, most phones): judge by the frame interval, and only
      // while the window has the user's attention (an unfocused window may
      // simply be throttled). Cost is taken to follow the pixel count, as
      // above, so a heavy overload is answered in one step instead of many
      // small ones; the interval is rounded up to whole refreshes, which makes
      // the estimate err towards fewer pixels, and the raise path corrects it.
      // The median interval: one hitch (garbage collection, a cloud snapshot
      // swap) must not read as a slow GPU.
      const target = governor.refresh > 1 / 100 ? governor.refresh : governor.refresh * 2;
      const load = sorted[Math.floor(sorted.length / 2)] / target;
      if (load > 1.2 && !document.hasFocus()) return;
      // With headroom, probe one step up (at least +0.1, so that the raise
      // below, which wants more than +0.07, also happens from low scales).
      ideal = load > 1.2 ? autoScale * Math.min(Math.sqrt(1.05 / load), 0.88)
        : load < 1.06 ? Math.max(autoScale * 1.15, autoScale + 0.1) : autoScale;
    }

    if (ideal < autoScale - 0.01) {
      governor.under = 0;
      // One window is enough when the frame is far over budget (under ~2/3 of
      // the target rate); a mild overload has to show up twice in a row.
      const severe = ideal < autoScale * 0.8;
      if (++governor.over >= (severe ? 1 : 2)) {
        // Dropping right after a raise means the raise was a mistake: wait longer next time.
        if (governor.sinceRaise <= 6) governor.patience = Math.min(governor.patience * 2, 64);
        governor.over = 0;
        setAutoScale(Math.max(Math.floor(ideal * 20) / 20, autoScale * 0.75));
      }
    } else if (ideal > autoScale + 0.07 && autoScale < 1) {
      governor.over = 0;
      if (++governor.under >= governor.patience) {
        governor.under = 0;
        setAutoScale(Math.min(Math.floor(ideal * 20) / 20, autoScale + 0.15));
      }
    } else {
      governor.over = 0;
      governor.under = 0;
    }
  }

  // ------------------------------------------------------------------
  // HUD wiring
  // ------------------------------------------------------------------
  // The archetype and seed the user chose. The state takes them over only
  // in the dark of a transition; the link must not wait for that.
  let presetIndex = 0;
  let worldSeed = PRESETS[0].seed;
  let tours = null;                 // the tour player (created with the cards, below)
  let capture = null;               // the snapshot (created with the cards, below)
  let expedition = null;            // the photo expedition (created with the cards, below)
  /** A mission of the photo expedition holds the world: say so instead of changing it. */
  const worldHeld = () => {
    if (!expedition || !expedition.fixedWorld) return false;
    cards.toast('toast.worldHeld');
    return true;
  };
  // The address follows the screen (see link.js); every change calls touch().
  const link = createLinkWriter(describeView);
  const LINK_AFTER_FLIGHT = 2300;   // ms: a camera flight lasts 2 s
  const LINK_AFTER_DRAG = 1500;     // ms: the controls glide on after release

  const hud = createHud({
    presets: PRESETS,
    cameras: CAMERAS,
    i18n,
    on: {
      preset(index) {
        if (worldHeld()) return;
        if (tours.active) tours.abandon();
        const preset = PRESETS[index];
        presetIndex = index;
        worldSeed = preset.seed;
        hud.setPreset(index);
        hud.syncSliders(preset.sliders);
        hud.setRings(preset.rings);
        hud.setSeed(preset.seed);
        dipTransition(() => {
          state.applyPreset(preset);
          state.snap();
        }, 0.55);
        link.touch();
      },
      camera(id) {
        // (A mission that holds its world keeps its rings off: the camera just flies.)
        if (id === 'ring' && state.get('ringsOn') < 0.5 && !(expedition && expedition.fixedWorld)) {
          state.set('ringsOn', 1);
          hud.setRings(true);
          hud.setModified(true);
        }
        const pose = cameraPose(id);
        rig.flyTo(pose.dir, pose.dist);
        link.touch(LINK_AFTER_FLIGHT);
      },
      param(key, value) {
        if (key === 'renderScale') {
          renderScale = value;
          resize();
          return;
        }
        state.set(key, value);
        if (key === 'sunAngle') tourSun = null;     // the user takes the sun over
        if (key !== 'sunAngle' && key !== 'rotSpeed') hud.setModified(true);
        link.touch();
      },
      rings(enabled) {
        if (worldHeld()) return;
        state.set('ringsOn', enabled ? 1 : 0);
        hud.setRings(enabled);
        hud.setModified(true);
        link.touch();
      },
      seed(text) {
        reseed(parseSeed(text));
      },
      randomize() {
        reseed(Math.floor(Math.random() * 1000000));
      },
      // A sheet opened or closed, or the interface was hidden.
      layout: measureFraming,
      capture() {
        if (expedition && expedition.active) expedition.shoot();
        else if (capture) capture.take();
      },
      caption(enabled) {
        capture.caption = enabled;
        hud.setCaption(enabled);
      },
    },
  });

  function reseed(seed) {
    if (worldHeld()) {
      hud.setSeed(worldSeed);
      return;
    }
    if (tours.active) tours.abandon();
    worldSeed = seed;
    hud.setSeed(seed);
    hud.setModified(true);
    dipTransition(() => state.setSeed(seed), 0.36);
    link.touch();
  }
  rig.controls.addEventListener('end', () => link.touch(LINK_AFTER_DRAG));

  // ------------------------------------------------------------------
  // The world in the address (link.js)
  // ------------------------------------------------------------------
  /** What the address says: the tour step or the mission, else the world. */
  function describeView() {
    if (tours && tours.active) return { tour: tours.position };
    if (expedition && expedition.active) return { mission: expedition.position };
    return worldView();
  }
  function worldView() {
    const sliders = {};
    for (const key of SLIDER_KEYS) sliders[key] = state.get(key);
    const view = rig.destination;
    return {
      preset: PRESETS[presetIndex],
      seed: worldSeed,
      sliders,
      rings: state.get('ringsOn') > 0.5,
      sunAngle: state.get('sunAngle'),
      rotSpeed: state.get('rotSpeed'),
      camera: { dir: view.dir.toArray(), dist: view.dist },
      spin: world.planet.rotation.y,
      // A marker set by a tour is the tour's, not the user's.
      marker: marker.dir && !marker.quiet ? latLonOf(marker.dir) : null,
    };
  }

  /** Put a decoded link on screen: at once (start-up) or behind a dip. */
  function applyView(view, instant) {
    presetIndex = PRESETS.indexOf(view.preset);
    worldSeed = view.seed;
    hud.setPreset(presetIndex);
    hud.syncSliders({ ...view.sliders, sunAngle: view.sunAngle, rotSpeed: view.rotSpeed });
    hud.setRings(view.rings);
    hud.setSeed(view.seed);
    hud.setModified(isModified(view));
    const apply = () => {
      state.applyPreset(view.preset);
      for (const key of SLIDER_KEYS) state.set(key, view.sliders[key]);
      state.set('ringsOn', view.rings ? 1 : 0);
      state.set('sunAngle', view.sunAngle);
      state.set('rotSpeed', view.rotSpeed);
      state.setSeed(view.seed);
      state.snap();
      state.update(0);                       // sun direction for the default pose
      if (view.spin !== undefined) {
        world.planet.rotation.y = view.spin;
        world.clouds.rotation.y = view.spin;
      }
      rig.cancel();
      const pose = view.camera
        ? { dir: new THREE.Vector3().fromArray(view.camera.dir), dist: view.camera.dist }
        : cameraPose('overview');
      rig.jumpTo(pose.dir, pose.dist);
      if (view.marker) setMarker(dirOfLatLon(view.marker));
      else clearMarker();
      // Write the address back as this tab now sees it (fills in what the link left out).
      link.touch();
    };
    if (instant) apply();
    else dipTransition(apply, 0.55);
  }

  // A link opened in this tab (pasted into the address, or Back / Forward).
  window.addEventListener('hashchange', () => {
    if (window.location.hash === link.current) return;
    const view = decodeView(window.location.hash, PRESETS);
    if (!view) return;
    if (view.tour) {
      tours.start(view.tour.id, view.tour.step);
      return;
    }
    if (view.mission) {
      expedition.start(view.mission);
      return;
    }
    if (tours.active) tours.abandon();
    if (expedition.active) expedition.abandon();
    applyView(view, false);
  });

  // ------------------------------------------------------------------
  // Share
  // ------------------------------------------------------------------
  const cards = createCards(i18n);
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      // Refused (no permission, no focus): try the old way.
    }
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(area);
      area.select();
      const done = document.execCommand('copy');
      area.remove();
      return done;
    } catch (error) {
      return false;
    }
  }
  async function share() {
    const url = link.flush();
    // A phone has a system share sheet; a desktop is better served by the clipboard.
    if (window.matchMedia('(pointer: coarse)').matches && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: i18n.t(`preset.${PRESETS[presetIndex].id}.name`), url });
        return;
      } catch (error) {
        if (error && error.name === 'AbortError') return;   // the user closed the sheet
      }
    }
    cards.toast((await copyText(url)) ? 'toast.copied' : 'toast.copyFailed');
  }
  document.getElementById('share').addEventListener('click', share);
  document.getElementById('share-top').addEventListener('click', share);

  // ------------------------------------------------------------------
  // Snapshot: the frame as a picture (capture.js)
  // ------------------------------------------------------------------
  capture = createCapture({
    i18n,
    cards,
    host: {
      renderStill: (pixelRatio, copy) => renderStill(pixelRatio, copy),
      viewSize: () => ({ width: viewWidth, height: viewHeight }),
      maxSide: Math.min(
        quality.still,
        renderer.capabilities.maxTextureSize,
        gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
        ...gl.getParameter(gl.MAX_VIEWPORT_DIMS),
      ),
      ready: () => !dip && !baker.busy,
      info: () => {
        const view = worldView();
        return {
          presetId: view.preset.id,
          name: i18n.t(`preset.${view.preset.id}.name`),
          seed: view.seed,
          custom: isModified(view),
        };
      },
    },
  });
  hud.setCaption(capture.caption);
  document.getElementById('capture-top').addEventListener('click', () => {
    if (expedition && expedition.active) expedition.shoot();
    else capture.take();
  });

  // ------------------------------------------------------------------
  // Probe: tap the planet, read the ground there (probe.js, survey.js)
  // ------------------------------------------------------------------
  const probe = createProbe(renderer, uniforms);
  const PROBE_INTERVAL = 0.3;       // s between readings while a marker is set
  const TAP_SLOP = 6;               // px a tap may wander
  const TAP_TIME = 300;             // ms a tap may last
  const marker = {
    dir: null,                      // planet space, unit length
    quiet: false,                   // set by a tour: no probe card
    sample: null,
    clock: 0,
    node: document.getElementById('marker'),
    world: new THREE.Vector3(),
    screen: new THREE.Vector3(),
    toCamera: new THREE.Vector3(),
  };
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const unitSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  const hit = new THREE.Vector3();

  function latLonOf(dir) {
    return {
      lat: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1))),
      lon: THREE.MathUtils.radToDeg(Math.atan2(-dir.z, dir.x)),
    };
  }
  function dirOfLatLon({ lat, lon }) {
    const phi = THREE.MathUtils.degToRad(lat);
    const lambda = THREE.MathUtils.degToRad(lon);
    return new THREE.Vector3(Math.cos(phi) * Math.cos(lambda), Math.sin(phi), -Math.cos(phi) * Math.sin(lambda));
  }

  function worldInfo() {
    const preset = PRESETS[presetIndex];
    let sunElevation = 0;
    if (marker.dir) {
      marker.world.copy(marker.dir).applyQuaternion(world.planet.quaternion);
      sunElevation = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(marker.world.dot(state.sunDir), -1, 1)));
    }
    return {
      survey: preset.survey,
      presetIce: preset.sliders.ice,
      presetCity: preset.sliders.cityLights,
      ice: state.cur.ice,
      // Where the sliders are headed ("what if" starts from there, not from mid-glide).
      target: { seaLevel: state.get('seaLevel'), ice: state.get('ice'), cityLights: state.get('cityLights') },
      seaLevel: uniforms.uSeaLevel.value,
      biomeDatum: uniforms.uBiomeDatum.value,
      lavaSea: state.cur.liquidEmissive > 0.3,
      veinEmissive: state.cur.veinEmissive,
      veinMix: state.cur.veinMix,
      cityLights: state.cur.cityLights,
      sunElevation,
    };
  }
  function cardContent() {
    if (!marker.sample) return null;
    const info = worldInfo();
    const sample = {
      ...marker.sample,
      landH: marker.sample.h0 - info.seaLevel,
      bioH: marker.sample.h0 - info.biomeDatum,
    };
    const point = describePoint(sample, info, i18n);
    const { t } = i18n;
    const actions = [];
    if (point.whatIf) {
      const { key, value } = point.whatIf;
      actions.push({ label: t('probe.try'), primary: true, run: () => trySlider(key, value) });
    }
    // Probed in the middle of a tour: the way back to it.
    if (tours && tours.active) actions.push({ label: t('tour.resume'), run: () => tours.resume() });
    if (expedition && expedition.active) actions.push({ label: t('expedition.backToMission'), run: () => expedition.resume() });
    return {
      ...point,
      why: { label: t('probe.why'), text: point.why },
      hint: point.whatIf ? { label: t('probe.whatIf'), text: point.whatIf.text } : null,
      actions,
    };
  }
  /** "What if": move one slider, as if the user had dragged it. */
  function trySlider(key, value) {
    state.set(key, value);
    hud.syncSliders({ [key]: value });
    hud.setModified(true);
    link.touch(LINK_AFTER_DRAG);
    marker.clock = PROBE_INTERVAL;
  }

  function readGround() {
    if (!marker.dir) return;
    marker.clock = 0;
    const dir = marker.dir;
    probe.sample(dir).then((sample) => {
      // Dropped for a newer request, or the marker moved / went away meanwhile.
      if (!sample || marker.dir !== dir) return;
      marker.sample = sample;
      // A tour's marker only points; the tour card says what is there.
      if (!marker.quiet) cards.show(cardContent, { onClose: closeProbeCard });
    });
  }
  function closeProbeCard() {
    clearMarker();
    if (tours.active) tours.resume();
    else if (expedition.active) expedition.resume();
  }
  /** quiet: set by a tour, it shows a spot without opening the probe card. */
  function setMarker(dir, quiet = false) {
    marker.dir = dir.normalize();
    marker.quiet = quiet;
    marker.sample = null;
    marker.node.hidden = false;
    // Read on the next frame that may (see updateMarker): not from half-built caches.
    marker.clock = PROBE_INTERVAL;
  }
  /** Take the marker away; its probe card goes with it unless keepCard. */
  function clearMarker(keepCard = false) {
    if (!marker.dir) return;
    const quiet = marker.quiet;
    marker.dir = null;
    marker.quiet = false;
    marker.sample = null;
    marker.node.hidden = true;
    if (!quiet && keepCard !== true) cards.hide();
    link.touch();
  }

  function probeAt(clientX, clientY) {
    pointerNdc.set((clientX / viewWidth) * 2 - 1, -(clientY / viewHeight) * 2 + 1);
    // The projection carries the view offset, so the ray follows the framing.
    raycaster.setFromCamera(pointerNdc, camera);
    if (!raycaster.ray.intersectSphere(unitSphere, hit)) {
      clearMarker();
      return;
    }
    setMarker(world.planet.worldToLocal(hit.clone()));
    link.touch();
  }

  // A short tap that does not move: a drag turns the camera instead, and a
  // second finger means a pinch.
  const tap = { id: null, x: 0, y: 0, time: 0, spoilt: false };
  canvas.addEventListener('pointerdown', (event) => {
    if (tap.id !== null) {
      tap.spoilt = true;
      return;
    }
    if (event.button !== 0) return;
    Object.assign(tap, { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), spoilt: false });
  });
  canvas.addEventListener('pointermove', (event) => {
    if (event.pointerId === tap.id && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_SLOP) tap.spoilt = true;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.pointerId !== tap.id) return;
    const isTap = !tap.spoilt && performance.now() - tap.time < TAP_TIME
      && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) <= TAP_SLOP;
    tap.id = null;
    if (isTap) probeAt(event.clientX, event.clientY);
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (event.pointerId === tap.id) tap.id = null;
  });

  /** Keep the reticle on its spot of ground, and the reading fresh. */
  function updateMarker(dt) {
    if (!marker.dir) return;
    world.planet.updateMatrixWorld();
    marker.world.copy(marker.dir).applyMatrix4(world.planet.matrixWorld);
    marker.toCamera.copy(camera.position).sub(marker.world).normalize();
    // Fades out towards the limb and is gone on the far side.
    const facing = THREE.MathUtils.smoothstep(marker.world.dot(marker.toCamera), 0.04, 0.2);
    marker.screen.copy(marker.world).project(camera);
    const x = (marker.screen.x * 0.5 + 0.5) * viewWidth;
    const y = (0.5 - marker.screen.y * 0.5) * viewHeight;
    marker.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    marker.node.style.opacity = facing.toFixed(2);
    // New readings while the ground turns into night or the sliders move;
    // not while the caches are being rebuilt or the screen is dark.
    marker.clock += dt;
    if (marker.clock >= PROBE_INTERVAL && !baker.busy && !dip) readGround();
  }

  // ------------------------------------------------------------------
  // Guided tours (tours.js: the routes, tour.js: the player)
  // ------------------------------------------------------------------
  const TOUR_FLIGHT = 2.4;          // s: camera and sun move together
  let tourSun = null;               // { from, to, t }: the sun gliding to a step's hour

  /** Put step "index" of a tour on screen: its world, its light, its view. */
  function stageTour(tour, index, instant) {
    const step = tour.steps[index];
    const preset = PRESETS.find((p) => p.id === (step.preset || tour.preset)) || PRESETS[0];
    const seed = step.seed ?? tour.seed ?? preset.seed;
    const sliders = { ...preset.sliders, ...tour.sliders, ...step.sliders };
    const rings = step.rings ?? tour.rings ?? preset.rings;
    const nextIndex = PRESETS.indexOf(preset);
    const newWorld = nextIndex !== presetIndex || seed !== worldSeed;
    presetIndex = nextIndex;
    worldSeed = seed;
    hud.setPreset(nextIndex);
    hud.syncSliders(sliders);
    hud.setRings(rings);
    hud.setSeed(seed);
    hud.setModified(isModified({ preset, seed, sliders, rings }));
    const apply = () => {
      if (newWorld) {
        state.applyPreset(preset);
        state.setSeed(seed);
      }
      for (const key of SLIDER_KEYS) state.set(key, sliders[key]);
      state.set('ringsOn', rings ? 1 : 0);
      // The planet holds still during a tour: each step shows a chosen spot.
      state.set('rotSpeed', 0);
      state.cur.rotSpeed = 0;
      if (newWorld || instant) state.snap();
      aimTour(step, newWorld || instant);
    };
    if (newWorld && !instant) dipTransition(apply, 0.55);
    else apply();
  }

  function aimTour(step, jump) {
    const turn = world.planet.quaternion;
    const current = state.get('sunAngle');
    // The equivalent angle nearest the current one: the sun takes the short way round.
    const near = (deg) => current + THREE.MathUtils.euclideanModulo(deg - current + 180, 360) - 180;
    let sun;
    let dir;
    let dist;
    if (step.look) {
      const below = dirOfLatLon({ lat: 0, lon: step.look.lon + (step.sun || 0) }).applyQuaternion(turn);
      sun = near(THREE.MathUtils.radToDeg(Math.atan2(below.z, below.x)));
      dir = dirOfLatLon(step.look).applyQuaternion(turn);
      dist = step.look.dist;
    } else {
      sun = near(step.sunAngle ?? current);
      const az = THREE.MathUtils.degToRad(sun + step.orbit.az);
      const el = THREE.MathUtils.degToRad(step.orbit.el);
      dir = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
      dist = step.orbit.dist;
    }
    hud.syncSliders({ sunAngle: THREE.MathUtils.euclideanModulo(sun, 360), rotSpeed: 0 });
    if (jump) {
      tourSun = null;
      state.set('sunAngle', sun);
      state.cur.sunAngle = sun;
      rig.cancel();
      rig.jumpTo(dir, dist);
    } else {
      tourSun = { from: state.cur.sunAngle, to: sun, t: 0 };
      rig.flyTo(dir, dist, TOUR_FLIGHT);
    }
    if (step.mark) setMarker(dirOfLatLon(step.mark), true);
    else clearMarker(true);
  }

  function updateTourSun(dt) {
    if (!tourSun) return;
    tourSun.t = Math.min(tourSun.t + dt / TOUR_FLIGHT, 1);
    const k = THREE.MathUtils.smootherstep(tourSun.t, 0, 1);
    state.set('sunAngle', tourSun.from + (tourSun.to - tourSun.from) * k);
    if (tourSun.t >= 1) tourSun = null;
  }

  /** A tour or a mission is over and its world stays: the sun back in range, the spin back on. */
  function settleGuided(saved) {
    tourSun = null;
    const sun = state.get('sunAngle');
    const inRange = THREE.MathUtils.euclideanModulo(sun, 360);
    state.cur.sunAngle += inRange - sun;
    state.set('sunAngle', inRange);
    const spin = saved ? saved.rotSpeed : state.get('rotSpeed');
    state.set('rotSpeed', spin);
    hud.syncSliders({ sunAngle: inRange, rotSpeed: spin });
    if (marker.quiet) clearMarker(true);
  }
  function restoreGuided(view) {
    tourSun = null;
    applyView(view, false);
  }

  tours = createTours({
    i18n,
    cards,
    host: {
      snapshot: worldView,
      restore: restoreGuided,
      stage: stageTour,
      settle: settleGuided,
      changed: () => link.touch(),
      sheetOff: () => hud.closeSheet(),
      leave: () => { if (expedition && expedition.active) expedition.abandon(); },
    },
  });

  // ------------------------------------------------------------------
  // Photo expedition (missions.js: the missions, expedition.js: the player)
  // ------------------------------------------------------------------
  /** Put a mission on screen: its world (if it has one), a still planet, its viewpoint. */
  function stageMission(mission, instant) {
    tourSun = null;
    if (marker.quiet) clearMarker(true);
    const holdStill = () => {
      state.set('rotSpeed', 0);
      state.cur.rotSpeed = 0;
      hud.syncSliders({ rotSpeed: 0 });
    };
    const aim = (jump) => {
      const pose = cameraPose(mission.camera);
      if (jump) {
        rig.cancel();
        rig.jumpTo(pose.dir, pose.dist);
      } else rig.flyTo(pose.dir, pose.dist, TOUR_FLIGHT);
    };
    const preset = mission.world && PRESETS.find((p) => p.id === mission.world);
    if (!preset) {
      holdStill();
      aim(instant);
      return;
    }
    const sliders = { ...preset.sliders };
    const rings = mission.rings ?? preset.rings;
    const nextIndex = PRESETS.indexOf(preset);
    const newWorld = nextIndex !== presetIndex || preset.seed !== worldSeed;
    presetIndex = nextIndex;
    worldSeed = preset.seed;
    hud.setPreset(nextIndex);
    hud.syncSliders(sliders);
    hud.setRings(rings);
    hud.setSeed(preset.seed);
    hud.setModified(isModified({ preset, seed: preset.seed, sliders, rings }));
    const apply = () => {
      if (newWorld) state.applyPreset(preset);
      for (const key of SLIDER_KEYS) state.set(key, sliders[key]);
      state.set('ringsOn', rings ? 1 : 0);
      holdStill();
      if (newWorld || instant) {
        state.snap();
        state.update(0);
      }
      aim(newWorld || instant);
    };
    if (newWorld && !instant) dipTransition(apply, 0.55);
    else apply();
  }

  /** The geometry of the picture being taken (judge.js, "shot"): call while the still's camera is set. */
  function shotFacts() {
    world.clouds.updateMatrixWorld();
    camera.updateMatrixWorld();
    return {
      camera: {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        fovY: THREE.MathUtils.degToRad(camera.fov),
        aspect: camera.aspect,
      },
      sun: state.sunDir.clone(),
      planetQuat: world.planet.quaternion.clone(),
      ring: {
        on: state.cur.ringsOn > 0.5,
        normal: state.ringNormal.clone(),
        inner: state.cur.ringInner,
        outer: state.cur.ringOuter,
      },
      storms: state.storms.map((storm) => storm.dir.clone().applyQuaternion(world.clouds.quaternion)),
      cloudCover: state.cur.cloudCover,
      cloudRadius: uniforms.uCloudRadius.value,
      world: {
        lavaSea: state.cur.liquidEmissive > 0.3,
        veinEmissive: state.cur.veinEmissive,
        veinMix: state.cur.veinMix,
        cityLights: state.cur.cityLights,
        seaLevel: uniforms.uSeaLevel.value,
        dry: false,
      },
    };
  }

  expedition = createExpedition({
    i18n,
    cards,
    capture,
    host: {
      snapshot: worldView,
      restore: restoreGuided,
      settle: settleGuided,
      stage: stageMission,
      shot: shotFacts,
      // The probe reads up to MAX_POINTS at once: the judge's grid goes in batches.
      async sample(dirs) {
        const readings = [];
        for (let i = 0; i < dirs.length; i += MAX_POINTS) {
          const part = await probe.sampleMany(dirs.slice(i, i + MAX_POINTS));
          if (!part) return null;
          readings.push(...part);
        }
        return readings;
      },
      worldLink: () => encodeView(worldView()),
      openLink(hash) {
        const view = decodeView(hash, PRESETS);
        if (view) applyView(view, false);
      },
      lock: (spec) => hud.lock(spec),
      leaveTour: () => { if (tours.active) tours.abandon(); },
      changed: () => link.touch(),
      sheetOff: () => hud.closeSheet(),
    },
  });

  // Compile the shaders before the first bake and the first frame, and wait
  // for them without blocking the page (see precompile below).
  await precompile(renderer, hdrTarget, camera, [
    world.scene,
    baker.compileScene(),
    probe.compileScene(),
    passScene([bloom.materialHighPassFilter, ...bloom.separableBlurMaterials, bloom.compositeMaterial]),
  ]);

  // Initial world: the one in the address, else the first archetype.
  resize();
  const linked = decodeView(window.location.hash, PRESETS);
  const linkedWorld = linked && !linked.tour && !linked.mission ? linked : null;
  applyView(linkedWorld || {
    preset: PRESETS[0],
    seed: PRESETS[0].seed,
    sliders: { ...PRESETS[0].sliders },
    rings: PRESETS[0].rings,
    sunAngle: state.get('sunAngle'),
    rotSpeed: state.get('rotSpeed'),
  }, true);
  // A link to a tour step: the default world is "the user's", the tour starts on top.
  if (linked && linked.tour) tours.start(linked.tour.id, linked.tour.step, { instant: true });
  if (linked && linked.mission) expedition.start(linked.mission, { instant: true });
  hud.syncSliders({ renderScale });
  baker.bakeSky();
  baker.requestWorld(0);
  baker.step();
  // The address always describes the screen, from the first moment.
  link.touch();

  // ------------------------------------------------------------------
  // Frame loop
  // ------------------------------------------------------------------
  // Finite-difference step: a little over one texel of the terrain cache.
  const TERRAIN_STEP = (0.0024 * 1024) / quality.terrain;
  // Wavelengths of the micro-relief octaves (must match the surface shader).
  const DETAIL_WAVELENGTHS = [0, 1, 2].map((i) => 1 / (200 * Math.pow(2.03, i)));
  let last = performance.now();
  let time = 0;
  let frames = 0;
  let statClock = 0;
  let firstFrame = true;

  /**
   * Level of detail from the size of one pixel on the ground below the
   * camera. The terrain cache covers the view from orbit; as the camera
   * closes in, micro-relief octaves fade in once each is a few pixels wide.
   * Returns how many octaves are on (for the telemetry).
   */
  function updateDetail() {
    const dist = camera.position.length();
    const tanHalfFov = (FIELD * viewHeight) / framing.span;   // the live field of view
    const pixel = (2 * tanHalfFov * (dist - 1)) / renderer.domElement.height;
    uniforms.uEps.value = Math.max(TERRAIN_STEP, pixel * 1.2);
    let detailOctaves = 0;
    DETAIL_WAVELENGTHS.forEach((wavelength, i) => {
      const weight = THREE.MathUtils.smoothstep(wavelength / pixel, 2.5, 5.0);
      uniforms.uDetail.value.setComponent(i, weight);
      detailOctaves += weight;
    });
    uniforms.uCloudDetail.value = 1 - THREE.MathUtils.smoothstep(pixel, 0.0006, 0.0016);
    return detailOctaves;
  }

  /**
   * One still frame for the snapshot (capture.js): drawn at "pixelRatio",
   * with the planet in the middle of the whole canvas (the interface is not
   * in the picture, so it need not leave room for it), handed to copy() while
   * it is still on the canvas, then everything is put back as it was.
   */
  function renderStill(pixelRatio, copy) {
    const saved = { x: framing.x, y: framing.y, span: framing.span };
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(viewWidth, viewHeight, false);
    composer.setPixelRatio(pixelRatio);
    composer.setSize(viewWidth, viewHeight);
    framing.x = 0;
    framing.y = 0;
    framing.span = Math.max(Math.min(viewHeight, viewWidth * FIELD_ASPECT), viewHeight * 0.3);
    applyFraming();
    updateDetail();
    try {
      composer.render(0);
      copy(renderer.domElement);
    } finally {
      Object.assign(framing, saved);
      resize();
      framing.snap = false;            // resize() would jump to the target: keep any glide going
      Object.assign(framing, saved);
      applyFraming();
      // The still took far longer than a frame: that says nothing about the steady load.
      last = performance.now();
      governor.time = 0;
      governor.intervals = [];
    }
  }

  function frame(now) {
    // The simulation never steps more than 0.1 s at once; the governor gets
    // the real interval, so that it also sees a device running below 10 fps.
    const interval = Math.max((now - last) / 1000, 0);
    const dt = Math.min(interval, 0.1);
    last = Math.max(last, now);
    time += dt;

    // Exposure dip around hard changes: fade out, swap the world in the
    // dark (holding until its caches are rebuilt), fade back in.
    let rendering = true;
    if (dip) {
      if (!dip.fired) {
        dip.t += dt / dip.duration;
        if (dip.t >= 0.5) {
          dip.t = 0.5;
          dip.action();
          dip.fired = true;
          worldDirty = true;
        }
      } else if (baker.busy) {
        // The frame that fired has already painted black; spend the following
        // ones on the bake instead of on a picture nobody can see.
        if (dip.held++ > 0) {
          baker.step(BAKE_BUDGET);
          rendering = false;
        }
      } else {
        dip.t += dt / dip.duration;
      }
      const x = Math.min(dip.t, 1);
      renderer.toneMappingExposure = EXPOSURE * THREE.MathUtils.smoothstep(Math.abs(1 - 2 * x), 0, 1);
      if (dip.t >= 1) {
        renderer.toneMappingExposure = EXPOSURE;
        dip = null;
      }
    }

    updateTourSun(dt);
    state.update(dt);
    rig.update(dt);
    updateFraming(dt);
    uniforms.uTime.value = time;
    if (cachesLost) {
      cachesLost = false;
      baker.bakeSky();
      baker.requestWorld(time);
      baker.step();
    } else if (worldDirty) {
      worldDirty = false;
      baker.requestWorld(time);
    }
    if (!dip) gpuBegin();
    baker.updateClouds(time);
    hud.setStatus(baker.busy ? 'status.busy' : 'status.live');

    // Spin: the cloud deck drifts on its own, slightly faster than the ground.
    const spin = state.cur.rotSpeed * 0.25;
    world.planet.rotation.y += spin * dt;
    world.clouds.rotation.y += (spin * 1.08 + 0.006) * dt;
    world.clouds.updateMatrixWorld();
    uniforms.uCloudW2O.value.setFromMatrix4(world.clouds.matrixWorld).transpose();

    world.rings.quaternion.copy(state.ringQuat);
    world.rings.visible = state.cur.ringsOn > 0.003;
    world.clouds.visible = state.cur.cloudCover > 0.004;

    const dist = camera.position.length();
    const detailOctaves = updateDetail();

    if (rendering) composer.render(dt);
    gpuEnd();
    updateMarker(dt);
    // A frame that waited on a bake says nothing about the steady load.
    govern(rendering ? interval : 0);

    if (firstFrame) {
      firstFrame = false;
      if (!bootFailed) bootOverlay.classList.add('done');
    }

    // Telemetry at 4 Hz.
    frames++;
    statClock += dt;
    if (statClock >= 0.25) {
      const fps = frames / statClock;
      const phase = THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(
        camera.position.dot(state.sunDir) / dist, -1, 1)));
      hud.setTelemetry({
        fps: `${fps.toFixed(0).padStart(3, ' ')} ${i18n.t('unit.fps')}`,
        ms: `${i18n.number(1000 / fps, 1).padStart(5, ' ')} ${i18n.t('unit.ms')}`,
        gpu: gpu.ms > 0 ? `${i18n.number(gpu.ms, 1).padStart(5, ' ')} ${i18n.t('unit.ms')}` : '—',
        res: `${renderer.domElement.width} × ${renderer.domElement.height}`,
        quality: i18n.t(`quality.${quality.id}`),
        alt: `${i18n.number(dist - 1, 2)} ${i18n.t('unit.radius')}`,
        phase: `${phase.toFixed(0).padStart(3, '0')}°`,
        lod: i18n.t('value.lod', { n: i18n.number(detailOctaves, 1) }),
      });
      frames = 0;
      statClock = 0;
    }
  }
  function loop(now) {
    requestAnimationFrame(loop);
    frame(now);
  }
  requestAnimationFrame(loop);

  // Handle for poking at the scene from the console. advance(seconds) steps
  // the simulation by hand, which is handy for automated checks.
  let manualClock = 0;
  const advance = (seconds, step = 1 / 60) => {
    manualClock = Math.max(manualClock, last);
    for (let t = 0; t < seconds; t += step) frame((manualClock += step * 1000));
  };
  const perf = {
    gpu,
    governor,
    get autoScale() { return autoScale; },
    /** Freeze the automatic resolution at "scale" (pass nothing to release it). */
    lock(scale) {
      governor.locked = scale !== undefined;
      if (governor.locked) setAutoScale(scale);
    },
  };
  window.planetGenerator = {
    renderer, composer, camera, state, uniforms, world, rig, hud, baker, advance, perf, i18n, quality, framing,
    probe, cards, link, marker, probeAt, setMarker, describeView, tours, capture, renderStill, expedition, shotFacts,
  };
}

/**
 * Shader compilation ahead of use. Drawn cold, a material compiles its shader
 * there and then, and the page freezes until the driver is done: on a phone
 * the large planet and bake shaders can take seconds. compileAsync hands the
 * work to the browser first; where it supports KHR_parallel_shader_compile
 * the drivers compile in the background while the page keeps running, and
 * the promise settles once every program is ready. Elsewhere it settles at
 * once and the first draw compiles, as before.
 *
 * A program depends on the target it draws into (tone mapping and colour
 * space are only applied on screen), so it is compiled for a render target,
 * which is where the scene, the bakes and the bloom all draw.
 */
async function precompile(renderer, target, camera, scenes) {
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  // compileAsync creates the programs synchronously; only the wait is async.
  const ready = scenes.map((scene) => renderer.compileAsync(scene, camera));
  renderer.setRenderTarget(previous);
  await Promise.all(ready);
}

/** A scene holding one full-screen mesh per material (for precompile). */
function passScene(materials) {
  const scene = new THREE.Scene();
  const plane = new THREE.PlaneGeometry(2, 2);
  for (const material of materials) scene.add(new THREE.Mesh(plane, material));
  return scene;
}

/**
 * UnrealBloomPass blurs with a Gaussian of sigma = radius cut off at that same
 * radius, i.e. at one sigma: the weights hardly fall, so each pass is nearly a
 * box, and a box blurred across and then down is a square. On something as
 * bright as the sun the glow came out visibly square. A Gaussian is the one
 * separable kernel that is round, as long as it is not cut short: keep about
 * the same spread (sigma 0.6 radius) and run the taps out to 3.5 sigma.
 */
function roundBloomKernels(bloom) {
  for (const material of bloom.separableBlurMaterials || []) {
    const radius = material.defines && material.defines.KERNEL_RADIUS;
    const coefficients = material.uniforms && material.uniforms.gaussianCoefficients;
    if (!radius || !coefficients) continue;
    const sigma = 0.6 * radius;
    const taps = Math.ceil(3.5 * sigma) + 1;
    const weights = [];
    for (let i = 0; i < taps; i++) weights.push(Math.exp(-0.5 * (i * i) / (sigma * sigma)));
    material.defines.KERNEL_RADIUS = taps;
    coefficients.value = weights;  // the shader normalises by their sum
    material.needsUpdate = true;
  }
}

/**
 * UnrealBloomPass ends by adding its glow onto the scene with a full-screen
 * pass, and OutputPass then reads the sum in another one. This folds the two:
 * the bloom pass stops after building the glow, and the output pass samples
 * scene and glow together, tone maps the sum and dithers the 8-bit result (so
 * the night sky and the dark limb do not band). One full-resolution pass less.
 *
 * It patches the stock shader source, so it checks that every edit took and
 * otherwise leaves both passes exactly as they ship.
 */
function mergeBloomIntoOutput(bloom, output) {
  const glow = bloom.renderTargetsHorizontal && bloom.renderTargetsHorizontal[0];
  const source = output.material && output.material.fragmentShader;
  if (!glow || !bloom.blendMaterial || !bloom.fsQuad || typeof source !== 'string') return;

  const fetch = /gl_FragColor\s*=\s*texture2D\(\s*tDiffuse\s*,\s*vUv\s*\)\s*;/;
  const end = source.lastIndexOf('}');
  if (!fetch.test(source) || !source.includes('uniform sampler2D tDiffuse;') || end < 0) return;

  const dither = `
	// Dither: +-1 LSB of triangular noise hides banding in smooth dark gradients.
	vec2 seed = gl_FragCoord.xy;
	float n1 = fract( 52.9829189 * fract( dot( seed, vec2( 0.06711056, 0.00583715 ) ) ) );
	float n2 = fract( 52.9829189 * fract( dot( seed + 47.0, vec2( 0.00583715, 0.06711056 ) ) ) );
	gl_FragColor.rgb += ( n1 + n2 - 1.0 ) / 255.0;
`;
  output.material.fragmentShader = (source.slice(0, end) + dither + source.slice(end))
    .replace('uniform sampler2D tDiffuse;', 'uniform sampler2D tDiffuse;\nuniform sampler2D tBloom;')
    .replace(fetch, 'gl_FragColor = texture2D( tDiffuse, vUv );\n\tgl_FragColor.rgb += texture2D( tBloom, vUv ).rgb;');
  output.uniforms.tBloom = { value: glow.texture };
  output.material.needsUpdate = true;

  // Skip the bloom pass's own additive blit (its last draw).
  const draw = bloom.fsQuad.render.bind(bloom.fsQuad);
  bloom.fsQuad.render = (renderer) => {
    if (bloom.fsQuad.material !== bloom.blendMaterial) draw(renderer);
  };
}

start().catch((error) => {
  console.error(error);
  fail(`${i18n.t('boot.startFailed')}\n${error && error.message ? error.message : error}\n\n${i18n.t('boot.webgl2')}`);
});
