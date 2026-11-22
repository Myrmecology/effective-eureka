/**
 * Effective Eureka - "Enter the Realm" button
 *
 * Wires the HTML button to the enter sequence. This module only handles the
 * button itself; main.js supplies what actually happens via `onActivate`
 * (3D burst, scroll roll-back, screen change).
 *
 * @module ui/enterButton
 */

import { unlockAudio } from '@/audio/audioEngine.js';
import { uiHover } from '@/audio/sfx.js';

/**
 * @typedef {Object} ButtonCenter
 * @property {number} screenX  CSS pixels from the canvas's left edge
 * @property {number} screenY  CSS pixels from the canvas's top edge
 */

/**
 * @typedef {Object} EnterButtonOptions
 * @property {(center: ButtonCenter) => Promise<void> | void} onActivate
 *   Runs once when the button is pressed. The button stays locked until
 *   the returned promise finishes.
 */

/**
 * Set up the Enter button.
 * @param {EnterButtonOptions} options
 * @returns {{ reset: () => void, destroy: () => void }}
 */
export function initEnterButton({ onActivate }) {
  const button = document.getElementById('enter-btn');
  const canvas = document.getElementById('render-canvas');

  if (!(button instanceof HTMLButtonElement) || !(canvas instanceof HTMLCanvasElement)) {
    throw new Error('initEnterButton: #enter-btn or #render-canvas is missing from index.html.');
  }

  let activated = false;

  /**
   * The button's center, relative to the canvas.
   * @returns {ButtonCenter}
   */
  function getButtonCenter() {
    const buttonRect = button.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    return {
      screenX: buttonRect.left + buttonRect.width / 2 - canvasRect.left,
      screenY: buttonRect.top + buttonRect.height / 2 - canvasRect.top,
    };
  }

  /** @param {MouseEvent} event */
  async function handleClick(event) {
    event.preventDefault();
    if (activated) return;
    activated = true;

    // Measure before the burst animation changes the button's size.
    const center = getButtonCenter();

    // Must run inside the click so the browser allows sound to start.
    await unlockAudio();

    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.classList.add('is-bursting');

    // Hide the button completely once its CSS burst animation finishes.
    button.addEventListener(
      'animationend',
      () => {
        button.style.visibility = 'hidden';
      },
      { once: true },
    );

    try {
      await onActivate(center);
    } catch (error) {
      console.error('[enterButton] Enter sequence failed:', error);
      reset(); // let the user try again
    }
  }

  function handlePointerEnter() {
    if (!activated) uiHover();
  }

  /** Put the button back to its starting state. */
  function reset() {
    activated = false;
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.classList.remove('is-bursting');
    button.style.visibility = '';
  }

  /** Remove all listeners. */
  function destroy() {
    button.removeEventListener('click', handleClick);
    button.removeEventListener('pointerenter', handlePointerEnter);
  }

  button.addEventListener('click', handleClick);
  button.addEventListener('pointerenter', handlePointerEnter);

  return { reset, destroy };
}