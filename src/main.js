/**
 * Effective Eureka - application entry point
 *
 * Boots the engine, registers scenes, wires every UI module to the state
 * store, and reacts to screen changes (switching 3D scenes and music).
 *
 * Flow:
 *   loading → home ──Enter──▶ profile ──Save──▶ review ──Slime──▶ game
 *                               ▲                 │   ▲              │
 *                               └────Edit─────────┘   └─Back/Exit────┘
 *
 * @module main
 */

import '@/styles/main.css';
import '@/styles/ui.css';

import { isMuted, setMuted } from '@/audio/audioEngine.js';
import {
  gameOver as gameOverSound,
  newBest as newBestSound,
  startRealmAmbience,
  stopGameMusic,
  stopRealmAmbience,
  uiClick,
  uiHover,
} from '@/audio/sfx.js';
import { createEngine, showFatalError, startRenderLoop } from '@/core/engine.js';
import {
  getActiveController,
  getActiveSceneKey,
  registerScene,
  renderActiveScene,
  switchScene,
} from '@/core/sceneManager.js';
import {
  SCREENS,
  enterRealm,
  getState,
  goToScreen,
  recordScore,
  toggleSound,
  watch,
} from '@/core/state.js';
import { createGameScene } from '@/scenes/game/gameScene.js';
import { createHomeScene } from '@/scenes/home/homeScene.js';
import { initEnterButton } from '@/ui/enterButton.js';
import { initProfileForm } from '@/ui/profileForm.js';
import { initProfileReview } from '@/ui/profileReview.js';
import { initSlimeButton } from '@/ui/slimeButton.js';
import { DEFAULT_COLOR } from '@/utils/storage.js';

// -----------------------------------------------------------------------------
//  DOM references
// -----------------------------------------------------------------------------

/**
 * Get a required element, failing loudly if index.html is missing it.
 * @template {HTMLElement} T
 * @param {string} id
 * @returns {T}
 */
function $(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id} in index.html.`);
  return /** @type {T} */ (element);
}

const dom = {
  canvas: /** @type {HTMLCanvasElement} */ ($('render-canvas')),
  loading: $('loading-screen'),
  soundToggle: /** @type {HTMLButtonElement} */ ($('sound-toggle')),
  screens: {
    [SCREENS.HOME]: $('screen-home'),
    [SCREENS.PROFILE]: $('screen-profile'),
    [SCREENS.REVIEW]: $('screen-review'),
    [SCREENS.GAME]: $('screen-game'),
  },
  hudScore: $('hud-score'),
  hudBest: $('hud-best'),
  gameHint: $('game-hint'),
  gameOver: $('game-over'),
  gameOverTitle: $('game-over-title'),
  gameOverScore: $('game-over-score'),
  retryButton: /** @type {HTMLButtonElement} */ ($('retry-btn')),
  backButton: /** @type {HTMLButtonElement} */ ($('back-to-profile-btn')),
};

const HINT_DEFAULT = 'Press Space, click, or tap to jump';
const HINT_PAUSED = 'Paused. Press Esc or P to resume.';
const SCREEN_FADE_MS = 320;

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// -----------------------------------------------------------------------------
//  Screen visibility
// -----------------------------------------------------------------------------

/**
 * Show one screen and fade out the previous one.
 * @param {string} next
 * @param {string | null} previous
 */
function showScreen(next, previous) {
  const nextElement = dom.screens[next];
  const previousElement = previous ? dom.screens[previous] : null;

  if (previousElement && previousElement !== nextElement) {
    if (prefersReducedMotion()) {
      previousElement.hidden = true;
    } else {
      previousElement.classList.add('is-leaving');
      window.setTimeout(() => {
        previousElement.hidden = true;
        previousElement.classList.remove('is-leaving');
      }, SCREEN_FADE_MS);
    }
  }

  if (nextElement) {
    nextElement.classList.remove('is-leaving');
    nextElement.hidden = false;
  }
}

// -----------------------------------------------------------------------------
//  Sound toggle
// -----------------------------------------------------------------------------

/** @param {boolean} enabled */
function renderSoundToggle(enabled) {
  dom.soundToggle.setAttribute('aria-pressed', String(enabled));
  dom.soundToggle.setAttribute('aria-label', enabled ? 'Sound on. Click to mute.' : 'Sound off. Click to unmute.');
  const icon = dom.soundToggle.querySelector('.sound-toggle__icon');
  if (icon) icon.textContent = enabled ? '🔊' : '🔇';
}

// -----------------------------------------------------------------------------
//  Game HUD and game-over panel
// -----------------------------------------------------------------------------

function resetGameHud() {
  dom.hudScore.textContent = '0';
  dom.hudBest.textContent = String(getState().bestScore);
  dom.gameHint.textContent = HINT_DEFAULT;
  dom.gameHint.classList.remove('is-hidden');
  dom.gameOver.hidden = true;
}

/** @param {number} score */
function handleGameOver(score) {
  const { isNewBest, best } = recordScore(score);

  dom.gameOverScore.textContent = String(score);
  dom.gameOverTitle.textContent = isNewBest && score > 0 ? 'New Best Score!' : 'Experiment Failed!';
  dom.hudBest.textContent = String(best);
  dom.gameOver.hidden = false;

  if (isNewBest && score > 0) {
    newBestSound();
  } else {
    gameOverSound();
  }

  dom.retryButton.focus({ preventScroll: true });
}

/** @type {import('@/scenes/game/gameScene.js').GameSceneOptions} */
const gameCallbacks = {
  onScoreChange: (score) => {
    dom.hudScore.textContent = String(score);
  },
  onGameOver: handleGameOver,
  onPauseChange: (paused) => {
    dom.gameHint.textContent = paused ? HINT_PAUSED : HINT_DEFAULT;
    dom.gameHint.classList.toggle('is-hidden', !paused);
  },
  onFirstInput: () => {
    dom.gameHint.classList.add('is-hidden');
  },
};

function handleRetry() {
  uiClick();
  dom.gameOver.hidden = true;
  dom.gameHint.textContent = HINT_DEFAULT;
  dom.gameHint.classList.remove('is-hidden');
  dom.hudScore.textContent = '0';

  // Move focus off the button so Space jumps instead of clicking "Try Again".
  /** @type {HTMLElement} */ (document.activeElement)?.blur?.();

  const controller = getActiveController();
  if (controller && 'restart' in controller) controller.restart();
}

function handleBackToProfile() {
  uiClick();
  dom.gameOver.hidden = true;
  goToScreen(SCREENS.REVIEW);
}

// -----------------------------------------------------------------------------
//  Bootstrap
// -----------------------------------------------------------------------------

async function bootstrap() {
  // 1. Engine
  const engine = createEngine(dom.canvas);

  // 2. Scenes
  registerScene('home', createHomeScene);
  registerScene('game', createGameScene);

  // 3. UI modules
  initEnterButton({
    onActivate: async (center) => {
      startRealmAmbience();
      const home = getActiveController();
      if (home && 'playEnterSequence' in home) {
        await home.playEnterSequence(center);
      }
      enterRealm(); // goes to Profile (new player) or Review (returning)
    },
  });

  const profileForm = initProfileForm({
    onSaved: () => goToScreen(SCREENS.REVIEW),
  });

  const profileReview = initProfileReview({
    onEdit: () => goToScreen(SCREENS.PROFILE),
  });

  const slimeButton = initSlimeButton({
    onActivate: () => goToScreen(SCREENS.GAME),
  });

  dom.soundToggle.addEventListener('click', () => {
    toggleSound();
    if (!isMuted()) uiClick();
  });
  dom.retryButton.addEventListener('click', handleRetry);
  dom.backButton.addEventListener('click', handleBackToProfile);
  [dom.retryButton, dom.backButton].forEach((button) => button.addEventListener('pointerenter', uiHover));

  // 4. React to state changes

  // Sound on/off
  watch(
    (s) => s.soundEnabled,
    (enabled) => {
      setMuted(!enabled);
      renderSoundToggle(enabled);
    },
    { immediate: true },
  );

  // Favorite color tints the UI
  watch(
    (s) => s.profile?.favoriteColor ?? DEFAULT_COLOR,
    (color) => document.documentElement.style.setProperty('--player-color', color),
    { immediate: true },
  );

  // Best score in the HUD
  watch(
    (s) => s.bestScore,
    (best) => {
      dom.hudBest.textContent = String(best);
    },
    { immediate: true },
  );

  // Screen changes: visibility, 3D scene and music
  watch(
    (s) => s.screen,
    (screen, previous) => {
      showScreen(screen, previous);
      handleScreenEnter(screen).catch((error) => {
        console.error(`[main] Failed to open screen "${screen}":`, error);
      });
    },
  );

  /**
   * Everything that happens when a screen opens.
   * @param {string} screen
   */
  async function handleScreenEnter(screen) {
    const { profile } = getState();

    switch (screen) {
      case SCREENS.PROFILE: {
        slimeButton.hide();
        profileForm.prepare(profile);
        profileForm.focusFirstField();
        break;
      }

      case SCREENS.REVIEW: {
        if (!profile) return;

        // Coming back from the game: return to the realm, scroll already open.
        if (getActiveSceneKey() !== 'home') {
          stopGameMusic();
          await switchScene('home', { options: { startRolled: true } });
        }
        startRealmAmbience();

        profileReview.render(profile);
        profileReview.focusHeading();
        slimeButton.show();
        break;
      }

      case SCREENS.GAME: {
        slimeButton.hide();
        stopRealmAmbience();
        resetGameHud();
        await switchScene('game', {
          options: { playerColor: profile?.favoriteColor ?? DEFAULT_COLOR, ...gameCallbacks },
        });
        break;
      }

      default:
        break;
    }
  }

  // 5. First scene, render loop, then reveal the page
  await switchScene('home', { fade: false, options: { startRolled: false } });
  startRenderLoop(renderActiveScene);

  dom.loading.classList.add('is-done');
  goToScreen(SCREENS.HOME);

  // Keep the render size correct after fonts and layout settle.
  requestAnimationFrame(() => engine.resize());
}

// -----------------------------------------------------------------------------
//  Start
// -----------------------------------------------------------------------------

window.addEventListener('unhandledrejection', (event) => {
  console.error('[main] Unhandled promise rejection:', event.reason);
});

bootstrap().catch((error) => {
  console.error('[main] Failed to start Effective Eureka:', error);
  const message =
    error instanceof Error && /WebGL/i.test(error.message)
      ? 'Your browser or device does not support WebGL, which Effective Eureka needs for 3D graphics. Try an up-to-date Chrome, Edge or Firefox.'
      : 'Something went wrong while growing the vines. Please refresh the page.';
  showFatalError(message);
});