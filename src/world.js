// Scene graph: five procedural objects, all driven by the shared uniforms.
//
// Each object sits on the layer of its depth range (scenePass.js).
//
// Draw order matters because three of them are translucent:
//   sky -> planet -> clouds -> far half of the rings
//       -> atmosphere (adds the air, dims what is behind it) -> near half of the rings
import * as THREE from 'three';
import { createTerrain } from './terrain.js';
import { CLOUDS_VERT, CLOUDS_FRAG } from './shaders/clouds.js';
import { CLOUD_VOLUME_VERT, CLOUD_VOLUME_FRAG, CLOUD_COMPOSITE_VERT, CLOUD_COMPOSITE_FRAG } from './shaders/cloudVolume.js';
import { ATMO_VERT, ATMO_FRAG } from './shaders/atmosphere.js';
import { RINGS_VERT, RINGS_FRAG } from './shaders/rings.js';
import { SKY_VERT, SKY_FRAG } from './shaders/sky.js';
import { LAYER } from './scenePass.js';

export function createWorld(uniforms, heightmap) {
  const scene = new THREE.Scene();

  // --- deep space backdrop ---
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 24),
    new THREE.ShaderMaterial({
      name: 'Sky',
      uniforms,
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
    }),
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.layers.set(LAYER.FAR);
  scene.add(sky);

  // --- planetary surface: the terrain quadtree (terrain.js) ---
  // The group carries the planet's turn about its axis; the patches hang from it.
  const terrain = createTerrain(uniforms, heightmap);
  const planet = new THREE.Group();
  planet.add(terrain.mesh);
  scene.add(planet);

  // --- cloud shell (from afar) ---
  // A unit sphere scaled to the middle of the cloud layer (main.js), which is a
  // few kilometres up on every planet.
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1, 192, 192),
    new THREE.ShaderMaterial({
      name: 'Clouds',
      uniforms,
      vertexShader: CLOUDS_VERT,
      fragmentShader: CLOUDS_FRAG,
      transparent: true,
      depthWrite: false,
    }),
  );
  clouds.renderOrder = 1;
  clouds.layers.set(LAYER.NEAR);
  scene.add(clouds);

  // --- cloud layer as a volume (close to it, in flight) ---
  // A screen-covering quad; the shader marches the rays through the layer.
  // It is drawn at half resolution into a target of its own (scenePass.js):
  // colour and alpha, and the depth of the cloud in the depth buffer. The
  // march is the costliest thing in a cloudy flight and the clouds are soft,
  // so a quarter of the pixels is enough.
  const cloudVolume = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      name: 'CloudVolume',
      uniforms,
      vertexShader: CLOUD_VOLUME_VERT,
      fragmentShader: CLOUD_VOLUME_FRAG,
      // Into a cleared target: premultiplied colour and alpha as they are, and
      // the depth the fragment writes (the depth test must be on for that).
      blending: THREE.NoBlending,
      depthFunc: THREE.AlwaysDepth,
      depthWrite: true,
    }),
  );
  cloudVolume.frustumCulled = false;
  cloudVolume.visible = false;
  cloudVolume.layers.set(LAYER.NEAR);
  const volumeScene = new THREE.Scene();
  volumeScene.add(cloudVolume);
  // ...and put over the near scene at full resolution: a quad that copies the
  // colour and the cloud's depth, so the ground in front of a cloud hides it.
  const cloudComposite = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      name: 'CloudComposite',
      uniforms: { tCloud: { value: null }, tCloudDepth: { value: null } },
      vertexShader: CLOUD_COMPOSITE_VERT,
      fragmentShader: CLOUD_COMPOSITE_FRAG,
      // premultiplied colour over what is behind
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      transparent: true,
      depthWrite: false,
    }),
  );
  cloudComposite.frustumCulled = false;
  cloudComposite.renderOrder = 2;
  cloudComposite.visible = false;
  cloudComposite.layers.set(LAYER.NEAR);
  scene.add(cloudComposite);

  // --- atmospheric scattering halo ---
  // Back faces of the shell cover the whole disc, so one pass handles both the
  // halo beyond the limb and the haze in front of the surface. The shader
  // intersects the planet analytically, hence no depth test.
  const atmosphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.065, 128, 128),
    new THREE.ShaderMaterial({
      name: 'Atmosphere',
      uniforms,
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      side: THREE.BackSide,
      // colour + behind * alpha (atmosphere.js)
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  atmosphere.renderOrder = 3;
  atmosphere.layers.set(LAYER.AIR);
  scene.add(atmosphere);

  // --- rings ---
  // The mesh spans the widest ring any archetype uses; the shader trims it to
  // the current inner / outer radius.
  const ringGeometry = new THREE.RingGeometry(1.1, 3.2, 256, 1);
  const makeRing = (pass, order) => {
    const mesh = new THREE.Mesh(
      ringGeometry,
      new THREE.ShaderMaterial({
        name: pass > 0 ? 'RingsNear' : 'RingsFar',
        uniforms: { ...uniforms, uRingPass: { value: pass } },
        vertexShader: RINGS_VERT,
        fragmentShader: RINGS_FRAG,
        side: THREE.DoubleSide,
        transparent: true,
        premultipliedAlpha: true,
        depthWrite: false,
      }),
    );
    mesh.rotation.x = -Math.PI / 2;   // lay the ring in the equatorial plane
    mesh.renderOrder = order;
    mesh.layers.set(LAYER.FAR);
    return mesh;
  };
  const ringFar = makeRing(-1, 2);
  const ringNear = makeRing(1, 4);
  const rings = new THREE.Group();
  rings.add(ringFar, ringNear);
  scene.add(rings);

  return { scene, sky, planet, terrain, clouds, cloudVolume, volumeScene, cloudComposite, atmosphere, rings };
}
