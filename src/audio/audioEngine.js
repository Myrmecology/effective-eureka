/**
 * Effective Eureka - audio engine
 *
 * Every sound in the app is synthesized in code with the Web Audio API.
 * There are no audio files.
 *
 * Signal chain:
 *
 *   voices ─┬─> sfxBus ───┐
 *           │             ├─> masterGain ─> limiter ─> speakers
 *           └─> reverbSend ─> reverb ─┘
 *   music  ───> musicBus ─┘
 *
 * Browsers block audio until the user interacts with the page, so call
 * unlockAudio() from inside a click or key handler (the Enter button does this).
 *
 * @module audio/audioEngine
 */

import { clamp } from '@/utils/math.js';

/** Overall loudness (0 to 1). */
const MASTER_VOLUME = 0.7;

/** Most sounds allowed at once. Protects the CPU during big particle bursts. */
const MAX_VOICES = 48;

/** Quietest value for exponential fades (Web Audio can't fade to exactly 0). */
const SILENCE = 0.0001;

/** @type {AudioContext | null} */
let ctx = null;

/** @type {GainNode | null} */ let masterGain = null;
/** @type {GainNode | null} */ let sfxBus = null;
/** @type {GainNode | null} */ let musicBus = null;
/** @type {GainNode | null} */ let reverbSend = null;
/** @type {DynamicsCompressorNode | null} */ let limiter = null;

/** @type {AudioBuffer | null} */
let noiseBuffer = null;

let muted = false;
let activeVoices = 0;

// -----------------------------------------------------------------------------
//  Setup
// -----------------------------------------------------------------------------

/** @returns {boolean} Whether this browser supports Web Audio */
export function isAudioSupported() {
  return typeof window !== 'undefined' && ('AudioContext' in window || 'webkitAudioContext' in window);
}

/**
 * Create the audio graph (once). Does not start sound by itself.
 * @returns {AudioContext | null}
 */
function ensureContext() {
  if (ctx) return ctx;
  if (!isAudioSupported()) return null;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  ctx = new AudioContextClass({ latencyHint: 'interactive' });

  // Limiter: catches loud peaks so stacked sounds never clip or hurt ears.
  limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 12;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.15;
  limiter.connect(ctx.destination);

  masterGain = ctx.createGain();
  masterGain.gain.value = muted ? 0 : MASTER_VOLUME;
  masterGain.connect(limiter);

  sfxBus = ctx.createGain();
  sfxBus.gain.value = 1;
  sfxBus.connect(masterGain);

  musicBus = ctx.createGain();
  musicBus.gain.value = 0.55;
  musicBus.connect(masterGain);

  // Reverb: gives sounds a big "magical realm" space.
  const reverb = ctx.createConvolver();
  reverb.buffer = createImpulseResponse(ctx, 2.4, 2.8);
  reverbSend = ctx.createGain();
  reverbSend.gain.value = 0.35;
  reverbSend.connect(reverb);
  reverb.connect(masterGain);

  noiseBuffer = createNoiseBuffer(ctx, 2);

  // Pause audio processing when the tab is hidden.
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      ctx.suspend().catch(() => {});
    } else if (!muted) {
      ctx.resume().catch(() => {});
    }
  });

  return ctx;
}

/**
 * Start audio. Must be called from a user gesture (click, tap, key press).
 * Safe to call many times.
 * @returns {Promise<boolean>} true if audio is running
 */
export async function unlockAudio() {
  const context = ensureContext();
  if (!context) return false;

  if (context.state !== 'running') {
    try {
      await context.resume();
    } catch (error) {
      console.warn('[audio] Could not start audio:', error);
      return false;
    }
  }
  return context.state === 'running';
}

/** @returns {boolean} True when sounds can actually play */
export function isAudioReady() {
  return ctx !== null && ctx.state === 'running' && !muted;
}

/**
 * The audio context, or null if audio hasn't started.
 * @returns {AudioContext | null}
 */
export function getAudioContext() {
  return ctx;
}

/** @returns {GainNode | null} Where music generators should connect */
export function getMusicBus() {
  return musicBus;
}

/** @returns {GainNode | null} Where sound effects connect */
export function getSfxBus() {
  return sfxBus;
}

/** @returns {GainNode | null} Send sound here (as well) to add reverb */
export function getReverbSend() {
  return reverbSend;
}

// -----------------------------------------------------------------------------
//  Mute
// -----------------------------------------------------------------------------

/**
 * Mute or unmute everything with a short fade (no clicks or pops).
 * @param {boolean} value
 */
export function setMuted(value) {
  muted = Boolean(value);
  if (!ctx || !masterGain) return;

  const now = ctx.currentTime;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(muted ? 0 : MASTER_VOLUME, now + 0.15);
}

/** @returns {boolean} */
export function isMuted() {
  return muted;
}

// -----------------------------------------------------------------------------
//  Generated buffers
// -----------------------------------------------------------------------------

/**
 * White noise: random samples. The base for pops, sparks, splats and whooshes.
 * @param {AudioContext} context
 * @param {number} seconds
 * @returns {AudioBuffer}
 */
function createNoiseBuffer(context, seconds) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/**
 * A synthetic reverb "room": stereo noise that fades out over time.
 * @param {AudioContext} context
 * @param {number} seconds Reverb length
 * @param {number} decay Higher = fades faster
 * @returns {AudioBuffer}
 */
function createImpulseResponse(context, seconds, decay) {
  const length = Math.floor(context.sampleRate * seconds);
  const buffer = context.createBuffer(2, length, context.sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

// -----------------------------------------------------------------------------
//  Voice management
// -----------------------------------------------------------------------------

/** @returns {boolean} True if there's room for another sound */
function acquireVoice() {
  if (activeVoices >= MAX_VOICES) return false;
  activeVoices += 1;
  return true;
}

function releaseVoice() {
  activeVoices = Math.max(0, activeVoices - 1);
}

/**
 * Connect a voice's output to the sfx bus, with optional reverb and stereo pan.
 * @param {AudioNode} node
 * @param {number} pan -1 (left) to 1 (right)
 * @param {number} reverb 0 to 1
 * @returns {AudioNode[]} Extra nodes to disconnect when the voice ends
 */
function routeOutput(node, pan, reverb) {
  if (!ctx || !sfxBus || !reverbSend) return [];
  const extra = [];

  let output = node;
  if (pan !== 0) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(pan, -1, 1);
    node.connect(panner);
    output = panner;
    extra.push(panner);
  }

  output.connect(sfxBus);

  if (reverb > 0) {
    const send = ctx.createGain();
    send.gain.value = clamp(reverb, 0, 1);
    output.connect(send);
    send.connect(reverbSend);
    extra.push(send);
  }

  return extra;
}

/**
 * Shape a gain node into an envelope: fade in over `attack`, then
 * fade out over `decay`.
 * @param {GainNode} gainNode
 * @param {number} start   Start time (context seconds)
 * @param {number} volume  Peak volume (0 to 1)
 * @param {number} attack  Seconds
 * @param {number} decay   Seconds
 * @returns {number} The time the sound is fully silent
 */
function applyEnvelope(gainNode, start, volume, attack, decay) {
  const peak = Math.max(volume, SILENCE * 2);
  const gain = gainNode.gain;
  gain.setValueAtTime(SILENCE, start);
  gain.exponentialRampToValueAtTime(peak, start + Math.max(attack, 0.001));
  gain.exponentialRampToValueAtTime(SILENCE, start + attack + Math.max(decay, 0.01));
  return start + attack + decay;
}

// -----------------------------------------------------------------------------
//  Public building blocks
// -----------------------------------------------------------------------------

/**
 * @typedef {Object} ToneOptions
 * @property {OscillatorType} [type='sine']  'sine' | 'square' | 'sawtooth' | 'triangle'
 * @property {number} [frequency=440]   Starting pitch in Hz
 * @property {number} [frequencyEnd]    Pitch to glide to (optional)
 * @property {number} [attack=0.005]    Fade-in, seconds
 * @property {number} [decay=0.25]      Fade-out, seconds
 * @property {number} [volume=0.3]      0 to 1
 * @property {number} [detune=0]        Cents (100 = one semitone)
 * @property {number} [pan=0]           -1 left to 1 right
 * @property {number} [delay=0]         Seconds before starting
 * @property {number} [reverb=0]        0 to 1
 * @property {{ type: BiquadFilterType, frequency: number, Q?: number }} [filter]
 * @property {{ rate: number, depth: number }} [vibrato] Wobble: rate Hz, depth Hz
 */

/**
 * Play a synthesized tone (an oscillator with an envelope).
 * @param {ToneOptions} [options]
 */
export function playTone({
  type = 'sine',
  frequency = 440,
  frequencyEnd,
  attack = 0.005,
  decay = 0.25,
  volume = 0.3,
  detune = 0,
  pan = 0,
  delay = 0,
  reverb = 0,
  filter,
  vibrato,
} = {}) {
  if (!isAudioReady() || !ctx || !acquireVoice()) return;

  const start = ctx.currentTime + Math.max(0, delay);
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  const nodes = [osc, amp];

  osc.type = type;
  osc.frequency.setValueAtTime(Math.max(1, frequency), start);
  osc.detune.value = detune;

  const end = applyEnvelope(amp, start, volume, attack, decay);

  if (frequencyEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, frequencyEnd), end);
  }

  // Optional vibrato (a slow oscillator wobbling the pitch).
  if (vibrato) {
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = vibrato.rate;
    lfoGain.gain.value = vibrato.depth;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(start);
    lfo.stop(end + 0.05);
    nodes.push(lfo, lfoGain);
  }

  // Optional filter to shape the tone.
  let last = /** @type {AudioNode} */ (osc);
  if (filter) {
    const biquad = ctx.createBiquadFilter();
    biquad.type = filter.type;
    biquad.frequency.value = filter.frequency;
    biquad.Q.value = filter.Q ?? 1;
    osc.connect(biquad);
    last = biquad;
    nodes.push(biquad);
  }

  last.connect(amp);
  nodes.push(...routeOutput(amp, pan, reverb));

  osc.start(start);
  osc.stop(end + 0.05);
  osc.onended = () => {
    nodes.forEach((node) => node.disconnect());
    releaseVoice();
  };
}

/**
 * @typedef {Object} NoiseOptions
 * @property {BiquadFilterType} [filterType='bandpass']
 * @property {number} [frequency=1000]    Filter frequency at start, Hz
 * @property {number} [frequencyEnd]      Filter frequency to sweep to
 * @property {number} [Q=1]               Filter sharpness
 * @property {number} [attack=0.002]
 * @property {number} [decay=0.15]
 * @property {number} [volume=0.3]
 * @property {number} [pan=0]
 * @property {number} [delay=0]
 * @property {number} [reverb=0]
 * @property {number} [playbackRate=1]    Speed up or slow down the noise
 */

/**
 * Play filtered noise. The base for pops, sparks, splats and whooshes.
 * @param {NoiseOptions} [options]
 */
export function playNoise({
  filterType = 'bandpass',
  frequency = 1000,
  frequencyEnd,
  Q = 1,
  attack = 0.002,
  decay = 0.15,
  volume = 0.3,
  pan = 0,
  delay = 0,
  reverb = 0,
  playbackRate = 1,
} = {}) {
  if (!isAudioReady() || !ctx || !noiseBuffer || !acquireVoice()) return;

  const start = ctx.currentTime + Math.max(0, delay);
  const source = ctx.createBufferSource();
  const biquad = ctx.createBiquadFilter();
  const amp = ctx.createGain();

  source.buffer = noiseBuffer;
  source.playbackRate.value = playbackRate;
  // Start at a random point in the noise so repeated sounds aren't identical.
  const offset = Math.random() * (noiseBuffer.duration - 0.5);

  biquad.type = filterType;
  biquad.frequency.setValueAtTime(Math.max(20, frequency), start);
  biquad.Q.value = Q;

  const end = applyEnvelope(amp, start, volume, attack, decay);

  if (frequencyEnd !== undefined) {
    biquad.frequency.exponentialRampToValueAtTime(Math.max(20, frequencyEnd), end);
  }

  source.connect(biquad).connect(amp);
  const extra = routeOutput(amp, pan, reverb);

  source.start(start, Math.max(0, offset));
  source.stop(end + 0.05);
  source.onended = () => {
    [source, biquad, amp, ...extra].forEach((node) => node.disconnect());
    releaseVoice();
  };
}

/**
 * Schedule a function to run in sync with the audio clock (for sequences).
 * Falls back to setTimeout timing.
 * @param {number} delaySeconds
 * @param {() => void} callback
 * @returns {number} Timer id (pass to clearTimeout to cancel)
 */
export function scheduleSound(delaySeconds, callback) {
  return window.setTimeout(callback, Math.max(0, delaySeconds) * 1000);
}