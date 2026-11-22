/**
 * Effective Eureka - "Enter the Realm" burst effect
 *
 * The button explodes into tiny 3D shapes that fly outward, spin, spark
 * as they travel, then each pop with a spark burst and a sound.
 *
 * Performance: each shape type is one mesh drawn many times with
 * instancing (one draw call per shape type), and sparks come from a small
 * pool of reusable particle systems.
 *
 * Usage:
 *   const burst = createBurstEffect(scene);
 *   burst.burst(worldPosition);        // on click
 *   burst.update(deltaSeconds);        // every frame
 *
 * @module scenes/home/burstEffect
 */

import {
  Color3,
  Color4,
  DynamicTexture,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import { particlePop, spark } from '@/audio/sfx.js';
import { TAU, clamp, easeOutBack, randPick, randRange } from '@/utils/math.js';

// -----------------------------------------------------------------------------
//  Tuning
// -----------------------------------------------------------------------------

const GRAVITY = -5.5;
const AIR_DRAG = 1.4;
const POP_DURATION = 0.09; // seconds the "swell before popping" lasts
const SPARK_POOL_SIZE = 8;
const FLASH_DURATION = 0.6;

/** Neon palette for the flying shapes. */
const PALETTE = [
  '#33d17a', // vine green
  '#c6ff3d', // lime
  '#3df5ff', // cyan
  '#ff3dd8', // magenta
  '#ffc43d', // amber
  '#9d5cff', // violet
  '#ff6b3d', // orange
].map((hex) => Color4.FromColor3(Color3.FromHexString(hex), 1));

/** Spark colors (bright, additive). */
const SPARK_COLORS = [
  [new Color4(1, 1, 0.6, 1), new Color4(0.8, 1, 0.3, 1)],
  [new Color4(0.6, 1, 1, 1), new Color4(1, 0.5, 1, 1)],
  [new Color4(1, 0.85, 0.4, 1), new Color4(1, 1, 1, 1)],
];

// -----------------------------------------------------------------------------
//  Screen helper
// -----------------------------------------------------------------------------

/**
 * Convert a point on the screen (CSS pixels relative to the canvas) into a
 * 3D position on the flat plane z = planeZ.
 *
 * @param {import('@babylonjs/core').Scene} scene
 * @param {number} screenX
 * @param {number} screenY
 * @param {number} [planeZ=0]
 * @returns {Vector3}
 */
export function screenToWorldOnPlane(scene, screenX, screenY, planeZ = 0) {
  const camera = scene.activeCamera;
  if (!camera) return new Vector3(0, 0, planeZ);

  const ray = scene.createPickingRay(screenX, screenY, null, camera);
  if (Math.abs(ray.direction.z) < 1e-6) return new Vector3(0, 0, planeZ);

  const distance = (planeZ - ray.origin.z) / ray.direction.z;
  return ray.origin.add(ray.direction.scale(distance));
}

// -----------------------------------------------------------------------------
//  Effect
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} BurstOptions
 * @property {number} [panRange=4]  World distance from center that counts as fully left/right for audio panning
 */

/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {BurstOptions} [options]
 */
export function createBurstEffect(scene, { panRange = 4 } = {}) {
  // ---------------------------------------------------------------------------
  //  Shape sources (one per shape type, drawn many times via instances)
  // ---------------------------------------------------------------------------
  const material = new StandardMaterial('burst-shape-material', scene);
  material.diffuseColor = new Color3(1, 1, 1); // tinted per instance
  material.specularColor = new Color3(1, 1, 1);
  material.specularPower = 48;
  material.emissiveColor = new Color3(0.15, 0.15, 0.15);

  const sources = [
    MeshBuilder.CreateSphere('burst-sphere', { diameter: 0.16, segments: 8 }, scene),
    MeshBuilder.CreateBox('burst-cube', { size: 0.13 }, scene),
    MeshBuilder.CreatePolyhedron('burst-tetra', { type: 0, size: 0.09 }, scene),
    MeshBuilder.CreatePolyhedron('burst-octa', { type: 1, size: 0.09 }, scene),
    MeshBuilder.CreatePolyhedron('burst-dodeca', { type: 2, size: 0.07 }, scene),
    MeshBuilder.CreateTorus('burst-ring', { diameter: 0.15, thickness: 0.045, tessellation: 16 }, scene),
    MeshBuilder.CreateCylinder('burst-cone', { height: 0.17, diameterTop: 0, diameterBottom: 0.12, tessellation: 10 }, scene),
  ];

  for (const source of sources) {
    source.material = material;
    source.isPickable = false;
    source.registerInstancedBuffer('color', 4);
    source.instancedBuffers.color = new Color4(1, 1, 1, 1);
    // Keep the source itself out of sight; only its instances are shown.
    source.position.set(0, -1000, 0);
    source.scaling.setAll(0.0001);
    source.alwaysSelectAsActiveMesh = true; // instances stay drawn when the source is off-screen
  }

  // ---------------------------------------------------------------------------
  //  Spark particle pool
  // ---------------------------------------------------------------------------
  const sparkTexture = createSparkTexture(scene);
  const sparkPool = Array.from({ length: SPARK_POOL_SIZE }, (_, i) =>
    createSparkSystem(scene, sparkTexture, i),
  );
  let nextSparkSystem = 0;

  /**
   * Emit sparks at a position using the next system in the pool.
   * @param {Vector3} position
   * @param {number} count
   * @param {number} [power=1]
   */
  function emitSparks(position, count, power = 1) {
    const system = sparkPool[nextSparkSystem];
    nextSparkSystem = (nextSparkSystem + 1) % sparkPool.length;

    /** @type {Vector3} */ (system.emitter).copyFrom(position);
    const [c1, c2] = randPick(SPARK_COLORS);
    system.color1 = c1;
    system.color2 = c2;
    system.minEmitPower = 0.8 * power;
    system.maxEmitPower = 2.6 * power;
    system.manualEmitCount = Math.max(system.manualEmitCount, 0) + count;
  }

  // ---------------------------------------------------------------------------
  //  Flash of light
  // ---------------------------------------------------------------------------
  const flash = new PointLight('burst-flash', Vector3.Zero(), scene);
  flash.diffuse = Color3.FromHexString('#d8ff9a');
  flash.specular = Color3.FromHexString('#ffffff');
  flash.intensity = 0;
  flash.range = 12;
  let flashTime = 0;

  // ---------------------------------------------------------------------------
  //  Live particles
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} BurstParticle
   * @property {import('@babylonjs/core').InstancedMesh} mesh
   * @property {Vector3} velocity
   * @property {Vector3} spin
   * @property {number} age
   * @property {number} lifetime
   * @property {number} size
   * @property {number} popAge  -1 while flying, then counts up during the pop
   * @property {number} sparkTimer
   */

  /** @type {BurstParticle[]} */
  let particles = [];
  let instanceCounter = 0;

  /**
   * Explode from a world position.
   * @param {Vector3} origin
   * @param {{ count?: number }} [options]
   */
  function burst(origin, { count = 70 } = {}) {
    for (let i = 0; i < count; i += 1) {
      const source = randPick(sources);
      const mesh = source.createInstance(`burst-${instanceCounter++}`);
      mesh.isPickable = false;
      mesh.instancedBuffers.color = randPick(PALETTE).clone();

      // Start slightly scattered around the button.
      mesh.position.copyFrom(origin).addInPlaceFromFloats(
        randRange(-0.35, 0.35),
        randRange(-0.1, 0.1),
        randRange(-0.1, 0.1),
      );
      mesh.rotation.set(randRange(0, TAU), randRange(0, TAU), randRange(0, TAU));

      const size = randRange(0.6, 1.6);
      mesh.scaling.setAll(0.01); // grows in on the first frames

      // Fly outward in all directions, biased upward and toward the camera.
      const angle = randRange(0, TAU);
      const speed = randRange(2.5, 7);
      const velocity = new Vector3(
        Math.cos(angle) * speed,
        Math.sin(angle) * speed * 0.8 + randRange(1.5, 4),
        randRange(-1, 3.5),
      );

      particles.push({
        mesh,
        velocity,
        spin: new Vector3(randRange(-9, 9), randRange(-9, 9), randRange(-9, 9)),
        age: 0,
        lifetime: randRange(0.55, 1.7),
        size,
        popAge: -1,
        sparkTimer: randRange(0.03, 0.15),
      });
    }

    // Big central spark explosion and a flash of light.
    emitSparks(origin, 80, 2.2);
    emitSparks(origin, 40, 1.2);
    flash.position.copyFrom(origin).addInPlaceFromFloats(0, 0, -1);
    flashTime = FLASH_DURATION;
  }

  /**
   * @param {number} deltaSeconds
   */
  function update(deltaSeconds) {
    // Flash fades out quickly.
    if (flashTime > 0) {
      flashTime = Math.max(0, flashTime - deltaSeconds);
      const t = flashTime / FLASH_DURATION;
      flash.intensity = 9 * t * t;
    }

    if (particles.length === 0) return;

    const drag = Math.exp(-AIR_DRAG * deltaSeconds);
    const survivors = [];

    for (const p of particles) {
      p.age += deltaSeconds;

      if (p.popAge < 0) {
        // ---- Flying ----
        p.velocity.y += GRAVITY * deltaSeconds;
        p.velocity.scaleInPlace(drag);
        p.mesh.position.addInPlace(p.velocity.scale(deltaSeconds));
        p.mesh.rotation.addInPlace(p.spin.scale(deltaSeconds));

        // Pop in with a little overshoot during the first 0.15 seconds.
        const grow = clamp(p.age / 0.15, 0, 1);
        p.mesh.scaling.setAll(p.size * Math.max(0.01, easeOutBack(grow)));

        // Trailing sparks while flying.
        p.sparkTimer -= deltaSeconds;
        if (p.sparkTimer <= 0) {
          p.sparkTimer = randRange(0.08, 0.22);
          emitSparks(p.mesh.position, 3, 0.5);
          if (Math.random() < 0.25) spark({ pan: panFor(p.mesh.position.x) });
        }

        if (p.age >= p.lifetime) p.popAge = 0;
        survivors.push(p);
      } else {
        // ---- Popping: swell quickly, then vanish ----
        p.popAge += deltaSeconds;
        const t = p.popAge / POP_DURATION;

        if (t < 1) {
          p.mesh.scaling.setAll(p.size * (1 + t * 0.9));
          survivors.push(p);
        } else {
          emitSparks(p.mesh.position, 14, 1);
          particlePop({ pan: panFor(p.mesh.position.x), size: clamp((p.size - 0.6) / 1, 0, 1) });
          p.mesh.dispose();
        }
      }
    }

    particles = survivors;
  }

  /**
   * Stereo pan from a world x position.
   * @param {number} x
   */
  function panFor(x) {
    return clamp(x / panRange, -1, 1);
  }

  /** @returns {boolean} True while shapes are still flying or popping */
  function isActive() {
    return particles.length > 0;
  }

  function dispose() {
    particles.forEach((p) => p.mesh.dispose());
    particles = [];
    sparkPool.forEach((system) => system.dispose());
    sparkTexture.dispose();
    sources.forEach((source) => source.dispose());
    material.dispose();
    flash.dispose();
  }

  return { burst, update, isActive, dispose };
}

// =============================================================================
//  Spark helpers
// =============================================================================

/**
 * A soft glowing dot, painted in code so no image file is needed.
 * @param {import('@babylonjs/core').Scene} scene
 * @returns {DynamicTexture}
 */
function createSparkTexture(scene) {
  const size = 64;
  const texture = new DynamicTexture('spark-texture', { width: size, height: size }, scene, false);
  const ctx = texture.getContext();
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.25, 'rgba(255, 255, 230, 0.9)');
  gradient.addColorStop(0.6, 'rgba(255, 255, 200, 0.25)');
  gradient.addColorStop(1, 'rgba(255, 255, 200, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

/**
 * One reusable spark particle system. It emits only when told to
 * (manualEmitCount), never continuously.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {DynamicTexture} texture
 * @param {number} index
 * @returns {ParticleSystem}
 */
function createSparkSystem(scene, texture, index) {
  const system = new ParticleSystem(`burst-sparks-${index}`, 300, scene);
  system.particleTexture = texture;
  system.emitter = Vector3.Zero();
  system.createSphereEmitter(0.06);

  system.blendMode = ParticleSystem.BLENDMODE_ADD; // bright, glowing overlap
  system.colorDead = new Color4(0.3, 0, 0.4, 0);
  system.minSize = 0.03;
  system.maxSize = 0.11;
  system.minLifeTime = 0.15;
  system.maxLifeTime = 0.55;
  system.gravity = new Vector3(0, -4, 0);
  system.minAngularSpeed = -6;
  system.maxAngularSpeed = 6;
  system.emitRate = 0; // only manual bursts
  system.manualEmitCount = 0;
  system.updateSpeed = 1 / 60;

  system.start();
  return system;
}