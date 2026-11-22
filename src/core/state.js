/**
 * Effective Eureka - application state
 *
 * A tiny, dependency-free state store. It holds:
 *  - which screen is showing
 *  - the player's profile
 *  - the best score
 *  - settings (sound on/off)
 *
 * Other modules read state with `getState()`, change it through the
 * action functions below, and react to changes with `subscribe()`.
 * State objects are frozen, so they can't be changed by accident.
 *
 * @module core/state
 */

import {
  loadBestScore,
  loadProfile,
  loadSettings,
  saveProfile,
  saveSettings,
  submitScore,
} from '@/utils/storage.js';

// -----------------------------------------------------------------------------
//  Screens and allowed transitions
// -----------------------------------------------------------------------------

/** Every screen in the app. */
export const SCREENS = Object.freeze({
  LOADING: 'loading',
  HOME: 'home',
  PROFILE: 'profile',
  REVIEW: 'review',
  GAME: 'game',
});

/**
 * Which screens each screen may move to. Prevents impossible jumps
 * (for example, from Home straight into the game without a profile).
 * @type {Readonly<Record<string, readonly string[]>>}
 */
const ALLOWED_TRANSITIONS = Object.freeze({
  [SCREENS.LOADING]: [SCREENS.HOME],
  [SCREENS.HOME]: [SCREENS.PROFILE, SCREENS.REVIEW],
  [SCREENS.PROFILE]: [SCREENS.REVIEW],
  [SCREENS.REVIEW]: [SCREENS.PROFILE, SCREENS.GAME],
  [SCREENS.GAME]: [SCREENS.REVIEW],
});

// -----------------------------------------------------------------------------
//  State shape
// -----------------------------------------------------------------------------

/**
 * @typedef {import('@/utils/storage.js').Profile} Profile
 */

/**
 * @typedef {Object} AppState
 * @property {string} screen              One of SCREENS
 * @property {string | null} previousScreen
 * @property {Profile | null} profile     Null until the player saves one
 * @property {number} bestScore
 * @property {number} lastScore
 * @property {boolean} soundEnabled
 */

/** @returns {Readonly<AppState>} */
function createInitialState() {
  const settings = loadSettings();

  return Object.freeze({
    screen: SCREENS.LOADING,
    previousScreen: null,
    profile: loadProfile(),
    bestScore: loadBestScore(),
    lastScore: 0,
    soundEnabled: settings.soundEnabled,
  });
}

/** @type {Readonly<AppState>} */
let state = createInitialState();

/**
 * @callback StateListener
 * @param {Readonly<AppState>} nextState
 * @param {Readonly<AppState>} previousState
 * @returns {void}
 */

/** @type {Set<StateListener>} */
const listeners = new Set();

// -----------------------------------------------------------------------------
//  Core store functions
// -----------------------------------------------------------------------------

/**
 * Get the current state (read-only).
 * @returns {Readonly<AppState>}
 */
export function getState() {
  return state;
}

/**
 * Merge changes into state and notify listeners.
 * Internal: other modules should use the action functions below.
 *
 * @param {Partial<AppState>} changes
 */
function setState(changes) {
  const previous = state;
  const next = Object.freeze({ ...previous, ...changes });

  // Skip notifying if nothing actually changed.
  const changed = Object.keys(changes).some((key) => previous[key] !== next[key]);
  if (!changed) return;

  state = next;

  for (const listener of listeners) {
    try {
      listener(next, previous);
    } catch (error) {
      // One broken listener must not stop the others.
      console.error('[state] A state listener threw an error:', error);
    }
  }
}

/**
 * Run a function whenever state changes.
 *
 * @param {StateListener} listener
 * @param {{ immediate?: boolean }} [options] Set immediate to also run it once right away
 * @returns {() => void} Call this to unsubscribe
 */
export function subscribe(listener, { immediate = false } = {}) {
  listeners.add(listener);
  if (immediate) listener(state, state);
  return () => listeners.delete(listener);
}

/**
 * Run a function only when one specific part of state changes.
 * Example: watch((s) => s.screen, (screen) => console.log(screen))
 *
 * @template T
 * @param {(s: Readonly<AppState>) => T} selector Picks the value to watch
 * @param {(value: T, previousValue: T) => void} callback
 * @param {{ immediate?: boolean }} [options]
 * @returns {() => void} Call this to unsubscribe
 */
export function watch(selector, callback, { immediate = false } = {}) {
  if (immediate) callback(selector(state), selector(state));

  return subscribe((next, previous) => {
    const value = selector(next);
    const previousValue = selector(previous);
    if (value !== previousValue) callback(value, previousValue);
  });
}

// -----------------------------------------------------------------------------
//  Actions: the only ways the rest of the app changes state
// -----------------------------------------------------------------------------

/**
 * Move to another screen, if that move is allowed.
 * @param {string} screen One of SCREENS
 * @returns {boolean} true if the screen changed
 */
export function goToScreen(screen) {
  const current = state.screen;
  if (screen === current) return false;

  const allowed = ALLOWED_TRANSITIONS[current] ?? [];
  if (!allowed.includes(screen)) {
    console.warn(`[state] Blocked screen change: "${current}" → "${screen}".`);
    return false;
  }

  // The game needs a profile first.
  if (screen === SCREENS.GAME && !state.profile) {
    console.warn('[state] Cannot start the game without a profile.');
    return false;
  }

  setState({ screen, previousScreen: current });
  return true;
}

/**
 * After entering the realm: returning players with a saved profile go
 * straight to Review, new players go to Profile creation.
 * @returns {string} The screen that was opened
 */
export function enterRealm() {
  const destination = state.profile ? SCREENS.REVIEW : SCREENS.PROFILE;
  goToScreen(destination);
  return destination;
}

/**
 * Save the profile (sanitized) to storage and state.
 * @param {Record<string, unknown>} profileData
 * @returns {Profile} The cleaned profile
 */
export function updateProfile(profileData) {
  const profile = saveProfile(profileData);
  setState({ profile });
  return profile;
}

/**
 * Record a finished game's score.
 * @param {number} score
 * @returns {{ best: number, isNewBest: boolean }}
 */
export function recordScore(score) {
  const result = submitScore(score);
  setState({ lastScore: Math.max(0, Math.floor(score)), bestScore: result.best });
  return result;
}

/**
 * Turn sound on or off and remember the choice.
 * @param {boolean} enabled
 */
export function setSoundEnabled(enabled) {
  const { soundEnabled } = saveSettings({ soundEnabled: Boolean(enabled) });
  setState({ soundEnabled });
}

/** Flip sound on/off. */
export function toggleSound() {
  setSoundEnabled(!state.soundEnabled);
}