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
  { title: 'section.seed', hint: 'R', kind: 'seed', tab: 'worlds' },
  {
    title: 'section.surface',
    tab: 'surface',
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
    tab: 'sky',
    hint: 'section.atmosphereHint',
    params: [
      { key: 'cloudCover', min: 0, max: 1, step: 0.005, format: 'unit' },
      { key: 'atmoDensity', min: 0, max: 1, step: 0.005, format: 'unit' },
      { key: 'atmoHue', min: -180, max: 180, step: 1, format: 'signedDeg' },
    ],
  },
  {
    title: 'section.rings',
    tab: 'sky',
    hint: 'section.ringsHint',
    kind: 'rings',
    params: [{ key: 'ringTilt', min: -60, max: 60, step: 0.5, format: 'signedDeg' }],
  },
  {
    title: 'section.orbit',
    tab: 'view',
    hint: 'section.orbitHint',
    params: [
      { key: 'sunAngle', min: 0, max: 360, step: 1, format: 'deg' },
      { key: 'rotSpeed', min: 0, max: 1, step: 0.005, format: 'unit' },
    ],
  },
  {
    title: 'section.render',
    tab: 'system',
    hint: 'section.renderHint',
    params: [{ key: 'renderScale', min: 0.5, max: 1.5, step: 0.05, format: 'scale' }],
  },
];

// Tabs of the compact (phone / tablet) layout. The icons are 20 × 20 line
// drawings in the HUD's own hairline style.
const TABS = [
  { id: 'worlds', icon: '<circle cx="10" cy="10" r="4.4"/><ellipse cx="10" cy="10" rx="8.6" ry="2.5" transform="rotate(-20 10 10)"/>' },
  { id: 'surface', icon: '<path d="M2 15.5 7.5 6l3.5 5.5 2.2-3 4.8 7z"/>' },
  { id: 'sky', icon: '<circle cx="10" cy="10" r="3.8"/><circle cx="10" cy="10" r="7.6" stroke-dasharray="2 2.4"/>' },
  { id: 'view', icon: '<path d="M3 7V3.5h3.5M13.5 3.5H17V7M17 13v3.5h-3.5M6.5 16.5H3V13"/><circle cx="10" cy="10" r="2"/>' },
  { id: 'system', icon: '<path d="M3 5.5h14M3 10h14M3 14.5h14"/><path d="M7 3.8v3.4M13 8.3v3.4M9 12.8v3.4" stroke-width="2.4"/>' },
];

const TELEMETRY = ['fps', 'ms', 'gpu', 'res', 'quality', 'alt', 'phase', 'lod'];

/**
 * @param {object} opts
 * @param {Array}  opts.presets   archetype definitions (texts come from i18n by id)
 * @param {Array}  opts.cameras   [{ id }]
 * @param {object} opts.i18n      text service from createI18n()
 * @param {object} opts.on        callbacks: preset(i), camera(id), param(key, value),
 *                                rings(bool), seed(text), randomize(), layout()
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
  const languageButton = (language, text) => {
    const button = el('button', 'btn compact', text);
    button.type = 'button';
    button.lang = language.id;
    button.title = language.name;
    button.setAttribute('aria-label', language.name);
    button.addEventListener('click', () => i18n.set(language.id));
    languageButtons.push({ id: language.id, button });
    return button;
  };
  const languageSwitch = document.getElementById('lang-switch');
  LANGUAGES.forEach((language) => languageSwitch.append(languageButton(language, language.code)));

  // ---- left panel: identity ----------------------------------------------
  const nameNode = document.getElementById('planet-name');
  const blurbNode = document.getElementById('planet-class');
  const indexNode = document.getElementById('ident-index');
  // The compact layout repeats the name in a strip at the top of the screen.
  const topNameNode = document.getElementById('top-name');
  const topIndexNode = document.getElementById('top-index');
  const paintIdentity = () => {
    const id = presets[activePreset].id;
    const name = t(`preset.${id}.name`);
    nameNode.textContent = name;
    topNameNode.textContent = name;
    blurbNode.textContent = t(`preset.${id}.blurb`);
    let index = `${String(activePreset + 1).padStart(2, '0')} / ${String(presets.length).padStart(2, '0')}`;
    if (modified) index += ` · ${t('ident.custom')}`;
    indexNode.textContent = index;
    topIndexNode.textContent = index;
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
    const group = el('div', index === 0 ? 'group first' : 'group');
    group.dataset.tab = section.tab;
    const title = el('div', 'group-title');
    const titleText = el('span');
    const hintText = el('span');
    label(titleText, section.title);
    if (section.hint.includes('.')) label(hintText, section.hint);
    else {
      // A hotkey: hidden where there is no keyboard.
      hintText.textContent = section.hint;
      hintText.className = 'hotkey';
    }
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

  // ---- language, once more, for the compact layout ----------------------
  // There the switch lives in the System tab and has room for full names.
  {
    const group = el('div', 'group group-language');
    group.dataset.tab = 'system';
    const title = el('div', 'group-title');
    const titleText = el('span');
    label(titleText, 'group.language');
    title.append(titleText, el('span', '', LANGUAGES.map((language) => language.code).join(' · ')));
    const wrap = el('div', 'switch three');
    wrap.setAttribute('role', 'group');
    paint(() => wrap.setAttribute('aria-label', t('aria.language')));
    LANGUAGES.forEach((language) => wrap.append(languageButton(language, language.name)));
    group.append(title, wrap);
    controls.append(group);
  }
  paint(() => {
    languageButtons.forEach(({ id, button }) => button.setAttribute('aria-pressed', String(id === i18n.language)));
  });

  // ---- tab bar (compact layout) -----------------------------------------
  // One sheet, five tabs: the open tab is named in body[data-sheet] and the
  // stylesheet shows the blocks tagged with it. Tapping the open tab closes
  // the sheet again, which gives the whole screen back to the planet.
  const tabBar = document.getElementById('tabs');
  const tabButtons = new Map();
  const notifyLayout = () => {
    if (on.layout) on.layout();
  };
  const setSheet = (tab) => {
    if (tab) document.body.dataset.sheet = tab;
    else delete document.body.dataset.sheet;
    tabButtons.forEach((button, id) => button.setAttribute('aria-expanded', String(id === tab)));
    if (tab) document.getElementById('sheet').scrollTop = 0;
    notifyLayout();
  };
  TABS.forEach(({ id, icon }) => {
    const button = el('button', 'tab');
    button.type = 'button';
    button.innerHTML = `<svg viewBox="0 0 20 20" aria-hidden="true">${icon}</svg>`;
    const caption = el('span');
    label(caption, `tab.${id}`);
    button.append(caption);
    button.setAttribute('aria-controls', 'sheet');
    button.setAttribute('aria-expanded', 'false');
    button.addEventListener('click', () => setSheet(document.body.dataset.sheet === id ? null : id));
    tabBar.append(button);
    tabButtons.set(id, button);
  });

  // ---- cinematic toggle & keyboard -------------------------------------
  const toggle = document.getElementById('hud-toggle');
  const toggleLabel = toggle.querySelector('.label');
  const isCinematic = () => document.body.classList.contains('cinematic');
  const paintToggle = () => {
    const text = t(isCinematic() ? 'toggle.show' : 'toggle.hide');
    toggleLabel.textContent = text;
    toggle.setAttribute('aria-label', text);   // the compact layout shows an icon only
  };
  paint(paintToggle);
  const setCinematic = (hidden) => {
    document.body.classList.toggle('cinematic', hidden);
    toggle.setAttribute('aria-pressed', String(hidden));
    paintToggle();
    notifyLayout();
  };
  toggle.addEventListener('click', () => setCinematic(!isCinematic()));

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape' && document.body.dataset.sheet) {
      setSheet(null);
      return;
    }
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
