// Quick targets of the flight (FLIGHT-PLAN.md stage H): the highest peak, a
// coast near the camera, the brightest city. Searched in the coarse copy of
// the terrain cache on the CPU (heightmap.js), a cell of tens of kilometres:
// good enough to aim a flight, and the ground probe takes over from there.
import * as THREE from 'three';

const dir = new THREE.Vector3();

/** Planet-space direction of cell (x, y) of a face (cell centres, see heightmap.js). */
function cellDir(faces, face, x, y, size, out) {
  const [n, u, v] = faces[face];
  const a = ((x + 0.5) / size) * 2 - 1;
  const b = ((y + 0.5) / size) * 2 - 1;
  return out.set(n[0] + a * u[0] + b * v[0], n[1] + a * u[1] + b * v[1], n[2] + a * u[2] + b * v[2]).normalize();
}

/**
 * Find a target. kind: 'peak' | 'coast' | 'city'. near: planet-space unit
 * vector the search prefers (coasts: the nearest one). Returns
 * { dir (planet space), elevation } or null when the grid is not ready or
 * nothing fits (no sea, no cities).
 */
export function findTarget(heightmap, kind, sea, near) {
  const grid = heightmap.grid();
  if (!grid) return null;
  const { size, elevation, city, faces } = grid;
  let best = -Infinity;
  let found = null;
  const step = 2;   // every other cell: 128^2 per face is plenty
  for (let face = 0; face < 6; face++) {
    const o = face * size * size;
    for (let y = step; y < size - step; y += step) {
      for (let x = step; x < size - step; x += step) {
        const i = o + y * size + x;
        const e = elevation[i];
        let score;
        if (kind === 'peak') {
          score = e;
        } else if (kind === 'city') {
          // The lights the shader admits (coverHabitable in chunks.js): low
          // land, the coast first, away from the poles.
          const h = e - sea;
          if (h <= 0 || h > 0.3 || city[i] < 0.05) continue;
          const lat = Math.abs(cellDir(faces, face, x, y, size, dir).y);
          const smooth = THREE.MathUtils.smoothstep;
          score = city[i] * (1 - smooth(h, 0.1, 0.3)) * (0.45 + 0.55 * (1 - smooth(h, 0, 0.1))) * (1 - smooth(lat, 0.62, 0.86));
        } else {
          // Land at the shore: above the sea, with sea a cell or two away.
          if (e <= sea) continue;
          const wet = elevation[i - step] < sea || elevation[i + step] < sea
            || elevation[i - step * size] < sea || elevation[i + step * size] < sea;
          if (!wet) continue;
          score = cellDir(faces, face, x, y, size, dir).dot(near);
        }
        if (score > best) {
          best = score;
          found = { face, x, y, e };
        }
      }
    }
  }
  if (!found || (kind === 'city' && best < 0.02)) return null;
  return { dir: cellDir(faces, found.face, found.x, found.y, size, new THREE.Vector3()), elevation: found.e };
}
