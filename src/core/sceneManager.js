/**
 * Effective Eureka - scene manager
 *
 * Owns the active Babylon scene and switches between scenes.
 *
 * Every scene module exports a factory function that returns a
 * "scene controller" object:
 *
 *   {
 *     scene:    BABYLON.Scene,                       // required
 *     update?:  (deltaSeconds, elapsedSeconds) => {}, // runs every frame
 *     dispose?: () => {},                             // extra cleanup
 *     ...anything else the scene wants to expose      // e.g. playScrollTransition()
 *   }
 *
 * Usage:
 *   registerScene('home', createHomeScene);
 *   await switchScene('home');
 *   startRenderLoop(renderActiveScene);
 *
 * @module core/sceneManager
 */

import { getCanvas, getEngine } from '@/core/engine.js';

/** Fade duration between scenes, in milliseconds. */
const FADE_MS = 450;

/**
 * @typedef {import('@babylonjs/core').Scene} Scene
 * @typedef {import('@babylonjs/core').Engine} Engine
 */

/**
 * @typedef {Object} SceneController
 * @property {Scene} scene
 * @property {(deltaSeconds: number, elapsedSeconds: number) => void} [update]
 * @property {() => void} [dispose]
 */

/**
 * @callback SceneFactory
 * @param {{ engine: Engine, canvas: HTMLCanvasElement, options: Record<string, unknown> }} context
 * @returns {SceneController | Promise<SceneController>}
 */

/** @type {Map<string, SceneFactory>} */
const registry = new Map();

/** @type {SceneController | null} */
let activeController = null;

/** @type {string | null} */
let activeKey = null;

/** @type {Promise<SceneController> | null} */
let pendingSwitch = null;

// -----------------------------------------------------------------------------
//  Registration
// -----------------------------------------------------------------------------

/**
 * Register a scene factory under a name.
 * @param {string} key
 * @param {SceneFactory} factory
 */
export function registerScene(key, factory) {
  if (typeof factory !== 'function') {
    throw new TypeError(`registerScene: factory for "${key}" must be a function.`);
  }
  if (registry.has(key)) {
    console.warn(`[sceneManager] Replacing existing scene "${key}".`);
  }
  registry.set(key, factory);
}

// -----------------------------------------------------------------------------
//  Queries
// -----------------------------------------------------------------------------

/** @returns {string | null} The key of the scene currently showing */
export function getActiveSceneKey() {
  return activeKey;
}

/**
 * The active scene controller (with any extra methods the scene exposes).
 * @returns {SceneController | null}
 */
export function getActiveController() {
  return activeController;
}

/** @returns {boolean} True while a scene switch is in progress */
export function isSwitching() {
  return pendingSwitch !== null;
}

// -----------------------------------------------------------------------------
//  Switching
// -----------------------------------------------------------------------------

/**
 * Switch to a registered scene. The old scene fades out and is fully
 * disposed (freeing GPU memory) before the new one fades in.
 *
 * If a switch is already in progress, this waits for it to finish first.
 *
 * @param {string} key
 * @param {{ fade?: boolean, options?: Record<string, unknown> }} [config]
 * @returns {Promise<SceneController>}
 */
export async function switchScene(key, { fade = true, options = {} } = {}) {
  // Run one switch at a time.
  while (pendingSwitch) {
    try {
      await pendingSwitch;
    } catch {
      // A failed earlier switch shouldn't block this one.
    }
  }

  if (key === activeKey && activeController) return activeController;

  const factory = registry.get(key);
  if (!factory) {
    throw new Error(`switchScene: no scene registered as "${key}".`);
  }

  pendingSwitch = performSwitch(key, factory, fade, options);

  try {
    return await pendingSwitch;
  } finally {
    pendingSwitch = null;
  }
}

/**
 * @param {string} key
 * @param {SceneFactory} factory
 * @param {boolean} fade
 * @param {Record<string, unknown>} options
 * @returns {Promise<SceneController>}
 */
async function performSwitch(key, factory, fade, options) {
  const engine = getEngine();
  const canvas = getCanvas();
  const shouldFade = fade && activeController !== null && !prefersReducedMotion();

  if (shouldFade) await fadeCanvas(canvas, 0);

  disposeActive();

  const controller = await factory({ engine, canvas, options });
  assertValidController(controller, key);

  // Wait until shaders and textures are compiled so the first frame isn't blank.
  await controller.scene.whenReadyAsync();

  activeController = controller;
  activeKey = key;

  if (shouldFade) {
    // Render one frame before fading in, so we never fade in on black.
    renderActiveScene(0, 0);
    await fadeCanvas(canvas, 1);
  } else {
    canvas.style.opacity = '1';
  }

  return controller;
}

/** Dispose the active scene and everything it created. */
function disposeActive() {
  if (!activeController) return;

  try {
    activeController.dispose?.();
  } catch (error) {
    console.error(`[sceneManager] Error while disposing "${activeKey}":`, error);
  }

  if (!activeController.scene.isDisposed) {
    activeController.scene.dispose();
  }

  activeController = null;
  activeKey = null;
}

/**
 * @param {unknown} controller
 * @param {string} key
 * @returns {asserts controller is SceneController}
 */
function assertValidController(controller, key) {
  if (!controller || typeof controller !== 'object' || !('scene' in controller)) {
    throw new Error(`Scene "${key}" factory must return an object with a "scene" property.`);
  }
}

// -----------------------------------------------------------------------------
//  Rendering (called by the engine's frame loop)
// -----------------------------------------------------------------------------

/**
 * Update and render the active scene. Pass this to startRenderLoop().
 * @param {number} deltaSeconds
 * @param {number} elapsedSeconds
 */
export function renderActiveScene(deltaSeconds, elapsedSeconds) {
  const controller = activeController;
  if (!controller || controller.scene.isDisposed) return;

  try {
    controller.update?.(deltaSeconds, elapsedSeconds);
  } catch (error) {
    console.error(`[sceneManager] Error in "${activeKey}" update():`, error);
  }

  if (controller.scene.activeCamera) {
    controller.scene.render();
  }
}

/** Dispose everything (used when shutting the app down). */
export function disposeAllScenes() {
  disposeActive();
  registry.clear();
}

// -----------------------------------------------------------------------------
//  Helpers
// -----------------------------------------------------------------------------

/** @returns {boolean} */
function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

/**
 * Fade the canvas to a given opacity using a CSS transition.
 * @param {HTMLCanvasElement} canvas
 * @param {0 | 1} targetOpacity
 * @returns {Promise<void>}
 */
function fadeCanvas(canvas, targetOpacity) {
  return new Promise((resolve) => {
    const current = Number.parseFloat(canvas.style.opacity || '1');
    if (current === targetOpacity) {
      resolve();
      return;
    }

    canvas.style.transition = `opacity ${FADE_MS}ms ease`;

    // Resolve on transitionend, with a timeout as a safety net.
    const done = () => {
      canvas.removeEventListener('transitionend', done);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, FADE_MS + 100);
    canvas.addEventListener('transitionend', done);

    // Next frame, so the transition reliably starts.
    requestAnimationFrame(() => {
      canvas.style.opacity = String(targetOpacity);
    });
  });
}