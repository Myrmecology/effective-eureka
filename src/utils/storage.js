/**
 * Effective Eureka - storage utilities
 *
 * What is remembered, and for how long:
 *  - PROFILE: this visit only. It lives in memory, so every page load
 *    starts with a blank profile form. Any profile saved by an older
 *    version of the app is deleted on load.
 *  - BEST SCORE and SETTINGS (sound on/off): saved in localStorage, so
 *    they survive closing the tab.
 *
 * Security and reliability:
 *  - All keys are namespaced and versioned ("effective-eureka:v1:...").
 *  - Everything read back is validated and cleaned, because anyone can edit
 *    localStorage by hand in the browser's dev tools.
 *  - If storage is blocked (private mode, strict settings), we fall back to
 *    in-memory storage so the app still works for that session.
 *  - Only plain text is stored. It is always displayed with textContent,
 *    never innerHTML.
 *
 * @module utils/storage
 */

const NAMESPACE = 'effective-eureka';
const SCHEMA_VERSION = 1;

const KEYS = Object.freeze({
  profile: `${NAMESPACE}:v${SCHEMA_VERSION}:profile`, // only used to delete old saved profiles
  bestScore: `${NAMESPACE}:v${SCHEMA_VERSION}:best-score`,
  settings: `${NAMESPACE}:v${SCHEMA_VERSION}:settings`,
});

// -----------------------------------------------------------------------------
//  Profile schema: the single source of truth for profile fields.
//  The form, the validation and the review screen all read from this list.
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} ProfileField
 * @property {string} key        Property name on the profile object
 * @property {string} label      Human-readable label
 * @property {'text' | 'color' | 'longText'} type
 * @property {number} maxLength
 * @property {boolean} required
 */

/** @type {readonly ProfileField[]} */
export const PROFILE_FIELDS = Object.freeze([
  { key: 'name', label: 'Name', type: 'text', maxLength: 40, required: true },
  { key: 'favoriteColor', label: 'Favorite Color', type: 'color', maxLength: 7, required: true },
  { key: 'favoriteGame', label: 'Favorite Video Game', type: 'text', maxLength: 60, required: true },
  { key: 'favoriteMovie', label: 'Favorite Movie', type: 'text', maxLength: 60, required: true },
  {
    key: 'favoriteSubject',
    label: 'Favorite Subject in School',
    type: 'text',
    maxLength: 60,
    required: true,
  },
  { key: 'favoriteAnimal', label: 'Favorite Animal', type: 'text', maxLength: 60, required: true },
  {
    key: 'favoriteCsTopic',
    label: 'Favorite Computer Science Topic',
    type: 'text',
    maxLength: 60,
    required: true,
  },
  {
    key: 'purpose',
    label: 'My Purpose for Using Effective Eureka',
    type: 'longText',
    maxLength: 300,
    required: true,
  },
]);

/** Default favorite color (matches the vine green). */
export const DEFAULT_COLOR = '#33d17a';

/**
 * @typedef {Object} Profile
 * @property {string} name
 * @property {string} favoriteColor  Hex color like "#33d17a"
 * @property {string} favoriteGame
 * @property {string} favoriteMovie
 * @property {string} favoriteSubject
 * @property {string} favoriteAnimal
 * @property {string} favoriteCsTopic
 * @property {string} purpose
 */

/**
 * @typedef {Object} Settings
 * @property {boolean} soundEnabled
 */

/** @type {Readonly<Settings>} */
const DEFAULT_SETTINGS = Object.freeze({ soundEnabled: true });

const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

// Control characters (except tab and newline) that should never be stored.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// -----------------------------------------------------------------------------
//  Safe storage backend (localStorage with in-memory fallback)
// -----------------------------------------------------------------------------

/** @type {Map<string, string>} */
const memoryStore = new Map();

/**
 * Check once whether localStorage really works.
 * It can exist but throw (Safari private mode, blocked cookies, full quota).
 * @returns {boolean}
 */
function detectLocalStorage() {
  try {
    const testKey = `${NAMESPACE}:__test__`;
    window.localStorage.setItem(testKey, '1');
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

const hasLocalStorage = typeof window !== 'undefined' && detectLocalStorage();

/** Whether best score and settings will persist after the tab is closed. */
export const isPersistent = hasLocalStorage;

/**
 * @param {string} key
 * @returns {string | null}
 */
function readRaw(key) {
  try {
    return hasLocalStorage ? window.localStorage.getItem(key) : (memoryStore.get(key) ?? null);
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

/**
 * @param {string} key
 * @param {string} value
 * @returns {boolean} true if the write succeeded
 */
function writeRaw(key, value) {
  try {
    if (hasLocalStorage) {
      window.localStorage.setItem(key, value);
    } else {
      memoryStore.set(key, value);
    }
    return true;
  } catch (error) {
    // Usually a full storage quota. Keep the value in memory for this session.
    console.warn('[storage] Could not save to localStorage, using memory instead.', error);
    memoryStore.set(key, value);
    return false;
  }
}

/** @param {string} key */
function removeRaw(key) {
  try {
    if (hasLocalStorage) window.localStorage.removeItem(key);
  } catch {
    // Ignore: nothing useful to do if removal fails.
  }
  memoryStore.delete(key);
}

/**
 * Read and parse JSON safely. Returns null for missing or corrupted data.
 * @param {string} key
 * @returns {unknown}
 */
function readJson(key) {
  const raw = readRaw(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn(`[storage] Corrupted data in "${key}". Ignoring it.`);
    removeRaw(key);
    return null;
  }
}

/**
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean}
 */
function writeJson(key, value) {
  return writeRaw(key, JSON.stringify(value));
}

// Delete any profile saved by an older version of the app, so personal
// answers are never left sitting in the browser.
removeRaw(KEYS.profile);

// -----------------------------------------------------------------------------
//  Cleaning and validation
// -----------------------------------------------------------------------------

/**
 * Clean user text: remove control characters, collapse runs of spaces,
 * trim, and enforce a maximum length.
 *
 * @param {unknown} value
 * @param {number} maxLength
 * @param {{ allowNewlines?: boolean }} [options]
 * @returns {string}
 */
export function sanitizeText(value, maxLength, { allowNewlines = false } = {}) {
  if (typeof value !== 'string') return '';

  let text = value.normalize('NFC').replace(CONTROL_CHARS, '');

  if (allowNewlines) {
    text = text
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n');
  } else {
    text = text.replace(/\s+/g, ' ');
  }

  // Array.from counts emoji as one character, so we never cut one in half.
  return Array.from(text.trim()).slice(0, maxLength).join('');
}

/**
 * Return a valid lowercase hex color, or the default if invalid.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeColor(value) {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value.trim())
    ? value.trim().toLowerCase()
    : DEFAULT_COLOR;
}

/**
 * Build a clean profile from any input (form data or stored data).
 * Unknown properties are dropped.
 *
 * @param {Record<string, unknown>} input
 * @returns {Profile}
 */
export function sanitizeProfile(input) {
  const source = input && typeof input === 'object' ? input : {};
  /** @type {Record<string, string>} */
  const clean = {};

  for (const field of PROFILE_FIELDS) {
    const raw = source[field.key];
    if (field.type === 'color') {
      clean[field.key] = sanitizeColor(raw);
    } else {
      clean[field.key] = sanitizeText(raw, field.maxLength, {
        allowNewlines: field.type === 'longText',
      });
    }
  }

  return /** @type {Profile} */ (clean);
}

/**
 * Check a (sanitized) profile for missing required fields.
 * @param {Profile} profile
 * @returns {Record<string, string>} Map of field key to error message (empty if valid)
 */
export function validateProfile(profile) {
  /** @type {Record<string, string>} */
  const errors = {};

  for (const field of PROFILE_FIELDS) {
    if (field.required && !profile[field.key]) {
      errors[field.key] = `Please fill in "${field.label}".`;
    }
  }

  return errors;
}

// -----------------------------------------------------------------------------
//  Public API: profile (this visit only)
// -----------------------------------------------------------------------------

/**
 * The profile for this visit. Lives only in memory, so it is gone
 * as soon as the page is reloaded or closed.
 * @type {Profile | null}
 */
let sessionProfile = null;

/**
 * Get the profile for this visit, or null if one hasn't been created yet.
 * On every fresh page load this returns null.
 * @returns {Profile | null}
 */
export function loadProfile() {
  if (!sessionProfile) return null;
  return Object.keys(validateProfile(sessionProfile)).length === 0 ? sessionProfile : null;
}

/**
 * Keep a profile for the rest of this visit (not saved to the browser).
 * It is sanitized before being kept.
 * @param {Record<string, unknown>} profile
 * @returns {Profile} The cleaned profile
 */
export function saveProfile(profile) {
  sessionProfile = sanitizeProfile(profile);
  return sessionProfile;
}

/** Forget the profile for this visit (and any old saved copy). */
export function clearProfile() {
  sessionProfile = null;
  removeRaw(KEYS.profile);
}

// -----------------------------------------------------------------------------
//  Public API: best score (saved between visits)
// -----------------------------------------------------------------------------

/** Highest score we'll accept, to reject obviously edited values. */
const MAX_SCORE = 10_000_000;

/**
 * @returns {number} The saved best score, or 0
 */
export function loadBestScore() {
  const value = Number(readRaw(KEYS.bestScore));
  return Number.isFinite(value) && value >= 0 && value <= MAX_SCORE ? Math.floor(value) : 0;
}

/**
 * Save a score only if it beats the current best.
 * @param {number} score
 * @returns {{ best: number, isNewBest: boolean }}
 */
export function submitScore(score) {
  const current = loadBestScore();
  const safeScore = Math.floor(Math.min(Math.max(Number(score) || 0, 0), MAX_SCORE));

  if (safeScore > current) {
    writeRaw(KEYS.bestScore, String(safeScore));
    return { best: safeScore, isNewBest: true };
  }
  return { best: current, isNewBest: false };
}

// -----------------------------------------------------------------------------
//  Public API: settings (saved between visits)
// -----------------------------------------------------------------------------

/**
 * @returns {Settings}
 */
export function loadSettings() {
  const stored = readJson(KEYS.settings);
  const source = stored && typeof stored === 'object' ? stored : {};

  return {
    soundEnabled:
      typeof source.soundEnabled === 'boolean'
        ? source.soundEnabled
        : DEFAULT_SETTINGS.soundEnabled,
  };
}

/**
 * Save settings, merged with the current ones.
 * @param {Partial<Settings>} partial
 * @returns {Settings}
 */
export function saveSettings(partial) {
  const next = { ...loadSettings(), ...partial };
  const clean = { soundEnabled: Boolean(next.soundEnabled) };
  writeJson(KEYS.settings, clean);
  return clean;
}

// -----------------------------------------------------------------------------
//  Public API: reset everything
// -----------------------------------------------------------------------------

/** Remove all Effective Eureka data from this browser and this visit. */
export function clearAll() {
  sessionProfile = null;
  Object.values(KEYS).forEach(removeRaw);
}