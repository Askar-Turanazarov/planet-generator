// Telemetry HUD: builds the panels, wires the controls, reports back through
// a small set of callbacks. It knows nothing about Three.js. Every label is a
// key into the i18n dictionary, so the whole HUD re-letters itself in place
// when the language changes.
import { LANGUAGES } from './i18n.js';

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

// Declarative description of the right-hand panel. "title", "hint" and
// "label" are dictionary keys; a hint without a dot is shown as is (a hotkey).
const SECTIONS = [
  { title: 'section.seed', hint: 'R', kind: 'seed' },
  {
    title: 'section.surface',
    hint: 'section.surfaceHint',
    params: [
      { key: 'seaLevel', min: 0, max: 1, step: 0.005, format: 'unit' },
      { key: 'relief', min: 0, max: 1, step: 0.005, format: 'unit' },
      { key: 'ice', min: 0, max: 1, step: 0.005, format: 'unit' },
      { key: 'cityLights', min: 0, max: 1, step: 0.005, format: 'unit' },
    ],
  },
  {
    title: 'section.atmosphere',
    hint: 'section.atmosphereHint',
    params: [
      { key: 'cloudCover', min: 0, max: 1, step: 0.005, format: 'unit' },
      { key: 'atmoDensity', min: 0, max: 1, step: 0.005, format: 'unit' },
      { key: 'atmoHue', min: -180, max: 180, step: 1, format: 'signedDeg' },
    ],
  },
  {
    title: 'section.rings',
    hint: 'section.ringsHint',
    kind: 'rings',
    params: [{ key: 'ringTilt', min: -60, max: 60, step: 0.5, format: 'signedDeg' }],
  },
  {
    title: 'section.orbit',
    hint: 'section.orbitHint',
    params: [
      { key: 'sunAngle', min: 0, max: 360, step: 1, format: 'deg' },
      { key: 'rotSpeed', min: 0, max: 1, step: 0.005, format: 'unit' },
    ],
  },
  {
    title: 'section.render',
    hint: 'section.renderHint',
    params: [{ key: 'renderScale', min: 0.5, max: 1.5, step: 0.05, format: 'scale' }],
  },
];

const TELEMETRY = ['fps', 'ms', 'gpu', 'res', 'alt', 'phase', 'lod'];

/**
 * @param {object} opts
 * @param {Array}  opts.presets   archetype definitions (texts come from i18n by id)
 * @param {Array}  opts.cameras   [{ id }]
 * @param {object} opts.i18n      text service from createI18n()
 * @param {object} opts.on        callbacks: preset(i), camera(id), param(key, value),
 *                                rings(bool), seed(text), randomize()
 */
export function createHud({ presets, cameras, i18n, on }) {
  const sliders = new Map();        // key -> { input, output, format }
  const telemetry = new Map();      // key -> <dd>
  const presetButtons = [];
  const languageButtons = [];
  let ringButtons = null;
  let seedInput = null;
  let activePreset = 0;
  let modified = false;
  let statusKey = 'status.live';

  const t = i18n.t;

  // Everything that shows text registers a painter here; a language switch
  // simply runs them all again.
  const painters = [];
  const paint = (painter) => {
    painters.push(painter);
    painter();
  };
  const label = (node, key) => paint(() => {
    node.textContent = t(key);
  });

  const formats = {
    unit: (v) => i18n.number(v, 2),
    deg: (v) => `${Math.round(v)}°`,
    signedDeg: (v) => `${v > 0 ? '+' : v < 0 ? '−' : ' '}${String(Math.abs(Math.round(v))).padStart(3, '0')}°`,
    scale: (v) => `${i18n.number(v, 2)}×`,
  };

  const paintSlider = (entry) => {
    const { input, output, format } = entry;
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    input.style.setProperty('--p', `${((value - min) / (max - min)) * 100}%`);
    output.textContent = format(value);
  };

  // ---- language switch ---------------------------------------------------
  // Codes on the buttons, each language's own name in the tooltip.
  const languageSwitch = document.getElementById('lang-switch');
  LANGUAGES.forEach((language) => {
    const button = el('button', 'btn compact', language.code);
    button.type = 'button';
    button.lang = language.id;
    button.title = language.name;
    button.setAttribute('aria-label', language.name);
    button.addEventListener('click', () => i18n.set(language.id));
    languageSwitch.append(button);
    languageButtons.push({ id: language.id, button });
  });
  paint(() => {
    languageButtons.forEach(({ id, button }) => button.setAttribute('aria-pressed', String(id === i18n.language)));
  });

  // ---- left panel: identity ----------------------------------------------
  const nameNode = document.getElementById('planet-name');
  const blurbNode = document.getElementById('planet-class');
  const indexNode = document.getElementById('ident-index');
  const paintIdentity = () => {
    const id = presets[activePreset].id;
    nameNode.textContent = t(`preset.${id}.name`);
    blurbNode.textContent = t(`preset.${id}.blurb`);
    const index = `${String(activePreset + 1).padStart(2, '0')} / ${String(presets.length).padStart(2, '0')}`;
    indexNode.textContent = modified ? `${index} · ${t('ident.custom')}` : index;
  };
  paint(paintIdentity);

  // ---- left panel: archetypes ------------------------------------------
  const presetList = document.getElementById('preset-list');
  presets.forEach((preset, i) => {
    const button = el('button', 'btn');
    button.type = 'button';
    const name = el('span', 'name');
    const tag = el('span', 'tag');
    label(name, `preset.${preset.id}.name`);
    label(tag, `preset.${preset.id}.tag`);
    button.append(el('span', 'idx', String(i + 1).padStart(2, '0')), name, tag);
    button.addEventListener('click', () => on.preset(i));
    presetList.append(button);
    presetButtons.push(button);
  });

  // ---- left panel: camera fly-to ---------------------------------------
  const cameraList = document.getElementById('camera-list');
  cameras.forEach((cam) => {
    const button = el('button', 'btn compact');
    button.type = 'button';
    label(button, `camera.${cam.id}`);
    button.addEventListener('click', () => on.camera(cam.id));
    cameraList.append(button);
  });

  // ---- left panel: telemetry -------------------------------------------
  const statusNode = document.getElementById('tm-status');
  paint(() => {
    statusNode.textContent = t(statusKey);
  });
  const telemetryList = document.getElementById('telemetry');
  TELEMETRY.forEach((key) => {
    const dt = el('dt');
    const dd = el('dd', '', '—');
    label(dt, `telemetry.${key}`);
    telemetryList.append(dt, dd);
    telemetry.set(key, dd);
  });

  // ---- right panel: parameters -----------------------------------------
  const controls = document.getElementById('controls');
  SECTIONS.forEach((section, index) => {
    const group = el('div', 'group');
    if (index === 0) group.style.borderTop = '0';
    const title = el('div', 'group-title');
    const titleText = el('span');
    const hintText = el('span');
    label(titleText, section.title);
    if (section.hint.includes('.')) label(hintText, section.hint);
    else hintText.textContent = section.hint;
    title.append(titleText, hintText);
    group.append(title);

    if (section.kind === 'seed') {
      const row = el('div', 'seed-row');
      seedInput = el('input');
      seedInput.type = 'text';
      seedInput.spellcheck = false;
      seedInput.autocomplete = 'off';
      seedInput.maxLength = 24;
      seedInput.addEventListener('change', () => on.seed(seedInput.value));
      seedInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') seedInput.blur();
      });
      const randomize = el('button', 'btn');
      randomize.type = 'button';
      randomize.addEventListener('click', () => on.randomize());
      label(randomize, 'seed.randomize');
      paint(() => seedInput.setAttribute('aria-label', t('section.seed')));
      row.append(seedInput, randomize);
      group.append(row);
    }

    if (section.kind === 'rings') {
      const wrap = el('div', 'switch');
      wrap.setAttribute('role', 'group');
      const off = el('button', 'btn');
      const onBtn = el('button', 'btn');
      off.type = 'button';
      onBtn.type = 'button';
      off.addEventListener('click', () => on.rings(false));
      onBtn.addEventListener('click', () => on.rings(true));
      label(off, 'rings.off');
      label(onBtn, 'rings.on');
      paint(() => wrap.setAttribute('aria-label', t('aria.rings')));
      wrap.append(off, onBtn);
      group.append(wrap);
      ringButtons = { off, on: onBtn };
    }

    (section.params || []).forEach((param) => {
      const row = el('div', 'param');
      const id = `p-${param.key}`;
      const caption = el('label');
      caption.htmlFor = id;
      label(caption, `param.${param.key}`);
      const output = el('output');
      output.htmlFor = id;
      const input = el('input');
      input.type = 'range';
      input.id = id;
      input.min = String(param.min);
      input.max = String(param.max);
      input.step = String(param.step);
      const entry = { input, output, format: formats[param.format] };
      input.addEventListener('input', () => {
        paintSlider(entry);
        on.param(param.key, Number(input.value));
      });
      row.append(caption, output, input);
      group.append(row);
      sliders.set(param.key, entry);
    });

    controls.append(group);
  });
  // Slider read-outs carry the decimal mark of the language.
  paint(() => sliders.forEach(paintSlider));

  // ---- cinematic toggle & keyboard -------------------------------------
  const toggle = document.getElementById('hud-toggle');
  const toggleLabel = toggle.querySelector('span');
  const isCinematic = () => document.body.classList.contains('cinematic');
  const paintToggle = () => {
    toggleLabel.textContent = t(isCinematic() ? 'toggle.show' : 'toggle.hide');
  };
  paint(paintToggle);
  const setCinematic = (hidden) => {
    document.body.classList.toggle('cinematic', hidden);
    toggle.setAttribute('aria-pressed', String(hidden));
    paintToggle();
  };
  toggle.addEventListener('click', () => setCinematic(!isCinematic()));

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
    if (target instanceof HTMLInputElement && target.type === 'text') return;
    // The typed character where it is a Latin letter or a digit; otherwise the
    // physical key, so H and R also work under a Cyrillic keyboard layout.
    let key = e.key.toLowerCase();
    if (!/^[a-z0-9]$/.test(key) && /^Key[A-Z]$/.test(e.code)) key = e.code.slice(3).toLowerCase();
    if (key === 'h') {
      setCinematic(!isCinematic());
    } else if (key === 'r') {
      on.randomize();
    } else if (key >= '1' && key <= String(presets.length)) {
      on.preset(Number(key) - 1);
    }
  });

  i18n.onChange(() => painters.forEach((painter) => painter()));

  // ---- public API -------------------------------------------------------
  return {
    /** Move every slider to the given values (after an archetype change). */
    syncSliders(values) {
      sliders.forEach((entry, key) => {
        if (values[key] === undefined) return;
        entry.input.value = String(values[key]);
        paintSlider(entry);
      });
    },

    setRings(enabled) {
      ringButtons.off.setAttribute('aria-pressed', String(!enabled));
      ringButtons.on.setAttribute('aria-pressed', String(enabled));
    },

    setSeed(seed) {
      seedInput.value = String(seed);
    },

    /** Highlight an archetype and show its identity block. */
    setPreset(index) {
      activePreset = index;
      modified = false;
      presetButtons.forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
      paintIdentity();
    },

    /** Flag that the world no longer matches its archetype exactly. */
    setModified(value) {
      if (modified === value) return;
      modified = value;
      paintIdentity();
    },

    /** State word next to the telemetry heading, as a dictionary key. */
    setStatus(key) {
      if (statusKey === key) return;
      statusKey = key;
      statusNode.textContent = t(key);
    },

    setTelemetry(values) {
      for (const key in values) {
        const node = telemetry.get(key);
        if (node && node.textContent !== values[key]) node.textContent = values[key];
      }
    },
  };
}
