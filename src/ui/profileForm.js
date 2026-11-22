/**
 * Effective Eureka - profile form
 *
 * Handles the "Create Your Profile" form:
 *  - fills it in when editing an existing profile
 *  - live preview of the favorite color
 *  - validation with accessible error messages
 *  - saves through the state store, then calls onSaved()
 *
 * All input is cleaned by sanitizeProfile() before it's stored.
 *
 * @module ui/profileForm
 */

import { formError, profileSaved, uiClick, uiHover } from '@/audio/sfx.js';
import { updateProfile } from '@/core/state.js';
import {
  DEFAULT_COLOR,
  PROFILE_FIELDS,
  sanitizeColor,
  sanitizeProfile,
  validateProfile,
} from '@/utils/storage.js';

/**
 * @typedef {import('@/utils/storage.js').Profile} Profile
 */

/**
 * @typedef {Object} ProfileFormOptions
 * @property {(profile: Profile) => void} onSaved Runs after a successful save
 */

/**
 * Set up the profile form.
 * @param {ProfileFormOptions} options
 */
export function initProfileForm({ onSaved }) {
  const form = document.getElementById('profile-form');
  const title = document.getElementById('profile-title');
  const submitButton = document.getElementById('profile-submit-btn');
  const colorInput = document.getElementById('field-color');
  const colorOutput = document.getElementById('field-color-value');

  if (!(form instanceof HTMLFormElement) || !(colorInput instanceof HTMLInputElement)) {
    throw new Error('initProfileForm: #profile-form or #field-color is missing from index.html.');
  }

  // ---------------------------------------------------------------------------
  //  Field helpers
  // ---------------------------------------------------------------------------

  /**
   * @param {string} key
   * @returns {HTMLInputElement | HTMLTextAreaElement | null}
   */
  function getField(key) {
    const element = form.elements.namedItem(key);
    return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? element
      : null;
  }

  /**
   * @param {string} key
   * @returns {HTMLElement | null}
   */
  function getErrorElement(key) {
    return form.querySelector(`[data-error-for="${CSS.escape(key)}"]`);
  }

  /**
   * Show or clear one field's error.
   * @param {string} key
   * @param {string} message Empty string clears the error
   */
  function setFieldError(key, message) {
    const field = getField(key);
    const errorElement = getErrorElement(key);

    if (errorElement) {
      errorElement.textContent = message;
      if (!errorElement.id) errorElement.id = `error-${key}`;
    }

    if (!field) return;
    if (message) {
      field.setAttribute('aria-invalid', 'true');
      if (errorElement) field.setAttribute('aria-describedby', errorElement.id);
    } else {
      field.removeAttribute('aria-invalid');
      field.removeAttribute('aria-describedby');
    }
  }

  function clearAllErrors() {
    PROFILE_FIELDS.forEach((field) => setFieldError(field.key, ''));
  }

  /**
   * Read every field into a plain object.
   * @returns {Record<string, string>}
   */
  function readForm() {
    /** @type {Record<string, string>} */
    const data = {};
    for (const field of PROFILE_FIELDS) {
      data[field.key] = getField(field.key)?.value ?? '';
    }
    return data;
  }

  // ---------------------------------------------------------------------------
  //  Favorite color preview
  // ---------------------------------------------------------------------------

  /**
   * Show the chosen color next to the picker and tint the UI with it.
   * @param {string} value
   */
  function updateColorPreview(value) {
    const color = sanitizeColor(value);
    if (colorOutput) colorOutput.textContent = color;
    document.documentElement.style.setProperty('--player-color', color);
  }

  function handleColorInput() {
    updateColorPreview(colorInput.value);
  }

  // ---------------------------------------------------------------------------
  //  Submit
  // ---------------------------------------------------------------------------

  /** @param {SubmitEvent} event */
  function handleSubmit(event) {
    event.preventDefault();
    clearAllErrors();

    const profile = sanitizeProfile(readForm());
    const errors = validateProfile(profile);
    const invalidKeys = Object.keys(errors);

    if (invalidKeys.length > 0) {
      invalidKeys.forEach((key) => setFieldError(key, errors[key]));
      getField(invalidKeys[0])?.focus();
      formError();
      return;
    }

    // Show the cleaned values in the form (trimmed spaces, etc.).
    fill(profile);

    const saved = updateProfile(profile);
    uiClick();
    profileSaved();
    onSaved(saved);
  }

  /**
   * Clear a field's error as soon as the user starts fixing it.
   * @param {Event} event
   */
  function handleInput(event) {
    const target = event.target;
    if (
      (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) &&
      target.getAttribute('aria-invalid') === 'true' &&
      target.value.trim() !== ''
    ) {
      setFieldError(target.name, '');
    }
  }

  // ---------------------------------------------------------------------------
  //  Public API
  // ---------------------------------------------------------------------------

  /**
   * Fill the form with a profile (for editing).
   * @param {Profile | null} profile
   */
  function fill(profile) {
    for (const field of PROFILE_FIELDS) {
      const element = getField(field.key);
      if (!element) continue;

      if (field.type === 'color') {
        element.value = profile ? sanitizeColor(profile[field.key]) : DEFAULT_COLOR;
      } else {
        element.value = profile?.[field.key] ?? '';
      }
    }
    updateColorPreview(colorInput.value);
  }

  /**
   * Switch the wording between creating and editing.
   * @param {'create' | 'edit'} mode
   */
  function setMode(mode) {
    const editing = mode === 'edit';
    if (title) title.textContent = editing ? 'Edit Your Profile' : 'Create Your Profile';
    if (submitButton) submitButton.textContent = editing ? 'Save Changes' : 'Save Profile';
  }

  /**
   * Get the form ready to show: fill it, set the wording, clear old errors.
   * @param {Profile | null} profile Existing profile, or null for a new one
   */
  function prepare(profile) {
    clearAllErrors();
    fill(profile);
    setMode(profile ? 'edit' : 'create');
  }

  /** Put keyboard focus in the first field. */
  function focusFirstField() {
    getField(PROFILE_FIELDS[0].key)?.focus({ preventScroll: true });
  }

  function destroy() {
    form.removeEventListener('submit', handleSubmit);
    form.removeEventListener('input', handleInput);
    colorInput.removeEventListener('input', handleColorInput);
    submitButton?.removeEventListener('pointerenter', uiHover);
  }

  form.addEventListener('submit', handleSubmit);
  form.addEventListener('input', handleInput);
  colorInput.addEventListener('input', handleColorInput);
  submitButton?.addEventListener('pointerenter', uiHover);

  return { prepare, fill, setMode, focusFirstField, destroy };
}