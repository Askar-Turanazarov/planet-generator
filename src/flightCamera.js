// Camera for the flight below the orbit (FLIGHT-PLAN.md, stages C and H).
//
// On orbit the camera belongs to OrbitControls (camera.js). Once a descent
// starts it is handed over to this controller, which keeps its own pose:
//   pos   position in world space, metres-exact (JS numbers are doubles; the
//         GPU never sees it as one float: see the terrain's camera-relative
//         patches and the split depth passes in main.js)
//   quat  orientation of the camera
// The planet does not spin while flying, so world space is the planet's space
// turned by its (frozen) rotation about the axis.
//
// Modes: 'orbit' (controller idle), 'descent', 'flight', 'ascent'.
// Units: planet radii unless a name says otherwise; angles in radians.
import * as THREE from 'three';

const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);

/**
 * Local frame on the sphere at direction "up" (unit): east and north, with
 * heading 0 = north and 90 degrees = east. Near a pole east falls back to a
 * fixed meridian.
 */
export function localFrame(up, east, north) {
  east.crossVectors(AXIS_Y, up);
  if (east.lengthSq() < 1e-12) east.crossVectors(AXIS_X, up);
  east.normalize();
  north.crossVectors(up, east);
  return { up, east, north };
}

/** Direction in planet space for latitude / longitude in radians (survey.js convention). */
export function dirFromLatLon(lat, lon, out = new THREE.Vector3()) {
  return out.set(Math.cos(lat) * Math.cos(lon), Math.sin(lat), -Math.cos(lat) * Math.sin(lon));
}

export class FlightCamera {
  constructor(camera, planet) {
    this.camera = camera;
    this.planet = planet;           // Object3D whose rotation turns planet space into world space
    this.mode = 'orbit';
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    // Radius of the ground under the camera (planet radii); refreshed by the
    // ground probe (stage H). 1 until something better is known.
    this.groundRadius = 1;
    // Extra turn on top of quat (a light shake in the clouds, flight.js).
    this.shake = new THREE.Quaternion();
    this._up = new THREE.Vector3();
    this._east = new THREE.Vector3();
    this._north = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  get active() {
    return this.mode !== 'orbit';
  }

  /** Height above the sphere of radius 1 (planet radii). */
  get altitude() {
    return this.pos.length() - 1;
  }

  /** Height above the ground under the camera (planet radii, never below 0). */
  get clearance() {
    return Math.max(this.pos.length() - this.groundRadius, 0);
  }

  /**
   * Place the camera: latitude / longitude in degrees (planet space), altitude
   * in planet radii above radius 1, heading from north and pitch above the
   * horizon in degrees, roll in degrees (positive banks to the right).
   */
  setPose({ lat, lon, alt, heading = 0, pitch = 0, roll = 0 }) {
    const d2r = THREE.MathUtils.DEG2RAD;
    dirFromLatLon(lat * d2r, lon * d2r, this._up).applyQuaternion(this.planet.quaternion);
    this.pos.copy(this._up).multiplyScalar(1 + alt);
    this.orient(heading * d2r, pitch * d2r, roll * d2r);
    return this;
  }

  /** Point the camera from its position: heading, pitch, roll in radians. */
  orient(heading, pitch, roll = 0) {
    const { up, east, north } = localFrame(this._up.copy(this.pos).normalize(), this._east, this._north);
    const fwd = this._fwd
      .copy(north).multiplyScalar(Math.cos(heading))
      .addScaledVector(east, Math.sin(heading))
      .multiplyScalar(Math.cos(pitch))
      .addScaledVector(up, Math.sin(pitch));
    // Matrix4.lookAt puts +z on eye - target: the camera looks down -z.
    this._m.lookAt(this._v.set(0, 0, 0), fwd, up);
    this.quat.setFromRotationMatrix(this._m);
    if (roll) this.quat.multiply(this._q.setFromAxisAngle(this._v.set(0, 0, 1), -roll));
    return this;
  }

  /** The pose in the terms setPose takes (degrees, planet space). */
  getPose() {
    const r2d = THREE.MathUtils.RAD2DEG;
    const up = this._up.copy(this.pos).normalize();
    const local = this._v.copy(up).applyQuaternion(this._q.copy(this.planet.quaternion).invert());
    const lat = Math.asin(THREE.MathUtils.clamp(local.y, -1, 1)) * r2d;
    const lon = Math.atan2(-local.z, local.x) * r2d;
    const { east, north } = localFrame(up, this._east, this._north);
    const fwd = this._fwd.set(0, 0, -1).applyQuaternion(this.quat);
    const pitch = Math.asin(THREE.MathUtils.clamp(fwd.dot(up), -1, 1)) * r2d;
    let heading = Math.atan2(fwd.dot(east), fwd.dot(north)) * r2d;
    if (heading < 0) heading += 360;
    return { lat, lon, alt: this.pos.length() - 1, heading, pitch };
  }

  /** Hand the pose to the three.js camera. */
  apply() {
    this.camera.position.copy(this.pos);
    this.camera.quaternion.copy(this.quat).multiply(this.shake);
    this.camera.updateMatrixWorld();
  }

  /** Take over from the orbit camera, keeping the current view. */
  takeOver(mode = 'flight') {
    this.pos.copy(this.camera.position);
    this.quat.copy(this.camera.quaternion);
    this.mode = mode;
  }

  /** Give the camera back to the orbit controls. */
  release() {
    this.mode = 'orbit';
  }
}
