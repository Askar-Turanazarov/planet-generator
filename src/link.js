// The world on screen, written into the address of the page and read back.
//
//   #v=1&w=terran&s=4217&sea=0.62&c=0.612,0.220,0.758,3.60&a=1.234&m=41.30,69.24
//
// Only what differs from the archetype goes in, which keeps links short and
// lets them survive a later change of an archetype's defaults. The hash, not
// the query string: it never reaches the server, and a host that rewrites
// clean URLs leaves it alone. Nothing personal is ever written here; the
// interface language stays the reader's own.
//
// It knows nothing about Three.js: a "view" is plain numbers.

export const LINK_VERSION = 1;

// Slider -> short name in the address, with the number of decimals kept.
const SLIDERS = {
  seaLevel: ['sea', 3],
  relief: ['rel', 3],
  ice: ['ice', 3],
  cityLights: ['city', 3],
  cloudCover: ['cld', 3],
  atmoDensity: ['atm', 3],
  atmoHue: ['hue', 0],
  ringTilt: ['tilt', 1],
};

// Global controls with fixed defaults (see state.js).
const GLOBALS = {
  sunAngle: ['sun', 0, 32],
  rotSpeed: ['spin', 3, 0.18],
};

// Slider ranges (as in the HUD): a hand-edited link cannot push a value out.
const RANGES = {
  seaLevel: [0, 1], relief: [0, 1], ice: [0, 1], cityLights: [0, 1], cloudCover: [0, 1],
  atmoDensity: [0, 1], atmoHue: [-180, 180], ringTilt: [-60, 60], sunAngle: [0, 360], rotSpeed: [0, 1],
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const trim = (value, digits) => {
  // Fixed decimals, then drop trailing zeros: 0.500 -> 0.5, 32.0 -> 32.
  const text = value.toFixed(digits);
  return digits > 0 ? text.replace(/\.?0+$/, '') || '0' : text;
};
const same = (a, b, digits) => Math.abs(a - b) < 0.5 * Math.pow(10, -digits) + 1e-9;

/**
 * @param {object} view
 *   preset   archetype object (id, seed, sliders, rings)
 *   seed     integer
 *   sliders  { key: value } for the keys of SLIDERS
 *   rings    boolean
 *   sunAngle, rotSpeed
 *   camera   { dir: [x, y, z], dist }   (direction from the planet centre)
 *   spin     planet rotation about its axis, radians
 *   marker   { lat, lon } in degrees, or null
 */
export function encodeView(view) {
  const parts = [`v=${LINK_VERSION}`, `w=${view.preset.id}`];
  if (view.seed !== view.preset.seed) parts.push(`s=${view.seed}`);
  for (const key in SLIDERS) {
    const [name, digits] = SLIDERS[key];
    const value = view.sliders[key];
    if (value !== undefined && !same(value, view.preset.sliders[key], digits)) parts.push(`${name}=${trim(value, digits)}`);
  }
  if (view.rings !== view.preset.rings) parts.push(`r=${view.rings ? 1 : 0}`);
  for (const key in GLOBALS) {
    const [name, digits, fallback] = GLOBALS[key];
    if (!same(view[key], fallback, digits)) parts.push(`${name}=${trim(view[key], digits)}`);
  }
  if (view.camera) {
    const [x, y, z] = view.camera.dir;
    parts.push(`c=${[x, y, z].map((v) => v.toFixed(3)).join(',')},${view.camera.dist.toFixed(2)}`);
  }
  if (view.spin !== undefined) {
    const turn = 2 * Math.PI;
    parts.push(`a=${(((view.spin % turn) + turn) % turn).toFixed(3)}`);
  }
  if (view.marker) parts.push(`m=${view.marker.lat.toFixed(2)},${view.marker.lon.toFixed(2)}`);
  return `#${parts.join('&')}`;
}

/**
 * Parse an address hash. Returns null when it does not describe a world
 * (empty, another version, an unknown archetype); unreadable fields are
 * skipped one by one rather than throwing the whole link away.
 */
export function decodeView(hash, presets) {
  const text = String(hash || '').replace(/^#/, '');
  if (!text) return null;
  const params = new Map();
  for (const part of text.split('&')) {
    const at = part.indexOf('=');
    if (at > 0) params.set(part.slice(0, at), decodeURIComponent(part.slice(at + 1)));
  }
  if (Number(params.get('v')) !== LINK_VERSION) return null;
  const preset = presets.find((p) => p.id === params.get('w'));
  if (!preset) return null;

  const number = (name) => {
    if (!params.has(name)) return undefined;
    const value = Number(params.get(name));
    return Number.isFinite(value) ? value : undefined;
  };
  const numbers = (name, count) => {
    if (!params.has(name)) return undefined;
    const values = params.get(name).split(',').map(Number);
    return values.length === count && values.every(Number.isFinite) ? values : undefined;
  };

  const view = { preset, seed: preset.seed, sliders: { ...preset.sliders }, rings: preset.rings };
  const seed = number('s');
  if (seed !== undefined && seed >= 0 && seed < 1e9) view.seed = Math.floor(seed);
  for (const key in SLIDERS) {
    const value = number(SLIDERS[key][0]);
    if (value !== undefined) view.sliders[key] = clamp(value, ...RANGES[key]);
  }
  if (params.has('r')) view.rings = params.get('r') === '1';
  for (const key in GLOBALS) {
    const value = number(GLOBALS[key][0]);
    view[key] = value !== undefined ? clamp(value, ...RANGES[key]) : GLOBALS[key][2];
  }
  const camera = numbers('c', 4);
  if (camera && Math.hypot(camera[0], camera[1], camera[2]) > 0.1) {
    view.camera = { dir: camera.slice(0, 3), dist: clamp(camera[3], 1.3, 14) };
  }
  const spin = number('a');
  if (spin !== undefined) view.spin = spin;
  const marker = numbers('m', 2);
  if (marker) view.marker = { lat: clamp(marker[0], -90, 90), lon: ((marker[1] + 540) % 360) - 180 };
  return view;
}

/** True when a view differs from its archetype (the HUD marks it "custom"). */
export function isModified(view) {
  if (view.seed !== view.preset.seed || view.rings !== view.preset.rings) return true;
  return Object.keys(SLIDERS).some((key) => !same(view.sliders[key], view.preset.sliders[key], SLIDERS[key][1]));
}

/**
 * Keeps the address in step with the screen. touch() after anything changes;
 * the write happens once things have been quiet for a moment, through
 * replaceState, so the history (the Back button) is not filled with every
 * slider step, and the browser's limit on address updates is never reached.
 */
export function createLinkWriter(describe, delay = 700) {
  let timer = 0;
  let last = '';
  const write = () => {
    timer = 0;
    const hash = encodeView(describe());
    if (hash === last && window.location.hash === hash) return;
    last = hash;
    try {
      window.history.replaceState(window.history.state, '', hash);
    } catch (error) {
      // Some embedded views refuse address changes; the link is a convenience.
    }
  };
  return {
    /** Something changed; write once things settle (ms, default `delay`). */
    touch(wait = delay) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(write, wait);
    },
    /** Write now and return the full link (before sharing). */
    flush() {
      if (timer) clearTimeout(timer);
      write();
      // Built from our own hash, so it is right even where replaceState failed.
      return `${window.location.href.split('#')[0]}${last}`;
    },
    /** The hash just written by us (hashchange from it is not a new link). */
    get current() {
      return last;
    },
  };
}
