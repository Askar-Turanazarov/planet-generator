// The album of the photo expedition: the pictures that earned at least one
// star, kept in the browser (IndexedDB) with the mission, the stars, the date
// and the link to the world they were taken of.
//
// A picture is kept as a JPEG of at most PHOTO_SIDE px and a small thumbnail;
// past LIMIT pictures the oldest go. Where IndexedDB is refused (some private
// modes), the album lives in memory for the visit.

const DB_NAME = 'planet-generator';
const DB_VERSION = 1;
const STORE = 'album';
const LIMIT = 48;
const PHOTO_SIDE = 1600;
const THUMB_SIDE = 360;

function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** A JPEG copy of a canvas, its longer side at most "side" px. */
export function shrink(canvas, side, quality) {
  const scale = Math.min(1, side / Math.max(canvas.width, canvas.height));
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(canvas.width * scale));
  out.height = Math.max(1, Math.round(canvas.height * scale));
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return new Promise((resolve, reject) => {
    out.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('no JPEG'))), 'image/jpeg', quality);
  });
}

export function createAlbum() {
  let memory = null;              // the fallback: [{ id, ... }]
  let nextId = 1;
  const opening = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch (error) {
      resolve(null);
    }
  }).then((db) => {
    if (!db) memory = [];
    return db;
  });

  async function store(mode) {
    const db = await opening;
    return db ? db.transaction(STORE, mode).objectStore(STORE) : null;
  }

  /** Every picture, newest first. */
  async function list() {
    const os = await store('readonly');
    const all = os ? await request(os.getAll()) : memory.slice();
    return all.sort((a, b) => b.date - a.date || b.id - a.id);
  }

  async function remove(id) {
    const os = await store('readwrite');
    if (os) await request(os.delete(id));
    else memory = memory.filter((entry) => entry.id !== id);
  }

  /**
   * Keep a picture.
   * @param {HTMLCanvasElement} canvas  the still
   * @param {object} facts  { mission, stars, link, presetId, seed }
   * @returns the new entry (or null if it could not be kept)
   */
  async function add(canvas, facts) {
    try {
      const [image, thumb] = await Promise.all([shrink(canvas, PHOTO_SIDE, 0.88), shrink(canvas, THUMB_SIDE, 0.8)]);
      const entry = { ...facts, date: Date.now(), image, thumb };
      const os = await store('readwrite');
      if (os) entry.id = await request(os.add(entry));
      else {
        entry.id = nextId++;
        memory.push(entry);
      }
      // Past the limit the oldest go.
      const all = await list();
      for (const old of all.slice(LIMIT)) await remove(old.id);
      return entry;
    } catch (error) {
      console.error(error);
      return null;
    }
  }

  return { add, list, remove, LIMIT };
}
