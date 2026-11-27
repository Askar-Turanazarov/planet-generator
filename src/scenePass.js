// The scene pass of the composer (replaces RenderPass).
//
// From orbit the whole scene fits one depth range (near 0.05, far 200 planet
// radii) and is drawn in one go. Close to the ground it cannot: 150 m above
// the surface the nearest ground is 10^-5 radii away while the sky, the rings
// and the atmosphere shell are radii away. Rather than a logarithmic depth
// buffer (which writes gl_FragDepth and loses early depth rejection), the
// scene is split by layers and drawn in three ranges into the same target:
//   FAR   sky, rings                       range of the orbit view
//   AIR   atmosphere shell (no depth test) range of the orbit view
//   NEAR  terrain, clouds                  near / far from the horizon
// The depth buffer is cleared before NEAR, so the terrain covers the sky and
// the air behind it (it adds the air in front of it itself: uAerial). Everything in FAR is beyond the horizon or above it, which is what
// makes the split exact.
//
// The cloud volume (cloudVolume.js) is marched at half resolution into a
// target of its own right before the NEAR range, with the NEAR projection,
// and put over the frame by a full-screen quad in that range.
import * as THREE from 'three';
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
    // { scene, mesh, composite } of the cloud volume (world.js), or null.
    this.volume = null;
    this.volumeTarget = null;
    this.clearColor = new THREE.Color();
  }

  /** March the cloud volume into its half-resolution target (NEAR camera set). */
  drawVolume(renderer, target) {
    const { mesh, scene, composite } = this.volume;
    const width = Math.max(1, Math.ceil(target.width / 2));
    const height = Math.max(1, Math.ceil(target.height / 2));
    let rt = this.volumeTarget;
    if (!rt) {
      rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType });
      rt.depthTexture = new THREE.DepthTexture(width, height, THREE.FloatType);
      this.volumeTarget = rt;
      composite.material.uniforms.tCloud.value = rt.texture;
      composite.material.uniforms.tCloudDepth.value = rt.depthTexture;
    } else if (rt.width !== width || rt.height !== height) {
      rt.setSize(width, height);
    }
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(this.clearColor);
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(rt);
    renderer.clear();
    renderer.render(scene, this.camera);
    renderer.setClearColor(this.clearColor, alpha);
    renderer.setRenderTarget(target);
    composite.visible = mesh.visible;
  }

  render(renderer, writeBuffer, readBuffer) {
    const { scene, camera } = this;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    renderer.clear();
    const split = this.split;
    const target = this.renderToScreen ? null : readBuffer;
    if (this.volume) this.volume.composite.visible = false;
    if (!split) {
      camera.layers.enableAll();
      renderer.render(scene, camera);
    } else {
      const { near, far } = camera;
      this.draw(renderer, LAYER.FAR, split.farNear, split.farFar);
      this.draw(renderer, LAYER.AIR, split.farNear, split.farFar);
      renderer.clearDepth();
      if (this.volume && this.volume.mesh.visible && target) {
        this.setRange(LAYER.NEAR, split.near, split.far);
        this.drawVolume(renderer, target);
      }
      this.draw(renderer, LAYER.NEAR, split.near, split.far);
      camera.layers.enableAll();
      camera.near = near;
      camera.far = far;
      camera.updateProjectionMatrix();
    }
    renderer.autoClear = autoClear;
  }

  setRange(layer, near, far) {
    const camera = this.camera;
    camera.layers.set(layer);
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }

  draw(renderer, layer, near, far) {
    this.setRange(layer, near, far);
    renderer.render(this.scene, this.camera);
  }
}
