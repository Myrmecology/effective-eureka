/**
 * Effective Eureka - obstacles (v2: procedural sections)
 *
 * Spawns obstacles at the right edge, scrolls them left toward the
 * scientist, handles collisions and scoring, and removes them off-screen.
 *
 * Variety system:
 *  - Each "section" is built from 1 to 4 randomized ELEMENTS (spike clusters,
 *    block runs, stairs, saws, platforms...). Harder levels chain more.
 *  - Elements are drawn from a weighted SHUFFLE BAG, so you see a mix
 *    before anything repeats, and the same element never appears twice in a row.
 *  - Every element randomizes its own details (cluster size, run length,
 *    platform width, saw height).
 *
 * Fairness rules:
 *  - Gaps between elements are measured in TIME (seconds x speed), so there
 *    is always room to land and jump again, at any speed.
 *  - Bouncing saws are timed to be at their very top (run under) or very
 *    bottom (jump over) when they reach you.
 *
 * Collision model (axis-aligned boxes in the x/y plane):
 *  - "deadly" boxes (spikes, saws): touching one ends the run.
 *  - "solid" boxes (blocks, platforms): land on the top; hitting the
 *    side or bottom ends the run.
 *
 * Public API (unchanged from v1):
 *   update(dt, speed, playerX) → { passed }
 *   getSupportHeight(hitbox, feetY), hitsPlayer(hitbox, feetY)
 *   setDifficulty(level), setPulse(value), reset(), dispose()
 *
 * @module scenes/game/obstacles
 */

import { Color3, Color4, Mesh, MeshBuilder, StandardMaterial, TransformNode } from '@babylonjs/core';
import { TAU, clamp, randInt, randRange } from '@/utils/math.js';

// -----------------------------------------------------------------------------
//  Tuning
// -----------------------------------------------------------------------------

/** How far above a block's top your feet may be (or slightly below) to count as landing. */
const LANDING_TOLERANCE = 0.28;

/** Breather between sections, in seconds (easy → hardest). */
const SECTION_GAP_EASY = [0.95, 1.4];
const SECTION_GAP_HARD = [0.6, 0.95];

/** Gap between elements inside a section, in seconds: time to land and re-jump. */
const ELEMENT_GAP = [0.72, 0.95];

/** How many elements a section chains together, per difficulty level 0 to 4. */
const ELEMENTS_PER_SECTION = [
  [1, 2],
  [1, 2],
  [1, 3],
  [2, 3],
  [2, 4],
];

const SPIKE_SIZE = 0.7;
const BLOCK_SIZE = 1;
const SAW_RADIUS = 0.45;

/** Bouncing saw motion */
const BOUNCER_MID = 1.6;
const BOUNCER_AMPLITUDE = 1.1;
const BOUNCER_PERIOD = 1.6; // seconds per full bounce

// -----------------------------------------------------------------------------
//  Types
// -----------------------------------------------------------------------------

/** @typedef {'spike' | 'block' | 'tallBlock' | 'saw' | 'platform'} ObstacleType */

/**
 * @typedef {Object} PatternPiece
 * @property {ObstacleType} type
 * @property {number} x               Offset from the element's start
 * @property {number} [y]             Height (saws, platforms, spikes on blocks)
 * @property {number} [w]             Platform width
 * @property {boolean} [bounce]       Saw bounces up and down
 */

/**
 * @typedef {Object} BuiltElement
 * @property {number} width
 * @property {PatternPiece[]} pieces
 */

/**
 * @typedef {Object} ElementDefinition
 * @property {string} id
 * @property {number} minLevel  Difficulty level where it starts appearing
 * @property {number} weight    How often it appears relative to others
 * @property {(level: number) => BuiltElement} build
 */

/**
 * @typedef {Object} Collider
 * @property {'deadly' | 'solid'} kind
 * @property {number} minX  Relative to the obstacle's x
 * @property {number} maxX
 * @property {number} minY
 * @property {number} maxY
 */

/**
 * @typedef {Object} BounceMotion
 * @property {number} age     Seconds since spawn
 * @property {number} omega   Radians per second
 * @property {number} phase   Radians
 * @property {Collider} collider
 */

/**
 * @typedef {Object} Obstacle
 * @property {ObstacleType} type
 * @property {TransformNode} node
 * @property {number} x
 * @property {number} width
 * @property {Collider[]} colliders
 * @property {boolean} scored
 * @property {boolean} countsForScore
 * @property {Mesh[]} edgeMeshes
 * @property {TransformNode | null} spinner
 * @property {BounceMotion | null} bounce
 */

// -----------------------------------------------------------------------------
//  Element library
// -----------------------------------------------------------------------------

/**
 * A row of identical pieces side by side.
 * @param {ObstacleType} type
 * @param {number} count
 * @param {number} size
 * @param {number} [y]
 * @returns {BuiltElement}
 */
function row(type, count, size, y) {
  const pieces = [];
  for (let i = 0; i < count; i += 1) pieces.push({ type, x: i * size, y });
  return { width: count * size, pieces };
}

/** @type {ElementDefinition[]} */
const ELEMENTS = [
  {
    id: 'spikes',
    minLevel: 0,
    weight: 3,
    build: (level) => row('spike', randInt(1, level >= 2 ? 3 : 2), SPIKE_SIZE),
  },
  {
    id: 'blocks',
    minLevel: 0,
    weight: 2,
    build: () => row('block', randInt(1, 3), BLOCK_SIZE),
  },
  {
    id: 'ground-saw',
    minLevel: 1,
    weight: 2,
    build: () => ({
      width: SAW_RADIUS * 2,
      pieces: [{ type: 'saw', x: SAW_RADIUS, y: SAW_RADIUS + 0.05 }],
    }),
  },
  {
    id: 'block-then-spike',
    minLevel: 1,
    weight: 2,
    build: () => {
      const blocks = randInt(1, 2);
      return {
        width: blocks + 1.5 + SPIKE_SIZE,
        pieces: [
          ...row('block', blocks, BLOCK_SIZE).pieces,
          { type: 'spike', x: blocks + 1.5 },
        ],
      };
    },
  },
  {
    id: 'stairs',
    minLevel: 2,
    weight: 2,
    build: () => {
      const variants = [
        ['block', 'tallBlock'],
        ['block', 'tallBlock', 'tallBlock'],
        ['block', 'tallBlock', 'block'],
        ['block', 'block', 'tallBlock', 'tallBlock'],
      ];
      const steps = variants[randInt(0, variants.length - 1)];
      return {
        width: steps.length * BLOCK_SIZE,
        pieces: steps.map((type, i) => ({ type: /** @type {ObstacleType} */ (type), x: i * BLOCK_SIZE })),
      };
    },
  },
  {
    id: 'high-saw',
    minLevel: 2,
    weight: 1.5,
    build: () => ({
      width: SAW_RADIUS * 2,
      pieces: [{ type: 'saw', x: SAW_RADIUS, y: randRange(2.25, 2.45) }], // run under it
    }),
  },
  {
    id: 'platform-pit',
    minLevel: 2,
    weight: 1.5,
    build: () => {
      const spikeCount = randInt(3, 5);
      const pitWidth = spikeCount * SPIKE_SIZE;
      const platformWidth = pitWidth + 0.6;
      const pieces = [{ type: 'platform', x: 0, y: randRange(1.35, 1.6), w: platformWidth }];
      for (let i = 0; i < spikeCount; i += 1) pieces.push({ type: 'spike', x: 0.3 + i * SPIKE_SIZE });
      return { width: platformWidth, pieces: /** @type {PatternPiece[]} */ (pieces) };
    },
  },
  {
    id: 'spike-on-blocks',
    minLevel: 3,
    weight: 1.5,
    build: () => ({
      width: 5 * BLOCK_SIZE,
      pieces: [
        ...row('block', 5, BLOCK_SIZE).pieces,
        { type: 'spike', x: 3 * BLOCK_SIZE + (BLOCK_SIZE - SPIKE_SIZE) / 2, y: BLOCK_SIZE },
      ],
    }),
  },
  {
    id: 'bouncing-saw',
    minLevel: 3,
    weight: 1.5,
    build: () => ({
      width: SAW_RADIUS * 2,
      pieces: [{ type: 'saw', x: SAW_RADIUS, y: BOUNCER_MID, bounce: true }],
    }),
  },
];

// =============================================================================
//  Factory
// =============================================================================

/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {{ spawnX: number, despawnX: number }} options
 */
export function createObstacles(scene, { spawnX, despawnX }) {
  const materials = createMaterials(scene);
  const templates = createTemplates(scene, materials);

  /** @type {Obstacle[]} */
  let obstacles = [];
  let distanceUntilNext = 6; // short run-up before the first section
  let difficulty = 0;
  let time = 0;
  let pulse = 0;
  let counter = 0;

  /** @type {ElementDefinition[]} */
  let bag = [];
  let lastElementId = '';

  // ---------------------------------------------------------------------------
  //  Shuffle bag: variety without long streaks or immediate repeats
  // ---------------------------------------------------------------------------

  /** Refill the bag with every allowed element, copies by weight, shuffled. */
  function refillBag() {
    bag = [];
    for (const element of ELEMENTS) {
      if (element.minLevel > difficulty) continue;
      const copies = Math.max(1, Math.round(element.weight * 2));
      for (let i = 0; i < copies; i += 1) bag.push(element);
    }
    // Fisher-Yates shuffle
    for (let i = bag.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
  }

  /** @returns {ElementDefinition} */
  function drawElement() {
    if (bag.length === 0) refillBag();

    // Avoid repeating the previous element if anything else is available.
    let index = bag.findIndex((element) => element.id !== lastElementId);
    if (index === -1) index = 0;

    const [element] = bag.splice(index, 1);
    lastElementId = element.id;
    return element;
  }

  // ---------------------------------------------------------------------------
  //  Spawning
  // ---------------------------------------------------------------------------

  /**
   * Build a section of chained elements at the spawn line.
   * @param {number} speed
   * @param {number} playerX
   * @returns {number} Total width of the section
   */
  function spawnSection(speed, playerX) {
    const [minCount, maxCount] = ELEMENTS_PER_SECTION[difficulty];
    const count = randInt(minCount, maxCount);
    let cursor = 0;
    let width = 0;

    for (let e = 0; e < count; e += 1) {
      const element = drawElement();
      const built = element.build(difficulty);

      built.pieces.forEach((piece, index) => {
        const x = spawnX + cursor + piece.x;
        obstacles.push(spawnPiece(piece, x, index === 0, speed, playerX));
      });

      width = cursor + built.width;
      cursor = width + randRange(ELEMENT_GAP[0], ELEMENT_GAP[1]) * speed;
    }

    return width;
  }

  /**
   * Build one obstacle from its template.
   * @param {PatternPiece} piece
   * @param {number} x
   * @param {boolean} countsForScore
   * @param {number} speed
   * @param {number} playerX
   * @returns {Obstacle}
   */
  function spawnPiece(piece, x, countsForScore, speed, playerX) {
    const node = new TransformNode(`obstacle-${counter++}`, scene);
    node.position.x = x;

    /** @type {Collider[]} */
    const colliders = [];
    /** @type {Mesh[]} */
    const edgeMeshes = [];
    /** @type {TransformNode | null} */
    let spinner = null;
    /** @type {BounceMotion | null} */
    let bounce = null;
    let width = 0;

    /**
     * @param {Mesh} template
     * @param {string} name
     */
    const cloneFrom = (template, name) => {
      const mesh = /** @type {Mesh} */ (template.clone(name, node));
      mesh.setEnabled(true);
      mesh.isPickable = false;
      return mesh;
    };

    switch (piece.type) {
      case 'spike': {
        const baseY = piece.y ?? 0;
        const mesh = cloneFrom(templates.spike, 'spike');
        mesh.position.set(SPIKE_SIZE / 2, baseY + SPIKE_SIZE / 2, 0);
        enableEdges(mesh, edgeMeshes);
        width = SPIKE_SIZE;
        // Pyramid hitbox: narrower than the base, lower than the tip.
        colliders.push({
          kind: 'deadly',
          minX: 0.2,
          maxX: SPIKE_SIZE - 0.2,
          minY: baseY,
          maxY: baseY + SPIKE_SIZE * 0.72,
        });
        break;
      }

      case 'block':
      case 'tallBlock': {
        const height = piece.type === 'tallBlock' ? BLOCK_SIZE * 2 : BLOCK_SIZE;
        const mesh = cloneFrom(templates.block, 'block');
        mesh.scaling.y = height / BLOCK_SIZE;
        mesh.position.set(BLOCK_SIZE / 2, height / 2, 0);
        enableEdges(mesh, edgeMeshes);
        width = BLOCK_SIZE;
        colliders.push({ kind: 'solid', minX: 0, maxX: BLOCK_SIZE, minY: 0, maxY: height });
        break;
      }

      case 'saw': {
        const y = piece.y ?? SAW_RADIUS;
        spinner = new TransformNode('saw-spinner', scene);
        spinner.parent = node;
        spinner.position.set(0, y, 0);
        const blade = cloneFrom(templates.saw, 'saw');
        blade.parent = spinner;
        blade.position.set(0, 0, 0);
        width = 0;
        const r = SAW_RADIUS * 0.75; // forgiving hitbox
        /** @type {Collider} */
        const collider = { kind: 'deadly', minX: -r, maxX: r, minY: y - r, maxY: y + r };
        colliders.push(collider);

        if (piece.bounce) {
          // Time the bounce so it's at an extreme when it reaches the player:
          // top (run under) or bottom (jump over), chosen at random.
          const omega = TAU / BOUNCER_PERIOD;
          const arrivalSeconds = Math.max(0, (x - playerX) / Math.max(speed, 0.1));
          const targetAngle = Math.random() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
          const phase = targetAngle - omega * arrivalSeconds;
          bounce = { age: 0, omega, phase, collider };
          applyBounce(spinner, bounce);
        }
        break;
      }

      case 'platform': {
        const w = piece.w ?? 3;
        const thickness = 0.3;
        const y = piece.y ?? 1.5;
        const mesh = cloneFrom(templates.platform, 'platform');
        mesh.scaling.x = w;
        mesh.position.set(w / 2, y - thickness / 2, 0);
        enableEdges(mesh, edgeMeshes);
        width = w;
        colliders.push({ kind: 'solid', minX: 0, maxX: w, minY: y - thickness, maxY: y });
        break;
      }

      default:
        break;
    }

    return {
      type: piece.type,
      node,
      x,
      width,
      colliders,
      scored: false,
      countsForScore,
      edgeMeshes,
      spinner,
      bounce,
    };
  }

  // ---------------------------------------------------------------------------
  //  Update
  // ---------------------------------------------------------------------------

  /**
   * Move obstacles, spawn new ones, recolor, and count passed obstacles.
   * @param {number} dt
   * @param {number} speed      World units per second
   * @param {number} playerX    The scientist's x position
   * @returns {{ passed: number }}
   */
  function update(dt, speed, playerX) {
    time += dt;
    const move = speed * dt;
    let passed = 0;

    // Spawn
    distanceUntilNext -= move;
    if (distanceUntilNext <= 0 && speed > 0) {
      const width = spawnSection(speed, playerX);
      const t = clamp(difficulty / 4, 0, 1);
      const minGap = SECTION_GAP_EASY[0] + (SECTION_GAP_HARD[0] - SECTION_GAP_EASY[0]) * t;
      const maxGap = SECTION_GAP_EASY[1] + (SECTION_GAP_HARD[1] - SECTION_GAP_EASY[1]) * t;
      distanceUntilNext = width + randRange(minGap, maxGap) * speed;
    }

    // Move, animate, score and despawn
    const survivors = [];
    for (const obstacle of obstacles) {
      obstacle.x -= move;
      obstacle.node.position.x = obstacle.x;

      if (obstacle.spinner) {
        obstacle.spinner.rotation.z += dt * 9;
        if (obstacle.bounce) {
          obstacle.bounce.age += dt;
          applyBounce(obstacle.spinner, obstacle.bounce);
        }
      }

      if (!obstacle.scored && obstacle.x + obstacle.width < playerX) {
        obstacle.scored = true;
        if (obstacle.countsForScore) passed += 1;
      }

      if (obstacle.x + obstacle.width < despawnX) {
        obstacle.node.dispose(false, false); // materials are shared; keep them
      } else {
        survivors.push(obstacle);
      }
    }
    obstacles = survivors;

    updateColors();
    return { passed };
  }

  /** Psychedelic hue cycling, with a flash on each music beat. */
  function updateColors() {
    const boost = 1 + pulse * 0.8;
    setHue(materials.spike, time * 90, 1, boost);
    setHue(materials.block, time * 60 + 120, 0.9, boost);
    setHue(materials.saw, time * 140 + 240, 1, boost);
    setHue(materials.platform, time * 60 + 180, 0.9, boost);

    const edgeColor = new Color3();
    for (const obstacle of obstacles) {
      const hue = (((time * 120 + obstacle.x * 25) % 360) + 360) % 360;
      Color3.HSVtoRGBToRef(hue, 0.8, 1, edgeColor);
      for (const mesh of obstacle.edgeMeshes) {
        mesh.edgesColor = new Color4(edgeColor.r, edgeColor.g, edgeColor.b, 1);
      }
    }
  }

  // ---------------------------------------------------------------------------
  //  Collision queries
  // ---------------------------------------------------------------------------

  /**
   * The height of the highest solid surface directly under the player.
   * @param {{ minX: number, maxX: number }} hitbox
   * @param {number} feetY
   * @returns {number}
   */
  function getSupportHeight(hitbox, feetY) {
    let support = 0;
    for (const obstacle of obstacles) {
      for (const c of obstacle.colliders) {
        if (c.kind !== 'solid') continue;
        const minX = obstacle.x + c.minX;
        const maxX = obstacle.x + c.maxX;
        if (hitbox.maxX <= minX || hitbox.minX >= maxX) continue;
        if (feetY >= c.maxY - LANDING_TOLERANCE && c.maxY > support) support = c.maxY;
      }
    }
    return support;
  }

  /**
   * Did the player hit something deadly, or the side of a solid block?
   * @param {{ minX: number, maxX: number, minY: number, maxY: number }} hitbox
   * @param {number} feetY
   * @returns {boolean}
   */
  function hitsPlayer(hitbox, feetY) {
    for (const obstacle of obstacles) {
      for (const c of obstacle.colliders) {
        const minX = obstacle.x + c.minX;
        const maxX = obstacle.x + c.maxX;
        if (hitbox.maxX <= minX || hitbox.minX >= maxX) continue;
        if (hitbox.maxY <= c.minY || hitbox.minY >= c.maxY) continue;

        if (c.kind === 'deadly') return true;
        if (feetY < c.maxY - LANDING_TOLERANCE) return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  //  Controls
  // ---------------------------------------------------------------------------

  /** @param {number} level 0 (easy) to 4 (hardest) */
  function setDifficulty(level) {
    const next = clamp(Math.floor(level), 0, 4);
    if (next !== difficulty) {
      difficulty = next;
      bag = []; // refill with newly unlocked elements on the next draw
    }
  }

  /** @param {number} value 0 to 1: brightness flash on the music beat */
  function setPulse(value) {
    pulse = clamp(value, 0, 1);
  }

  /** Remove every obstacle and start over. */
  function reset() {
    obstacles.forEach((o) => o.node.dispose(false, false));
    obstacles = [];
    distanceUntilNext = 6;
    difficulty = 0;
    bag = [];
    lastElementId = '';
  }

  function dispose() {
    reset();
    Object.values(templates).forEach((mesh) => mesh.dispose());
    Object.values(materials).forEach((material) => material.dispose());
  }

  return { update, getSupportHeight, hitsPlayer, setDifficulty, setPulse, reset, dispose };
}

// =============================================================================
//  Motion helper
// =============================================================================

/**
 * Move a bouncing saw and its hitbox to the current height.
 * @param {TransformNode} spinner
 * @param {BounceMotion} bounce
 */
function applyBounce(spinner, bounce) {
  const y = BOUNCER_MID + BOUNCER_AMPLITUDE * Math.sin(bounce.omega * bounce.age + bounce.phase);
  spinner.position.y = y;
  const r = SAW_RADIUS * 0.75;
  bounce.collider.minY = y - r;
  bounce.collider.maxY = y + r;
}

// =============================================================================
//  Templates and materials
// =============================================================================

/**
 * Hidden template meshes that obstacles are cloned from.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {ReturnType<typeof createMaterials>} materials
 */
function createTemplates(scene, materials) {
  const spike = MeshBuilder.CreateCylinder(
    'spike-template',
    { height: SPIKE_SIZE, diameterTop: 0, diameterBottom: SPIKE_SIZE * 1.3, tessellation: 4 },
    scene,
  );
  spike.rotation.y = Math.PI / 4;
  spike.bakeCurrentTransformIntoVertices();
  spike.material = materials.spike;

  const block = MeshBuilder.CreateBox('block-template', { size: BLOCK_SIZE }, scene);
  block.material = materials.block;

  const platform = MeshBuilder.CreateBox('platform-template', { width: 1, height: 0.3, depth: 1 }, scene);
  platform.material = materials.platform;

  const saw = createSawTemplate(scene, materials.saw);

  for (const mesh of [spike, block, platform, saw]) {
    mesh.setEnabled(false);
    mesh.isPickable = false;
  }

  return { spike, block, platform, saw };
}

/**
 * A ring with teeth, merged into one mesh.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {StandardMaterial} material
 * @returns {Mesh}
 */
function createSawTemplate(scene, material) {
  const parts = [];

  const ring = MeshBuilder.CreateTorus(
    'saw-ring',
    { diameter: SAW_RADIUS * 1.5, thickness: 0.16, tessellation: 28 },
    scene,
  );
  ring.rotation.x = Math.PI / 2;
  parts.push(ring);

  const hub = MeshBuilder.CreateCylinder('saw-hub', { diameter: 0.25, height: 0.12, tessellation: 16 }, scene);
  hub.rotation.x = Math.PI / 2;
  parts.push(hub);

  const teeth = 10;
  for (let i = 0; i < teeth; i += 1) {
    const angle = (i / teeth) * TAU;
    const tooth = MeshBuilder.CreateCylinder(
      `saw-tooth-${i}`,
      { height: 0.22, diameterTop: 0, diameterBottom: 0.16, tessellation: 4 },
      scene,
    );
    tooth.position.set(Math.cos(angle) * SAW_RADIUS * 0.9, Math.sin(angle) * SAW_RADIUS * 0.9, 0);
    tooth.rotation.z = angle - Math.PI / 2;
    parts.push(tooth);
  }

  const saw = /** @type {Mesh} */ (Mesh.MergeMeshes(parts, true, true));
  saw.name = 'saw-template';
  saw.material = material;
  return saw;
}

/**
 * Glossy, glowing neon materials (colors animate every frame).
 * @param {import('@babylonjs/core').Scene} scene
 */
function createMaterials(scene) {
  /** @param {string} name */
  const make = (name) => {
    const material = new StandardMaterial(`obstacle-${name}`, scene);
    material.diffuseColor = new Color3(0.1, 0.1, 0.1);
    material.specularColor = new Color3(1, 1, 1);
    material.specularPower = 64;
    material.emissiveColor = new Color3(1, 0, 1);
    return material;
  };

  return {
    spike: make('spike'),
    block: make('block'),
    saw: make('saw'),
    platform: make('platform'),
  };
}

/**
 * Glowing outline edges on a mesh.
 * @param {Mesh} mesh
 * @param {Mesh[]} list
 */
function enableEdges(mesh, list) {
  mesh.enableEdgesRendering(0.95);
  mesh.edgesWidth = 5;
  mesh.edgesColor = new Color4(1, 1, 1, 1);
  list.push(mesh);
}

/**
 * Set a material's glow color from a hue angle.
 * @param {StandardMaterial} material
 * @param {number} hue Degrees (wraps)
 * @param {number} saturation 0 to 1
 * @param {number} brightness Multiplier
 */
function setHue(material, hue, saturation, brightness) {
  const color = new Color3();
  Color3.HSVtoRGBToRef(((hue % 360) + 360) % 360, saturation, 0.55, color);
  material.emissiveColor = color.scale(brightness);
  material.diffuseColor = color.scale(0.3);
}