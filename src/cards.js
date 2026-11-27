// Cards: one look for everything the interface has to say about the world
// beyond the panels (the probe reading now; tour steps and tasks later), and
// a toast for one-line confirmations.
//
// A card is described by a function that returns its content, so that a
// change of language redraws it on the spot:
//   { kicker, title, summary, words, rows: [{ label, value }], text, note }
// "summary" is the short line of figures shown while the card is folded; the
// rest unfolds below. On a desktop a card opens unfolded, on a phone folded
// (the planet stays in view) and a tap on it unfolds it.

const COMPACT = '(max-width: 1100px), (max-height: 520px)';
const TOAST_MS = 2200;

export function createCards(i18n) {
  const root = document.getElementById('card');
  const toastNode = document.getElementById('toast');
  const node = (selector) => root.querySelector(selector);
  const kicker = node('.card-kicker');
  const close = node('.card-close');
  const main = node('.card-main');
  const title = node('.card-title');
  const summary = node('.card-summary');
  const words = node('.card-words');
  const rows = node('.card-rows');
  const text = node('.card-text');
  const note = node('.card-note');

  const compact = window.matchMedia(COMPACT);
  let render = null;
  let onClose = null;
  let toastTimer = 0;

  // Only touch what changed: the probe refreshes a few times a second and
  // most of the card stays the same.
  const put = (element, value) => {
    const next = value || '';
    if (element.textContent !== next) element.textContent = next;
    element.hidden = !next;
  };

  function setRows(list) {
    const items = list || [];
    while (rows.children.length > items.length * 2) rows.lastElementChild.remove();
    items.forEach((row, i) => {
      let dt = rows.children[i * 2];
      let dd = rows.children[i * 2 + 1];
      if (!dt) {
        dt = rows.appendChild(document.createElement('dt'));
        dd = rows.appendChild(document.createElement('dd'));
      }
      put(dt, row.label);
      put(dd, row.value);
    });
    rows.hidden = items.length === 0;
  }

  function paint() {
    if (!render) return;
    const spec = render();
    if (!spec) return;
    put(kicker, spec.kicker);
    put(title, spec.title);
    put(summary, spec.summary);
    put(words, spec.words);
    setRows(spec.rows);
    put(text, spec.text);
    put(note, spec.note);
    close.setAttribute('aria-label', i18n.t('card.close'));
    close.title = i18n.t('card.close');
    main.title = i18n.t('card.toggle');
  }

  function setOpen(open) {
    main.setAttribute('aria-expanded', String(open));
    root.classList.toggle('open', open);
  }

  function hide() {
    if (root.hidden) return;
    root.hidden = true;
    document.body.classList.remove('has-card');
    render = null;
    const callback = onClose;
    onClose = null;
    if (callback) callback();
  }

  main.addEventListener('click', () => setOpen(main.getAttribute('aria-expanded') !== 'true'));
  close.addEventListener('click', hide);
  window.addEventListener('keydown', (event) => {
    // An open sheet takes the first Escape (hud.js closes it). Capture phase:
    // this runs before hud.js, while the sheet is still marked open.
    if (event.key === 'Escape' && !root.hidden && !document.body.dataset.sheet) hide();
  }, { capture: true });
  i18n.onChange(paint);

  return {
    get open() {
      return !root.hidden;
    },
    /**
     * Show a card (or replace the one on screen, keeping it folded or
     * unfolded as the user left it).
     * @param {() => object} content   returns the card content
     * @param {{ onClose?: () => void }} options
     */
    show(content, options = {}) {
      const fresh = root.hidden;
      render = content;
      onClose = options.onClose || null;
      paint();
      if (fresh) {
        setOpen(!compact.matches);
        root.hidden = false;
        document.body.classList.add('has-card');
      }
    },
    /** Redraw from the same content function (new data arrived). */
    refresh: paint,
    hide,
    /** A one-line message that fades by itself. */
    toast(key) {
      toastNode.textContent = i18n.t(key);
      toastNode.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastNode.classList.remove('show'), TOAST_MS);
    },
  };
}
