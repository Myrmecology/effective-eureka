/**
 * Effective Eureka - slime button
 *
 * Builds the oozing button that starts the game. The gooey look comes from
 * an SVG filter: blur everything, then sharpen the alpha channel, so
 * separate blobs (the body and the drips) melt together like liquid.
 *
 * Usage:
 *   const slime = initSlimeButton({ onActivate: startGame });
 *   slime.show();   // when the review screen opens
 *   slime.hide();   // when leaving it
 *
 * @module ui/slimeButton
 */

import { unlockAudio } from '@/audio/audioEngine.js';
import { slimeAppear, slimeBlub, slimeSquish } from '@/audio/sfx.js';
import { randRange } from '@/utils/math.js';

const FILTER_ID = 'slime-goo';
const SVG_NS = 'http://www.w3.org/2000/svg';
const DRIP_COUNT = 8;
const BUTTON_LABEL = 'Start the Game';

/**
 * @typedef {Object} SlimeButtonOptions
 * @property {() => void} onActivate Runs after the squish animation finishes
 */

/**
 * Set up the slime button (it stays hidden until show() is called).
 * @param {SlimeButtonOptions} options
 */
export function initSlimeButton({ onActivate }) {
  const host = document.getElementById('slime-button-host');
  if (!(host instanceof HTMLElement)) {
    throw new Error('initSlimeButton: #slime-button-host is missing from index.html.');
  }

  ensureGooFilter();

  /** @type {HTMLButtonElement | null} */
  let button = null;
  let activated = false;
  /** @type {number} */
  let bubbleTimer = 0;

  // ---------------------------------------------------------------------------
  //  Build
  // ---------------------------------------------------------------------------

  /** @returns {HTMLButtonElement} */
  function build() {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'slime-btn';
    element.id = 'slime-btn';

    // Gooey layer: body and drips, melted together by the SVG filter.
    const goo = document.createElement('span');
    goo.className = 'slime-btn__goo';
    goo.setAttribute('aria-hidden', 'true');

    const body = document.createElement('span');
    body.className = 'slime-btn__body';
    goo.append(body);

    for (let i = 0; i < DRIP_COUNT; i += 1) {
      const drip = document.createElement('span');
      drip.className = 'slime-btn__drip';
      // Spread drips across the bottom edge with random size and timing.
      const lane = (i + 0.5) / DRIP_COUNT;
      drip.style.setProperty('--drip-x', `${(8 + lane * 84 + randRange(-4, 4)).toFixed(1)}%`);
      drip.style.setProperty('--drip-size', `${randRange(12, 26).toFixed(0)}px`);
      drip.style.setProperty('--drip-delay', `${randRange(0, 2.5).toFixed(2)}s`);
      drip.style.setProperty('--drip-duration', `${randRange(2, 3.6).toFixed(2)}s`);
      goo.append(drip);
    }

    const label = document.createElement('span');
    label.className = 'slime-btn__label';
    label.textContent = BUTTON_LABEL;

    element.append(goo, label);

    element.addEventListener('click', handleClick);
    element.addEventListener('pointerenter', handlePointerEnter);
    element.addEventListener('pointerleave', handlePointerLeave);
    element.addEventListener('focus', handlePointerEnter);
    element.addEventListener('blur', handlePointerLeave);

    return element;
  }

  // ---------------------------------------------------------------------------
  //  Interaction
  // ---------------------------------------------------------------------------

  /** Blub sounds while hovering, at random intervals. */
  function handlePointerEnter() {
    if (activated) return;
    slimeBlub();
    window.clearInterval(bubbleTimer);
    bubbleTimer = window.setInterval(() => {
      if (Math.random() < 0.6) slimeBlub();
    }, 380);
  }

  function handlePointerLeave() {
    window.clearInterval(bubbleTimer);
  }

  /** @param {MouseEvent} event */
  async function handleClick(event) {
    event.preventDefault();
    if (activated || !button) return;
    activated = true;
    handlePointerLeave();

    await unlockAudio();
    slimeSquish();

    const element = button;
    element.disabled = true;
    element.setAttribute('aria-busy', 'true');
    element.classList.remove('is-appearing');
    element.classList.add('is-squished');

    // Wait for the squish to finish, with a timeout in case animations are off.
    await new Promise((resolve) => {
      const timer = window.setTimeout(resolve, 600);
      element.addEventListener(
        'animationend',
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });

    onActivate();
  }

  // ---------------------------------------------------------------------------
  //  Public API
  // ---------------------------------------------------------------------------

  /**
   * Show the button with its pop-in animation and sound.
   * @param {{ silent?: boolean }} [options] silent skips the appear sound
   */
  function show({ silent = false } = {}) {
    hide();
    activated = false;
    button = build();
    host.append(button);

    // Restart the pop-in animation on the next frame.
    requestAnimationFrame(() => {
      button?.classList.add('is-appearing');
      if (!silent) slimeAppear();
    });
  }

  /** Remove the button. */
  function hide() {
    handlePointerLeave();
    button?.remove();
    button = null;
  }

  /** Move keyboard focus to the button. */
  function focus() {
    button?.focus({ preventScroll: true });
  }

  function destroy() {
    hide();
    document.getElementById(`${FILTER_ID}-svg`)?.remove();
  }

  return { show, hide, focus, destroy };
}

// =============================================================================
//  SVG goo filter (added to the page once)
// =============================================================================

/**
 * Add the hidden SVG that defines the "goo" filter.
 *  1. Blur the shapes so their edges spread into each other.
 *  2. Boost alpha contrast, so the blurry edges snap back to a sharp,
 *     merged outline.
 *  3. Draw the original colors back on top of the merged shape.
 */
function ensureGooFilter() {
  if (document.getElementById(FILTER_ID)) return;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.id = `${FILTER_ID}-svg`;
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('width', '0');
  svg.setAttribute('height', '0');
  svg.style.position = 'absolute';

  const filter = document.createElementNS(SVG_NS, 'filter');
  filter.id = FILTER_ID;
  // Give the filter room so drips below the button aren't clipped.
  filter.setAttribute('x', '-20%');
  filter.setAttribute('y', '-20%');
  filter.setAttribute('width', '140%');
  filter.setAttribute('height', '220%');

  const blur = document.createElementNS(SVG_NS, 'feGaussianBlur');
  blur.setAttribute('in', 'SourceGraphic');
  blur.setAttribute('stdDeviation', '7');
  blur.setAttribute('result', 'blur');

  const matrix = document.createElementNS(SVG_NS, 'feColorMatrix');
  matrix.setAttribute('in', 'blur');
  matrix.setAttribute('mode', 'matrix');
  matrix.setAttribute('values', '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9');
  matrix.setAttribute('result', 'goo');

  const composite = document.createElementNS(SVG_NS, 'feComposite');
  composite.setAttribute('in', 'SourceGraphic');
  composite.setAttribute('in2', 'goo');
  composite.setAttribute('operator', 'atop');

  filter.append(blur, matrix, composite);
  svg.append(filter);
  document.body.append(svg);
}