/**
 * Effective Eureka - scientist explosion
 *
 * A deliberately huge, over-the-top cartoon explosion:
 *  - fireball (white-hot → orange → red) plus three aftershock fireballs
 *  - two shockwave rings (toward the camera and across the floor)
 *  - particle fire, sparks, smoke and red mist
 *  - red splatter blobs that fly, fall, and flatten into puddles on the floor
 *  - debris: lab-coat scraps, flask glass and goggle pieces that tumble and bounce
 *  - cartoon BONES that fly everywhere, then clatter, bounce and skid on the floor
 *  - the scientist's cartoon SKULL, still wearing his glowing goggles, landing with a BONK
 *  - red splats that hit the "camera lens", then drip down and fade
 *  - an orange flash of light
 *
 * Performance: blobs, debris and bones use instancing (one draw call per
 * shape), and particle systems are created once and reused.
 *
 * Usage:
 *   const explosion = createExplosion(scene, camera, { playerColor });
 *   explosion.explode(position);   // when the scientist is hit
 *   explosion.update(dt);          // every frame
 *   explosion.clear();             // when restarting
 *
 * @module scenes/game/explosion
 */

import {
  Color3,
  Color4,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  PointLight,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { boneClack, skullBonk, splat } from '@/audio/sfx.js';
import { TAU, clamp, damp, easeOutCubic, randPick, randRange } from '@/utils/math.js';

// -----------------------------------------------------------------------------
//  Tuning
// -----------------------------------------------------------------------------

const BLOB_COUNT = 70;
const DEBRIS_COUNT = 22;
const BONE_COUNT = 14;
const SCREEN_SPLAT_COUNT = 8;
const GRAVITY = -20;

const FIREBALL_GROW = 0.32; // seconds to reach full size
const FIREBALL_LIFE = 0.9;
const SHOCKWAVE_LIFE = 0.55;
const AFTERSHOCK_TIMES = [0.18, 0.42, 0.78]; // matches the echo booms in sfx.explosion()

const SCREEN_SPLAT_DISTANCE = 1.3; // in front of the camera
const SCREEN_SPLAT_HOLD = 2.4; // seconds before fading starts
const SCREEN_SPLAT_FADE = 2.2;

/** Bones and skull bounce physics */
const BONE_BOUNCE = 0.42; // share of vertical speed kept on each bounce
const BONE_REST_SPEED = 1.8; // below this impact speed, a bone stops bouncing
const BONE_SKID_FRICTION = 5; // how quickly resting bones stop sliding
const SKULL_RADIUS = 0.18;

/** Red splatter shades. */
const RED_SHADES = ['#b3001b', '#d90429', '#ff1f3d', '#8a0012', '#ff4d5e'].map((hex) =>
  Color4.FromColor3(Color3.FromHexString(hex), 1),
);

/**
 * @typedef {Object} ExplosionOptions
 * @property {string} [playerColor='#33d17a'] Goggle color (debris and skull)
 * @property {number} [floorY=0]              Height of the floor surface
 * @property {number} [floorFrontZ=-1]        Front edge of the floor (things in front of it keep falling)
 * @property {number} [panRange=8]            World x distance treated as fully left/right for sound
 */

/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {import('@babylonjs/core').Camera} camera
 * @param {ExplosionOptions} [options]
 */
export function createExplosion(
  scene,
  camera,
  { playerColor = '#33d17a', floorY = 0, floorFrontZ = -1, panRange = 8 } = {},
) {
  const glowTexture = createGlowTexture(scene);
  const splatTextures = [0, 1, 2].map((i) => createSplatTexture(scene, i));

  // ---------------------------------------------------------------------------
  //  Fireball and shockwaves
  // ---------------------------------------------------------------------------
  const fireMaterial = new StandardMaterial('explosion-fire', scene);
  fireMaterial.disableLighting = true;
  fireMaterial.emissiveColor = new Color3(1, 1, 0.8);
  fireMaterial.alpha = 0;
  fireMaterial.backFaceCulling = false;

  const fireball = MeshBuilder.CreateSphere('explosion-fireball', { diameter: 1, segments: 24 }, scene);
  fireball.material = fireMaterial;
  fireball.isPickable = false;
  fireball.setEnabled(false);

  /** Smaller fireballs for the aftershocks. */
  const aftershocks = AFTERSHOCK_TIMES.map((startTime, i) => {
    const material = fireMaterial.clone(`explosion-aftershock-mat-${i}`);
    const mesh = MeshBuilder.CreateSphere(`explosion-aftershock-${i}`, { diameter: 1, segments: 16 }, scene);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.setEnabled(false);
    return { mesh, material, startTime, offset: new Vector3(), size: 1 };
  });

  const ringMaterial = new StandardMaterial('explosion-ring', scene);
  ringMaterial.disableLighting = true;
  ringMaterial.emissiveColor = new Color3(1, 0.85, 0.5);
  ringMaterial.alpha = 0;
  ringMaterial.backFaceCulling = false;

  // Ring facing the camera
  const airRing = MeshBuilder.CreateTorus('explosion-air-ring', { diameter: 1, thickness: 0.06, tessellation: 48 }, scene);
  airRing.rotation.x = Math.PI / 2;
  airRing.material = ringMaterial;
  airRing.isPickable = false;
  airRing.setEnabled(false);

  // Ring rippling across the floor
  const floorRing = MeshBuilder.CreateTorus('explosion-floor-ring', { diameter: 1, thickness: 0.05, tessellation: 48 }, scene);
  floorRing.material = ringMaterial;
  floorRing.isPickable = false;
  floorRing.setEnabled(false);

  const flashLight = new PointLight('explosion-light', Vector3.Zero(), scene);
  flashLight.diffuse = new Color3(1, 0.55, 0.2);
  flashLight.specular = new Color3(1, 0.7, 0.4);
  flashLight.range = 16;
  flashLight.intensity = 0;

  // ---------------------------------------------------------------------------
  //  Particle systems (created once, fired on demand)
  // ---------------------------------------------------------------------------
  const fire = createBurstSystem(scene, glowTexture, 'explosion-fire-particles', {
    capacity: 220,
    blend: ParticleSystem.BLENDMODE_ADD,
    color1: new Color4(1, 0.85, 0.3, 1),
    color2: new Color4(1, 0.35, 0.05, 1),
    colorDead: new Color4(0.4, 0, 0, 0),
    size: [0.3, 1],
    life: [0.2, 0.6],
    power: [3, 9],
    gravity: new Vector3(0, 2, 0),
    radius: 0.35,
  });

  const sparks = createBurstSystem(scene, glowTexture, 'explosion-sparks', {
    capacity: 200,
    blend: ParticleSystem.BLENDMODE_ADD,
    color1: new Color4(1, 1, 0.6, 1),
    color2: new Color4(1, 0.6, 0.2, 1),
    colorDead: new Color4(0.5, 0.1, 0, 0),
    size: [0.04, 0.11],
    life: [0.3, 1],
    power: [6, 17],
    gravity: new Vector3(0, -12, 0),
    radius: 0.2,
  });

  const smoke = createBurstSystem(scene, glowTexture, 'explosion-smoke', {
    capacity: 90,
    blend: ParticleSystem.BLENDMODE_STANDARD,
    color1: new Color4(0.28, 0.24, 0.24, 0.65),
    color2: new Color4(0.15, 0.12, 0.12, 0.55),
    colorDead: new Color4(0.05, 0.05, 0.05, 0),
    size: [0.7, 1.8],
    life: [1, 2.6],
    power: [1, 3],
    gravity: new Vector3(0, 1.3, 0),
    radius: 0.5,
  });

  const redMist = createBurstSystem(scene, glowTexture, 'explosion-red-mist', {
    capacity: 140,
    blend: ParticleSystem.BLENDMODE_STANDARD,
    color1: new Color4(0.85, 0.02, 0.06, 0.85),
    color2: new Color4(0.55, 0, 0.03, 0.75),
    colorDead: new Color4(0.25, 0, 0, 0),
    size: [0.15, 0.5],
    life: [0.4, 1.2],
    power: [2, 8],
    gravity: new Vector3(0, -6, 0),
    radius: 0.3,
  });

  const particleSystems = [fire, sparks, smoke, redMist];

  // ---------------------------------------------------------------------------
  //  Red blobs and debris (instanced)
  // ---------------------------------------------------------------------------
  const blobMaterial = new StandardMaterial('explosion-blob', scene);
  blobMaterial.diffuseColor = new Color3(1, 1, 1); // tinted per instance
  blobMaterial.specularColor = new Color3(1, 0.8, 0.8); // wet shine
  blobMaterial.specularPower = 80;
  blobMaterial.emissiveColor = new Color3(0.25, 0, 0.02);

  const blobSource = MeshBuilder.CreateSphere('explosion-blob-source', { diameter: 0.2, segments: 8 }, scene);
  prepareInstanceSource(blobSource, blobMaterial, true);

  const debrisMaterial = new StandardMaterial('explosion-debris', scene);
  debrisMaterial.diffuseColor = new Color3(1, 1, 1);
  debrisMaterial.specularColor = new Color3(0.6, 0.6, 0.6);
  debrisMaterial.emissiveColor = new Color3(0.2, 0.2, 0.2);
  debrisMaterial.backFaceCulling = false;

  const debrisSource = MeshBuilder.CreateBox(
    'explosion-debris-source',
    { width: 0.18, height: 0.03, depth: 0.13 },
    scene,
  );
  prepareInstanceSource(debrisSource, debrisMaterial, true);

  const debrisColors = [
    Color4.FromHexString('#f4f7f6ff'), // lab coat
    Color4.FromHexString('#f4f7f6ff'),
    Color4.FromHexString('#f4f7f6ff'),
    Color4.FromHexString('#d8f6ffff'), // flask glass
    Color4.FromColor3(Color3.FromHexString(playerColor), 1), // goggle lens
    Color4.FromHexString('#3b2a5cff'), // trousers
  ];

  // ---------------------------------------------------------------------------
  //  Cartoon bones (instanced) and the skull
  // ---------------------------------------------------------------------------
  const boneMaterial = new StandardMaterial('explosion-bone', scene);
  boneMaterial.diffuseColor = Color3.FromHexString('#f5eedc');
  boneMaterial.specularColor = new Color3(0.5, 0.5, 0.45);
  boneMaterial.specularPower = 32;
  boneMaterial.emissiveColor = Color3.FromHexString('#3a352a'); // stays readable under wild lights

  const boneSource = createBoneTemplate(scene);
  prepareInstanceSource(boneSource, boneMaterial, false);

  const skull = createSkull(scene, boneMaterial, playerColor);
  skull.node.setEnabled(false);

  /**
   * @typedef {Object} Chunk
   * @property {import('@babylonjs/core').InstancedMesh} mesh
   * @property {Vector3} velocity
   * @property {Vector3} spin
   * @property {number} size
   * @property {boolean} resting
   */

  /** @type {Chunk[]} */
  let blobs = [];
  /** @type {Chunk[]} */
  let debris = [];
  /** @type {Chunk[]} */
  let bones = [];
  let instanceCounter = 0;

  /** Skull state */
  const skullState = {
    active: false,
    resting: false,
    velocity: new Vector3(),
    spin: new Vector3(),
  };

  // ---------------------------------------------------------------------------
  //  Screen splats (on the "camera lens")
  // ---------------------------------------------------------------------------

  /**
   * @typedef {Object} ScreenSplat
   * @property {Mesh} mesh
   * @property {StandardMaterial} material
   * @property {number} appearAt   Seconds after the explosion
   * @property {number} size
   * @property {boolean} shown
   */

  /** @type {ScreenSplat[]} */
  let screenSplats = [];

  // ---------------------------------------------------------------------------
  //  State
  // ---------------------------------------------------------------------------
  let age = -1; // -1 = no explosion running
  const origin = new Vector3();

  // ---------------------------------------------------------------------------
  //  Explode!
  // ---------------------------------------------------------------------------

  /**
   * Blow up at a position (usually the scientist's chest).
   * @param {Vector3} position
   */
  function explode(position) {
    clear();
    age = 0;
    origin.copyFrom(position);

    // Fireball, rings and light
    fireball.position.copyFrom(origin);
    fireball.setEnabled(true);
    airRing.position.copyFrom(origin);
    airRing.setEnabled(true);
    floorRing.position.set(origin.x, floorY + 0.02, origin.z);
    floorRing.setEnabled(true);
    flashLight.position.copyFrom(origin).addInPlaceFromFloats(0, 0.5, -1.5);

    for (const shock of aftershocks) {
      shock.offset.set(randRange(-1.2, 1.2), randRange(-0.3, 1.2), randRange(-0.5, 0.5));
      shock.size = randRange(1.2, 2);
      shock.mesh.setEnabled(false);
    }

    // Particles
    fire.emitter = origin.clone();
    sparks.emitter = origin.clone();
    smoke.emitter = origin.clone();
    redMist.emitter = origin.clone();
    fire.manualEmitCount = 200;
    sparks.manualEmitCount = 180;
    smoke.manualEmitCount = 70;
    redMist.manualEmitCount = 130;

    spawnBlobs();
    spawnDebris();
    spawnBones();
    launchSkull();
    spawnScreenSplats();
  }

  function spawnBlobs() {
    for (let i = 0; i < BLOB_COUNT; i += 1) {
      const mesh = blobSource.createInstance(`explosion-blob-${instanceCounter++}`);
      mesh.isPickable = false;
      mesh.instancedBuffers.color = randPick(RED_SHADES).clone();
      mesh.position.copyFrom(origin).addInPlaceFromFloats(
        randRange(-0.25, 0.25),
        randRange(-0.3, 0.4),
        randRange(-0.2, 0.2),
      );

      const size = randRange(0.5, 1.8);
      mesh.scaling.setAll(size);

      const angle = randRange(0, TAU);
      const speed = randRange(4, 14);
      blobs.push({
        mesh,
        velocity: new Vector3(
          Math.cos(angle) * speed,
          Math.abs(Math.sin(angle)) * speed * 0.9 + randRange(2, 7),
          randRange(-3, 1.5),
        ),
        spin: new Vector3(),
        size,
        resting: false,
      });
    }
  }

  function spawnDebris() {
    for (let i = 0; i < DEBRIS_COUNT; i += 1) {
      const mesh = debrisSource.createInstance(`explosion-debris-${instanceCounter++}`);
      mesh.isPickable = false;
      mesh.instancedBuffers.color = randPick(debrisColors).clone();
      mesh.position.copyFrom(origin);
      mesh.rotation.set(randRange(0, TAU), randRange(0, TAU), randRange(0, TAU));

      const size = randRange(0.7, 1.6);
      mesh.scaling.setAll(size);

      const angle = randRange(0, TAU);
      const speed = randRange(5, 13);
      debris.push({
        mesh,
        velocity: new Vector3(
          Math.cos(angle) * speed,
          Math.abs(Math.sin(angle)) * speed + randRange(3, 8),
          randRange(-2, 2),
        ),
        spin: new Vector3(randRange(-14, 14), randRange(-14, 14), randRange(-14, 14)),
        size,
        resting: false,
      });
    }
  }

  function spawnBones() {
    for (let i = 0; i < BONE_COUNT; i += 1) {
      const mesh = boneSource.createInstance(`explosion-bone-${instanceCounter++}`);
      mesh.isPickable = false;
      mesh.position.copyFrom(origin).addInPlaceFromFloats(
        randRange(-0.2, 0.2),
        randRange(-0.2, 0.3),
        randRange(-0.1, 0.1),
      );
      mesh.rotation.set(randRange(0, TAU), randRange(0, TAU), randRange(0, TAU));

      const size = randRange(0.65, 1.5);
      mesh.scaling.setAll(size);

      // Fling them high and wide so they're easy to see.
      const angle = randRange(0.15, Math.PI - 0.15); // mostly upward
      const speed = randRange(6, 14);
      bones.push({
        mesh,
        velocity: new Vector3(
          Math.cos(angle) * speed * randRange(0.8, 1.3),
          Math.sin(angle) * speed + randRange(3, 7),
          randRange(-1.2, 1.5),
        ),
        // Spin mostly end over end (around z) so it reads clearly from the side.
        spin: new Vector3(randRange(-6, 6), randRange(-6, 6), randRange(-16, 16)),
        size,
        resting: false,
      });
    }
  }

  function launchSkull() {
    skull.node.position.copyFrom(origin).addInPlaceFromFloats(0, 0.3, 0);
    skull.node.rotation.set(0, Math.PI / 2, 0);
    skull.node.setEnabled(true);
    skullState.active = true;
    skullState.resting = false;
    skullState.velocity.set(randRange(-2.5, 2.5), randRange(10, 13), randRange(-0.6, 0.4));
    skullState.spin.set(randRange(-3, 3), randRange(-4, 4), randRange(-11, 11));
  }

  function spawnScreenSplats() {
    const halfHeight = SCREEN_SPLAT_DISTANCE * Math.tan(camera.fov / 2);
    const engine = scene.getEngine();
    const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
    const halfWidth = halfHeight * aspect;

    for (let i = 0; i < SCREEN_SPLAT_COUNT; i += 1) {
      const material = new StandardMaterial(`explosion-screen-splat-mat-${i}`, scene);
      material.diffuseTexture = randPick(splatTextures);
      material.diffuseTexture.hasAlpha = true;
      material.useAlphaFromDiffuseTexture = true;
      material.disableLighting = true;
      // Lighting is off, so the material needs a full-white self-glow to
      // show the texture's own colors (bright red) instead of black.
      material.emissiveColor = new Color3(1, 1, 1);
      material.diffuseColor = new Color3(0, 0, 0);
      material.specularColor = new Color3(0, 0, 0);
      material.fogEnabled = false;
      material.backFaceCulling = false;

      const mesh = MeshBuilder.CreatePlane(`explosion-screen-splat-${i}`, { size: 1 }, scene);
      mesh.material = material;
      mesh.parent = camera; // stuck to the "lens"
      mesh.isPickable = false;
      mesh.renderingGroupId = 1; // always drawn on top of the world
      mesh.position.set(
        randRange(-halfWidth * 0.85, halfWidth * 0.85),
        randRange(-halfHeight * 0.6, halfHeight * 0.85),
        SCREEN_SPLAT_DISTANCE,
      );
      mesh.rotation.z = randRange(0, TAU);
      mesh.setEnabled(false);

      screenSplats.push({
        mesh,
        material,
        appearAt: 0.08 + i * randRange(0.04, 0.09),
        size: randRange(0.18, 0.42) * halfHeight * 1.6,
        shown: false,
      });
    }
  }

  // ---------------------------------------------------------------------------
  //  Update
  // ---------------------------------------------------------------------------

  /** @param {number} dt */
  function update(dt) {
    if (age < 0) return;
    age += dt;

    updateFireball();
    updateAftershocks();
    updateShockwaves();
    updateBlobs(dt);
    updateDebris(dt);
    updateBones(dt);
    updateSkull(dt);
    updateScreenSplats(dt);

    // Orange flash fades quickly.
    const flashT = clamp(1 - age / 0.7, 0, 1);
    flashLight.intensity = 14 * flashT * flashT;
  }

  function updateFireball() {
    if (age > FIREBALL_LIFE) {
      fireball.setEnabled(false);
      return;
    }
    const grow = easeOutCubic(clamp(age / FIREBALL_GROW, 0, 1));
    fireball.scaling.setAll(0.3 + grow * 3.4);

    // White-hot → orange → deep red, then fade.
    const t = age / FIREBALL_LIFE;
    fireMaterial.emissiveColor.set(1, clamp(1 - t * 1.3, 0.1, 1), clamp(0.8 - t * 2, 0, 1));
    fireMaterial.alpha = clamp(1 - Math.pow(t, 1.5), 0, 1) * 0.95;
  }

  function updateAftershocks() {
    for (const shock of aftershocks) {
      const local = age - shock.startTime;
      if (local < 0 || local > 0.5) {
        shock.mesh.setEnabled(false);
        continue;
      }
      shock.mesh.setEnabled(true);
      shock.mesh.position.copyFrom(origin).addInPlace(shock.offset);
      const t = local / 0.5;
      shock.mesh.scaling.setAll(shock.size * easeOutCubic(t));
      shock.material.emissiveColor.set(1, clamp(0.8 - t, 0.15, 1), 0.1);
      shock.material.alpha = 0.9 * (1 - t);
    }
  }

  function updateShockwaves() {
    if (age > SHOCKWAVE_LIFE) {
      airRing.setEnabled(false);
      floorRing.setEnabled(false);
      return;
    }
    const t = age / SHOCKWAVE_LIFE;
    const scale = 0.5 + easeOutCubic(t) * 9;
    airRing.scaling.set(scale, scale, scale);
    floorRing.scaling.set(scale * 1.3, 1, scale * 1.3);
    ringMaterial.alpha = (1 - t) * 0.85;
  }

  /** @param {number} dt */
  function updateBlobs(dt) {
    const survivors = [];
    for (const blob of blobs) {
      if (blob.resting) {
        survivors.push(blob);
        continue;
      }

      blob.velocity.y += GRAVITY * dt;
      blob.velocity.x *= Math.exp(-0.6 * dt);
      blob.mesh.position.addInPlace(blob.velocity.scale(dt));

      // Stretch in the direction of travel for a gooey look.
      const stretch = clamp(blob.velocity.length() / 12, 0, 0.6);
      blob.mesh.scaling.set(blob.size * (1 - stretch * 0.3), blob.size * (1 + stretch), blob.size);

      const overFloor = blob.mesh.position.z >= floorFrontZ;
      if (overFloor && blob.mesh.position.y <= floorY + 0.02 && blob.velocity.y < 0) {
        // SPLAT: flatten into a puddle on the floor.
        blob.resting = true;
        blob.mesh.position.y = floorY + 0.012;
        blob.mesh.rotation.set(0, randRange(0, TAU), 0);
        blob.mesh.scaling.set(blob.size * randRange(1.6, 2.8), 0.06, blob.size * randRange(1.2, 2.1));
        if (Math.random() < 0.35) splat({ pan: panFor(blob.mesh.position.x) });
        survivors.push(blob);
      } else if (blob.mesh.position.y < floorY - 10) {
        blob.mesh.dispose(); // fell off the front edge, out of sight
      } else {
        survivors.push(blob);
      }
    }
    blobs = survivors;
  }

  /** @param {number} dt */
  function updateDebris(dt) {
    for (const piece of debris) {
      if (piece.resting) continue;

      piece.velocity.y += GRAVITY * dt;
      piece.mesh.position.addInPlace(piece.velocity.scale(dt));
      piece.mesh.rotation.addInPlace(piece.spin.scale(dt));

      const overFloor = piece.mesh.position.z >= floorFrontZ;
      if (overFloor && piece.mesh.position.y <= floorY + 0.03 && piece.velocity.y < 0) {
        piece.mesh.position.y = floorY + 0.03;
        if (Math.abs(piece.velocity.y) < 2) {
          // Settle flat on the floor.
          piece.resting = true;
          piece.mesh.rotation.set(0, piece.mesh.rotation.y, 0);
        } else {
          // Bounce with lost energy.
          piece.velocity.y *= -0.35;
          piece.velocity.x *= 0.6;
          piece.velocity.z *= 0.6;
          piece.spin.scaleInPlace(0.5);
        }
      }
    }
  }

  /**
   * Bones fly, tumble, then bounce and clatter across the floor before
   * skidding to a stop.
   * @param {number} dt
   */
  function updateBones(dt) {
    const survivors = [];
    for (const bone of bones) {
      const position = bone.mesh.position;

      if (bone.resting) {
        // Skid along the floor until friction stops it.
        const friction = Math.exp(-BONE_SKID_FRICTION * dt);
        bone.velocity.x *= friction;
        bone.velocity.z *= friction;
        position.x += bone.velocity.x * dt;
        position.z += bone.velocity.z * dt;
        bone.mesh.rotation.y += bone.spin.y * dt * Math.abs(bone.velocity.x) * 0.1;
        survivors.push(bone);
        continue;
      }

      bone.velocity.y += GRAVITY * dt;
      position.addInPlace(bone.velocity.scale(dt));
      bone.mesh.rotation.addInPlace(bone.spin.scale(dt));

      const contactHeight = floorY + 0.05 * bone.size;
      const overFloor = position.z >= floorFrontZ;

      if (overFloor && position.y <= contactHeight && bone.velocity.y < 0) {
        const impact = Math.abs(bone.velocity.y);
        position.y = contactHeight;

        // CLACK! Louder for harder hits, higher for smaller bones.
        boneClack({
          pan: panFor(position.x),
          strength: clamp(impact / 12, 0, 1),
          size: bone.size,
        });

        if (impact < BONE_REST_SPEED) {
          // Lie flat on the floor (keep its heading), then skid.
          bone.resting = true;
          bone.mesh.rotation.set(0, bone.mesh.rotation.y, 0);
        } else {
          bone.velocity.y = impact * BONE_BOUNCE;
          bone.velocity.x *= 0.7;
          bone.velocity.z *= 0.7;
          bone.spin.scaleInPlace(0.6);
          // A little random kick on each bounce makes the clatter feel chaotic.
          bone.spin.z += randRange(-4, 4);
        }
        survivors.push(bone);
      } else if (position.y < floorY - 10) {
        bone.mesh.dispose(); // fell off the front edge, out of sight
      } else {
        survivors.push(bone);
      }
    }
    bones = survivors;
  }

  /**
   * The skull spins through the air, BONKs and bounces, then settles
   * facing the camera.
   * @param {number} dt
   */
  function updateSkull(dt) {
    if (!skullState.active) return;
    const node = skull.node;
    const position = node.position;

    if (skullState.resting) {
      // Roll upright to stare at the camera.
      node.rotation.x = damp(node.rotation.x, 0, 6, dt);
      node.rotation.y = damp(node.rotation.y, Math.PI / 2 - 0.25, 6, dt);
      node.rotation.z = damp(node.rotation.z, 0.12, 6, dt);
      return;
    }

    skullState.velocity.y += GRAVITY * dt;
    position.addInPlace(skullState.velocity.scale(dt));
    node.rotation.addInPlace(skullState.spin.scale(dt));

    const contactHeight = floorY + SKULL_RADIUS;
    const overFloor = position.z >= floorFrontZ;

    if (overFloor && position.y <= contactHeight && skullState.velocity.y < 0) {
      const impact = Math.abs(skullState.velocity.y);
      position.y = contactHeight;
      skullBonk({ pan: panFor(position.x), strength: clamp(impact / 12, 0, 1) });

      if (impact < 2.2) {
        skullState.resting = true;
        node.rotation.x = wrapAngle(node.rotation.x);
        node.rotation.y = wrapAngle(node.rotation.y);
        node.rotation.z = wrapAngle(node.rotation.z);
      } else {
        skullState.velocity.y = impact * 0.45;
        skullState.velocity.x *= 0.65;
        skullState.velocity.z *= 0.6;
        skullState.spin.scaleInPlace(0.55);
      }
    } else if (position.y < floorY - 10) {
      skullState.active = false;
      node.setEnabled(false);
    }
  }

  /** @param {number} dt */
  function updateScreenSplats(dt) {
    for (const s of screenSplats) {
      if (age < s.appearAt) continue;

      if (!s.shown) {
        s.shown = true;
        s.mesh.setEnabled(true);
        splat({ pan: clamp(s.mesh.position.x * 2, -1, 1) });
      }

      const local = age - s.appearAt;

      // Pop onto the lens with an overshoot.
      const pop = local < 0.12 ? easeOutCubic(local / 0.12) * 1.15 : 1 + Math.max(0, 0.15 - (local - 0.12));
      // Slowly drip downward and stretch.
      const drip = Math.max(0, local - 0.4);
      s.mesh.position.y -= dt * 0.025 * Math.min(1, drip);
      s.mesh.scaling.set(s.size * pop, s.size * pop * (1 + drip * 0.08), 1);

      // Fade out after holding.
      const fade = clamp((local - SCREEN_SPLAT_HOLD) / SCREEN_SPLAT_FADE, 0, 1);
      s.material.alpha = 1 - fade;
      if (fade >= 1) s.mesh.setEnabled(false);
    }
  }

  /**
   * @param {number} x
   * @returns {number}
   */
  function panFor(x) {
    return clamp(x / panRange, -1, 1);
  }

  // ---------------------------------------------------------------------------
  //  Cleanup
  // ---------------------------------------------------------------------------

  /** Remove every trace of the last explosion (call on restart). */
  function clear() {
    age = -1;
    blobs.forEach((b) => b.mesh.dispose());
    debris.forEach((d) => d.mesh.dispose());
    bones.forEach((b) => b.mesh.dispose());
    screenSplats.forEach((s) => {
      s.mesh.dispose();
      s.material.dispose();
    });
    blobs = [];
    debris = [];
    bones = [];
    screenSplats = [];

    skullState.active = false;
    skullState.resting = false;
    skull.node.setEnabled(false);

    fireball.setEnabled(false);
    airRing.setEnabled(false);
    floorRing.setEnabled(false);
    aftershocks.forEach((shock) => shock.mesh.setEnabled(false));
    flashLight.intensity = 0;
    particleSystems.forEach((system) => {
      system.manualEmitCount = 0;
      system.reset();
    });
  }

  /** @returns {boolean} True while an explosion is playing or its mess remains */
  function isActive() {
    return age >= 0;
  }

  function dispose() {
    clear();
    particleSystems.forEach((system) => system.dispose());
    glowTexture.dispose();
    splatTextures.forEach((texture) => texture.dispose());
    [fireball, airRing, floorRing, blobSource, debrisSource, boneSource].forEach((mesh) => mesh.dispose());
    aftershocks.forEach((shock) => {
      shock.mesh.dispose();
      shock.material.dispose();
    });
    skull.dispose();
    [fireMaterial, ringMaterial, blobMaterial, debrisMaterial, boneMaterial].forEach((material) =>
      material.dispose(),
    );
    flashLight.dispose();
  }

  return { explode, update, clear, isActive, dispose };
}

// =============================================================================
//  Bone and skull builders
// =============================================================================

/**
 * A classic cartoon bone: a shaft with two round knobs on each end,
 * merged into a single mesh. Its length runs along local x.
 * @param {import('@babylonjs/core').Scene} scene
 * @returns {Mesh}
 */
function createBoneTemplate(scene) {
  const length = 0.5;
  const parts = [];

  const shaft = MeshBuilder.CreateCylinder('bone-shaft', { height: length, diameter: 0.075, tessellation: 12 }, scene);
  shaft.rotation.z = Math.PI / 2; // lie along x
  parts.push(shaft);

  for (const end of [-1, 1]) {
    for (const side of [-1, 1]) {
      const knob = MeshBuilder.CreateSphere('bone-knob', { diameter: 0.11, segments: 10 }, scene);
      knob.position.set(end * length * 0.5, side * 0.04, 0);
      parts.push(knob);
    }
  }

  const bone = /** @type {Mesh} */ (Mesh.MergeMeshes(parts, true, true));
  bone.name = 'explosion-bone-source';
  return bone;
}

/**
 * The scientist's cartoon skull, still wearing his glowing goggles.
 * Faces local +x (like the scientist did).
 * @param {import('@babylonjs/core').Scene} scene
 * @param {StandardMaterial} boneMaterial
 * @param {string} playerColor
 */
function createSkull(scene, boneMaterial, playerColor) {
  const node = new TransformNode('explosion-skull', scene);

  const dark = new StandardMaterial('explosion-skull-dark', scene);
  dark.diffuseColor = Color3.FromHexString('#120a14');
  dark.specularColor = Color3.Black();
  dark.emissiveColor = Color3.FromHexString('#050206');

  const metal = new StandardMaterial('explosion-skull-metal', scene);
  metal.diffuseColor = Color3.FromHexString('#9aa4ad');
  metal.specularColor = new Color3(0.9, 0.9, 0.9);
  metal.emissiveColor = new Color3(0.1, 0.1, 0.1);

  const glow = new StandardMaterial('explosion-skull-glow', scene);
  const glowColor = Color3.FromHexString(playerColor);
  glow.diffuseColor = glowColor;
  glow.emissiveColor = glowColor;
  glow.specularColor = new Color3(0.8, 0.8, 0.8);

  /** @type {Mesh[]} */
  const meshes = [];

  /**
   * @param {Mesh} mesh
   * @param {StandardMaterial} material
   */
  const add = (mesh, material) => {
    mesh.parent = node;
    mesh.material = material;
    mesh.isPickable = false;
    meshes.push(mesh);
    return mesh;
  };

  // Cranium
  const cranium = add(MeshBuilder.CreateSphere('skull-cranium', { diameter: 0.36, segments: 16 }, scene), boneMaterial);
  cranium.scaling.set(1, 0.95, 0.95);

  // Jaw
  const jaw = add(MeshBuilder.CreateBox('skull-jaw', { width: 0.2, height: 0.09, depth: 0.2 }, scene), boneMaterial);
  jaw.position.set(0.05, -0.16, 0);

  // Teeth line
  const teeth = add(MeshBuilder.CreateBox('skull-teeth', { width: 0.01, height: 0.02, depth: 0.15 }, scene), dark);
  teeth.position.set(0.151, -0.14, 0);

  // Eye sockets and nose hole
  for (const side of [-1, 1]) {
    const socket = add(MeshBuilder.CreateSphere(`skull-eye-${side}`, { diameter: 0.09, segments: 10 }, scene), dark);
    socket.position.set(0.14, 0.03, side * 0.07);
  }
  const nose = add(MeshBuilder.CreateCylinder('skull-nose', { height: 0.04, diameterTop: 0, diameterBottom: 0.05, tessellation: 3 }, scene), dark);
  nose.position.set(0.165, -0.05, 0);
  nose.rotation.z = -Math.PI / 2;

  // Goggles: strap plus two rims with glowing lenses
  const strap = add(MeshBuilder.CreateTorus('skull-goggle-strap', { diameter: 0.37, thickness: 0.03, tessellation: 24 }, scene), dark);
  strap.position.y = 0.04;

  for (const side of [-1, 1]) {
    const rim = add(MeshBuilder.CreateTorus(`skull-goggle-rim-${side}`, { diameter: 0.11, thickness: 0.03, tessellation: 16 }, scene), metal);
    rim.position.set(0.175, 0.04, side * 0.07);
    rim.rotation.z = Math.PI / 2;

    const lens = add(MeshBuilder.CreateCylinder(`skull-goggle-lens-${side}`, { diameter: 0.09, height: 0.02, tessellation: 16 }, scene), glow);
    lens.parent = rim;
    lens.position.set(0, 0, 0);
  }

  return {
    node,
    dispose() {
      meshes.forEach((mesh) => mesh.dispose());
      node.dispose();
      [dark, metal, glow].forEach((material) => material.dispose());
    },
  };
}

// =============================================================================
//  Helpers
// =============================================================================

/**
 * Hide an instancing source mesh while keeping its instances visible.
 * @param {Mesh} source
 * @param {StandardMaterial} material
 * @param {boolean} perInstanceColor Enable a separate color for each instance
 */
function prepareInstanceSource(source, material, perInstanceColor) {
  source.material = material;
  source.isPickable = false;
  if (perInstanceColor) {
    source.registerInstancedBuffer('color', 4);
    source.instancedBuffers.color = new Color4(1, 1, 1, 1);
  }
  source.position.set(0, -1000, 0);
  source.scaling.setAll(0.0001);
  source.alwaysSelectAsActiveMesh = true;
}

/**
 * Wrap an angle into -π to π, so easing back to upright takes the short way.
 * @param {number} angle
 * @returns {number}
 */
function wrapAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * @typedef {Object} BurstSystemConfig
 * @property {number} capacity
 * @property {number} blend
 * @property {Color4} color1
 * @property {Color4} color2
 * @property {Color4} colorDead
 * @property {[number, number]} size
 * @property {[number, number]} life
 * @property {[number, number]} power
 * @property {Vector3} gravity
 * @property {number} radius
 */

/**
 * A particle system that only emits when told to (manualEmitCount).
 * @param {import('@babylonjs/core').Scene} scene
 * @param {DynamicTexture} texture
 * @param {string} name
 * @param {BurstSystemConfig} config
 * @returns {ParticleSystem}
 */
function createBurstSystem(scene, texture, name, config) {
  const system = new ParticleSystem(name, config.capacity, scene);
  system.particleTexture = texture;
  system.emitter = Vector3.Zero();
  system.createSphereEmitter(config.radius);
  system.blendMode = config.blend;
  system.color1 = config.color1;
  system.color2 = config.color2;
  system.colorDead = config.colorDead;
  system.minSize = config.size[0];
  system.maxSize = config.size[1];
  system.minLifeTime = config.life[0];
  system.maxLifeTime = config.life[1];
  system.minEmitPower = config.power[0];
  system.maxEmitPower = config.power[1];
  system.gravity = config.gravity;
  system.minAngularSpeed = -4;
  system.maxAngularSpeed = 4;
  system.emitRate = 0;
  system.manualEmitCount = 0;
  system.updateSpeed = 1 / 60;
  system.start();
  return system;
}

/**
 * A soft white glow dot, painted in code.
 * @param {import('@babylonjs/core').Scene} scene
 * @returns {DynamicTexture}
 */
function createGlowTexture(scene) {
  const size = 64;
  const texture = new DynamicTexture('explosion-glow-texture', { width: size, height: size }, scene, false);
  const ctx = texture.getContext();
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.35, 'rgba(255, 255, 255, 0.7)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

/**
 * A cartoon red splat with lobes, droplets and a wet highlight.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {number} variant
 * @returns {DynamicTexture}
 */
function createSplatTexture(scene, variant) {
  const size = 256;
  const center = size / 2;
  const texture = new DynamicTexture(`explosion-splat-texture-${variant}`, { width: size, height: size }, scene, true);
  const ctx = /** @type {CanvasRenderingContext2D} */ (texture.getContext());
  ctx.clearRect(0, 0, size, size);

  const body = ctx.createRadialGradient(center - 10, center - 10, 5, center, center, size * 0.42);
  body.addColorStop(0, '#ff3b4f');
  body.addColorStop(0.6, '#d10022');
  body.addColorStop(1, '#7a0010');
  ctx.fillStyle = body;

  // Irregular main blob
  ctx.beginPath();
  const points = 18;
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * TAU;
    const radius = size * (0.22 + Math.random() * 0.1);
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.quadraticCurveTo(center + Math.cos(angle - 0.17) * radius * 1.15, center + Math.sin(angle - 0.17) * radius * 1.15, x, y);
  }
  ctx.closePath();
  ctx.fill();

  // Splash arms with droplets at the ends
  const arms = 6 + variant * 2;
  for (let i = 0; i < arms; i += 1) {
    const angle = Math.random() * TAU;
    const length = size * (0.28 + Math.random() * 0.17);
    const width = 6 + Math.random() * 10;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#c8001f';
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(center + Math.cos(angle) * length, center + Math.sin(angle) * length);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(
      center + Math.cos(angle) * (length + width),
      center + Math.sin(angle) * (length + width),
      width * 0.8,
      0,
      TAU,
    );
    ctx.fill();
  }

  // Loose droplets
  for (let i = 0; i < 10; i += 1) {
    const angle = Math.random() * TAU;
    const distance = size * (0.3 + Math.random() * 0.17);
    ctx.beginPath();
    ctx.arc(center + Math.cos(angle) * distance, center + Math.sin(angle) * distance, 2 + Math.random() * 5, 0, TAU);
    ctx.fill();
  }

  // Wet highlight
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  ctx.beginPath();
  ctx.ellipse(center - 22, center - 26, 18, 9, -0.6, 0, TAU);
  ctx.fill();

  texture.hasAlpha = true;
  texture.update();
  return texture;
}