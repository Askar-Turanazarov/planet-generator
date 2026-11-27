// The scene pass of the composer (replaces RenderPass).
//
// From orbit the whole scene fits one depth range (near 0.05, far 200 planet
// radii) and is drawn in one go. Close to the ground it cannot: 150 m above
// the surface the nearest ground is 10^-5 radii away while the sky, the rings
// and the atmosphere shell are radii away. Rather than a logarithmic depth
// buffer (which writes gl_FragDepth and loses early depth rejection), the
// scene is split by layers and drawn in three ranges into the same target:
//   FAR   sky, rings                       range of the orbit view
//   NEAR  terrain, clouds                  near / far from the horizon
//   AIR   atmosphere shell (no depth test) range of the orbit view
// The depth buffer is cleared before NEAR, so the terrain occludes the far
// layer. Everything in FAR is beyond the horizon or above it, which is what
// makes the split exact.
import { Pass } from 'three/addons/postprocessing/Pass.js';

export const LAYER = { FAR: 1, NEAR: 2, AIR: 3 };

export class ScenePass extends Pass {
  constructor(scene, camera) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.needsSwap = false;
    // null: one pass. Otherwise { farNear, farFar, near, far } (planet radii).
    this.split = null;
  }

  render(renderer, writeBuffer, readBuffer) {
    const { scene, camera } = this;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clear();
    const split = this.split;
    if (!split) {
      camera.layers.enableAll();
      renderer.render(scene, camera);
    } else {
      const { near, far } = camera;
      this.draw(renderer, LAYER.FAR, split.farNear, split.farFar);
      renderer.clearDepth();
      this.draw(renderer, LAYER.NEAR, split.near, split.far);
      this.draw(renderer, LAYER.AIR, split.farNear, split.farFar);
      camera.layers.enableAll();
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    renderer.autoClear = autoClear;
  }

  draw(renderer, layer, near, far) {
    const camera = this.camera;
    camera.layers.set(layer);
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
    renderer.render(this.scene, camera);
  }
}
