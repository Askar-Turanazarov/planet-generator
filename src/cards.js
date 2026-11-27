// Cards: one look for everything the interface has to say about the world
// beyond the panels (the probe reading, the steps and questions of a tour),
// and a toast for one-line confirmations.
//
// A card is described by a function that returns its content, so that a
// change of language redraws it on the spot:
//   { kicker, title, summary,
//     body,                                  narration (a tour step, a question)
//     words, rows: [{ label, value }],       the probe's words and figures
//     choices: [{ label, state, run }],      answers to pick from; state: '', 'right', 'wrong', 'off'
//     why:  { label, text },                 an explanation
//     hint: { label, text },                 a suggestion ("what if...")
//     actions: [{ label, run, primary }],    buttons
//     text, note }
// Everything is optional but the title. "summary" is the short line shown
// while the card is folded; the rest unfolds below. On a desktop a card opens
// unfolded, on a phone folded (the planet stays in view) and a tap on it
// unfolds it; show(..., { open: true }) opens it unfolded everywhere.

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
  const body = node('.card-body');
  const words = node('.card-words');
  const rows = node('.card-rows');
  const choices = node('.card-choices');
  const why = node('.card-why');
  const hint = node('.card-hint');
  const actions = node('.card-actions');
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

  /** A labelled paragraph ("Why", "What if"). */
  function setSection(section, spec) {
    const label = section.firstElementChild;
    const paragraph = section.lastElementChild;
    put(label, spec && spec.label);
    put(paragraph, spec && spec.text);
    section.hidden = !(spec && spec.text);
  }

  // Buttons are kept between redraws (a redraw must not steal focus or a
  // hover); each remembers the latest function to run.
  function setButtons(box, list, base) {
    const items = list || [];
    while (box.children.length > items.length) box.lastElementChild.remove();
    items.forEach((item, i) => {
      let button = box.children[i];
      if (!button) {
        button = box.appendChild(document.createElement('button'));
        button.type = 'button';
      }
      const className = [base, item.primary ? 'primary' : '', item.state || ''].filter(Boolean).join(' ');
      if (button.className !== className) button.className = className;
      if (button.textContent !== item.label) button.textContent = item.label;
      button.disabled = Boolean(item.disabled);
      button.runAction = item.run;
    });
    box.hidden = items.length === 0;
  }
  const onButton = (event) => {
    const button = event.target.closest('button');
    if (button && !button.disabled && button.runAction) button.runAction();
  };
  choices.addEventListener('click', onButton);
  actions.addEventListener('click', onButton);

  function paint() {
    if (!render) return;
    const spec = render();
    if (!spec) return;
    put(kicker, spec.kicker);
    put(title, spec.title);
    put(summary, spec.summary);
    put(body, spec.body);
    put(words, spec.words);
    setRows(spec.rows);
    setButtons(choices, spec.choices, 'card-choice');
    setSection(why, spec.why);
    setSection(hint, spec.hint);
    setButtons(actions, spec.actions, 'card-action');
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

  // The card's height, for the stylesheet: during a tour the planet is framed
  // above the card instead of behind it.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => {
      const height = root.hidden ? 0 : Math.round(root.getBoundingClientRect().height);
      document.documentElement.style.setProperty('--card-h', `${height}px`);
    }).observe(root);
  }

  return {
    get open() {
      return !root.hidden;
    },
    /**
     * Show a card (or replace the one on screen, keeping it folded or
     * unfolded as the user left it).
     * @param {() => object} content   returns the card content
     * @param {{ onClose?: () => void, open?: boolean }} options
     *   onClose  runs when the user closes the card (not when another replaces it)
     *   open     unfold it, also on a phone
     */
    show(content, options = {}) {
      const fresh = root.hidden;
      render = content;
      onClose = options.onClose || null;
      paint();
      if (fresh || options.open) setOpen(Boolean(options.open) || !compact.matches);
      if (fresh) {
        root.hidden = false;
        document.body.classList.add('has-card');
      }
      // A new page of a card starts at its top.
      if (options.open) root.scrollTop = 0;
    },
    /** Redraw from the same content function (new data arrived). */
    refresh: paint,
    hide,
    /** Put focus on the first primary button (keyboard users follow the card). */
    focusAction() {
      const button = actions.querySelector('button.primary:not([disabled])') || actions.querySelector('button');
      if (button) button.focus({ preventScroll: true });
    },
    /** A one-line message that fades by itself. */
    toast(key) {
      toastNode.textContent = i18n.t(key);
      toastNode.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastNode.classList.remove('show'), TOAST_MS);
    },
  };
}
