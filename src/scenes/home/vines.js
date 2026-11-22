/**
 * Effective Eureka - breathing vines
 *
 * Builds several vine strands that twist around each other down the
 * center of the screen, with leaves and curly tendrils. Each frame the
 * strands "breathe": a slow wave of thickness travels along them.
 *
 * Usage:
 *   const vines = createVines(scene, { height: 14 });
 *   // every frame:
 *   vines.update(deltaSeconds, elapsedSeconds);
 *
 * @module scenes/home/vines
 */

import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  TransformNode,
  Vector3,
} from '@babylonjs/core';
import { TAU, breathe, clamp, createSeededRandom, damp, lerp, randRange } from '@/utils/math.js';

/**
 * @typedef {Object} VineOptions
 * @property {number} [height=14]          Total length (make it taller than the screen)
 * @property {number} [strandCount=4]      How many vines twist together
 * @property {number} [coilRadius=0.42]    How far strands wind from the center
 * @property {number} [thickness=0.13]     Base strand radius
 * @property {number} [twists=3.4]         Full wraps over the whole length
 * @property {number} [breathSeconds=5]    Time for one full breath
 * @property {number} [pointsPerStrand=150] Smoothness of each strand
 * @property {number} [seed=7]             Change for a different arrangement
 */

/** @type {Required<VineOptions>} */
const DEFAULTS = Object.freeze({
  height: 14,
  strandCount: 4,
  coilRadius: 0.42,
  thickness: 0.13,
  twists: 3.4,
  breathSeconds: 5,
  pointsPerStrand: 150,
  seed: 7,
});

/** How much the strands swell when breathing (0.22 = 22% thicker). */
const BASE_BREATH_AMOUNT = 0.22;

/**
 * Create the vines.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {VineOptions} [options]
 */
export function createVines(scene, options = {}) {
  const config = { ...DEFAULTS, ...options };
  const rng = createSeededRandom(config.seed);

  const root = new TransformNode('vines-root', scene);

  const vineMaterial = createVineMaterial(scene);
  const leafMaterial = createLeafMaterial(scene);

  // Shared animation values, read by the radius functions below.
  const anim = {
    time: 0,
    breathAmount: BASE_BREATH_AMOUNT,
    targetBreathAmount: BASE_BREATH_AMOUNT,
  };

  // ---------------------------------------------------------------------------
  //  Strands
  // ---------------------------------------------------------------------------
  const strands = [];

  for (let i = 0; i < config.strandCount; i += 1) {
    const { path, outward, along } = buildStrandPath(i, config);

    // Each point on a strand gets its own resting thickness for an organic feel.
    const baseRadii = along.map(
      (s) => config.thickness * (0.82 + 0.18 * Math.sin(s * TAU * 3 + i * 1.3)),
    );

    // Called by Babylon for every ring of the tube; a breathing wave
    // travels along the strand over time.
    const radiusFunction = (index) => {
      const s = along[index];
      const wave = breathe(anim.time, config.breathSeconds, -s * 5 + i * 0.7);
      return baseRadii[index] * (1 + anim.breathAmount * wave);
    };

    const mesh = MeshBuilder.CreateTube(
      `vine-strand-${i}`,
      {
        path,
        radiusFunction,
        tessellation: 18,
        cap: Mesh.CAP_ALL,
        updatable: true,
      },
      scene,
    );
    mesh.material = vineMaterial;
    mesh.parent = root;
    mesh.isPickable = false;

    strands.push({ mesh, path, outward, along, radiusFunction, baseRadii });
  }

  // ---------------------------------------------------------------------------
  //  Leaves
  // ---------------------------------------------------------------------------
  const leafSource = createLeafMesh(scene);
  leafSource.material = leafMaterial;
  leafSource.parent = root;
  leafSource.isPickable = false;

  /** @type {{ node: import('@babylonjs/core').AbstractMesh, phase: number, baseScale: number }[]} */
  const leaves = [];
  const leafSpacing = 9;

  strands.forEach((strand, strandIndex) => {
    for (let k = 4 + strandIndex * 2; k < strand.path.length - 4; k += leafSpacing) {
      const leaf = leaves.length === 0 ? leafSource : leafSource.createInstance(`leaf-${k}`);
      leaf.parent = root;
      leaf.isPickable = false;

      const point = strand.path[k];
      const out = strand.outward[k];
      leaf.position.copyFrom(point.add(out.scale(config.thickness * 0.9)));

      // Point the leaf outward and a little upward, with random variation.
      const target = leaf.position
        .add(out)
        .add(new Vector3(0, randRange(0.2, 0.8, rng), 0));
      leaf.lookAt(target);
      leaf.rotate(Vector3.Forward(), randRange(-0.6, 0.6, rng));

      const baseScale = randRange(0.75, 1.25, rng);
      leaf.scaling.setAll(baseScale);
      leaves.push({ node: leaf, phase: strand.along[k] * 5 + strandIndex, baseScale });
    }
  });

  // ---------------------------------------------------------------------------
  //  Curly tendrils
  // ---------------------------------------------------------------------------
  /** @type {{ pivot: TransformNode, phase: number, axis: Vector3 }[]} */
  const tendrils = [];
  const tendrilCount = 10;

  for (let t = 0; t < tendrilCount; t += 1) {
    const strand = strands[t % strands.length];
    const k = Math.floor(lerp(12, strand.path.length - 12, (t + 0.5) / tendrilCount));
    const out = strand.outward[k];

    const pivot = new TransformNode(`tendril-pivot-${t}`, scene);
    pivot.parent = root;
    pivot.position.copyFrom(strand.path[k].add(out.scale(config.thickness * 0.8)));

    const tendril = createTendrilMesh(scene, `tendril-${t}`, out, rng);
    tendril.material = vineMaterial;
    tendril.parent = pivot;
    tendril.isPickable = false;

    // Sway axis: perpendicular to the outward direction.
    const axis = Vector3.Cross(out, Vector3.Up()).normalize();
    tendrils.push({ pivot, phase: randRange(0, TAU, rng), axis });
  }

  // ---------------------------------------------------------------------------
  //  Per-frame update
  // ---------------------------------------------------------------------------

  /**
   * @param {number} deltaSeconds
   * @param {number} elapsedSeconds
   */
  function update(deltaSeconds, elapsedSeconds) {
    anim.time = elapsedSeconds;
    anim.breathAmount = damp(anim.breathAmount, anim.targetBreathAmount, 3, deltaSeconds);

    // Re-shape each strand with the new breathing radius.
    for (const strand of strands) {
      MeshBuilder.CreateTube(strand.mesh.name, {
        path: strand.path,
        radiusFunction: strand.radiusFunction,
        instance: strand.mesh,
      });
    }

    // Leaves swell slightly with the breath.
    for (const leaf of leaves) {
      const pulse = breathe(elapsedSeconds, config.breathSeconds, leaf.phase);
      leaf.node.scaling.setAll(leaf.baseScale * (1 + 0.1 * pulse * (anim.breathAmount / BASE_BREATH_AMOUNT)));
    }

    // Tendrils sway gently.
    for (const tendril of tendrils) {
      const angle = Math.sin(elapsedSeconds * 0.9 + tendril.phase) * 0.18;
      tendril.pivot.rotationQuaternion = null;
      tendril.pivot.rotation.set(0, 0, 0);
      tendril.pivot.rotate(tendril.axis, angle);
    }

    // The whole vine slowly sways and turns, showing it's 3D.
    root.rotation.y = Math.sin(elapsedSeconds * 0.16) * 0.35;
    root.rotation.z = Math.sin(elapsedSeconds * 0.11) * 0.015;
  }

  // ---------------------------------------------------------------------------
  //  Public controls
  // ---------------------------------------------------------------------------

  /**
   * Make the breathing deeper or shallower (smoothly).
   * 1 = normal, 2 = heavy panting, 0 = still.
   * @param {number} intensity
   */
  function setBreathIntensity(intensity) {
    anim.targetBreathAmount = BASE_BREATH_AMOUNT * clamp(intensity, 0, 4);
  }

  function dispose() {
    root.dispose(false, true); // also disposes materials and textures
  }

  return {
    root,
    update,
    setBreathIntensity,
    dispose,
    /** Total length, for camera framing */
    height: config.height,
  };
}

// =============================================================================
//  Geometry builders
// =============================================================================

/**
 * Build one strand's path: a helix winding around the vertical center line,
 * with a gentle wander so it doesn't look machine-made.
 *
 * @param {number} index
 * @param {Required<VineOptions>} config
 * @returns {{ path: Vector3[], outward: Vector3[], along: number[] }}
 */
function buildStrandPath(index, config) {
  const { height, strandCount, coilRadius, twists, pointsPerStrand } = config;
  const path = [];
  const outward = [];
  const along = [];
  const phaseOffset = (index / strandCount) * TAU;

  for (let k = 0; k <= pointsPerStrand; k += 1) {
    const s = k / pointsPerStrand; // 0 at top, 1 at bottom
    const y = lerp(height / 2, -height / 2, s);

    // Shared wander of the whole bundle
    const driftX = Math.sin(s * TAU * 0.9) * 0.22;
    const driftZ = Math.cos(s * TAU * 0.6) * 0.12;

    // This strand's winding
    const angle = s * twists * TAU + phaseOffset;
    const radius = coilRadius * (0.72 + 0.28 * Math.sin(s * TAU * 2 + index * 1.7));

    const x = driftX + Math.cos(angle) * radius;
    const z = driftZ + Math.sin(angle) * radius;

    path.push(new Vector3(x, y, z));
    outward.push(new Vector3(Math.cos(angle), 0, Math.sin(angle)));
    along.push(s);
  }

  return { path, outward, along };
}

/**
 * A curved, creased leaf built from three ribbon paths (left edge, raised
 * midrib, right edge). Its length points along local +Z.
 * @param {import('@babylonjs/core').Scene} scene
 * @returns {Mesh}
 */
function createLeafMesh(scene) {
  const segments = 12;
  const length = 0.5;
  const halfWidth = 0.11;
  const left = [];
  const mid = [];
  const right = [];

  for (let i = 0; i <= segments; i += 1) {
    const s = i / segments;
    const width = Math.sin(Math.pow(s, 0.8) * Math.PI) * halfWidth;
    const curl = Math.sin(s * Math.PI) * 0.06 - s * s * 0.08; // arches then droops
    const z = s * length;

    left.push(new Vector3(-width, curl - width * 0.25, z));
    mid.push(new Vector3(0, curl + 0.015, z));
    right.push(new Vector3(width, curl - width * 0.25, z));
  }

  return MeshBuilder.CreateRibbon(
    'leaf',
    { pathArray: [left, mid, right], sideOrientation: Mesh.DOUBLESIDE },
    scene,
  );
}

/**
 * A thin, tapering spiral curling away from the vine.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} name
 * @param {Vector3} outward Direction to grow
 * @param {() => number} rng
 * @returns {Mesh}
 */
function createTendrilMesh(scene, name, outward, rng) {
  const points = 48;
  const length = randRange(0.45, 0.7, rng);
  const curlTurns = randRange(2, 3.2, rng);
  const side = Vector3.Cross(outward, Vector3.Up()).normalize();
  const lift = randRange(-0.15, 0.35, rng);
  const path = [];

  for (let i = 0; i <= points; i += 1) {
    const s = i / points;
    const curlRadius = 0.11 * s; // curl tightens toward the tip
    const angle = s * curlTurns * TAU;

    const position = outward
      .scale(s * length)
      .add(new Vector3(0, s * lift, 0))
      .add(side.scale(Math.cos(angle) * curlRadius))
      .add(Vector3.Up().scale(Math.sin(angle) * curlRadius));
    path.push(position);
  }

  return MeshBuilder.CreateTube(
    name,
    {
      path,
      radiusFunction: (i) => lerp(0.028, 0.005, i / points),
      tessellation: 8,
      cap: Mesh.CAP_ALL,
    },
    scene,
  );
}

// =============================================================================
//  Materials
// =============================================================================

/**
 * Glossy green vine skin with a procedurally painted streak texture.
 * @param {import('@babylonjs/core').Scene} scene
 * @returns {StandardMaterial}
 */
function createVineMaterial(scene) {
  const material = new StandardMaterial('vine-material', scene);

  const texture = new DynamicTexture('vine-texture', { width: 256, height: 256 }, scene, true);
  const ctx = texture.getContext();

  // Base green
  ctx.fillStyle = '#2e9a46';
  ctx.fillRect(0, 0, 256, 256);

  // Lengthwise fibers (stripes running along the vine)
  for (let x = 0; x < 256; x += 4) {
    const shade = Math.random();
    ctx.fillStyle = shade > 0.5 ? 'rgba(120, 220, 110, 0.35)' : 'rgba(10, 60, 25, 0.35)';
    ctx.fillRect(x, 0, 2 + Math.random() * 2, 256);
  }

  // Subtle growth rings (nodes)
  ctx.fillStyle = 'rgba(8, 50, 20, 0.45)';
  for (let y = 0; y < 256; y += 64) {
    ctx.fillRect(0, y, 256, 3);
  }
  texture.update();

  texture.vScale = 10; // repeat along the vine's length
  material.diffuseTexture = texture;
  material.diffuseColor = new Color3(0.85, 1, 0.85);
  material.specularColor = new Color3(0.35, 0.5, 0.35);
  material.specularPower = 28;
  material.emissiveColor = new Color3(0.02, 0.1, 0.04);

  return material;
}

/**
 * Bright, slightly glowing two-sided leaf material.
 * @param {import('@babylonjs/core').Scene} scene
 * @returns {StandardMaterial}
 */
function createLeafMaterial(scene) {
  const material = new StandardMaterial('leaf-material', scene);
  material.diffuseColor = Color3.FromHexString('#4cd964');
  material.specularColor = new Color3(0.25, 0.4, 0.25);
  material.specularPower = 16;
  material.emissiveColor = Color3.FromHexString('#0b3d18');
  material.backFaceCulling = false;
  return material;
}