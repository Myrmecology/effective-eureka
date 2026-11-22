/**
 * Effective Eureka - game scene
 *
 * The playable runner. Flow:
 *   intro   → the scientist walks in from the left edge
 *   playing → he runs, obstacles come at him, score climbs, speed rises
 *   dead    → he tumbles away; after a moment onGameOver() fires
 *   (paused can interrupt "playing")
 *
 * The scene talks to the HTML HUD only through callbacks (main.js owns the DOM).
 *
 * @module scenes/game/gameScene
 */

import { Scene, UniversalCamera, Vector3 } from '@babylonjs/core';
import {
  crash,
  gameStart,
  jump as jumpSound,
  land as landSound,
  milestone,
  scorePoint,
  setGameMusicTempo,
  startGameMusic,
  stopGameMusic,
} from '@/audio/sfx.js';
import { createGameInput } from '@/scenes/game/input.js';
import { createObstacles } from '@/scenes/game/obstacles.js';
import { createPsychedelicFx } from '@/scenes/game/psychedelicFx.js';
import { createScientist } from '@/scenes/game/scientist.js';
import { clamp, easeInOutSine, randRange } from '@/utils/math.js';

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
const GAME_OVER_DELAY_MS = 1100;

const BASE_BPM = 124;

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

    obstacles.reset();
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

  /** Crash! */
  function endRun() {
    phase = 'dead';
    scientist.die();
    crash();
    stopGameMusic();
    fx.flash('#ff3dd8', 1);
    shakeCamera(0.35, 0.6);
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

    // Psychedelic touches: a slow tilt and a slight zoom pulse on the beat.
    if (!fx.safeMode && phase === 'playing') {
      camera.rotation.z = Math.sin(time * 0.4) * 0.03 * (speed / MAX_SPEED);
      camera.fov = CAMERA_FOV - fx.getPulse() * 0.015;
    } else {
      camera.rotation.z = 0;
      camera.fov = CAMERA_FOV;
    }
  }

  // ---------------------------------------------------------------------------
  //  Cleanup
  // ---------------------------------------------------------------------------
  function dispose() {
    window.clearTimeout(gameOverTimer);
    stopGameMusic();
    input.destroy();
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