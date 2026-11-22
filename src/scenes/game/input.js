/**
 * Effective Eureka - game input
 *
 * Unified jump controls for keyboard, mouse and touch.
 *
 * Features:
 *  - Jump buffering: a press shortly before landing still counts.
 *  - Hold detection: holding jump makes a higher jump (variable jump height).
 *  - Pause: Escape or P.
 *  - Ignores clicks on real UI buttons (sound toggle, game-over buttons).
 *  - Releases everything when the window loses focus, so keys never "stick".
 *
 * Usage:
 *   const input = createGameInput({ onPause: togglePause });
 *   if (input.consumeJump()) startJump();
 *   if (!input.isJumpHeld()) cutJumpShort();
 *   input.destroy();
 *
 * @module scenes/game/input
 */

const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);

/** Clicks on these elements are UI, not jumps. */
const UI_SELECTOR = 'button, a, input, textarea, select, label, [role="dialog"]';

/** How long a jump press stays "remembered", in milliseconds. */
const DEFAULT_BUFFER_MS = 130;

/**
 * @typedef {Object} GameInputOptions
 * @property {() => void} [onPause]        Called when a pause key is pressed
 * @property {() => void} [onFirstInput]   Called on the very first jump press (hide the hint)
 * @property {number} [bufferMs=130]       Jump buffer window
 */

/**
 * @param {GameInputOptions} [options]
 */
export function createGameInput({ onPause, onFirstInput, bufferMs = DEFAULT_BUFFER_MS } = {}) {
  let enabled = true;
  let lastPressTime = -Infinity;
  let hasHadInput = false;

  /** Keys and pointers currently holding jump down. */
  const heldKeys = new Set();
  const heldPointers = new Set();

  // ---------------------------------------------------------------------------
  //  Internal
  // ---------------------------------------------------------------------------

  function registerPress() {
    lastPressTime = performance.now();
    if (!hasHadInput) {
      hasHadInput = true;
      onFirstInput?.();
    }
  }

  /**
   * True if the event target is a real UI control that should keep its click.
   * @param {EventTarget | null} target
   */
  function isUiTarget(target) {
    return target instanceof Element && target.closest(UI_SELECTOR) !== null;
  }

  // ---------------------------------------------------------------------------
  //  Keyboard
  // ---------------------------------------------------------------------------

  /** @param {KeyboardEvent} event */
  function handleKeyDown(event) {
    if (!enabled) return;

    if (PAUSE_KEYS.has(event.code)) {
      if (!event.repeat) onPause?.();
      event.preventDefault();
      return;
    }

    if (!JUMP_KEYS.has(event.code)) return;

    // Don't let Space scroll the page or click a focused button during play.
    event.preventDefault();

    if (!event.repeat && !heldKeys.has(event.code)) {
      registerPress();
    }
    heldKeys.add(event.code);
  }

  /** @param {KeyboardEvent} event */
  function handleKeyUp(event) {
    heldKeys.delete(event.code);
  }

  // ---------------------------------------------------------------------------
  //  Mouse and touch (pointer events cover both)
  // ---------------------------------------------------------------------------

  /** @param {PointerEvent} event */
  function handlePointerDown(event) {
    if (!enabled || isUiTarget(event.target)) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return; // left click only

    registerPress();
    heldPointers.add(event.pointerId);
  }

  /** @param {PointerEvent} event */
  function handlePointerUp(event) {
    heldPointers.delete(event.pointerId);
  }

  /** Release everything when the window loses focus. */
  function releaseAll() {
    heldKeys.clear();
    heldPointers.clear();
  }

  function handleVisibilityChange() {
    if (document.hidden) {
      releaseAll();
      if (enabled) onPause?.();
    }
  }

  /** @param {Event} event */
  function preventContextMenu(event) {
    if (enabled && !isUiTarget(event.target)) event.preventDefault();
  }

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('pointerdown', handlePointerDown);
  window.addEventListener('pointerup', handlePointerUp);
  window.addEventListener('pointercancel', handlePointerUp);
  window.addEventListener('blur', releaseAll);
  window.addEventListener('contextmenu', preventContextMenu);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // ---------------------------------------------------------------------------
  //  Public API
  // ---------------------------------------------------------------------------

  /**
   * Returns true (once) if jump was pressed within the buffer window.
   * Call this when the player is able to jump.
   * @returns {boolean}
   */
  function consumeJump() {
    if (!enabled) return false;
    if (performance.now() - lastPressTime <= bufferMs) {
      lastPressTime = -Infinity;
      return true;
    }
    return false;
  }

  /** @returns {boolean} True while any jump key or pointer is held down */
  function isJumpHeld() {
    return enabled && (heldKeys.size > 0 || heldPointers.size > 0);
  }

  /**
   * Turn input on or off (off during game-over and pause menus).
   * @param {boolean} value
   */
  function setEnabled(value) {
    enabled = Boolean(value);
    if (!enabled) {
      releaseAll();
      lastPressTime = -Infinity;
    }
  }

  /** Forget any buffered press (e.g. when restarting). */
  function clear() {
    releaseAll();
    lastPressTime = -Infinity;
  }

  function destroy() {
    window.removeEventListener('keydown', handleKeyDown);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('pointerdown', handlePointerDown);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
    window.removeEventListener('blur', releaseAll);
    window.removeEventListener('contextmenu', preventContextMenu);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    releaseAll();
  }

  return { consumeJump, isJumpHeld, setEnabled, clear, destroy };
}