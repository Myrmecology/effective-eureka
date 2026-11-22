/**
 * Effective Eureka - Babylon.js engine setup
 *
 * Creates the single WebGL engine for the whole app and runs the render loop.
 * Scenes are created and swapped by sceneManager.js. This file only owns
 * the engine, the canvas and the frame loop.
 *
 * Note on imports: we import from the '@babylonjs/core' package root.
 * This guarantees every Babylon feature we use is registered (no missing
 * "side-effect" imports). Vite still splits Babylon into its own cached chunk.
 *
 * @module core/engine
 */

import { Engine } from '@babylonjs/core';

/** Cap the pixel ratio so 4K and high-DPI screens don't overload the GPU. */
const MAX_PIXEL_RATIO = 2;

/** Largest frame time we'll report, so a lag spike can't break physics. */
const MAX_DELTA_SECONDS = 1 / 20;

/** @type {Engine | null} */
let engine = null;

/** @type {HTMLCanvasElement | null} */
let canvas = null;

/** @type {ResizeObserver | null} */
let resizeObserver = null;

/**
 * @callback FrameCallback
 * @param {number} deltaSeconds Time since the last frame, clamped
 * @param {number} elapsedSeconds Total time since the loop started
 * @returns {void}
 */

/** @type {FrameCallback | null} */
let frameCallback = null;

let elapsedSeconds = 0;
let isLoopRunning = false;

// -----------------------------------------------------------------------------
//  Support check
// -----------------------------------------------------------------------------

/**
 * Check whether the browser can create a WebGL context at all.
 * @returns {boolean}
 */
export function isWebGLSupported() {
  try {
    const testCanvas = document.createElement('canvas');
    return Boolean(testCanvas.getContext('webgl2') || testCanvas.getContext('webgl'));
  } catch {
    return false;
  }
}

// -----------------------------------------------------------------------------
//  Engine lifecycle
// -----------------------------------------------------------------------------

/**
 * Create the Babylon engine on the given canvas. Safe to call once.
 *
 * @param {HTMLCanvasElement} targetCanvas
 * @returns {Engine}
 * @throws {Error} If WebGL isn't available
 */
export function createEngine(targetCanvas) {
  if (engine) return engine;

  if (!(targetCanvas instanceof HTMLCanvasElement)) {
    throw new TypeError('createEngine: a <canvas> element is required.');
  }

  if (!isWebGLSupported()) {
    throw new Error('WebGL is not supported on this device or browser.');
  }

  canvas = targetCanvas;

  engine = new Engine(
    canvas,
    true, // antialias: smooth edges
    {
      preserveDrawingBuffer: false, // faster; we don't need screenshots
      stencil: true, // needed for glow and highlight effects
      powerPreference: 'high-performance', // prefer the gaming GPU on laptops
      premultipliedAlpha: false,
      doNotHandleContextLost: false, // let Babylon rebuild after a GPU reset
      audioEngine: false, // we generate all sound ourselves with Web Audio
    },
    false, // adaptToDeviceRatio: handled manually below with a cap
  );

  applyPixelRatio();
  watchCanvasSize();
  watchContextLoss();
  watchVisibility();

  return engine;
}

/**
 * The active engine.
 * @returns {Engine}
 * @throws {Error} If createEngine() hasn't been called
 */
export function getEngine() {
  if (!engine) throw new Error('getEngine: call createEngine() first.');
  return engine;
}

/**
 * The canvas the engine renders into.
 * @returns {HTMLCanvasElement}
 */
export function getCanvas() {
  if (!canvas) throw new Error('getCanvas: call createEngine() first.');
  return canvas;
}

/**
 * Start the frame loop. The callback runs once per frame and should
 * render the active scene (sceneManager.js does this).
 *
 * @param {FrameCallback} callback
 */
export function startRenderLoop(callback) {
  const activeEngine = getEngine();
  frameCallback = callback;

  if (isLoopRunning) return;
  isLoopRunning = true;

  activeEngine.runRenderLoop(() => {
    const deltaSeconds = Math.min(activeEngine.getDeltaTime() / 1000, MAX_DELTA_SECONDS);
    elapsedSeconds += deltaSeconds;
    frameCallback?.(deltaSeconds, elapsedSeconds);
  });
}

/** Stop the frame loop. */
export function stopRenderLoop() {
  if (!engine || !isLoopRunning) return;
  engine.stopRenderLoop();
  isLoopRunning = false;
}

/** Shut down the engine completely and free GPU memory. */
export function disposeEngine() {
  stopRenderLoop();
  resizeObserver?.disconnect();
  resizeObserver = null;
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  engine?.dispose();
  engine = null;
  canvas = null;
  frameCallback = null;
  elapsedSeconds = 0;
}

// -----------------------------------------------------------------------------
//  Sizing and pixel ratio
// -----------------------------------------------------------------------------

/**
 * Render at the screen's real sharpness, capped for performance.
 * A hardware scaling level of 0.5 means "render at 2x pixels".
 */
function applyPixelRatio() {
  if (!engine) return;
  const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  engine.setHardwareScalingLevel(1 / ratio);
}

/** Resize the render target whenever the canvas changes size. */
function watchCanvasSize() {
  if (!engine || !canvas) return;

  const handleResize = () => {
    applyPixelRatio();
    engine?.resize();
  };

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(canvas);
  } else {
    window.addEventListener('resize', handleResize, { passive: true });
  }

  // Moving the window to a monitor with a different pixel ratio.
  window.matchMedia?.(`(resolution: ${window.devicePixelRatio}dppx)`)
    .addEventListener?.('change', handleResize, { once: true });
}

// -----------------------------------------------------------------------------
//  Robustness: GPU context loss and hidden tabs
// -----------------------------------------------------------------------------

/** Log GPU resets. Babylon rebuilds resources automatically. */
function watchContextLoss() {
  if (!engine) return;

  engine.onContextLostObservable.add(() => {
    console.warn('[engine] WebGL context lost. Waiting for the browser to restore it…');
  });

  engine.onContextRestoredObservable.add(() => {
    console.info('[engine] WebGL context restored.');
    applyPixelRatio();
    engine?.resize();
  });
}

/** Pause rendering while the tab is hidden to save battery and GPU. */
function handleVisibilityChange() {
  if (!engine || !frameCallback) return;

  if (document.hidden) {
    stopRenderLoop();
  } else {
    // Reset Babylon's frame timer so we don't get one giant time jump.
    engine.getDeltaTime();
    startRenderLoop(frameCallback);
  }
}

function watchVisibility() {
  document.addEventListener('visibilitychange', handleVisibilityChange);
}

// -----------------------------------------------------------------------------
//  Error display
// -----------------------------------------------------------------------------

/**
 * Show a friendly error on the loading screen when something fatal happens.
 * Uses textContent only, never innerHTML.
 *
 * @param {string} message
 */
export function showFatalError(message) {
  const loading = document.getElementById('loading-screen');
  const text = loading?.querySelector('.loading-screen__text');
  const spinner = loading?.querySelector('.loading-screen__spinner');

  if (loading) {
    loading.classList.remove('is-done');
    loading.setAttribute('role', 'alert');
  }
  if (spinner instanceof HTMLElement) spinner.hidden = true;
  if (text) text.textContent = message;
}