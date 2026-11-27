// The tour player: walks a route from tours.js step by step in the card,
// then asks its questions, then asks what to do with the world.
//
// It owns the flow, the texts, the "Tours" list in the panel and the progress
// kept in the browser. Everything that touches the scene goes through the
// host (main.js):
//   host.snapshot()            the user's world, to give back at the end
//   host.restore(view)         give it back (behind a dip)
//   host.stage(tour, index, instant)   put step "index" on screen
//   host.settle()              the tour is over and the world stays: let it spin again
//   host.changed()             the tour moved on (rewrite the address)
//   host.sheetOff()            close the phone sheet so the planet shows
//   host.leave()               leave the photo expedition, if it is on (optional)

import { TOURS } from './tours.js';

const STORAGE_KEY = 'planet-generator.tours';

function load() {
  try {
    const data = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch (error) {
    return {};
  }
}

export function createTours({ i18n, cards, host }) {
  const { t } = i18n;
  let progress = load();
  const run = {
    tour: null,
    phase: 'off',           // step | quiz | result | exit
    step: 0,
    question: 0,
    picked: [],             // answer picked for each question (or undefined)
    saved: null,            // the user's world from before the tour
    exitFrom: null,         // the phase the exit question interrupted
  };

  const save = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch (error) {
      // Private mode or storage full: progress just isn't remembered.
    }
  };
  const record = (id, patch) => {
    progress[id] = { ...(progress[id] || {}), ...patch };
    save();
    paintList();
  };

  // ---- the panel list --------------------------------------------------
  const list = document.getElementById('tour-list');
  const buttons = new Map();
  TOURS.forEach((tour, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn tour-btn';
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = String.fromCharCode(65 + i);    // A, B, C...
    const name = document.createElement('span');
    name.className = 'name';
    const tag = document.createElement('span');
    tag.className = 'tag';
    button.append(idx, name, tag);
    button.addEventListener('click', () => {
      const saved = progress[tour.id];
      // Pick up an unfinished route where it was left; a finished one starts over.
      const from = saved && !saved.done && saved.step > 0 && saved.step < tour.steps.length ? saved.step : 0;
      start(tour.id, from);
    });
    list.append(button);
    buttons.set(tour.id, { button, name, tag });
  });

  function paintList() {
    TOURS.forEach((tour) => {
      const { button, name, tag } = buttons.get(tour.id);
      const saved = progress[tour.id];
      name.textContent = t(`tour.${tour.id}.title`);
      button.title = t(`tour.${tour.id}.lead`);
      let state;
      if (saved && saved.done) state = t('tour.tagDone', { n: saved.score, total: tour.quiz.length });
      else if (saved && saved.step > 0) state = t('tour.tagAt', { n: saved.step + 1, total: tour.steps.length });
      else state = t('tour.tagSteps', { n: tour.steps.length });
      tag.textContent = state;
      button.setAttribute('aria-pressed', String(run.tour === tour));
    });
  }
  paintList();
  i18n.onChange(paintList);

  // ---- cards -------------------------------------------------------------
  const kicker = () => t(`tour.${run.tour.id}.title`);

  function stepCard() {
    const tour = run.tour;
    if (!tour) return null;
    const i = run.step;
    const n = tour.steps.length;
    const last = i === n - 1;
    return {
      kicker: `${t('tour.kicker')} · ${kicker()}`,
      title: t(`tour.${tour.id}.s${i + 1}.title`),
      summary: t('tour.stepOf', { n: i + 1, total: n }),
      body: t(`tour.${tour.id}.s${i + 1}`),
      actions: [
        { label: t('tour.back'), run: () => go(i - 1), disabled: i === 0 },
        { label: t(last ? 'tour.toQuiz' : 'tour.next'), primary: true, run: () => (last ? ask(0) : go(i + 1)) },
      ],
      note: t('tour.stepOf', { n: i + 1, total: n }),
    };
  }

  function questionCard() {
    const tour = run.tour;
    if (!tour) return null;
    const q = run.question;
    const spec = tour.quiz[q];
    const picked = run.picked[q];
    const answered = picked !== undefined;
    const choices = [];
    for (let k = 0; k < spec.answers; k++) {
      let state = '';
      if (answered) state = k === spec.right ? 'right' : k === picked ? 'wrong' : 'off';
      choices.push({ label: t(`tour.${tour.id}.q${q + 1}.a${k + 1}`), state, disabled: answered, run: () => answer(k) });
    }
    const last = q === tour.quiz.length - 1;
    return {
      kicker: `${t('tour.quiz')} · ${kicker()}`,
      title: t('tour.questionOf', { n: q + 1, total: tour.quiz.length }),
      summary: t(`tour.${tour.id}.q${q + 1}`),
      body: t(`tour.${tour.id}.q${q + 1}`),
      choices,
      why: answered
        ? { label: t(picked === spec.right ? 'tour.right' : 'tour.wrong'), text: t(`tour.${tour.id}.q${q + 1}.why`) }
        : null,
      actions: answered
        ? [{ label: t(last ? 'tour.finish' : 'tour.next'), primary: true, run: () => (last ? finish() : ask(q + 1)) }]
        : null,
    };
  }

  function score() {
    const tour = run.tour;
    return tour.quiz.reduce((sum, spec, q) => sum + (run.picked[q] === spec.right ? 1 : 0), 0);
  }

  const endActions = (withResume) => {
    const actions = [
      { label: t('tour.restore'), primary: true, run: () => end(true) },
      { label: t('tour.stay'), run: () => end(false) },
    ];
    if (withResume) actions.push({ label: t('tour.continue'), run: resume });
    return actions;
  };

  function resultCard() {
    const tour = run.tour;
    if (!tour) return null;
    const total = tour.quiz.length;
    const n = score();
    return {
      kicker: `${t('tour.kicker')} · ${kicker()}`,
      title: t('tour.done'),
      summary: t('tour.score', { n, total }),
      body: `${t('tour.score', { n, total })} ${t(n === total ? 'tour.scoreAll' : n === 0 ? 'tour.scoreNone' : 'tour.scoreSome')}`,
      why: { label: t('tour.afterLabel'), text: t('tour.after') },
      actions: endActions(false),
    };
  }

  function exitCard() {
    if (!run.tour) return null;
    return {
      kicker: `${t('tour.kicker')} · ${kicker()}`,
      title: t('tour.exitTitle'),
      summary: t('tour.exitTitle'),
      body: t('tour.exitAsk'),
      actions: endActions(true),
    };
  }

  // Closing any tour card asks what to do with the world (the result card
  // has already asked: closing it keeps the world as it is).
  const onClose = () => {
    if (!run.tour) return;
    if (run.phase === 'result' || run.phase === 'exit') end(false);
    else {
      run.exitFrom = run.phase;
      run.phase = 'exit';
      show(exitCard);
    }
  };

  function show(content) {
    cards.show(content, { onClose, open: true });
    cards.focusAction();
  }

  // ---- flow ------------------------------------------------------------
  function start(id, index = 0, { instant = false } = {}) {
    const tour = TOURS.find((item) => item.id === id);
    if (!tour) return false;
    if (host.leave) host.leave();             // another guided mode (the photo expedition)
    if (!run.tour) run.saved = host.snapshot();
    run.tour = tour;
    run.picked = [];
    document.body.classList.add('touring');
    host.sheetOff();
    if (index === 'quiz') {
      host.stage(tour, tour.steps.length - 1, instant);
      run.step = tour.steps.length - 1;
      ask(0);
    } else {
      go(Math.min(Math.max(index, 0), tour.steps.length - 1), instant);
    }
    paintList();
    return true;
  }

  function go(index, instant = false) {
    const tour = run.tour;
    if (!tour || index < 0 || index >= tour.steps.length) return;
    run.phase = 'step';
    run.step = index;
    host.stage(tour, index, instant);
    const saved = progress[tour.id];
    if (!saved || !saved.done || index > 0) record(tour.id, { step: index });
    show(stepCard);
    host.changed();
  }

  function ask(q) {
    run.phase = 'quiz';
    run.question = q;
    show(questionCard);
    host.changed();
  }

  function answer(k) {
    if (run.picked[run.question] !== undefined) return;
    run.picked[run.question] = k;
    cards.refresh();
    cards.focusAction();
  }

  function finish() {
    const tour = run.tour;
    const n = score();
    const best = Math.max(n, (progress[tour.id] && progress[tour.id].best) || 0);
    record(tour.id, { done: true, step: 0, score: n, best });
    run.phase = 'result';
    show(resultCard);
    host.changed();
  }

  /** Back to the tour card (after a probe reading or a closed card). */
  function resume() {
    if (!run.tour) return;
    if (run.phase === 'exit') run.phase = run.exitFrom || 'step';
    if (run.phase === 'step') {
      host.stage(run.tour, run.step, false);
      show(stepCard);
    } else if (run.phase === 'quiz') show(questionCard);
    else show(resultCard);
  }

  /** Leave the tour: give the user's world back, or keep this one. */
  function end(restore) {
    if (!run.tour) return;
    const saved = run.saved;
    run.tour = null;
    run.phase = 'off';
    run.saved = null;
    document.body.classList.remove('touring');
    cards.hide();
    if (restore && saved) host.restore(saved);
    else host.settle(saved);
    paintList();
    host.changed();
  }

  /** The user went their own way (another archetype, a new link): leave without asking. */
  const abandon = () => end(false);

  // Arrow keys walk the steps (not while a slider or a text field has focus).
  window.addEventListener('keydown', (event) => {
    if (!run.tour || run.phase !== 'step' || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'ArrowRight') go(run.step + 1);
    else if (event.key === 'ArrowLeft') go(run.step - 1);
  });

  return {
    get active() {
      return run.tour !== null;
    },
    /** For the address: { id, step } (step from 1, or 'quiz'), or null. */
    get position() {
      if (!run.tour) return null;
      const phase = run.phase === 'exit' ? run.exitFrom : run.phase;
      return { id: run.tour.id, step: phase === 'step' ? run.step + 1 : 'quiz' };
    },
    start,
    resume,
    abandon,
    end,
    tours: TOURS,
    get progress() {
      return progress;
    },
  };
}
