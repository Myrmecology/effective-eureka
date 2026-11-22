/**
 * Effective Eureka - math utilities
 *
 * Small, pure helper functions used across the 3D scenes and the game.
 * Nothing here depends on Babylon.js, so these are easy to test and reuse.
 *
 * @module utils/math
 */

/** One full turn in radians (2π). */
export const TAU = Math.PI * 2;

// -----------------------------------------------------------------------------
//  Basic number helpers
// -----------------------------------------------------------------------------

/**
 * Keep a number inside a range.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamp a number between 0 and 1.
 * @param {number} value
 * @returns {number}
 */
export function saturate(value) {
  return clamp(value, 0, 1);
}

/**
 * Linear interpolation: blend from `a` to `b` by `t` (0 = a, 1 = b).
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * The opposite of lerp: where `value` sits between `a` and `b`, from 0 to 1.
 * @param {number} a
 * @param {number} b
 * @param {number} value
 * @returns {number}
 */
export function inverseLerp(a, b, value) {
  if (a === b) return 0;
  return (value - a) / (b - a);
}

/**
 * Map a value from one range to another.
 * Example: remap(5, 0, 10, 100, 200) === 150
 * @param {number} value
 * @param {number} inMin
 * @param {number} inMax
 * @param {number} outMin
 * @param {number} outMax
 * @param {boolean} [clampResult=false] Keep the result inside the output range
 * @returns {number}
 */
export function remap(value, inMin, inMax, outMin, outMax, clampResult = false) {
  const t = inverseLerp(inMin, inMax, value);
  return lerp(outMin, outMax, clampResult ? saturate(t) : t);
}

/**
 * Smooth S-curve from 0 to 1 as `x` moves from `edge0` to `edge1`.
 * @param {number} edge0
 * @param {number} edge1
 * @param {number} x
 * @returns {number}
 */
export function smoothstep(edge0, edge1, x) {
  const t = saturate(inverseLerp(edge0, edge1, x));
  return t * t * (3 - 2 * t);
}

/**
 * Convert degrees to radians.
 * @param {number} degrees
 * @returns {number}
 */
export function degToRad(degrees) {
  return (degrees * Math.PI) / 180;
}

/**
 * Check whether two numbers are nearly equal.
 * @param {number} a
 * @param {number} b
 * @param {number} [epsilon=1e-6]
 * @returns {boolean}
 */
export function approxEqual(a, b, epsilon = 1e-6) {
  return Math.abs(a - b) <= epsilon;
}

/**
 * Frame-rate independent smoothing: move `current` toward `target`.
 * Feels the same at 30 fps or 144 fps.
 *
 * @param {number} current
 * @param {number} target
 * @param {number} smoothing Higher = snappier (try 4 to 12)
 * @param {number} deltaSeconds Time since the last frame, in seconds
 * @returns {number}
 */
export function damp(current, target, smoothing, deltaSeconds) {
  return lerp(current, target, 1 - Math.exp(-smoothing * deltaSeconds));
}

// -----------------------------------------------------------------------------
//  Randomness
// -----------------------------------------------------------------------------

/**
 * Random decimal number in [min, max).
 * @param {number} min
 * @param {number} max
 * @param {() => number} [rng=Math.random]
 * @returns {number}
 */
export function randRange(min, max, rng = Math.random) {
  return min + (max - min) * rng();
}

/**
 * Random whole number in [min, max] (both ends included).
 * @param {number} min
 * @param {number} max
 * @param {() => number} [rng=Math.random]
 * @returns {number}
 */
export function randInt(min, max, rng = Math.random) {
  return Math.floor(randRange(min, max + 1, rng));
}

/**
 * Pick a random item from an array.
 * @template T
 * @param {readonly T[]} items
 * @param {() => number} [rng=Math.random]
 * @returns {T}
 */
export function randPick(items, rng = Math.random) {
  if (items.length === 0) {
    throw new RangeError('randPick: cannot pick from an empty array.');
  }
  return items[Math.floor(rng() * items.length)];
}

/**
 * Random -1 or +1.
 * @param {() => number} [rng=Math.random]
 * @returns {-1 | 1}
 */
export function randSign(rng = Math.random) {
  return rng() < 0.5 ? -1 : 1;
}

/**
 * Seeded random number generator (Mulberry32).
 * The same seed always produces the same sequence. That's useful for
 * repeatable obstacle patterns and testing.
 *
 * @param {number} seed Any whole number
 * @returns {() => number} A function returning numbers in [0, 1)
 */
export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -----------------------------------------------------------------------------
//  Easing curves
//  Each takes t from 0 to 1 and returns an eased value (usually 0 to 1).
// -----------------------------------------------------------------------------

/** @param {number} t */
export function easeInQuad(t) {
  return t * t;
}

/** @param {number} t */
export function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

/** @param {number} t */
export function easeInCubic(t) {
  return t * t * t;
}

/** @param {number} t */
export function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

/** @param {number} t */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** @param {number} t */
export function easeInOutSine(t) {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

/**
 * Overshoots slightly past 1, then settles. Good for "pop" effects.
 * @param {number} t
 */
export function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/**
 * Springy wobble that settles at 1. Good for slime and bouncy UI.
 * @param {number} t
 */
export function easeOutElastic(t) {
  if (t === 0 || t === 1) return t;
  const c4 = TAU / 3;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
}

// -----------------------------------------------------------------------------
//  Waves and cycles
// -----------------------------------------------------------------------------

/**
 * Smooth wave between 0 and 1. Used for "breathing" animations.
 * @param {number} timeSeconds
 * @param {number} [periodSeconds=4] How long one full breath takes
 * @param {number} [phase=0] Offset in radians
 * @returns {number}
 */
export function breathe(timeSeconds, periodSeconds = 4, phase = 0) {
  return 0.5 + 0.5 * Math.sin((timeSeconds / periodSeconds) * TAU + phase);
}

/**
 * Wrap a value into [min, max). Handy for looping hues and positions.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function wrap(value, min, max) {
  const range = max - min;
  if (range === 0) return min;
  return ((((value - min) % range) + range) % range) + min;
}