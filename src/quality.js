// Quality tiers: how large the baked caches are and how many device pixels
// the renderer may use. A desktop GPU gets the full set; phones and tablets
// get smaller caches, which cuts both the video memory and the time a new
// world takes to synthesise. The resolution governor in main.js still adapts
// the frame itself on top of whichever tier is picked.
//
// Append ?quality=high | medium | low to the address to override the choice.

const TIERS = {
  //        cube-map faces (terrain, clouds, sky), ring strip, device pixel ratio cap
  high: { id: 'high', terrain: 1024, clouds: 768, sky: 512, ring: 2048, pixelRatio: 1.5 },
  medium: { id: 'medium', terrain: 768, clouds: 512, sky: 384, ring: 2048, pixelRatio: 1.5 },
  low: { id: 'low', terrain: 512, clouds: 384, sky: 256, ring: 1024, pixelRatio: 1.25 },
};

function isAppleMobile() {
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS introduces itself as a Mac; a Mac with a multi-touch screen is an iPad.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

function isMobileDevice() {
  if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
  return /Android|Mobile/i.test(navigator.userAgent || '') || isAppleMobile();
}

/**
 * iPhone and iPad report neither their memory nor their model, and since
 * iOS 26 the user agent no longer gives the system version either (it stays
 * at "iPhone OS 18_6"). Two signs that do tell iOS 26 or later apart:
 *   - WebGPU: every browser on iOS runs WebKit, which ships it from 26 on;
 *   - the Safari version, which on iOS follows the system ("Version/26.0").
 * iOS 26 runs on iPhone 11 / iPad (8th generation) and later: 4 GB of memory
 * on every iPhone of them, and GPUs that carry the full caches comfortably.
 */
function isRecentAppleMobile() {
  if ('gpu' in navigator) return true;
  const safari = /Version\/(\d+)/.exec(navigator.userAgent || '');
  return Boolean(safari && Number(safari[1]) >= 26);
}

/**
 * @param {number} maxCubeSize  largest cube-map face the GPU accepts
 * @returns {{id: string, terrain: number, clouds: number, sky: number, ring: number, pixelRatio: number}}
 */
export function pickQuality(maxCubeSize = 4096) {
  let tier = TIERS.high;
  const asked = new URLSearchParams(window.location.search).get('quality');
  if (asked && TIERS[asked]) {
    tier = TIERS[asked];
  } else if (isAppleMobile()) {
    tier = isRecentAppleMobile() ? TIERS.high : TIERS.medium;
  } else if (isMobileDevice()) {
    // deviceMemory (GiB, Chromium only, capped at 8) is the one honest hint
    // an Android page gets; 8 means a flagship-class phone or tablet.
    const memory = navigator.deviceMemory;
    const phone = Math.min(window.screen.width, window.screen.height) < 600;
    if (memory >= 8) tier = TIERS.high;
    else if (memory && (memory <= 2 || (phone && memory <= 4))) tier = TIERS.low;
    else tier = TIERS.medium;
  }
  const fit = (size) => Math.min(size, maxCubeSize);
  return { ...tier, terrain: fit(tier.terrain), clouds: fit(tier.clouds), sky: fit(tier.sky) };
}
