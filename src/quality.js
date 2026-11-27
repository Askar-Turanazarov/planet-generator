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

function isMobileDevice() {
  const ua = navigator.userAgent || '';
  if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(ua)) return true;
  // iPadOS introduces itself as a Mac; a Mac with a multi-touch screen is an iPad.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
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
  } else if (isMobileDevice()) {
    // deviceMemory (GiB, Chromium only) is the one honest hint a page gets.
    const memory = navigator.deviceMemory || 8;
    const phone = Math.min(window.screen.width, window.screen.height) < 600;
    tier = memory <= 2 || (phone && memory <= 4) ? TIERS.low : TIERS.medium;
  }
  const fit = (size) => Math.min(size, maxCubeSize);
  return { ...tier, terrain: fit(tier.terrain), clouds: fit(tier.clouds), sky: fit(tier.sky) };
}
