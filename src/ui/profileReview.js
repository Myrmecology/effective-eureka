/**
 * Effective Eureka - profile review
 *
 * Renders the saved profile as a list of labeled tiles and wires the
 * "Edit Profile" button. The slime button lives in slimeButton.js.
 *
 * Security: every value is inserted with textContent (never innerHTML),
 * so user text is always shown as plain text and can't inject HTML or scripts.
 *
 * @module ui/profileReview
 */

import { uiClick, uiHover } from '@/audio/sfx.js';
import { PROFILE_FIELDS, sanitizeColor } from '@/utils/storage.js';

/**
 * @typedef {import('@/utils/storage.js').Profile} Profile
 */

/**
 * @typedef {Object} ProfileReviewOptions
 * @property {() => void} onEdit Runs when "Edit Profile" is clicked
 */

/**
 * Set up the review screen.
 * @param {ProfileReviewOptions} options
 */
export function initProfileReview({ onEdit }) {
  const summary = document.getElementById('profile-summary');
  const editButton = document.getElementById('edit-profile-btn');
  const title = document.getElementById('review-title');

  if (!(summary instanceof HTMLDListElement) || !(editButton instanceof HTMLButtonElement)) {
    throw new Error('initProfileReview: #profile-summary or #edit-profile-btn is missing.');
  }

  /**
   * Build one label/value tile.
   * @param {import('@/utils/storage.js').ProfileField} field
   * @param {string} value
   * @returns {HTMLDivElement}
   */
  function createItem(field, value) {
    const item = document.createElement('div');
    item.className = 'profile-summary__item';
    if (field.type === 'longText') item.classList.add('profile-summary__item--wide');

    const term = document.createElement('dt');
    term.textContent = field.label;

    const detail = document.createElement('dd');

    if (field.type === 'color') {
      const color = sanitizeColor(value);
      const swatch = document.createElement('span');
      swatch.className = 'profile-summary__swatch';
      swatch.style.backgroundColor = color;
      swatch.style.color = color; // drives the glow (box-shadow uses currentColor)
      swatch.setAttribute('aria-hidden', 'true');

      const code = document.createElement('span');
      code.textContent = color.toUpperCase();

      detail.append(swatch, code);
    } else {
      detail.textContent = value;
      if (field.type === 'longText') detail.style.whiteSpace = 'pre-line'; // keep line breaks
    }

    item.append(term, detail);
    return item;
  }

  /**
   * Show a profile on the review screen.
   * @param {Profile} profile
   */
  function render(profile) {
    const fragment = document.createDocumentFragment();

    for (const field of PROFILE_FIELDS) {
      fragment.append(createItem(field, profile[field.key] ?? ''));
    }

    summary.replaceChildren(fragment);

    if (title) {
      title.textContent = profile.name ? `${profile.name}'s Profile` : 'Your Profile';
    }
  }

  /** Move keyboard focus to the heading, for screen reader users. */
  function focusHeading() {
    if (!title) return;
    title.setAttribute('tabindex', '-1');
    title.focus({ preventScroll: true });
  }

  function handleEditClick() {
    uiClick();
    onEdit();
  }

  function destroy() {
    editButton.removeEventListener('click', handleEditClick);
    editButton.removeEventListener('pointerenter', uiHover);
  }

  editButton.addEventListener('click', handleEditClick);
  editButton.addEventListener('pointerenter', uiHover);

  return { render, focusHeading, destroy };
}