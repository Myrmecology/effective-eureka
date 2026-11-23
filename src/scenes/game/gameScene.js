/**
 * Effective Eureka - game scene
 *
 * The playable runner. Flow:
 *   intro   → the scientist walks in from the left edge
 *   playing → he runs, obstacles come at him, score climbs, speed rises
 *   dead    → he EXPLODES; after a moment onGameOver() fires
 *   (paused can interrupt "intro" or "playing")
 *
 * The scene talks to the HTML HUD only through callbacks (main.js owns the DOM).
 *
 * @module scenes/game/gameScene
 */

import { Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import {
  explosion as explosionSound,
  gameStart,
  jump as jumpSound,
  land as landSound,
  milestone,
  scorePoint,
  setGameMusicTempo,
  startGameMusic,
  stopGameMusic,
} from '@/audio/sfx.js';
import { createExplosion } from '@/scenes/game/explosion.js';
import { createGameInput } from '@/scenes/game/input.js';
import { createObstacles } from '@/scenes/game/obstacles.js';
import { createPsychedelicFx } from '@/scenes/game/psychedelicFx.js';
import { createScientist } from '@/scenes/game/scientist.js';
import { clamp, damp, easeInOutSine, randRange } from '@/utils/math.js';

// -----------------------------------------------------------------------------
//  Tuning
// -----------------------------------------------------------------------------

const CAMERA_POSITION = new Vector3(0, 2.4, -13);
const CAMERA_TARGET = new Vector3(0, 1.9, 0);
const CAMERA_FOV = 0.8;

const START_SPEED = 8; // world units per second
const MAX_SPEED = 17;
const ACCELERATION = 0.12; // speed gained per second of play
const MILESTONE_EVERY = 10; // points
const MILESTONE_SPEED_BOOST = 0.4;
const INTRO_SECONDS = 1.6;
const GAME_OVER_DELAY_MS = 1800; // long enough to enjoy the explosion

const BASE_BPM = 124;

/**
 * Camera tilt (visual only; it never affects gameplay).
 * TILT_MAX is the biggest lean in radians: 0.52 is about 30 degrees.
 * The background and floor in psychedelicFx.js stay covered up to about 35 degrees.
 */
const TILT_MAX = 0.52;
const TILT_MIN_SHARE = 0.6; // share of the max tilt from the very start of a run
const TILT_RESPONSE = 3; // how quickly the camera follows the sway (higher = snappier)

/** Where the explosion starts, relative to the scientist's feet. */
const EXPLOSION_OFFSET = new Vector3(0, 0.95, 0);

/**
 * @typedef {'intro' | 'playing' | 'paused' | 'dead'} GamePhase
 */

/**
 * @typedef {Object} GameSceneOptions
 * @property {string} [playerColor]
 * @property {(score: number) => void} [onScoreChange]
 * @property {(score: number) => void} [onGameOver]
 * @property {(paused: boolean) => void} [onPauseChange]
 * @property {() => void} [onFirstInput]
 */

/**
 * Scene factory for sceneManager.
 * @param {{
 *   engine: import('@babylonjs/core').Engine,
 *   canvas: HTMLCanvasElement,
 *   options: GameSceneOptions
 * }} context
 */
export function createGameScene({ engine, options }) {
  const {
    playerColor = '#33d17a',
    onScoreChange = () => {},
    onGameOver = () => {},
    onPauseChange = () => {},
    onFirstInput = () => {},
  } = options;

  const scene = new Scene(engine);

  // ---------------------------------------------------------------------------
  //  Camera (side view)
  // ---------------------------------------------------------------------------
  const camera = new UniversalCamera('game-camera', CAMERA_POSITION.clone(), scene);
  camera.fov = CAMERA_FOV;
  camera.minZ = 0.1;
  camera.maxZ = 200;
  camera.setTarget(CAMERA_TARGET);
  camera.inputs.clear();

  // Visible half-size at the play plane (z = 0).
  const distance = -CAMERA_POSITION.z;
  const viewHalfHeight = distance * Math.tan(CAMERA_FOV / 2);
  const aspect = engine.getRenderWidth() / Math.max(1, engine.getRenderHeight());
  const viewHalfWidth = viewHalfHeight * aspect;

  // The scientist stands left of center so you can see what's coming.
  const playerX = -viewHalfWidth * 0.45;
  const introStartX = -viewHalfWidth - 1;

  // ---------------------------------------------------------------------------
  //  World
  // ---------------------------------------------------------------------------
  const fx = createPsychedelicFx(scene, camera, { playerColor, viewHalfWidth, viewHalfHeight });
  const scientist = createScientist(scene, { playerColor });
  const obstacles = createObstacles(scene, {
    spawnX: viewHalfWidth * 1.4,
    despawnX: -viewHalfWidth * 1.5,
  });
  const explosion = createExplosion(scene, camera, {
    playerColor,
    floorY: 0,
    floorFrontZ: -1,
    panRange: viewHalfWidth,
  });

  // ---------------------------------------------------------------------------
  //  State
  // ---------------------------------------------------------------------------
  /** @type {GamePhase} */
  let phase = 'intro';
  /** @type {GamePhase} */
  let phaseBeforePause = 'intro';
  let introTime = 0;
  let speed = START_SPEED;
  let score = 0;
  let nextMilestone = MILESTONE_EVERY;
  let gameOverTimer = 0;
  let time = 0;
  let tilt = 0;
  const shake = { time: 0, duration: 0, strength: 0 };

  // ---------------------------------------------------------------------------
  //  Input
  // ---------------------------------------------------------------------------
  const input = createGameInput({
    onPause: () => togglePause(),
    onFirstInput,
  });

  // ---------------------------------------------------------------------------
  //  Flow control
  // ---------------------------------------------------------------------------

  /** Start (or restart) a run from the walk-in intro. */
  function beginIntro() {
    phase = 'intro';
    introTime = 0;
    speed = START_SPEED;
    score = 0;
    nextMilestone = MILESTONE_EVERY;
    gameOverTimer = 0;

    explosion.clear();
    obstacles.reset();
    scientist.root.setEnabled(true); // put him back together
    scientist.reset(introStartX, 'walk');
    scientist.setSpeedFactor(1);
    fx.setIntensity(0);
    fx.setTempo(BASE_BPM);
    input.clear();
    onScoreChange(0);
  }

  /** The intro is done: run! */
  function beginPlaying() {
    phase = 'playing';
    scientist.setGait('run');
    gameStart();
    fx.resetBeat();
    fx.flash('#3df5ff', 0.5);
    setGameMusicTempo(BASE_BPM);
    startGameMusic(BASE_BPM);
  }

  /** Hit! The scientist explodes. */
  function endRun() {
    phase = 'dead';

    const blastPosition = scientist.root.position.add(EXPLOSION_OFFSET);
    scientist.die();
    scientist.root.setEnabled(false); // he's gone: only the explosion remains

    explosion.explode(blastPosition);
    explosionSound();
    stopGameMusic();

    fx.flash('#ff2a2a', 1);
    shakeCamera(0.7, 0.9);

    gameOverTimer = window.setTimeout(() => onGameOver(score), GAME_OVER_DELAY_MS);
  }

  /** Pause or resume (only during intro or play). */
  function togglePause() {
    if (phase === 'paused') {
      phase = phaseBeforePause;
      input.clear();
      if (phase === 'playing') startGameMusic(tempoForSpeed());
      onPauseChange(false);
    } else if (phase === 'playing' || phase === 'intro') {
      phaseBeforePause = phase;
      phase = 'paused';
      stopGameMusic();
      onPauseChange(true);
    }
  }

  /** Public: start a new run after game over. */
  function restart() {
    window.clearTimeout(gameOverTimer);
    stopGameMusic();
    beginIntro();
  }

  // ---------------------------------------------------------------------------
  //  Per-frame update
  // ---------------------------------------------------------------------------

  /**
   * @param {number} dt
   */
  function update(dt) {
    time += dt;

    switch (phase) {
      case 'intro':
        updateIntro(dt);
        break;
      case 'playing':
        updatePlaying(dt);
        break;
      case 'dead':
        scientist.update(dt);
        explosion.update(dt);
        fx.update(dt, 0);
        break;
      case 'paused':
      default:
        break; // frozen: nothing moves
    }

    updateCamera(dt);
  }

  /** @param {number} dt */
  function updateIntro(dt) {
    introTime += dt;
    const t = clamp(introTime / INTRO_SECONDS, 0, 1);

    // Walk in, then break into a run for the last stretch.
    scientist.root.position.x = introStartX + (playerX - introStartX) * easeInOutSine(t);
    if (t > 0.7) scientist.setGait('run');
    scientist.update(dt, { groundY: 0 });

    fx.update(dt, START_SPEED * 0.15);
    input.clear(); // no jumping during the walk-in

    if (t >= 1) beginPlaying();
  }

  /** @param {number} dt */
  function updatePlaying(dt) {
    // Speed up gradually.
    speed = Math.min(MAX_SPEED, speed + ACCELERATION * dt);
    const speedFactor = speed / START_SPEED;
    scientist.setSpeedFactor(speedFactor);

    // Jump (buffered input).
    if (scientist.canJump() && input.consumeJump()) {
      scientist.jump();
      jumpSound();
    }

    // Physics: find what's under him, then move him.
    const feetY = scientist.root.position.y;
    const support = obstacles.getSupportHeight(scientist.getHitbox(), feetY);
    const events = scientist.update(dt, { jumpHeld: input.isJumpHeld(), groundY: support });
    if (events.landed) landSound();

    // Obstacles move and score.
    const { passed } = obstacles.update(dt, speed, playerX);
    if (passed > 0) addScore(passed);

    // Visuals.
    obstacles.setPulse(fx.getPulse());
    fx.update(dt, speed);

    // Collision.
    if (obstacles.hitsPlayer(scientist.getHitbox(), scientist.root.position.y)) {
      endRun();
    }
  }

  /** @param {number} points */
  function addScore(points) {
    score += points;
    scorePoint();
    onScoreChange(score);

    // Difficulty and trippiness rise with score.
    obstacles.setDifficulty(Math.floor(score / 6));
    fx.setIntensity(score / 50);

    if (score >= nextMilestone) {
      nextMilestone += MILESTONE_EVERY;
      speed = Math.min(MAX_SPEED, speed + MILESTONE_SPEED_BOOST);
      milestone();
      fx.flash('#c6ff3d', 0.7);
      shakeCamera(0.08, 0.3);
    }

    const tempo = tempoForSpeed();
    setGameMusicTempo(tempo);
    fx.setTempo(tempo);
  }

  /** Music speeds up with the game. */
  function tempoForSpeed() {
    return BASE_BPM + (speed - START_SPEED) * 6;
  }

  // ---------------------------------------------------------------------------
  //  Camera
  // ---------------------------------------------------------------------------

  /**
   * @param {number} strength
   * @param {number} duration
   */
  function shakeCamera(strength, duration) {
    if (fx.safeMode) return;
    shake.strength = strength;
    shake.duration = duration;
    shake.time = duration;
  }

  /**
   * The woozy tilt: three waves at different speeds mixed together, so the
   * view lurches and leans unpredictably instead of rocking evenly.
   * The weights add up to 1, so the lean never goes past TILT_MAX.
   * @returns {number} Target tilt in radians
   */
  function targetTilt() {
    if (fx.safeMode || phase !== 'playing') return 0;
    const progress = clamp((speed - START_SPEED) / (MAX_SPEED - START_SPEED), 0, 1);
    const amount = TILT_MAX * (TILT_MIN_SHARE + (1 - TILT_MIN_SHARE) * progress);
    const wave =
      Math.sin(time * 0.42) * 0.6 +
      Math.sin(time * 0.97 + 1.3) * 0.3 +
      Math.sin(time * 2.1 + 0.7) * 0.1;
    return amount * wave;
  }

  /** @param {number} dt */
  function updateCamera(dt) {
    let offsetX = 0;
    let offsetY = 0;

    if (shake.time > 0 && phase !== 'paused') {
      shake.time = Math.max(0, shake.time - dt);
      const strength = shake.strength * (shake.time / shake.duration);
      offsetX = randRange(-strength, strength);
      offsetY = randRange(-strength, strength);
    }

    camera.position.set(CAMERA_POSITION.x + offsetX, CAMERA_POSITION.y + offsetY, CAMERA_POSITION.z);
    camera.setTarget(CAMERA_TARGET.add(new Vector3(offsetX * 0.5, offsetY * 0.5, 0)));

    // Tilt eases smoothly toward its target (and back to level on crash or pause).
    if (phase !== 'paused') {
      tilt = damp(tilt, targetTilt(), phase === 'playing' ? TILT_RESPONSE : 1.5, dt);
    }
    camera.rotation.z = tilt;

    // Slight zoom pulse on the beat while playing.
    camera.fov = !fx.safeMode && phase === 'playing' ? CAMERA_FOV - fx.getPulse() * 0.015 : CAMERA_FOV;
  }

  // ---------------------------------------------------------------------------
  //  Cleanup
  // ---------------------------------------------------------------------------
  function dispose() {
    window.clearTimeout(gameOverTimer);
    stopGameMusic();
    input.destroy();
    explosion.dispose();
    scientist.dispose();
    obstacles.dispose();
    fx.dispose();
    // The scene itself is disposed by sceneManager.
  }

  beginIntro();

  return {
    scene,
    update,
    dispose,
    restart,
    togglePause,
    get score() {
      return score;
    },
    get phase() {
      return phase;
    },
  };
}