// Planet Generator 3D — entry point.
// Sets up the renderer and post-processing chain, builds the world, wires the
// HUD, and runs the frame loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createUniforms } from './uniforms.js';
import { PRESETS } from './presets.js';
import { PlanetState, parseSeed } from './state.js';
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

function start() {
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
    // Ignore frames that say nothing about the GPU (tab in background, bakes).
    if (dt >= 0.1 || dt <= 0 || document.hidden || dip) return;
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
    } else if (seen > governor.refresh * 1.03 && timerExt && ++governor.slowerFor >= 20) {
      // A slower display for ten seconds running: the window moved screens.
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
      // No timer: judge by the frame interval, and only while the window has
      // the user's attention (an unfocused window may simply be throttled).
      const target = governor.refresh > 1 / 100 ? governor.refresh : governor.refresh * 2;
      const load = frameTime / target;
      if (load > 1.2 && !document.hasFocus()) return;
      ideal = load > 1.2 ? autoScale * 0.88 : load < 1.06 ? autoScale * 1.12 : autoScale;
    }

    if (ideal < autoScale - 0.01) {
      governor.under = 0;
      if (++governor.over >= 2) {
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
  const hud = createHud({
    presets: PRESETS,
    cameras: CAMERAS,
    i18n,
    on: {
      preset(index) {
        const preset = PRESETS[index];
        hud.setPreset(index);
        hud.syncSliders(preset.sliders);
        hud.setRings(preset.rings);
        hud.setSeed(preset.seed);
        dipTransition(() => {
          state.applyPreset(preset);
          state.snap();
        }, 0.55);
      },
      camera(id) {
        if (id === 'ring' && state.get('ringsOn') < 0.5) {
          state.set('ringsOn', 1);
          hud.setRings(true);
          hud.setModified(true);
        }
        const pose = cameraPose(id);
        rig.flyTo(pose.dir, pose.dist);
      },
      param(key, value) {
        if (key === 'renderScale') {
          renderScale = value;
          resize();
          return;
        }
        state.set(key, value);
        if (key !== 'sunAngle' && key !== 'rotSpeed') hud.setModified(true);
      },
      rings(enabled) {
        state.set('ringsOn', enabled ? 1 : 0);
        hud.setRings(enabled);
        hud.setModified(true);
      },
      seed(text) {
        const seed = parseSeed(text);
        hud.setSeed(seed);
        hud.setModified(true);
        dipTransition(() => state.setSeed(seed), 0.36);
      },
      randomize() {
        const seed = Math.floor(Math.random() * 1000000);
        hud.setSeed(seed);
        hud.setModified(true);
        dipTransition(() => state.setSeed(seed), 0.36);
      },
      // A sheet opened or closed, or the interface was hidden.
      layout: measureFraming,
    },
  });

  // Initial world.
  state.applyPreset(PRESETS[0]);
  hud.setPreset(0);
  hud.syncSliders({ ...PRESETS[0].sliders, sunAngle: state.get('sunAngle'), rotSpeed: state.get('rotSpeed'), renderScale });
  hud.setRings(PRESETS[0].rings);
  hud.setSeed(PRESETS[0].seed);
  state.update(0);
  baker.bakeSky();
  baker.requestWorld(0);
  baker.step();
  resize();
  {
    const pose = cameraPose('overview');
    rig.jumpTo(pose.dir, pose.dist);
  }

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

  function frame(now) {
    const dt = THREE.MathUtils.clamp((now - last) / 1000, 0, 0.1);
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

    // Level of detail from the size of one pixel on the ground below the
    // camera. The terrain cache covers the view from orbit; as the camera
    // closes in, micro-relief octaves fade in once each is a few pixels wide.
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

    if (rendering) composer.render(dt);
    gpuEnd();
    govern(dt);

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
  window.planetGenerator = { renderer, composer, camera, state, uniforms, world, rig, hud, baker, advance, perf, i18n, quality, framing };
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

try {
  start();
} catch (error) {
  console.error(error);
  fail(`${i18n.t('boot.startFailed')}\n${error && error.message ? error.message : error}\n\n${i18n.t('boot.webgl2')}`);
}
