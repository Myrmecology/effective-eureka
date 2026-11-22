/**
 * Effective Eureka - home (realm) scene
 *
 * Shown behind the Home, Profile and Review screens. Contains:
 *  - the breathing vines down the center
 *  - two scroll sheets covering the sides (rolled back on Enter)
 *  - the button burst effect
 *  - a glowing nebula backdrop with drifting spores
 *  - camera parallax (follows the mouse slightly) and camera shake
 *
 * Exposes playEnterSequence() for the "Enter the Realm" button.
 *
 * @module scenes/home/homeScene
 */

import {
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  GlowLayer,
  HemisphericLight,
  MeshBuilder,
  PointLight,
  Scene,
  StandardMaterial,
  UniversalCamera,
  Vector3,
} from '@babylonjs/core';
import { enterBurst } from '@/audio/sfx.js';
import { createBurstEffect, screenToWorldOnPlane } from '@/scenes/home/burstEffect.js';
import { createScrollTransition } from '@/scenes/home/scrollTransition.js';
import { createVines } from '@/scenes/home/vines.js';
import { TAU, clamp, createSeededRandom, damp, randRange, wrap } from '@/utils/math.js';

// -----------------------------------------------------------------------------
//  Layout constants (world units)
// -----------------------------------------------------------------------------

const CAMERA_Z = -12;
const CAMERA_FOV = 0.75; // radians (vertical)
const VINES_Z = 0;
const SHEETS_Z = 0.4;
const BURST_Z = -1; // just in front of the vines
const BACKDROP_Z = 8;
const BREATH_SECONDS = 5; // matches the ambience in sfx.js
const SPORE_COUNT = 70;

/**
 * Half the visible width and height at a given depth.
 * @param {import('@babylonjs/core').Engine} engine
 * @param {number} z
 * @returns {{ halfWidth: number, halfHeight: number }}
 */
function visibleHalfSize(engine, z) {
  const distance = z - CAMERA_Z;
  const halfHeight = distance * Math.tan(CAMERA_FOV / 2);
  const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
  return { halfWidth: halfHeight * aspect, halfHeight };
}

/**
 * Scene factory for sceneManager.
 *
 * @param {{
 *   engine: import('@babylonjs/core').Engine,
 *   canvas: HTMLCanvasElement,
 *   options: { startRolled?: boolean }
 * }} context
 */
export function createHomeScene({ engine, options }) {
  const startRolled = Boolean(options.startRolled);

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.008, 0.035, 0.018, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = 0.018;
  scene.fogColor = new Color3(0.01, 0.05, 0.025);

  // ---------------------------------------------------------------------------
  //  Camera (fixed; the user doesn't steer it)
  // ---------------------------------------------------------------------------
  const camera = new UniversalCamera('home-camera', new Vector3(0, 0, CAMERA_Z), scene);
  camera.fov = CAMERA_FOV;
  camera.minZ = 0.1;
  camera.maxZ = 100;
  camera.setTarget(Vector3.Zero());
  camera.inputs.clear(); // no keyboard or mouse steering

  // ---------------------------------------------------------------------------
  //  Lighting
  // ---------------------------------------------------------------------------
  const ambient = new HemisphericLight('home-ambient', new Vector3(0, 1, -0.3), scene);
  ambient.diffuse = Color3.FromHexString('#7dffb0');
  ambient.groundColor = Color3.FromHexString('#06240f');
  ambient.specular = Color3.Black();
  ambient.intensity = 0.55;

  const key = new DirectionalLight('home-key', new Vector3(0.6, -0.5, 1), scene);
  key.diffuse = Color3.FromHexString('#eaffd8');
  key.specular = Color3.FromHexString('#ffffff');
  key.intensity = 1.1;

  // Lime light behind the vines, for a glowing rim
  const rim = new PointLight('home-rim', new Vector3(0, 0, 2.5), scene);
  rim.diffuse = Color3.FromHexString('#c6ff3d');
  rim.specular = Color3.FromHexString('#c6ff3d');
  rim.intensity = 0.9;
  rim.range = 7;

  // ---------------------------------------------------------------------------
  //  Backdrop: nebula plane and drifting spores (revealed by the scroll)
  // ---------------------------------------------------------------------------
  const backdrop = createBackdrop(scene, engine);
  const spores = createSpores(scene);

  const glow = new GlowLayer('home-glow', scene, { blurKernelSize: 48, mainTextureSamples: 2 });
  glow.intensity = 0.9;
  glow.addIncludedOnlyMesh(spores.source);

  // ---------------------------------------------------------------------------
  //  Vines, scroll and burst
  // ---------------------------------------------------------------------------
  const vineView = visibleHalfSize(engine, VINES_Z);
  const vines = createVines(scene, {
    height: vineView.halfHeight * 2.6, // taller than the screen, so no ends show
    breathSeconds: BREATH_SECONDS,
  });
  vines.root.position.z = VINES_Z;

  const sheetView = visibleHalfSize(engine, SHEETS_Z);
  const scroll = createScrollTransition(scene, {
    halfWidth: sheetView.halfWidth,
    halfHeight: sheetView.halfHeight,
    z: SHEETS_Z,
    startRolled,
  });

  const burst = createBurstEffect(scene, {
    panRange: visibleHalfSize(engine, BURST_Z).halfWidth,
  });

  // Keep the layout correct when the window is resized.
  const resizeObserver = engine.onResizeObservable.add(() => {
    const view = visibleHalfSize(engine, SHEETS_Z);
    scroll.resize(view.halfWidth, view.halfHeight);
    backdrop.fit();
  });

  // ---------------------------------------------------------------------------
  //  Camera motion: mouse parallax and shake
  // ---------------------------------------------------------------------------
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const parallax = { x: 0, y: 0, targetX: 0, targetY: 0 };
  const shake = { time: 0, duration: 0, strength: 0 };

  /** @param {PointerEvent} event */
  const handlePointerMove = (event) => {
    if (reducedMotion) return;
    parallax.targetX = (event.clientX / window.innerWidth - 0.5) * 2;
    parallax.targetY = (event.clientY / window.innerHeight - 0.5) * 2;
  };
  window.addEventListener('pointermove', handlePointerMove, { passive: true });

  /**
   * Shake the camera.
   * @param {number} strength World units
   * @param {number} duration Seconds
   */
  function shakeCamera(strength, duration) {
    if (reducedMotion) return;
    shake.strength = strength;
    shake.duration = duration;
    shake.time = duration;
  }

  // ---------------------------------------------------------------------------
  //  Enter sequence
  // ---------------------------------------------------------------------------
  let entering = false;

  /**
   * Burst the button, make the vines gasp, then roll back the scroll.
   * @param {{ screenX: number, screenY: number }} buttonCenter In CSS pixels, relative to the canvas
   * @returns {Promise<void>} Resolves when the scroll has fully rolled away
   */
  async function playEnterSequence({ screenX, screenY }) {
    if (entering || scroll.isRolled()) return;
    entering = true;

    const origin = screenToWorldOnPlane(scene, screenX, screenY, BURST_Z);
    burst.burst(origin);
    enterBurst();
    shakeCamera(0.12, 0.45);

    // The vines take a deep, startled breath.
    vines.setBreathIntensity(3);

    await wait(350);
    await scroll.play(1.9);

    vines.setBreathIntensity(1);
    entering = false;
  }

  // ---------------------------------------------------------------------------
  //  Per-frame update
  // ---------------------------------------------------------------------------

  /**
   * @param {number} deltaSeconds
   * @param {number} elapsedSeconds
   */
  function update(deltaSeconds, elapsedSeconds) {
    vines.update(deltaSeconds, elapsedSeconds);
    burst.update(deltaSeconds);
    scroll.update(deltaSeconds);
    spores.update(deltaSeconds, elapsedSeconds);

    // Rim light breathes with the vines.
    rim.intensity = 0.7 + 0.4 * (0.5 + 0.5 * Math.sin((elapsedSeconds / BREATH_SECONDS) * TAU));

    // Smooth parallax and a slow idle drift.
    parallax.x = damp(parallax.x, parallax.targetX, 3, deltaSeconds);
    parallax.y = damp(parallax.y, parallax.targetY, 3, deltaSeconds);
    const driftX = reducedMotion ? 0 : Math.sin(elapsedSeconds * 0.2) * 0.15;
    const driftY = reducedMotion ? 0 : Math.cos(elapsedSeconds * 0.17) * 0.1;

    let shakeX = 0;
    let shakeY = 0;
    if (shake.time > 0) {
      shake.time = Math.max(0, shake.time - deltaSeconds);
      const strength = shake.strength * (shake.time / shake.duration);
      shakeX = randRange(-strength, strength);
      shakeY = randRange(-strength, strength);
    }

    camera.position.set(
      parallax.x * 0.6 + driftX + shakeX,
      -parallax.y * 0.35 + driftY + shakeY,
      CAMERA_Z,
    );
    camera.setTarget(new Vector3(shakeX * 0.5, shakeY * 0.5, 0));
  }

  // ---------------------------------------------------------------------------
  //  Cleanup
  // ---------------------------------------------------------------------------
  function dispose() {
    window.removeEventListener('pointermove', handlePointerMove);
    engine.onResizeObservable.remove(resizeObserver);
    burst.dispose();
    scroll.dispose();
    vines.dispose();
    spores.dispose();
    backdrop.dispose();
    glow.dispose();
    // The scene itself is disposed by sceneManager.
  }

  return {
    scene,
    update,
    dispose,
    playEnterSequence,
    isScrollRolled: () => scroll.isRolled(),
    setBreathIntensity: (value) => vines.setBreathIntensity(value),
  };
}

// =============================================================================
//  Backdrop
// =============================================================================

/**
 * A large plane far behind everything, painted with a glowing green nebula.
 * @param {Scene} scene
 * @param {import('@babylonjs/core').Engine} engine
 */
function createBackdrop(scene, engine) {
  const size = 1024;
  const texture = new DynamicTexture('nebula-texture', { width: size, height: size }, scene, true);
  const ctx = texture.getContext();
  const rng = createSeededRandom(42);

  ctx.fillStyle = '#020a05';
  ctx.fillRect(0, 0, size, size);

  // Soft colored clouds
  const clouds = ['rgba(31,148,71,', 'rgba(61,245,255,', 'rgba(198,255,61,', 'rgba(157,92,255,'];
  for (let i = 0; i < 22; i += 1) {
    const x = rng() * size;
    const y = rng() * size;
    const radius = 120 + rng() * 320;
    const color = clouds[Math.floor(rng() * clouds.length)];
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `${color}${0.18 + rng() * 0.15})`);
    gradient.addColorStop(1, `${color}0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }

  // Tiny stars
  for (let i = 0; i < 400; i += 1) {
    ctx.fillStyle = `rgba(220,255,230,${0.2 + rng() * 0.6})`;
    const starSize = rng() < 0.92 ? 1 : 2;
    ctx.fillRect(rng() * size, rng() * size, starSize, starSize);
  }
  texture.update();

  const material = new StandardMaterial('nebula-material', scene);
  material.emissiveTexture = texture;
  material.disableLighting = true;
  material.fogEnabled = false;

  const plane = MeshBuilder.CreatePlane('nebula', { size: 1 }, scene);
  plane.material = material;
  plane.isPickable = false;
  plane.position.z = BACKDROP_Z;

  /** Scale the plane so it always fills the screen. */
  function fit() {
    const { halfWidth, halfHeight } = visibleHalfSize(engine, BACKDROP_Z);
    plane.scaling.set(halfWidth * 2.4, halfHeight * 2.4, 1);
  }
  fit();

  return {
    fit,
    dispose() {
      plane.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}

// =============================================================================
//  Spores
// =============================================================================

/**
 * Small glowing orbs drifting upward behind the vines.
 * @param {Scene} scene
 */
function createSpores(scene) {
  const rng = createSeededRandom(1234);

  const material = new StandardMaterial('spore-material', scene);
  material.emissiveColor = Color3.FromHexString('#b5ffd4');
  material.diffuseColor = Color3.Black();
  material.specularColor = Color3.Black();
  material.disableLighting = true;

  const source = MeshBuilder.CreateSphere('spore', { diameter: 0.07, segments: 6 }, scene);
  source.material = material;
  source.isPickable = false;

  const RANGE_Y = 9;
  const spores = [];

  for (let i = 0; i < SPORE_COUNT; i += 1) {
    const mesh = i === 0 ? source : source.createInstance(`spore-${i}`);
    mesh.isPickable = false;
    mesh.position.set(
      randRange(-9, 9, rng),
      randRange(-RANGE_Y, RANGE_Y, rng),
      randRange(1.5, 6.5, rng),
    );
    const scale = randRange(0.5, 1.8, rng);
    mesh.scaling.setAll(scale);
    spores.push({
      mesh,
      speed: randRange(0.15, 0.5, rng),
      swayPhase: randRange(0, TAU, rng),
      baseX: mesh.position.x,
      scale,
    });
  }

  return {
    source,
    /**
     * @param {number} deltaSeconds
     * @param {number} elapsedSeconds
     */
    update(deltaSeconds, elapsedSeconds) {
      for (const spore of spores) {
        const position = spore.mesh.position;
        position.y = wrap(position.y + spore.speed * deltaSeconds, -RANGE_Y, RANGE_Y);
        position.x = spore.baseX + Math.sin(elapsedSeconds * 0.5 + spore.swayPhase) * 0.3;
        const twinkle = 0.75 + 0.25 * Math.sin(elapsedSeconds * 2 + spore.swayPhase);
        spore.mesh.scaling.setAll(spore.scale * clamp(twinkle, 0.5, 1));
      }
    },
    dispose() {
      spores.forEach((spore) => spore.mesh.dispose());
      material.dispose();
    },
  };
}

// =============================================================================
//  Helpers
// =============================================================================

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}