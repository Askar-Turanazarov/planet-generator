// Snapshot of the frame, the "postcard" (idea Д1). The scene is drawn once
// more at up to twice the screen's resolution, without the interface and
// with the planet in the middle of the picture, and saved as a PNG: shared
// through the system sheet on a phone, downloaded elsewhere. An optional
// caption (the world, its seed, the date) is set in the HUD's own type.
//
// The canvas keeps no copy of its picture between frames (no
// preserveDrawingBuffer: it costs every frame), so the still is copied out in
// the same task that drew it, before the browser gets to present or clear it.

const CAPTION_KEY = 'planet-generator.capture.caption';
const LOCALES = { en: 'en-GB', ru: 'ru-RU', uz: 'uz-Latn-UZ' };

/**
 * Hand a picture to the user: the share sheet on a phone ("Save image"),
 * a download elsewhere. Resolves to false if the user closed the sheet.
 */
export async function deliver(blob, name, title) {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  if (coarse && typeof navigator.share === 'function' && typeof File === 'function') {
    const file = new File([blob], name, { type: blob.type || 'image/png' });
    if (!navigator.canShare || navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title });
        return true;
      } catch (error) {
        if (error && error.name === 'AbortError') return false;
        // NotAllowedError: the tap is too long ago (encoding took a while). Download instead.
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

/**
 * @param {object} opts
 * @param {object} opts.i18n
 * @param {object} opts.cards   for the toast
 * @param {object} opts.host
 *   renderStill(pixelRatio, copy)  draws one frame at this pixel ratio and calls
 *                                  copy(canvas) while the picture is still there
 *   viewSize()                     { width, height } of the canvas in CSS px
 *   maxSide                        largest side of a still, device px
 *   ready()                        false while the world is being rebuilt
 *   info()                         { presetId, name, seed, custom } of the world on screen
 */
export function createCapture({ i18n, cards, host }) {
  let busy = false;
  let caption = readFlag();

  function readFlag() {
    try {
      return window.localStorage.getItem(CAPTION_KEY) !== '0';
    } catch (error) {
      return true;
    }
  }

  /** Pixel ratio of the still: twice the screen, within the size limit. */
  function stillRatio() {
    const { width, height } = host.viewSize();
    const screen = window.devicePixelRatio || 1;
    const maxSide = typeof host.maxSide === 'function' ? host.maxSide() : host.maxSide;
    return Math.min(2 * screen, maxSide / Math.max(width, height, 1));
  }

  /**
   * Draw the still and copy it out (no caption yet).
   * @param {() => void} [during]  runs while the still's camera is in place
   *                               (the expedition reads the shot's geometry there)
   * @returns {{ canvas, info, date }}
   */
  function grab(during) {
    const info = host.info();
    const date = new Date();
    let still = null;
    host.renderStill(stillRatio(), (canvas) => {
      if (during) during();
      still = document.createElement('canvas');
      still.width = canvas.width;
      still.height = canvas.height;
      still.getContext('2d').drawImage(canvas, 0, 0);
    });
    if (!still) throw new Error('no picture');
    return { canvas: still, info, date };
  }

  const toPng = (canvas) => new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no PNG'))), 'image/png');
  });

  /** A copy of the still with the caption (when it is on), as a PNG for the user. */
  async function finish({ canvas, info, date }) {
    let out = canvas;
    if (caption) {
      out = document.createElement('canvas');
      out.width = canvas.width;
      out.height = canvas.height;
      out.getContext('2d').drawImage(canvas, 0, 0);
      drawCaption(out, info, date);
    }
    return toPng(out);
  }

  async function take() {
    if (busy) return;
    if (!host.ready()) {
      cards.toast('toast.captureWait');
      return;
    }
    busy = true;
    try {
      const shot = grab();
      const blob = await finish(shot);
      const saved = await deliver(blob, fileName(shot.info, shot.date), shot.info.name);
      if (saved) cards.toast('toast.captured');
    } catch (error) {
      console.error(error);
      cards.toast('toast.captureFailed');
    } finally {
      busy = false;
    }
  }

  // ---- caption -------------------------------------------------------------
  function formatDate(date) {
    try {
      return new Intl.DateTimeFormat(LOCALES[i18n.language] || 'en-GB',
        { year: 'numeric', month: 'long', day: 'numeric' }).format(date);
    } catch (error) {
      return date.toISOString().slice(0, 10);
    }
  }

  /** Bottom left, on a soft shade: kicker line, the name, the seed. */
  function drawCaption(canvas, info, date) {
    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    const unit = Math.min(width, height) / 1080;        // 1 at 1080p
    const margin = Math.round(Math.max(28, 54 * unit));
    const mono = getComputedStyle(document.documentElement).getPropertyValue('--mono').trim() || 'monospace';

    const shade = ctx.createLinearGradient(0, height - 260 * unit, 0, height);
    shade.addColorStop(0, 'rgba(0, 0, 0, 0)');
    shade.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
    ctx.fillStyle = shade;
    ctx.fillRect(0, height - 260 * unit, width, 260 * unit);

    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 6 * unit;
    const line = (text, size, color, spacing, y) => {
      ctx.font = `${size}px ${mono}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${(spacing * size).toFixed(2)}px`;
      ctx.fillStyle = color;
      ctx.fillText(text, margin, y);
    };
    const small = 15 * unit;
    const big = 40 * unit;
    let y = height - margin;
    const seedLine = i18n.t('capture.seed', { seed: info.seed }) + (info.custom ? ` · ${i18n.t('ident.custom')}` : '');
    line(seedLine.toUpperCase(), small, 'rgba(255, 255, 255, 0.62)', 0.14, y);
    y -= small * 1.9;
    line(info.name, big, 'rgba(255, 255, 255, 0.94)', 0.01, y);
    y -= big * 1.05;
    line(`${i18n.t('kicker.survey')} · ${formatDate(date)}`.toUpperCase(), small, 'rgba(255, 255, 255, 0.62)', 0.16, y);
    // A hairline over the kicker, as the panels draw theirs.
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.fillRect(margin, y - small * 1.9, 64 * unit, Math.max(1, unit));
  }

  // ---- delivery ------------------------------------------------------------
  function fileName(info, date, ext = 'png') {
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
      + `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
    const seed = String(info.seed).replace(/[^0-9A-Za-z-]/g, '');
    return `planet-${info.presetId}-${seed}-${stamp}.${ext}`;
  }

  return {
    take,
    grab,
    finish,
    fileName,
    get ready() { return host.ready() && !busy; },
    get busy() { return busy; },
    get caption() { return caption; },
    set caption(value) {
      caption = Boolean(value);
      try {
        window.localStorage.setItem(CAPTION_KEY, caption ? '1' : '0');
      } catch (error) {
        // Not remembered: the choice still holds for this visit.
      }
    },
  };
}
