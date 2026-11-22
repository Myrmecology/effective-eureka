/**
 * Effective Eureka - the scientist
 *
 * A procedurally built character with a jointed skeleton:
 *
 *   root (feet on the ground)
 *   └─ hips
 *      ├─ torso ─ head (hair, goggles)
 *      │        ├─ shoulder L/R ─ upper arm ─ elbow ─ forearm ─ hand (flask in front hand)
 *      ├─ coat tails
 *      └─ hip L/R ─ thigh ─ knee ─ shin ─ shoe
 *
 * Each joint is a pivot node. Poses (walk, run, jump, fall, dead) set target
 * angles, and joints ease toward them every frame for smooth blending.
 *
 * He faces +x (right). The camera looks from the front (-z), so joint
 * rotations around the z axis swing limbs forward and back.
 *
 * Also handles vertical physics: gravity, jump, variable jump height,
 * coyote time and landing.
 *
 * @module scenes/game/scientist
 */

import {
  Color3,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { TAU, clamp, damp } from '@/utils/math.js';

// -----------------------------------------------------------------------------
//  Physics tuning
// -----------------------------------------------------------------------------

const GRAVITY = -42;
const JUMP_VELOCITY = 14.5;
const JUMP_CUT_MULTIPLIER = 0.45; // releasing jump early cuts upward speed
const MAX_FALL_SPEED = -32;
const COYOTE_TIME = 0.09; // seconds you can still jump after running off an edge

// -----------------------------------------------------------------------------
//  Body proportions (world units; total height is about 1.6)
// -----------------------------------------------------------------------------

const SHOE_HEIGHT = 0.07;
const THIGH = 0.36;
const SHIN = 0.36;
const HIP_HEIGHT = SHOE_HEIGHT + THIGH + SHIN;
const TORSO = 0.52;
const UPPER_ARM = 0.28;
const FOREARM = 0.27;
const HEAD_SIZE = 0.34;

/** Hitbox, slightly smaller than the body so near-misses feel fair. */
const HITBOX = Object.freeze({ halfWidth: 0.22, height: 1.3, bottom: 0.05 });

/**
 * @typedef {'walk' | 'run' | 'jump' | 'fall' | 'dead'} ScientistState
 */

/**
 * @typedef {Object} ScientistEvents
 * @property {boolean} jumped
 * @property {boolean} landed
 */

/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {{ playerColor?: string }} [options]
 */
export function createScientist(scene, { playerColor = '#33d17a' } = {}) {
  const materials = createMaterials(scene, playerColor);

  // ---------------------------------------------------------------------------
  //  Skeleton and body
  // ---------------------------------------------------------------------------
  const root = new TransformNode('scientist', scene);

  const hips = pivot('hips', root, 0, HIP_HEIGHT, 0);
  const torso = pivot('torso', hips, 0, 0, 0);

  // Lab coat body
  const coat = MeshBuilder.CreateCylinder(
    'coat',
    { height: TORSO, diameterTop: 0.36, diameterBottom: 0.46, tessellation: 20 },
    scene,
  );
  coat.parent = torso;
  coat.position.y = TORSO / 2;
  coat.material = materials.coat;

  // Coat lapels (a darker strip down the front)
  const lapel = MeshBuilder.CreateBox('lapel', { width: 0.04, height: TORSO * 0.9, depth: 0.16 }, scene);
  lapel.parent = torso;
  lapel.position.set(0.2, TORSO * 0.5, 0);
  lapel.rotation.z = -0.08;
  lapel.material = materials.shirt;

  // Coat tails (flap while running)
  const tails = pivot('coat-tails', hips, 0, 0.02, 0);
  const tailMesh = MeshBuilder.CreateCylinder(
    'coat-tail-mesh',
    { height: 0.3, diameterTop: 0.46, diameterBottom: 0.58, tessellation: 20 },
    scene,
  );
  tailMesh.parent = tails;
  tailMesh.position.y = -0.15;
  tailMesh.material = materials.coat;

  // Head
  const neck = pivot('neck', torso, 0.02, TORSO + 0.02, 0);
  const head = MeshBuilder.CreateSphere('head', { diameter: HEAD_SIZE, segments: 16 }, scene);
  head.parent = neck;
  head.position.y = HEAD_SIZE / 2;
  head.material = materials.skin;

  const nose = MeshBuilder.CreateSphere('nose', { diameter: 0.07, segments: 8 }, scene);
  nose.parent = head;
  nose.position.set(HEAD_SIZE / 2, -0.02, 0);
  nose.material = materials.skin;

  // Wild scientist hair
  const hairPuffs = [
    [-0.1, 0.12, 0, 0.22], [-0.16, 0.02, 0.1, 0.18], [-0.16, 0.02, -0.1, 0.18],
    [0, 0.17, 0.08, 0.17], [0, 0.17, -0.08, 0.17], [-0.05, 0.2, 0, 0.16],
    [-0.18, -0.06, 0, 0.15], [0.06, 0.12, 0.14, 0.13], [0.06, 0.12, -0.14, 0.13],
  ];
  hairPuffs.forEach(([x, y, z, d], i) => {
    const puff = MeshBuilder.CreateSphere(`hair-${i}`, { diameter: d, segments: 8 }, scene);
    puff.parent = head;
    puff.position.set(x, y, z);
    puff.material = materials.hair;
  });

  // Glowing goggles
  const goggleStrap = MeshBuilder.CreateTorus('goggle-strap', { diameter: HEAD_SIZE * 1.02, thickness: 0.03, tessellation: 24 }, scene);
  goggleStrap.parent = head;
  goggleStrap.position.y = 0.04;
  goggleStrap.material = materials.dark;

  [-1, 1].forEach((side) => {
    const rim = MeshBuilder.CreateTorus(`goggle-rim-${side}`, { diameter: 0.11, thickness: 0.03, tessellation: 16 }, scene);
    rim.parent = head;
    rim.position.set(HEAD_SIZE * 0.44, 0.05, side * 0.07);
    rim.rotation.z = Math.PI / 2;
    rim.material = materials.metal;

    const lens = MeshBuilder.CreateCylinder(`goggle-lens-${side}`, { diameter: 0.09, height: 0.02, tessellation: 16 }, scene);
    lens.parent = rim;
    lens.material = materials.glow;
  });

  // Arms (z = -1 is the arm nearest the camera)
  const arms = [-1, 1].map((side) => {
    const shoulder = pivot(`shoulder-${side}`, torso, 0, TORSO - 0.06, side * 0.22);
    limb(`upper-arm-${side}`, shoulder, UPPER_ARM, 0.1, 0.085, materials.coat);
    const elbow = pivot(`elbow-${side}`, shoulder, 0, -UPPER_ARM, 0);
    limb(`forearm-${side}`, elbow, FOREARM, 0.085, 0.07, materials.coat);
    const hand = MeshBuilder.CreateSphere(`hand-${side}`, { diameter: 0.09, segments: 8 }, scene);
    hand.parent = elbow;
    hand.position.y = -FOREARM - 0.03;
    hand.material = materials.glove;
    return { shoulder, elbow, hand, side };
  });

  // Bubbling flask in the near hand
  const flask = createFlask(scene, materials);
  flask.parent = arms[0].hand;
  flask.position.set(0.02, -0.1, -0.03);

  // Legs
  const legs = [-1, 1].map((side) => {
    const hip = pivot(`hip-${side}`, hips, 0, 0, side * 0.1);
    limb(`thigh-${side}`, hip, THIGH, 0.15, 0.12, materials.pants);
    const knee = pivot(`knee-${side}`, hip, 0, -THIGH, 0);
    limb(`shin-${side}`, knee, SHIN, 0.12, 0.1, materials.pants);
    const shoe = MeshBuilder.CreateBox(`shoe-${side}`, { width: 0.22, height: SHOE_HEIGHT, depth: 0.12 }, scene);
    shoe.parent = knee;
    shoe.position.set(0.05, -SHIN - SHOE_HEIGHT / 2, 0);
    shoe.material = materials.dark;
    return { hip, knee, side };
  });

  // Soft shadow on the ground
  const shadow = MeshBuilder.CreateDisc('scientist-shadow', { radius: 0.38, tessellation: 24 }, scene);
  shadow.rotation.x = Math.PI / 2;
  shadow.material = materials.shadow;
  shadow.isPickable = false;

  // Nothing on the character should block clicks.
  root.getChildMeshes().forEach((mesh) => {
    mesh.isPickable = false;
  });

  // ---------------------------------------------------------------------------
  //  State
  // ---------------------------------------------------------------------------
  /** @type {ScientistState} */
  let state = 'walk';
  let velocityY = 0;
  let grounded = true;
  let coyoteTimer = 0;
  let jumpCut = false;
  let groundY = 0;
  let cyclePhase = 0;
  let speedFactor = 1;
  let deathSpin = 0;
  let deathVelocity = new Vector3(0, 0, 0);
  let time = 0;

  // ---------------------------------------------------------------------------
  //  Physics
  // ---------------------------------------------------------------------------

  /** @returns {boolean} True if a jump is allowed right now */
  function canJump() {
    return state !== 'dead' && (grounded || coyoteTimer > 0);
  }

  /** Launch a jump (call only when canJump() is true). */
  function jump() {
    if (!canJump()) return false;
    velocityY = JUMP_VELOCITY;
    grounded = false;
    coyoteTimer = 0;
    jumpCut = false;
    state = 'jump';
    return true;
  }

  /**
   * Advance physics and animation.
   * @param {number} dt Seconds
   * @param {{ jumpHeld?: boolean, groundY?: number }} [frame]
   *   jumpHeld: whether jump is still held (variable height)
   *   groundY:  height of whatever is under him (ground or a block top)
   * @returns {ScientistEvents}
   */
  function update(dt, { jumpHeld = false, groundY: support = 0 } = {}) {
    time += dt;
    groundY = support;
    /** @type {ScientistEvents} */
    const events = { jumped: false, landed: false };

    if (state === 'dead') {
      updateDeath(dt);
      animate(dt);
      return events;
    }

    // Variable jump height: let go early and the jump is cut short.
    if (!grounded && velocityY > 0 && !jumpHeld && !jumpCut) {
      velocityY *= JUMP_CUT_MULTIPLIER;
      jumpCut = true;
    }

    const wasGrounded = grounded;

    if (!grounded) {
      velocityY = Math.max(MAX_FALL_SPEED, velocityY + GRAVITY * dt);
    }
    root.position.y += velocityY * dt;

    if (root.position.y <= groundY && velocityY <= 0) {
      // Landed on the ground or a block.
      root.position.y = groundY;
      velocityY = 0;
      grounded = true;
      coyoteTimer = COYOTE_TIME;
      if (!wasGrounded) events.landed = true;
      if (state === 'jump' || state === 'fall') state = 'run';
    } else if (root.position.y > groundY + 0.001) {
      // In the air (jumped, or ran off an edge).
      if (grounded) {
        grounded = false;
        coyoteTimer = COYOTE_TIME;
      }
      coyoteTimer = Math.max(0, coyoteTimer - dt);
      if (velocityY < -1 && state !== 'jump') state = 'fall';
      if (velocityY < -4) state = 'fall';
    }

    animate(dt);
    return events;
  }

  /** Crash: fly backward, spin and tumble off-screen. */
  function die() {
    if (state === 'dead') return;
    state = 'dead';
    deathVelocity = new Vector3(-3.5, 9, 0);
    deathSpin = 0;
    grounded = false;
  }

  /** @param {number} dt */
  function updateDeath(dt) {
    deathVelocity.y += GRAVITY * 0.6 * dt;
    root.position.addInPlace(deathVelocity.scale(dt));
    deathSpin += dt * 9;
    root.rotation.z = deathSpin;
  }

  /**
   * Put him back at the start, standing.
   * @param {number} x
   * @param {ScientistState} [startState='walk']
   */
  function reset(x, startState = 'walk') {
    state = startState;
    root.position.set(x, 0, 0);
    root.rotation.set(0, 0, 0);
    velocityY = 0;
    grounded = true;
    coyoteTimer = 0;
    jumpCut = false;
    groundY = 0;
    cyclePhase = 0;
  }

  // ---------------------------------------------------------------------------
  //  Animation
  // ---------------------------------------------------------------------------

  /**
   * Set every joint's target angle for the current state, then ease toward it.
   * @param {number} dt
   */
  function animate(dt) {
    const running = state === 'run';
    const walking = state === 'walk';
    const cadence = walking ? 7 : 13 * speedFactor; // steps per second (radians)
    if (running || walking) cyclePhase = (cyclePhase + dt * cadence) % TAU;

    const swing = walking ? 0.55 : 0.95;
    const s = Math.sin(cyclePhase);
    const smoothing = state === 'dead' ? 6 : 22;

    /** @type {Record<string, number>} */
    const target = {};

    switch (state) {
      case 'walk':
      case 'run': {
        legs.forEach((leg, i) => {
          const phase = cyclePhase + (i === 0 ? 0 : Math.PI);
          target[`hip${i}`] = Math.sin(phase) * swing;
          target[`knee${i}`] = -(0.15 + (walking ? 0.5 : 1.1) * Math.max(0, Math.cos(phase)));
        });
        arms.forEach((arm, i) => {
          const phase = cyclePhase + (i === 0 ? Math.PI : 0); // arms opposite to legs
          target[`shoulder${i}`] = Math.sin(phase) * swing * 0.9;
          target[`elbow${i}`] = walking ? 0.35 : 1.2;
        });
        target.torso = walking ? -0.05 : -0.2;
        target.neck = walking ? 0.02 : 0.12;
        target.tails = walking ? 0.1 + s * 0.05 : 0.45 + Math.abs(s) * 0.25;
        target.bob = Math.abs(Math.cos(cyclePhase)) * (walking ? 0.03 : 0.07);
        break;
      }
      case 'jump': {
        target.hip0 = 1.1;
        target.hip1 = 0.35;
        target.knee0 = -1.6;
        target.knee1 = -1.2;
        target.shoulder0 = 2.5;
        target.shoulder1 = 2.8;
        target.elbow0 = 0.5;
        target.elbow1 = 0.3;
        target.torso = -0.3;
        target.neck = 0.2;
        target.tails = 0.9;
        target.bob = 0;
        break;
      }
      case 'fall': {
        const flail = Math.sin(time * 22) * 0.35;
        target.hip0 = 0.5;
        target.hip1 = -0.2;
        target.knee0 = -0.5;
        target.knee1 = -0.3;
        target.shoulder0 = 1.9 + flail;
        target.shoulder1 = 2.1 - flail;
        target.elbow0 = 0.2;
        target.elbow1 = 0.2;
        target.torso = -0.1;
        target.neck = -0.1;
        target.tails = -0.6;
        target.bob = 0;
        break;
      }
      case 'dead': {
        const flail = Math.sin(time * 30);
        target.hip0 = 1.2 * flail;
        target.hip1 = -1.2 * flail;
        target.knee0 = -1;
        target.knee1 = -0.6;
        target.shoulder0 = 2.8 + flail * 0.6;
        target.shoulder1 = -2 - flail * 0.6;
        target.elbow0 = 1;
        target.elbow1 = 1;
        target.torso = 0;
        target.neck = 0.4;
        target.tails = 1.2;
        target.bob = 0;
        break;
      }
      default:
        break;
    }

    // Ease each joint toward its target.
    legs.forEach((leg, i) => {
      leg.hip.rotation.z = damp(leg.hip.rotation.z, target[`hip${i}`], smoothing, dt);
      leg.knee.rotation.z = damp(leg.knee.rotation.z, target[`knee${i}`], smoothing, dt);
    });
    arms.forEach((arm, i) => {
      arm.shoulder.rotation.z = damp(arm.shoulder.rotation.z, target[`shoulder${i}`], smoothing, dt);
      arm.elbow.rotation.z = damp(arm.elbow.rotation.z, target[`elbow${i}`], smoothing, dt);
    });
    torso.rotation.z = damp(torso.rotation.z, target.torso, smoothing, dt);
    neck.rotation.z = damp(neck.rotation.z, target.neck, smoothing, dt);
    tails.rotation.z = damp(tails.rotation.z, target.tails, smoothing, dt);
    hips.position.y = HIP_HEIGHT + target.bob;

    // Flask liquid sloshes; goggles pulse.
    flask.rotation.z = Math.sin(time * 9) * 0.15;
    materials.glow.emissiveColor = materials.baseGlow.scale(0.8 + 0.4 * Math.abs(Math.sin(time * 5)));

    // Shadow stays on the ground, shrinking and fading as he rises.
    const height = Math.max(0, root.position.y - groundY);
    const shrink = clamp(1 - height / 4, 0.3, 1);
    shadow.position.set(root.position.x + 0.03, groundY + 0.01, 0);
    shadow.scaling.set(shrink * 1.2, shrink * 0.5, 1);
    materials.shadow.alpha = state === 'dead' ? 0 : 0.45 * shrink;
  }

  // ---------------------------------------------------------------------------
  //  Queries and settings
  // ---------------------------------------------------------------------------

  /**
   * World-space hitbox for collision checks.
   * @returns {{ minX: number, maxX: number, minY: number, maxY: number }}
   */
  function getHitbox() {
    const { x, y } = root.position;
    return {
      minX: x - HITBOX.halfWidth,
      maxX: x + HITBOX.halfWidth,
      minY: y + HITBOX.bottom,
      maxY: y + HITBOX.height,
    };
  }

  /**
   * Match the run animation to the game speed (1 = normal).
   * @param {number} factor
   */
  function setSpeedFactor(factor) {
    speedFactor = clamp(factor, 0.5, 2.5);
  }

  /**
   * Switch between walking and running (used for the intro).
   * @param {'walk' | 'run'} mode
   */
  function setGait(mode) {
    if (state === 'walk' || state === 'run') state = mode;
  }

  /**
   * Recolor the goggles and flask with a new favorite color.
   * @param {string} hex
   */
  function setPlayerColor(hex) {
    const color = Color3.FromHexString(hex);
    materials.baseGlow = color;
    materials.liquid.emissiveColor = color;
    materials.liquid.diffuseColor = color;
  }

  function dispose() {
    root.dispose(false, true);
    shadow.dispose(false, true);
  }

  return {
    root,
    update,
    jump,
    canJump,
    die,
    reset,
    getHitbox,
    setSpeedFactor,
    setGait,
    setPlayerColor,
    dispose,
    get state() {
      return state;
    },
    get isGrounded() {
      return grounded;
    },
    get isDead() {
      return state === 'dead';
    },
    get velocityY() {
      return velocityY;
    },
  };

  // ---------------------------------------------------------------------------
  //  Builders (hoisted function declarations)
  // ---------------------------------------------------------------------------

  /**
   * Create a joint pivot.
   * @param {string} name
   * @param {TransformNode} parent
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {TransformNode}
   */
  function pivot(name, parent, x, y, z) {
    const node = new TransformNode(name, scene);
    node.parent = parent;
    node.position.set(x, y, z);
    return node;
  }

  /**
   * A limb segment hanging down from a pivot.
   * @param {string} name
   * @param {TransformNode} parent
   * @param {number} length
   * @param {number} topDiameter
   * @param {number} bottomDiameter
   * @param {StandardMaterial} material
   * @returns {Mesh}
   */
  function limb(name, parent, length, topDiameter, bottomDiameter, material) {
    const mesh = MeshBuilder.CreateCylinder(
      name,
      { height: length, diameterTop: topDiameter, diameterBottom: bottomDiameter, tessellation: 12 },
      scene,
    );
    mesh.parent = parent;
    mesh.position.y = -length / 2;
    mesh.material = material;

    // Rounded joint cap so bends don't show gaps.
    const cap = MeshBuilder.CreateSphere(`${name}-joint`, { diameter: topDiameter, segments: 8 }, scene);
    cap.parent = parent;
    cap.material = material;
    return mesh;
  }
}

// =============================================================================
//  Flask and materials
// =============================================================================

/**
 * A round-bottom flask with glowing liquid.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {ReturnType<typeof createMaterials>} materials
 * @returns {TransformNode}
 */
function createFlask(scene, materials) {
  const flask = new TransformNode('flask', scene);

  const bulb = MeshBuilder.CreateSphere('flask-bulb', { diameter: 0.16, segments: 12 }, scene);
  bulb.parent = flask;
  bulb.position.y = -0.04;
  bulb.material = materials.glass;

  const liquid = MeshBuilder.CreateSphere('flask-liquid', { diameter: 0.13, segments: 12, slice: 0.6 }, scene);
  liquid.parent = flask;
  liquid.position.y = -0.04;
  liquid.rotation.x = Math.PI; // bowl shape, liquid sits in the bottom
  liquid.material = materials.liquid;

  const neckMesh = MeshBuilder.CreateCylinder('flask-neck', { height: 0.1, diameter: 0.045, tessellation: 10 }, scene);
  neckMesh.parent = flask;
  neckMesh.position.y = 0.07;
  neckMesh.material = materials.glass;

  return flask;
}

/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} playerColor
 */
function createMaterials(scene, playerColor) {
  /**
   * @param {string} name
   * @param {string} hex
   * @param {{ emissive?: number, specular?: number }} [opts]
   */
  const make = (name, hex, { emissive = 0.08, specular = 0.2 } = {}) => {
    const material = new StandardMaterial(`scientist-${name}`, scene);
    const color = Color3.FromHexString(hex);
    material.diffuseColor = color;
    material.emissiveColor = color.scale(emissive); // stays visible under wild lighting
    material.specularColor = new Color3(specular, specular, specular);
    return material;
  };

  const glowColor = Color3.FromHexString(playerColor);

  const glow = make('glow', playerColor, { emissive: 1, specular: 0.8 });
  const liquid = make('liquid', playerColor, { emissive: 0.9, specular: 0.6 });

  const glass = make('glass', '#d8f6ff', { emissive: 0.15, specular: 1 });
  glass.alpha = 0.35;

  const shadow = new StandardMaterial('scientist-shadow-material', scene);
  shadow.diffuseColor = Color3.Black();
  shadow.specularColor = Color3.Black();
  shadow.disableLighting = true;
  shadow.alpha = 0.45;

  return {
    coat: make('coat', '#f4f7f6', { emissive: 0.25, specular: 0.3 }),
    shirt: make('shirt', '#7fb7c9', { emissive: 0.15 }),
    pants: make('pants', '#3b2a5c', { emissive: 0.12 }),
    skin: make('skin', '#f1c6a0', { emissive: 0.18 }),
    hair: make('hair', '#f2f2f2', { emissive: 0.35 }),
    glove: make('glove', '#5ce1e6', { emissive: 0.2 }),
    dark: make('dark', '#1a1a22', { emissive: 0.05 }),
    metal: make('metal', '#9aa4ad', { emissive: 0.1, specular: 0.9 }),
    glow,
    liquid,
    glass,
    shadow,
    baseGlow: glowColor,
  };
}