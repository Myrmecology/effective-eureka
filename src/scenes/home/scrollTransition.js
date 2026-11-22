/**
 * Effective Eureka - scroll roll-back transition
 *
 * Two sheets cover the left and right sides of the home screen. When the
 * transition plays, each sheet curls backward into a spiral roll, starting
 * at the vines in the center and rolling outward like a scroll, then the
 * rolls slide away off-screen.
 *
 * How the curl works: every vertical column of the sheet has a position "u"
 * measured from the inner edge. A roll moves from u = 0 to the outer edge.
 * Columns the roll has passed get wrapped around it on a tightening spiral;
 * columns ahead of it stay flat.
 *
 * Usage:
 *   const scroll = createScrollTransition(scene, { halfWidth, halfHeight });
 *   await scroll.play();          // on Enter
 *   scroll.update(deltaSeconds);  // every frame
 *
 * @module scenes/home/scrollTransition
 */

import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Vector2,
  Vector3,
} from '@babylonjs/core';
import { scrollUnroll } from '@/audio/sfx.js';
import { TAU, clamp, easeInCubic, easeInOutCubic, inverseLerp } from '@/utils/math.js';

// -----------------------------------------------------------------------------
//  Tuning
// -----------------------------------------------------------------------------

const COLUMNS = 160; // horizontal resolution of each sheet (smoothness of the curl)
const ROLL_RADIUS = 0.34; // outer radius of the roll
const LAYER_GAP = 0.03; // how much the spiral tightens per full turn
const MIN_RADIUS = 0.08;
const ROLL_PHASE_END = 0.82; // fraction of the animation spent rolling (the rest slides away)
const SLIDE_DISTANCE = 3; // how far the finished rolls slide outward

/**
 * @typedef {Object} ScrollOptions
 * @property {number} halfWidth        Half the visible width at the sheets' depth
 * @property {number} halfHeight       Half the visible height at the sheets' depth
 * @property {number} [innerX=0.85]    Distance from the center where the sheets start (beside the vines)
 * @property {number} [z=0.4]          Depth of the sheets
 * @property {boolean} [startRolled=false] Begin already rolled away (returning players)
 */

/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {ScrollOptions} options
 */
export function createScrollTransition(scene, options) {
  const layout = {
    halfWidth: options.halfWidth,
    halfHeight: options.halfHeight,
    innerX: options.innerX ?? 0.85,
    z: options.z ?? 0.4,
  };

  const texture = createSheetTexture(scene);
  const material = createSheetMaterial(scene, texture);

  /** @type {{ side: -1 | 1, mesh: Mesh }[]} */
  const sheets = [-1, 1].map((side) => {
    const mesh = MeshBuilder.CreateRibbon(
      side < 0 ? 'scroll-sheet-left' : 'scroll-sheet-right',
      {
        pathArray: buildPaths(side, 0),
        uvs: buildUvs(),
        sideOrientation: Mesh.DOUBLESIDE,
        updatable: true,
      },
      scene,
    );
    mesh.material = material;
    mesh.isPickable = false;
    return { side: /** @type {-1 | 1} */ (side), mesh };
  });

  let progress = 0;

  /** @type {{ elapsed: number, duration: number, resolve: () => void } | null} */
  let playback = null;

  // ---------------------------------------------------------------------------
  //  Geometry
  // ---------------------------------------------------------------------------

  /** Total width of one sheet, from beside the vines to past the screen edge. */
  function sheetWidth() {
    return Math.max(0.5, layout.halfWidth * 1.15 - layout.innerX);
  }

  /**
   * Where a column at distance `u` ends up, given the roll's position.
   * Returns local coordinates: lx (outward from the inner edge) and lz (depth).
   *
   * @param {number} u        Column distance from the inner edge
   * @param {number} rollAt   Current roll position (same units)
   * @returns {{ lx: number, lz: number }}
   */
  function curl(u, rollAt) {
    if (u >= rollAt) return { lx: u, lz: 0 }; // still flat

    const wound = rollAt - u; // how much paper is wrapped past this column
    // The spiral tightens as more paper is wound in.
    const radius = Math.max(MIN_RADIUS, ROLL_RADIUS - LAYER_GAP * (wound / (TAU * ROLL_RADIUS)));
    const angle = wound / radius;

    // The roll's axis sits behind the sheet (positive z = away from camera).
    return {
      lx: rollAt - radius * Math.sin(angle),
      lz: ROLL_RADIUS - radius * Math.cos(angle),
    };
  }

  /**
   * Build the ribbon's columns (each a vertical line from top to bottom).
   * @param {-1 | 1} side  -1 = left sheet, 1 = right sheet
   * @param {number} p     Progress 0 to 1
   * @returns {Vector3[][]}
   */
  function buildPaths(side, p) {
    const width = sheetWidth();
    const top = layout.halfHeight * 1.1;
    const bottom = -top;

    // Phase 1: rolling. Phase 2: the finished roll slides away.
    const rollT = easeInOutCubic(clamp(p / ROLL_PHASE_END, 0, 1));
    const slideT = easeInCubic(clamp(inverseLerp(ROLL_PHASE_END, 1, p), 0, 1));
    const rollAt = rollT * (width + ROLL_RADIUS); // a little extra so the edge fully wraps
    const slide = slideT * SLIDE_DISTANCE;

    const paths = [];
    for (let c = 0; c <= COLUMNS; c += 1) {
      const u = (c / COLUMNS) * width;
      const { lx, lz } = curl(u, rollAt);
      const x = side * (layout.innerX + lx + slide);
      const z = layout.z + lz;
      paths.push([new Vector3(x, top, z), new Vector3(x, bottom, z)]);
    }
    return paths;
  }

  /**
   * UVs: u runs across the sheet (0 at the inner edge), v runs top to bottom.
   * @returns {Vector2[]}
   */
  function buildUvs() {
    const uvs = [];
    for (let c = 0; c <= COLUMNS; c += 1) {
      const u = c / COLUMNS;
      uvs.push(new Vector2(u, 1), new Vector2(u, 0));
    }
    return uvs;
  }

  /** Re-shape both sheets for the current progress. */
  function applyProgress() {
    for (const sheet of sheets) {
      MeshBuilder.CreateRibbon(sheet.mesh.name, {
        pathArray: buildPaths(sheet.side, progress),
        instance: sheet.mesh,
      });
      sheet.mesh.setEnabled(progress < 1);
    }
  }

  // ---------------------------------------------------------------------------
  //  Public controls
  // ---------------------------------------------------------------------------

  /**
   * Jump straight to a progress value (0 = flat, 1 = fully gone).
   * @param {number} value
   */
  function setProgress(value) {
    progress = clamp(value, 0, 1);
    applyProgress();
  }

  /**
   * Play the roll-back animation.
   * @param {number} [durationSeconds=1.9]
   * @returns {Promise<void>} Resolves when the sheets are gone
   */
  function play(durationSeconds = 1.9) {
    if (progress >= 1) return Promise.resolve();

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 0.4 : durationSeconds;

    scrollUnroll(duration * ROLL_PHASE_END);

    return new Promise((resolve) => {
      playback?.resolve(); // finish any earlier play() call
      playback = { elapsed: progress * duration, duration, resolve };
    });
  }

  /**
   * Advance the animation. Call every frame.
   * @param {number} deltaSeconds
   */
  function update(deltaSeconds) {
    if (!playback) return;

    playback.elapsed += deltaSeconds;
    setProgress(playback.elapsed / playback.duration);

    if (progress >= 1) {
      const { resolve } = playback;
      playback = null;
      resolve();
    }
  }

  /**
   * Rebuild for a new window size.
   * @param {number} halfWidth
   * @param {number} halfHeight
   */
  function resize(halfWidth, halfHeight) {
    layout.halfWidth = halfWidth;
    layout.halfHeight = halfHeight;
    applyProgress();
  }

  /** @returns {boolean} True when fully rolled away */
  function isRolled() {
    return progress >= 1;
  }

  /** @returns {boolean} True while animating */
  function isPlaying() {
    return playback !== null;
  }

  function dispose() {
    playback?.resolve();
    playback = null;
    sheets.forEach((sheet) => sheet.mesh.dispose());
    material.dispose();
    texture.dispose();
  }

  setProgress(options.startRolled ? 1 : 0);

  return { play, update, setProgress, resize, isRolled, isPlaying, dispose };
}

// =============================================================================
//  Sheet appearance
// =============================================================================

/**
 * Paint the sheet: deep green with faint vine patterns, fine grain, and a
 * glowing trim along the inner edge. Painted in code, so no image files.
 *
 * Texture x = across the sheet (0 = inner edge by the vines), y = vertical.
 *
 * @param {import('@babylonjs/core').Scene} scene
 * @returns {DynamicTexture}
 */
function createSheetTexture(scene) {
  const size = 1024;
  const texture = new DynamicTexture('scroll-sheet-texture', { width: size, height: size }, scene, true);
  const ctx = texture.getContext();

  // Base: lighter near the vines, darker toward the screen edge
  const base = ctx.createLinearGradient(0, 0, size, 0);
  base.addColorStop(0, '#0f4a25');
  base.addColorStop(0.35, '#0a3319');
  base.addColorStop(1, '#041a0b');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  // Faint swirling vine patterns
  ctx.lineCap = 'round';
  for (let i = 0; i < 26; i += 1) {
    const startX = Math.random() * size;
    ctx.strokeStyle = `rgba(80, 220, 130, ${0.05 + Math.random() * 0.07})`;
    ctx.lineWidth = 2 + Math.random() * 5;
    ctx.beginPath();
    ctx.moveTo(startX, -20);
    for (let y = 0; y <= size + 40; y += 40) {
      ctx.lineTo(startX + Math.sin(y * 0.012 + i) * 50, y);
    }
    ctx.stroke();

    // Little curls along each vine
    for (let k = 0; k < 4; k += 1) {
      const cy = Math.random() * size;
      const cx = startX + Math.sin(cy * 0.012 + i) * 50;
      ctx.beginPath();
      ctx.arc(cx + 14, cy, 10 + Math.random() * 12, Math.PI, Math.PI * 2.6);
      ctx.stroke();
    }
  }

  // Fine grain so it reads as a material, not flat color
  const grain = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < grain.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    grain.data[i] += n;
    grain.data[i + 1] += n;
    grain.data[i + 2] += n;
  }
  ctx.putImageData(grain, 0, 0);

  // Glowing trim along the inner edge (next to the vines)
  const trim = ctx.createLinearGradient(0, 0, 40, 0);
  trim.addColorStop(0, 'rgba(198, 255, 61, 0.95)');
  trim.addColorStop(0.3, 'rgba(111, 240, 166, 0.6)');
  trim.addColorStop(1, 'rgba(111, 240, 166, 0)');
  ctx.fillStyle = trim;
  ctx.fillRect(0, 0, 40, size);

  // Dark band near the outer edge
  const outer = ctx.createLinearGradient(size - 60, 0, size, 0);
  outer.addColorStop(0, 'rgba(0, 0, 0, 0)');
  outer.addColorStop(1, 'rgba(0, 0, 0, 0.5)');
  ctx.fillStyle = outer;
  ctx.fillRect(size - 60, 0, 60, size);

  texture.update();
  return texture;
}

/**
 * Two-sided material. The emissive texture keeps the sheets readable
 * even in the dim realm lighting.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {DynamicTexture} texture
 * @returns {StandardMaterial}
 */
function createSheetMaterial(scene, texture) {
  const material = new StandardMaterial('scroll-sheet-material', scene);
  material.diffuseTexture = texture;
  material.emissiveTexture = texture;
  material.emissiveColor = new Color3(0.45, 0.45, 0.45);
  material.specularColor = new Color3(0.15, 0.2, 0.15);
  material.specularPower = 12;
  material.backFaceCulling = false;
  material.twoSidedLighting = true;
  return material;
}