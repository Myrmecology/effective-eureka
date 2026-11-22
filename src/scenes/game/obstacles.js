/**
 * Effective Eureka - obstacles
 *
 * Spawns obstacle patterns at the right edge, scrolls them left toward the
 * scientist, handles collisions and scoring, and removes them off-screen.
 *
 * Collision model (axis-aligned boxes in the x/y plane):
 *  - "deadly" boxes (spikes, saws): touching one ends the run.
 *  - "solid" boxes (blocks, platforms): you can land on the top. Hitting
 *    the side or bottom ends the run.
 *
 * @module scenes/game/obstacles
 */

import { Color3, Color4, Mesh, MeshBuilder, StandardMaterial, TransformNode } from '@babylonjs/core';
import { TAU, clamp, randPick, randRange } from '@/utils/math.js';

// -----------------------------------------------------------------------------
//  Tuning
// -----------------------------------------------------------------------------

/** How far above a block's top your feet may be (or slightly below) to count as landing. */
const LANDING_TOLERANCE = 0.28;

/** Time gap between patterns at the start and at max difficulty (seconds). */
const GAP_SECONDS_EASY = [1.15, 1.7];
const GAP_SECONDS_HARD = [0.7, 1.1];

const SPIKE_SIZE = 0.7;
const BLOCK_SIZE = 1;
const SAW_RADIUS = 0.45;

// -----------------------------------------------------------------------------
//  Patterns
//  Each piece: { type, x (offset from pattern start), y?, w? }
//  minLevel: the difficulty level where this pattern starts appearing.
// -----------------------------------------------------------------------------

/** @typedef {'spike' | 'block' | 'tallBlock' | 'saw' | 'platform'} ObstacleType */

/**
 * @typedef {Object} PatternPiece
 * @property {ObstacleType} type
 * @property {number} x
 * @property {number} [y]
 * @property {number} [w]   Platform width
 */

/** @type {{ name: string, minLevel: number, width: number, pieces: PatternPiece[] }[]} */
const PATTERNS = [
  { name: 'single-spike', minLevel: 0, width: 0.7, pieces: [{ type: 'spike', x: 0 }] },
  { name: 'double-spike', minLevel: 0, width: 1.4, pieces: [{ type: 'spike', x: 0 }, { type: 'spike', x: 0.7 }] },
  { name: 'block', minLevel: 0, width: 1, pieces: [{ type: 'block', x: 0 }] },
  {
    name: 'block-run',
    minLevel: 1,
    width: 3,
    pieces: [{ type: 'block', x: 0 }, { type: 'block', x: 1 }, { type: 'block', x: 2 }],
  },
  { name: 'ground-saw', minLevel: 1, width: 0.9, pieces: [{ type: 'saw', x: 0.45, y: SAW_RADIUS + 0.05 }] },
  {
    name: 'block-then-spike',
    minLevel: 1,
    width: 3.2,
    pieces: [{ type: 'block', x: 0 }, { type: 'spike', x: 2.5 }],
  },
  {
    name: 'triple-spike',
    minLevel: 2,
    width: 2.1,
    pieces: [{ type: 'spike', x: 0 }, { type: 'spike', x: 0.7 }, { type: 'spike', x: 1.4 }],
  },
  {
    name: 'staircase',
    minLevel: 2,
    width: 3,
    pieces: [{ type: 'block', x: 0 }, { type: 'tallBlock', x: 1 }, { type: 'tallBlock', x: 2 }],
  },
  {
    name: 'high-saw',
    minLevel: 2,
    width: 0.9,
    pieces: [{ type: 'saw', x: 0.45, y: 2.25 }], // run under it, don't jump into it
  },
  {
    name: 'spike-pit-platform',
    minLevel: 3,
    width: 3.6,
    pieces: [
      { type: 'platform', x: 0.2, y: 1.45, w: 3.2 },
      { type: 'spike', x: 0.5 },
      { type: 'spike', x: 1.2 },
      { type: 'spike', x: 1.9 },
      { type: 'spike', x: 2.6 },
    ],
  },
  {
    name: 'saw-spike-combo',
    minLevel: 3,
    width: 3.4,
    pieces: [{ type: 'spike', x: 0 }, { type: 'saw', x: 2.9, y: SAW_RADIUS + 0.05 }],
  },
  {
    name: 'block-gauntlet',
    minLevel: 4,
    width: 5.4,
    pieces: [
      { type: 'block', x: 0 },
      { type: 'spike', x: 1.6 },
      { type: 'tallBlock', x: 3.2 },
      { type: 'spike', x: 4.7 },
    ],
  },
];

/**
 * @typedef {Object} Collider
 * @property {'deadly' | 'solid'} kind
 * @property {number} minX  Relative to the obstacle's x
 * @property {number} maxX
 * @property {number} minY
 * @property {number} maxY
 */

/**
 * @typedef {Object} Obstacle
 * @property {ObstacleType} type
 * @property {TransformNode} node
 * @property {number} x       World x of the obstacle's left edge
 * @property {number} width
 * @property {Collider[]} colliders
 * @property {boolean} scored
 * @property {boolean} countsForScore  Only the first piece of a pattern scores
 * @property {Mesh[]} edgeMeshes       Meshes with glowing edges (recolored each frame)
 * @property {TransformNode | null} spinner
 */

/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {{ spawnX: number, despawnX: number }} options
 */
export function createObstacles(scene, { spawnX, despawnX }) {
  const materials = createMaterials(scene);
  const templates = createTemplates(scene, materials);

  /** @type {Obstacle[]} */
  let obstacles = [];
  let distanceUntilNext = 6; // first pattern arrives after a short run-up
  let difficulty = 0;
  let time = 0;
  let pulse = 0;
  let counter = 0;
  let lastPatternName = '';

  // ---------------------------------------------------------------------------
  //  Spawning
  // ---------------------------------------------------------------------------

  /** Pick a pattern allowed at the current difficulty (avoiding immediate repeats). */
  function pickPattern() {
    const available = PATTERNS.filter((p) => p.minLevel <= difficulty && p.name !== lastPatternName);
    const pattern = randPick(available.length > 0 ? available : PATTERNS);
    lastPatternName = pattern.name;
    return pattern;
  }

  /**
   * @param {number} startX
   */
  function spawnPattern(startX) {
    const pattern = pickPattern();
    pattern.pieces.forEach((piece, index) => {
      obstacles.push(spawnPiece(piece, startX + piece.x, index === 0));
    });
    return pattern.width;
  }

  /**
   * Build one obstacle from its template.
   * @param {PatternPiece} piece
   * @param {number} x
   * @param {boolean} countsForScore
   * @returns {Obstacle}
   */
  function spawnPiece(piece, x, countsForScore) {
    const node = new TransformNode(`obstacle-${counter++}`, scene);
    node.position.x = x;

    /** @type {Collider[]} */
    const colliders = [];
    /** @type {Mesh[]} */
    const edgeMeshes = [];
    /** @type {TransformNode | null} */
    let spinner = null;
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
        const mesh = cloneFrom(templates.spike, 'spike');
        mesh.position.set(SPIKE_SIZE / 2, SPIKE_SIZE / 2, 0);
        enableEdges(mesh, edgeMeshes);
        width = SPIKE_SIZE;
        // Pyramid hitbox: narrower than the base, lower than the tip.
        colliders.push({ kind: 'deadly', minX: 0.2, maxX: SPIKE_SIZE - 0.2, minY: 0, maxY: SPIKE_SIZE * 0.72 });
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
        colliders.push({ kind: 'deadly', minX: -r, maxX: r, minY: y - r, maxY: y + r });
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

    return { type: piece.type, node, x, width, colliders, scored: false, countsForScore, edgeMeshes, spinner };
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
    if (distanceUntilNext <= 0) {
      const width = spawnPattern(spawnX);
      const t = clamp(difficulty / 4, 0, 1);
      const minGap = GAP_SECONDS_EASY[0] + (GAP_SECONDS_HARD[0] - GAP_SECONDS_EASY[0]) * t;
      const maxGap = GAP_SECONDS_EASY[1] + (GAP_SECONDS_HARD[1] - GAP_SECONDS_EASY[1]) * t;
      // Gaps are measured in time, so faster speed means bigger distances
      // and the game stays fair as it speeds up.
      distanceUntilNext = width + randRange(minGap, maxGap) * speed;
    }

    // Move, score and despawn
    const survivors = [];
    for (const obstacle of obstacles) {
      obstacle.x -= move;
      obstacle.node.position.x = obstacle.x;

      if (obstacle.spinner) obstacle.spinner.rotation.z += dt * 9;

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

    for (const obstacle of obstacles) {
      const hue = (time * 120 + obstacle.x * 25) % 360;
      const edgeColor = new Color3();
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
   * @param {number} feetY Current feet height
   * @returns {number} 0 for the floor, or a block or platform top
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
        // Solid: safe only if standing on (or landing onto) its top.
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
    difficulty = clamp(Math.floor(level), 0, 4);
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
    lastPatternName = '';
  }

  function dispose() {
    reset();
    Object.values(templates).forEach((mesh) => mesh.dispose());
    Object.values(materials).forEach((material) => material.dispose());
  }

  return { update, getSupportHeight, hitsPlayer, setDifficulty, setPulse, reset, dispose };
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
  // Spike: a four-sided pyramid
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

  const ring = MeshBuilder.CreateTorus('saw-ring', { diameter: SAW_RADIUS * 1.5, thickness: 0.16, tessellation: 28 }, scene);
  ring.rotation.x = Math.PI / 2; // face the camera
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