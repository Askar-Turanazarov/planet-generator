// Orbit camera with damped controls and smooth fly-to transitions.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraRig {
  constructor(camera, domElement) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.7;
    this.controls.minDistance = 1.3;    // stay outside the atmosphere shell
    this.controls.maxDistance = 14;

    this.flight = null;
    this._q = new THREE.Quaternion();
    this._qStep = new THREE.Quaternion();
    this._identity = new THREE.Quaternion();
    this._dir = new THREE.Vector3();

    // Grabbing the view cancels an in-progress flight.
    // (Capture phase, so the controls are re-enabled before they see the event.)
    domElement.addEventListener('pointerdown', () => this.cancel(), { capture: true });
    domElement.addEventListener('wheel', () => this.cancel(), { capture: true, passive: true });
  }

  /** Place the camera immediately. */
  jumpTo(direction, distance) {
    this.camera.position.copy(direction).normalize().multiplyScalar(distance);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
  }

  /** Glide along an arc around the planet to a new direction and distance. */
  flyTo(direction, distance, duration = 2.0) {
    const fromDir = this.camera.position.clone().normalize();
    const toDir = direction.clone().normalize();
    this.flight = {
      fromDir,
      fromDist: this.camera.position.length(),
      toDir,
      toDist: distance,
      rotation: new THREE.Quaternion().setFromUnitVectors(fromDir, toDir),
      t: 0,
      duration,
    };
    this.controls.enabled = false;
  }

  /** Where the camera is headed: the end of a flight, else where it is. */
  get destination() {
    const f = this.flight;
    if (f) return { dir: f.toDir.clone(), dist: f.toDist };
    return { dir: this.camera.position.clone().normalize(), dist: this.camera.position.length() };
  }

  cancel() {
    if (!this.flight) return;
    this.flight = null;
    this.controls.enabled = true;
  }

  update(dt) {
    const f = this.flight;
    if (f) {
      f.t = Math.min(f.t + dt / f.duration, 1);
      const e = easeInOutCubic(f.t);
      this._qStep.copy(this._identity).slerp(f.rotation, e);
      this._dir.copy(f.fromDir).applyQuaternion(this._qStep);
      // Swing slightly wide mid-flight so close passes do not clip the limb.
      const lift = Math.sin(e * Math.PI) * 0.25 * Math.abs(f.toDist - f.fromDist);
      const dist = THREE.MathUtils.lerp(f.fromDist, f.toDist, e) + lift * 0.3;
      this.camera.position.copy(this._dir).multiplyScalar(dist);
      this.camera.lookAt(0, 0, 0);
      if (f.t >= 1) this.cancel();
    }
    if (this.controls.enabled) this.controls.update();
  }
}
