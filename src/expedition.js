// The photo expedition (idea И1): missions to photograph something the
// generator can show (missions.js), each picture judged for one to three
// stars (judge.js), the good ones kept in an album (album.js).
//
// Like the tour player (tour.js) it owns the flow, the texts, its list in the
// panel and the progress kept in the browser; everything that touches the
// scene goes through the host (main.js):
//   host.snapshot()            the user's world, to give back at the end
//   host.restore(view)         give it back (behind a dip)
//   host.settle(saved)         the mission is over and the world stays: let it spin again
//   host.stage(mission, instant)  put the mission's world and viewpoint on screen
//   host.shot()                the geometry of the picture (judge.js, "shot"),
//                              read while the still's camera is in place
//   host.sample(dirs)          probe readings for planet-space directions
//   host.worldLink()           the address of the world on screen (for the album)
//   host.openLink(hash)        open a world from the album
//   host.lock(spec)            lock the sliders the mission does not allow
//   host.leaveTour()           a tour is running: leave it
//   host.changed()             rewrite the address
//   host.sheetOff()            close the phone sheet so the planet shows

import { MISSIONS } from './missions.js';
import { planRays, measure, judge, GLOW_WIDTH } from './judge.js';
import { createAlbum, shrink } from './album.js';
import { deliver } from './capture.js';

const PROGRESS_KEY = 'planet-generator.expedition';
const PREVIEW_SIDE = 960;

function loadProgress() {
  try {
    const data = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) || '{}');
    return data && typeof data === 'object' ? data : {};
  } catch (error) {
    return {};
  }
}

const starLine = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

/** The still's pixels at a smaller size, for the judge's look at the night side. */
function reducedPixels(canvas, width) {
  const w = Math.min(width, canvas.width);
  const h = Math.max(1, Math.round((canvas.height * w) / canvas.width));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function createExpedition({ i18n, cards, capture, host }) {
  const { t } = i18n;
  const album = createAlbum();
  let progress = loadProgress();
  const run = {
    mission: null,
    phase: 'off',           // brief | result | exit | album | photo
    back: null,             // the phase album / photo / exit return to
    saved: null,            // the user's world from before the mission
    busy: false,            // a picture is being taken and judged
    result: null,           // { stars, results, still, preview }
    photos: [],             // the album as listed: entries with object URLs
    photo: null,            // the album entry on screen
    confirmDelete: false,
  };

  const save = () => {
    try {
      window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
    } catch (error) {
      // Private mode or storage full: progress just isn't remembered.
    }
  };

  // ---- the panel list --------------------------------------------------
  const list = document.getElementById('mission-list');
  const rows = new Map();
  const row = (idxText, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn tour-btn';
    const idx = document.createElement('span');
    idx.className = 'idx';
    idx.textContent = idxText;
    const name = document.createElement('span');
    name.className = 'name';
    const tag = document.createElement('span');
    tag.className = 'tag';
    button.append(idx, name, tag);
    button.addEventListener('click', onClick);
    list.append(button);
    return { button, name, tag };
  };
  MISSIONS.forEach((mission, i) => rows.set(mission.id, row(String(i + 1), () => start(mission.id))));
  const albumRow = row('▦', () => openAlbum());
  let albumCount = 0;

  function paintList() {
    MISSIONS.forEach((mission) => {
      const { button, name, tag } = rows.get(mission.id);
      const best = (progress[mission.id] && progress[mission.id].best) || 0;
      name.textContent = t(`mission.${mission.id}.title`);
      button.title = t(`mission.${mission.id}.task`);
      tag.textContent = best > 0 ? starLine(best) : '—';
      button.setAttribute('aria-pressed', String(run.mission === mission));
    });
    albumRow.name.textContent = t('expedition.album');
    albumRow.tag.textContent = String(albumCount);
    albumRow.button.setAttribute('aria-pressed', String(run.phase === 'album' || run.phase === 'photo'));
  }
  album.list().then((all) => {
    albumCount = all.length;
    paintList();
  });
  paintList();
  i18n.onChange(paintList);

  // ---- texts -------------------------------------------------------------
  const index = (mission) => MISSIONS.indexOf(mission) + 1;
  const kicker = (mission) => `${t('expedition.kicker')} · ${index(mission)} / ${MISSIONS.length}`;
  const worldName = (mission) => (mission.world ? t(`preset.${mission.world}.name`) : t('expedition.anyWorld'));
  const allowed = (mission) => (mission.allow === '*'
    ? t('expedition.allowAll')
    : mission.allow.map((key) => t(`param.${key}`)).join(', '));
  const checkText = (spec, vars, ok) => {
    const failKey = `check.${spec.id}.fail`;
    return ok === false && t(failKey) !== failKey ? t(failKey, vars) : t(`check.${spec.id}`, vars);
  };
  const best = (mission) => (progress[mission.id] && progress[mission.id].best) || 0;

  // ---- cards -------------------------------------------------------------
  function briefCard() {
    const mission = run.mission;
    if (!mission) return null;
    const stars = best(mission);
    return {
      kicker: kicker(mission),
      title: t(`mission.${mission.id}.title`),
      summary: stars > 0 ? t('expedition.best', { stars: starLine(stars) }) : t('expedition.notYet'),
      body: t(`mission.${mission.id}.task`),
      checks: mission.checks.map((spec) => ({ mark: '★'.repeat(spec.star), text: checkText(spec, spec) })),
      hint: { label: t('expedition.hintLabel'), text: t(`mission.${mission.id}.hint`) },
      rows: [
        { label: t('expedition.world'), value: worldName(mission) },
        { label: t('expedition.allowed'), value: allowed(mission) },
      ],
      actions: [
        { label: t(run.busy ? 'expedition.developing' : 'expedition.shoot'), primary: true, disabled: run.busy, run: shoot },
        { label: t('expedition.album'), run: openAlbum },
        { label: t('expedition.leave'), run: askExit },
      ],
      note: t('expedition.shutterNote'),
    };
  }

  function resultCard() {
    const mission = run.mission;
    const result = run.result;
    if (!mission || !result) return null;
    const last = index(mission) === MISSIONS.length;
    const perfect = result.stars === 3;
    const actions = [
      { label: t('expedition.again'), primary: !perfect, run: again },
    ];
    if (!last) actions.push({ label: t('expedition.next'), primary: perfect, run: () => start(MISSIONS[index(mission)].id) });
    actions.push({ label: t('expedition.download'), run: downloadResult });
    actions.push({ label: t('expedition.album'), run: openAlbum });
    return {
      kicker: kicker(mission),
      title: `${starLine(result.stars)}  ${t(`expedition.stars${result.stars}`)}`,
      summary: `${starLine(result.stars)} · ${t(`mission.${mission.id}.title`)}`,
      image: result.preview ? { src: result.preview, alt: t(`mission.${mission.id}.title`) } : null,
      checks: result.results.map((r) => ({ mark: '★'.repeat(r.spec.star), ok: r.ok, text: checkText(r.spec, r.vars, r.ok) })),
      actions,
      note: t(result.stars > 0 ? 'expedition.saved' : 'expedition.notSaved'),
    };
  }

  function exitCard() {
    if (!run.mission) return null;
    return {
      kicker: kicker(run.mission),
      title: t('expedition.exitTitle'),
      summary: t('expedition.exitTitle'),
      body: t('expedition.exitAsk'),
      actions: [
        { label: t('tour.restore'), primary: true, run: () => end(true) },
        { label: t('tour.stay'), run: () => end(false) },
        { label: t('expedition.continue'), run: resume },
      ],
    };
  }

  function albumCard() {
    return {
      kicker: t('expedition.kicker'),
      title: t('expedition.album'),
      summary: t('expedition.albumCount', { n: run.photos.length }),
      body: run.photos.length ? t('expedition.albumLead') : t('expedition.albumEmpty'),
      gallery: run.photos.map((entry) => ({
        src: entry.thumbUrl,
        label: `${starLine(entry.stars)} ${t(`mission.${entry.mission}.title`)}`,
        run: () => openPhoto(entry),
      })),
      actions: [{ label: t(run.mission ? 'expedition.backToMission' : 'card.close'), primary: true, run: closeAlbum }],
      note: t('expedition.albumNote', { n: album.LIMIT }),
    };
  }

  function photoCard() {
    const entry = run.photo;
    if (!entry) return null;
    let date = '';
    try {
      date = new Date(entry.date).toLocaleString(i18n.language === 'uz' ? 'uz-Latn-UZ' : i18n.language);
    } catch (error) {
      date = new Date(entry.date).toISOString().slice(0, 16).replace('T', ' ');
    }
    return {
      kicker: t('expedition.album'),
      title: t(`mission.${entry.mission}.title`),
      summary: starLine(entry.stars),
      image: { src: entry.imageUrl, alt: t(`mission.${entry.mission}.title`) },
      rows: [
        { label: t('expedition.stars'), value: starLine(entry.stars) },
        { label: t('expedition.world'), value: t(`preset.${entry.presetId}.name`) },
        { label: t('expedition.date'), value: date },
      ],
      actions: [
        { label: t('expedition.download'), primary: true, run: () => downloadPhoto(entry) },
        { label: t('expedition.openWorld'), run: () => openWorld(entry) },
        { label: t(run.confirmDelete ? 'expedition.deleteSure' : 'expedition.delete'), run: () => deletePhoto(entry) },
        { label: t('expedition.backToAlbum'), run: openAlbum },
      ],
    };
  }

  // Closing a card: the album goes back where it was opened from; a
  // mission card asks what to do with the world (as a tour does).
  const onClose = () => {
    if (run.phase === 'album' || run.phase === 'photo') {
      closeAlbum();
      return;
    }
    if (!run.mission) return;
    if (run.phase === 'exit') end(false);
    else askExit();
  };

  function show(content) {
    cards.show(content, { onClose, open: true });
    cards.focusAction();
  }

  // ---- flow ------------------------------------------------------------
  function start(id, { instant = false } = {}) {
    const mission = MISSIONS.find((item) => item.id === id);
    if (!mission) return false;
    host.leaveTour();
    if (!run.mission) run.saved = host.snapshot();
    run.mission = mission;
    dropResult();
    releasePhotos();
    document.body.classList.add('touring');
    host.sheetOff();
    host.stage(mission, instant);
    host.lock({ allow: mission.allow, world: Boolean(mission.world) });
    run.phase = 'brief';
    show(briefCard);
    paintList();
    host.changed();
    return true;
  }

  function again() {
    run.phase = 'brief';
    show(briefCard);
  }

  function askExit() {
    if (!run.mission) return;
    run.back = run.phase === 'exit' ? run.back : run.phase;
    run.phase = 'exit';
    show(exitCard);
  }

  /** Back to the mission card (after the probe, the album or a closed card). */
  function resume() {
    if (!run.mission) return;
    const phase = run.phase === 'exit' || run.phase === 'album' || run.phase === 'photo' ? run.back : run.phase;
    run.phase = phase === 'result' && run.result ? 'result' : 'brief';
    show(run.phase === 'result' ? resultCard : briefCard);
  }

  /** Leave the expedition: give the user's world back, or keep this one. */
  function end(restore) {
    if (!run.mission) return;
    const saved = run.saved;
    run.mission = null;
    run.phase = 'off';
    run.saved = null;
    dropResult();
    releasePhotos();
    document.body.classList.remove('touring');
    host.lock(null);
    cards.hide();
    if (restore && saved) host.restore(saved);
    else host.settle(saved);
    paintList();
    host.changed();
  }

  /** The user went their own way (a new link, a tour): leave without asking. */
  const abandon = () => end(false);

  // ---- the shutter -------------------------------------------------------
  async function shoot() {
    const mission = run.mission;
    if (!mission || run.busy) return;
    if (!capture.ready) {
      cards.toast('toast.captureWait');
      return;
    }
    run.busy = true;
    if (run.phase === 'brief') cards.refresh();
    try {
      let shot = null;
      const still = capture.grab(() => { shot = host.shot(); });
      const plan = planRays(shot);
      const samples = plan.rays.length ? await host.sample(plan.rays.map((ray) => ray.local)) : [];
      const metrics = measure(shot, plan, samples, reducedPixels(still.canvas, GLOW_WIDTH));
      const verdict = judge(mission, metrics);
      if (run.mission !== mission) return;                 // left meanwhile
      dropResult();
      const preview = URL.createObjectURL(await shrink(still.canvas, PREVIEW_SIDE, 0.85));
      run.result = { ...verdict, still, preview, metrics };
      if (verdict.stars > 0) {
        const entry = await album.add(still.canvas, {
          mission: mission.id,
          stars: verdict.stars,
          link: host.worldLink(),
          presetId: still.info.presetId,
          seed: still.info.seed,
        });
        if (entry) albumCount = Math.min(albumCount + 1, album.LIMIT);
        if (verdict.stars > best(mission)) {
          progress[mission.id] = { ...(progress[mission.id] || {}), best: verdict.stars };
          save();
        }
      }
      if (run.mission !== mission) return;
      run.phase = 'result';
      show(resultCard);
      paintList();
    } catch (error) {
      console.error(error);
      cards.toast('toast.captureFailed');
    } finally {
      run.busy = false;
      if (run.phase === 'brief') cards.refresh();
    }
  }

  function dropResult() {
    if (run.result && run.result.preview) URL.revokeObjectURL(run.result.preview);
    run.result = null;
  }

  async function downloadResult() {
    const result = run.result;
    if (!result) return;
    try {
      const blob = await capture.finish(result.still);
      const saved = await deliver(blob, capture.fileName(result.still.info, result.still.date), result.still.info.name);
      if (saved) cards.toast('toast.captured');
    } catch (error) {
      console.error(error);
      cards.toast('toast.captureFailed');
    }
  }

  // ---- the album ---------------------------------------------------------
  function releasePhotos() {
    run.photos.forEach((entry) => {
      URL.revokeObjectURL(entry.thumbUrl);
      if (entry.imageUrl) URL.revokeObjectURL(entry.imageUrl);
    });
    run.photos = [];
    run.photo = null;
  }

  async function openAlbum() {
    if (run.phase !== 'album' && run.phase !== 'photo') run.back = run.phase === 'exit' ? run.back : run.phase;
    releasePhotos();
    const all = await album.list();
    albumCount = all.length;
    run.photos = all.map((entry) => ({ ...entry, thumbUrl: URL.createObjectURL(entry.thumb), imageUrl: null }));
    run.phase = 'album';
    run.confirmDelete = false;
    host.sheetOff();
    show(albumCard);
    paintList();
  }

  function openPhoto(entry) {
    if (!entry.imageUrl) entry.imageUrl = URL.createObjectURL(entry.image);
    run.photo = entry;
    run.phase = 'photo';
    run.confirmDelete = false;
    show(photoCard);
  }

  function closeAlbum() {
    releasePhotos();
    if (run.mission) resume();
    else {
      run.phase = 'off';
      cards.hide();
    }
    paintList();
  }

  async function downloadPhoto(entry) {
    const name = capture.fileName({ presetId: entry.presetId, seed: entry.seed }, new Date(entry.date), 'jpg');
    if (await deliver(entry.image, name, t(`mission.${entry.mission}.title`))) cards.toast('toast.captured');
  }

  async function deletePhoto(entry) {
    if (!run.confirmDelete) {
      run.confirmDelete = true;
      cards.refresh();
      return;
    }
    await album.remove(entry.id);
    await openAlbum();
  }

  function openWorld(entry) {
    const link = entry.link;
    if (run.mission) end(false);
    releasePhotos();
    run.phase = 'off';
    cards.hide();
    paintList();
    host.openLink(link);
  }

  return {
    get active() {
      return run.mission !== null;
    },
    /** The mission fixes the world: archetype, seed and rings stay as they are. */
    get fixedWorld() {
      return Boolean(run.mission && run.mission.world);
    },
    /** For the address: the mission's id, or null. */
    get position() {
      return run.mission ? run.mission.id : null;
    },
    start,
    resume,
    abandon,
    end,
    shoot,
    openAlbum,
    album,
    missions: MISSIONS,
    get progress() {
      return progress;
    },
    get result() {
      return run.result;
    },
  };
}
