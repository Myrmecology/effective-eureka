/**
 * Effective Eureka - sound effects and generated music
 *
 * Every sound here is designed in code using the building blocks from
 * audioEngine.js. To tweak a sound, change its numbers: frequency (pitch),
 * decay (length), volume, and so on.
 *
 * @module audio/sfx
 */

import {
  getAudioContext,
  getMusicBus,
  isAudioReady,
  playNoise,
  playTone,
} from '@/audio/audioEngine.js';
import { randPick, randRange } from '@/utils/math.js';

// -----------------------------------------------------------------------------
//  Rate limiting: stops the same sound stacking up into noise
// -----------------------------------------------------------------------------

/** @type {Map<string, number>} */
const lastPlayed = new Map();

/**
 * @param {string} name
 * @param {number} minGapMs
 * @returns {boolean} true if the sound may play now
 */
function throttle(name, minGapMs) {
  const now = performance.now();
  const last = lastPlayed.get(name) ?? 0;
  if (now - last < minGapMs) return false;
  lastPlayed.set(name, now);
  return true;
}

// -----------------------------------------------------------------------------
//  UI sounds
// -----------------------------------------------------------------------------

/** Soft leafy tick when hovering a button. */
export function uiHover() {
  if (!throttle('uiHover', 60)) return;
  playTone({ type: 'sine', frequency: 1400, frequencyEnd: 1800, decay: 0.05, volume: 0.06 });
}

/** Crisp click for ordinary buttons. */
export function uiClick() {
  playTone({ type: 'triangle', frequency: 900, frequencyEnd: 500, decay: 0.08, volume: 0.15 });
  playNoise({ filterType: 'highpass', frequency: 3000, decay: 0.03, volume: 0.08 });
}

/** Low "nope" buzz when the form has errors. */
export function formError() {
  playTone({ type: 'square', frequency: 180, decay: 0.12, volume: 0.1, filter: { type: 'lowpass', frequency: 900 } });
  playTone({ type: 'square', frequency: 150, decay: 0.16, volume: 0.1, delay: 0.12, filter: { type: 'lowpass', frequency: 900 } });
}

/** Rising magical chime when the profile is saved. */
export function profileSaved() {
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((frequency, i) => {
    playTone({ type: 'sine', frequency, decay: 0.6, volume: 0.16, delay: i * 0.08, reverb: 0.6 });
    playTone({ type: 'triangle', frequency: frequency * 2, decay: 0.3, volume: 0.05, delay: i * 0.08, reverb: 0.6 });
  });
}

// -----------------------------------------------------------------------------
//  "Enter the Realm" burst
// -----------------------------------------------------------------------------

/** The big moment: a deep thump, a bright crack and a shimmering tail. */
export function enterBurst() {
  // Deep body thump
  playTone({ type: 'sine', frequency: 140, frequencyEnd: 40, attack: 0.003, decay: 0.6, volume: 0.6 });
  // Bright crack
  playNoise({ filterType: 'highpass', frequency: 1800, decay: 0.18, volume: 0.45, reverb: 0.4 });
  // Mid "pomf" of air
  playNoise({ filterType: 'lowpass', frequency: 1200, frequencyEnd: 200, decay: 0.45, volume: 0.35 });
  // Shimmering magic tail
  for (let i = 0; i < 10; i += 1) {
    playTone({
      type: 'sine',
      frequency: randRange(1800, 4200),
      decay: randRange(0.3, 0.8),
      volume: 0.05,
      delay: 0.05 + i * 0.04,
      pan: randRange(-0.9, 0.9),
      reverb: 0.8,
    });
  }
}

/**
 * One little popping particle. Bigger particles sound lower.
 * @param {{ pan?: number, size?: number }} [options] size 0 (tiny) to 1 (big)
 */
export function particlePop({ pan = 0, size = 0.5 } = {}) {
  if (!throttle('particlePop', 18)) return;

  const pitch = randRange(500, 1100) * (1.6 - size);
  // The "bloop" of the pop
  playTone({
    type: 'sine',
    frequency: pitch * 1.8,
    frequencyEnd: pitch * 0.6,
    attack: 0.002,
    decay: randRange(0.05, 0.1),
    volume: 0.12 + size * 0.1,
    pan,
  });
  // The "pk" click on top
  playNoise({
    filterType: 'bandpass',
    frequency: randRange(2500, 5000),
    Q: 3,
    decay: 0.025,
    volume: 0.12,
    pan,
  });
}

/**
 * Electric crackle for sparking particles.
 * @param {{ pan?: number }} [options]
 */
export function spark({ pan = 0 } = {}) {
  if (!throttle('spark', 30)) return;

  const crackles = Math.round(randRange(2, 5));
  for (let i = 0; i < crackles; i += 1) {
    playNoise({
      filterType: 'highpass',
      frequency: randRange(4000, 8000),
      decay: randRange(0.008, 0.025),
      volume: randRange(0.05, 0.12),
      delay: i * randRange(0.01, 0.035),
      pan: pan + randRange(-0.15, 0.15),
    });
  }
  playTone({
    type: 'square',
    frequency: randRange(2000, 3500),
    decay: 0.02,
    volume: 0.025,
    pan,
    filter: { type: 'highpass', frequency: 1500 },
  });
}

// -----------------------------------------------------------------------------
//  Scroll unrolling
// -----------------------------------------------------------------------------

/**
 * Two sides of the page rolling back: a stereo whoosh with papery
 * rustling and a low, wooden creak.
 * @param {number} [durationSeconds=1.6]
 */
export function scrollUnroll(durationSeconds = 1.6) {
  // Left and right whooshes, one in each speaker
  [-0.8, 0.8].forEach((pan) => {
    playNoise({
      filterType: 'bandpass',
      frequency: 300,
      frequencyEnd: 2400,
      Q: 0.8,
      attack: durationSeconds * 0.35,
      decay: durationSeconds * 0.65,
      volume: 0.22,
      pan,
      reverb: 0.5,
    });
  });

  // Papery rustle: lots of tiny crinkles spread over the roll
  const rustles = 18;
  for (let i = 0; i < rustles; i += 1) {
    playNoise({
      filterType: 'highpass',
      frequency: randRange(3000, 6000),
      decay: randRange(0.02, 0.06),
      volume: randRange(0.03, 0.07),
      delay: (i / rustles) * durationSeconds,
      pan: randPick([-0.7, 0.7]),
    });
  }

  // Wooden creak of the scroll rods
  playTone({
    type: 'sawtooth',
    frequency: 70,
    frequencyEnd: 55,
    attack: 0.2,
    decay: durationSeconds,
    volume: 0.06,
    filter: { type: 'lowpass', frequency: 400, Q: 6 },
    vibrato: { rate: 13, depth: 6 },
  });
}

// -----------------------------------------------------------------------------
//  Slime button
// -----------------------------------------------------------------------------

/** Wet "shloop" when the slime button oozes into view. */
export function slimeAppear() {
  playTone({ type: 'sine', frequency: 90, frequencyEnd: 320, attack: 0.02, decay: 0.35, volume: 0.35, vibrato: { rate: 18, depth: 25 } });
  playNoise({ filterType: 'lowpass', frequency: 800, frequencyEnd: 300, decay: 0.3, volume: 0.15, delay: 0.05 });
  slimeBlub(0.25);
  slimeBlub(0.45);
}

/**
 * A single slimy bubble "blub".
 * @param {number} [delay=0]
 */
export function slimeBlub(delay = 0) {
  if (delay === 0 && !throttle('slimeBlub', 120)) return;
  const pitch = randRange(180, 320);
  playTone({ type: 'sine', frequency: pitch, frequencyEnd: pitch * 2.2, attack: 0.01, decay: 0.09, volume: 0.18, delay });
}

/** Squelchy SPLAT when the slime button is clicked. */
export function slimeSquish() {
  playNoise({ filterType: 'lowpass', frequency: 1400, frequencyEnd: 120, Q: 2, decay: 0.4, volume: 0.45 });
  playTone({ type: 'sine', frequency: 260, frequencyEnd: 50, decay: 0.35, volume: 0.4, vibrato: { rate: 24, depth: 40 } });
  for (let i = 0; i < 4; i += 1) slimeBlub(0.12 + i * 0.07);
}

// -----------------------------------------------------------------------------
//  Game sounds
// -----------------------------------------------------------------------------

/** Laser-y "power on" when a run begins. */
export function gameStart() {
  playTone({ type: 'sawtooth', frequency: 110, frequencyEnd: 880, attack: 0.02, decay: 0.5, volume: 0.15, filter: { type: 'lowpass', frequency: 2500 }, reverb: 0.3 });
  playTone({ type: 'square', frequency: 220, frequencyEnd: 1760, attack: 0.02, decay: 0.5, volume: 0.06, delay: 0.05 });
}

/** Springy "boing" when the scientist jumps. */
export function jump() {
  playTone({ type: 'square', frequency: 280, frequencyEnd: 720, attack: 0.003, decay: 0.14, volume: 0.1, filter: { type: 'lowpass', frequency: 3000 } });
  playTone({ type: 'sine', frequency: 560, frequencyEnd: 1100, decay: 0.12, volume: 0.08 });
}

/** Soft thud when landing. */
export function land() {
  if (!throttle('land', 80)) return;
  playTone({ type: 'sine', frequency: 120, frequencyEnd: 60, decay: 0.08, volume: 0.18 });
  playNoise({ filterType: 'lowpass', frequency: 600, decay: 0.05, volume: 0.08 });
}

/** Bright two-note "bling" when passing an obstacle. */
export function scorePoint() {
  if (!throttle('scorePoint', 50)) return;
  playTone({ type: 'square', frequency: 987.77, decay: 0.07, volume: 0.07 }); // B5
  playTone({ type: 'square', frequency: 1318.51, decay: 0.18, volume: 0.07, delay: 0.07 }); // E6
}

/** Big arpeggio every score milestone (speed-up moments). */
export function milestone() {
  const notes = [440, 554.37, 659.25, 880, 1108.73]; // A major arpeggio
  notes.forEach((frequency, i) => {
    playTone({ type: 'sawtooth', frequency, decay: 0.25, volume: 0.07, delay: i * 0.06, filter: { type: 'lowpass', frequency: 4000 }, reverb: 0.4 });
  });
}

/** Crash: the experiment explodes (smaller version, kept for reuse). */
export function crash() {
  playNoise({ filterType: 'lowpass', frequency: 3000, frequencyEnd: 100, decay: 0.9, volume: 0.55, reverb: 0.4 });
  playTone({ type: 'sawtooth', frequency: 400, frequencyEnd: 40, decay: 0.8, volume: 0.25, filter: { type: 'lowpass', frequency: 1500 } });
  playTone({ type: 'square', frequency: 90, frequencyEnd: 30, decay: 0.6, volume: 0.2 });
}

/** Sad descending "wah-wah" on the game-over panel. */
export function gameOver() {
  const notes = [392, 369.99, 349.23, 293.66]; // G4 F#4 F4 D4
  notes.forEach((frequency, i) => {
    playTone({
      type: 'triangle',
      frequency,
      decay: i === notes.length - 1 ? 0.9 : 0.3,
      volume: 0.14,
      delay: 0.4 + i * 0.32,
      vibrato: i === notes.length - 1 ? { rate: 6, depth: 8 } : undefined,
    });
  });
}

/** Victory fanfare for a new best score. */
export function newBest() {
  const melody = [
    [523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.36], [783.99, 0.54], [1046.5, 0.66],
  ];
  melody.forEach(([frequency, delay]) => {
    playTone({ type: 'square', frequency, decay: 0.22, volume: 0.08, delay, filter: { type: 'lowpass', frequency: 5000 }, reverb: 0.4 });
    playTone({ type: 'sine', frequency: frequency / 2, decay: 0.22, volume: 0.1, delay });
  });
}

// -----------------------------------------------------------------------------
//  Explosion: the scientist goes KABOOM
//  Deliberately huge and over the top. The limiter in audioEngine.js keeps
//  it from distorting or hurting your ears, however many layers stack up.
// -----------------------------------------------------------------------------

/** The massive, exaggerated explosion when the scientist is hit. */
export function explosion() {
  // 1. Sub-bass drop you can feel
  playTone({ type: 'sine', frequency: 110, frequencyEnd: 22, attack: 0.004, decay: 1.9, volume: 1 });

  // 2. The main blast of air
  playNoise({
    filterType: 'lowpass',
    frequency: 4500,
    frequencyEnd: 60,
    Q: 0.7,
    attack: 0.003,
    decay: 2.3,
    volume: 1,
    reverb: 0.6,
  });

  // 3. Sharp crack right at the start
  playNoise({ filterType: 'highpass', frequency: 1200, decay: 0.35, volume: 0.9, reverb: 0.3 });

  // 4. Distorted, gritty rumble
  playTone({
    type: 'sawtooth',
    frequency: 58,
    frequencyEnd: 26,
    attack: 0.02,
    decay: 2.5,
    volume: 0.45,
    filter: { type: 'lowpass', frequency: 280, Q: 3 },
    vibrato: { rate: 17, depth: 8 },
  });
  playTone({
    type: 'square',
    frequency: 41,
    frequencyEnd: 24,
    decay: 1.7,
    volume: 0.3,
    filter: { type: 'lowpass', frequency: 220 },
  });

  // 5. Echoing aftershock booms, bouncing between speakers
  [0.18, 0.42, 0.78].forEach((delay, i) => {
    const strength = 1 - i * 0.25;
    const pan = i % 2 === 0 ? -0.6 : 0.6;
    playTone({
      type: 'sine',
      frequency: 95 * strength,
      frequencyEnd: 28,
      decay: 0.9,
      volume: 0.6 * strength,
      delay,
      pan,
    });
    playNoise({
      filterType: 'lowpass',
      frequency: 2600,
      frequencyEnd: 90,
      decay: 1,
      volume: 0.55 * strength,
      delay,
      pan,
      reverb: 0.7,
    });
  });

  // 6. Wet red splatter: a squelch and gloopy blubs
  playNoise({
    filterType: 'bandpass',
    frequency: 950,
    frequencyEnd: 220,
    Q: 2.5,
    decay: 0.6,
    volume: 0.6,
    delay: 0.05,
  });
  for (let i = 0; i < 6; i += 1) {
    const pitch = randRange(120, 260);
    playTone({
      type: 'sine',
      frequency: pitch,
      frequencyEnd: pitch * 2.4,
      attack: 0.005,
      decay: 0.12,
      volume: 0.22,
      delay: 0.1 + i * 0.06,
      pan: randRange(-0.8, 0.8),
    });
  }

  // 7. Debris raining down for over a second
  for (let i = 0; i < 14; i += 1) {
    playNoise({
      filterType: randPick(['highpass', 'bandpass']),
      frequency: randRange(1500, 5200),
      Q: 2,
      decay: randRange(0.02, 0.07),
      volume: randRange(0.06, 0.15),
      delay: 0.35 + randRange(0, 1.5),
      pan: randRange(-1, 1),
    });
  }
}

/**
 * A wet splat: a red blob hitting the screen.
 * @param {{ pan?: number }} [options]
 */
export function splat({ pan = 0 } = {}) {
  if (!throttle('splat', 40)) return;
  playNoise({
    filterType: 'bandpass',
    frequency: randRange(1000, 1500),
    frequencyEnd: 280,
    Q: 1.8,
    decay: 0.18,
    volume: 0.45,
    pan,
  });
  playTone({
    type: 'sine',
    frequency: randRange(260, 340),
    frequencyEnd: 70,
    decay: 0.13,
    volume: 0.28,
    pan,
  });
}

// -----------------------------------------------------------------------------
//  Music 1: breathing realm ambience (home, profile, review)
//  A warm drone whose volume and brightness swell like breathing.
// -----------------------------------------------------------------------------

/** @type {{ nodes: AudioNode[], output: GainNode, sources: AudioScheduledSourceNode[] } | null} */
let ambience = null;

/**
 * Start the realm ambience. Safe to call repeatedly.
 * @param {number} [breathSeconds=5] Should match the vines' breathing speed
 */
export function startRealmAmbience(breathSeconds = 5) {
  const ctx = getAudioContext();
  const bus = getMusicBus();
  if (ambience || !ctx || !bus) return;

  const now = ctx.currentTime;
  const output = ctx.createGain();
  output.gain.setValueAtTime(0, now);
  output.gain.linearRampToValueAtTime(0.5, now + 3); // gentle fade-in
  output.connect(bus);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 600;
  filter.Q.value = 2;
  filter.connect(output);

  // Breathing: a slow LFO moving the volume and the filter brightness
  const breathLfo = ctx.createOscillator();
  breathLfo.frequency.value = 1 / breathSeconds;
  const breathToVolume = ctx.createGain();
  breathToVolume.gain.value = 0.18;
  const breathToFilter = ctx.createGain();
  breathToFilter.gain.value = 350;
  breathLfo.connect(breathToVolume).connect(output.gain);
  breathLfo.connect(breathToFilter).connect(filter.frequency);

  // Drone chord: A2, E3, A3 plus a slightly detuned A2 for richness
  const sources = [breathLfo];
  const nodes = [output, filter, breathToVolume, breathToFilter];
  const chord = [
    { freq: 110, type: 'sawtooth', gain: 0.12, detune: 0 },
    { freq: 110, type: 'sawtooth', gain: 0.12, detune: 9 },
    { freq: 164.81, type: 'triangle', gain: 0.1, detune: -4 },
    { freq: 220, type: 'sine', gain: 0.08, detune: 3 },
  ];

  chord.forEach(({ freq, type, gain, detune }) => {
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = /** @type {OscillatorType} */ (type);
    osc.frequency.value = freq;
    osc.detune.value = detune;
    amp.gain.value = gain;
    osc.connect(amp).connect(filter);
    sources.push(osc);
    nodes.push(amp);
  });

  sources.forEach((source) => source.start(now));
  ambience = { nodes, output, sources };
}

/** Fade out and stop the realm ambience. */
export function stopRealmAmbience(fadeSeconds = 1.2) {
  const ctx = getAudioContext();
  if (!ambience || !ctx) return;

  const { nodes, output, sources } = ambience;
  ambience = null;

  const now = ctx.currentTime;
  output.gain.cancelScheduledValues(now);
  output.gain.setValueAtTime(output.gain.value, now);
  output.gain.linearRampToValueAtTime(0, now + fadeSeconds);

  sources.forEach((source) => source.stop(now + fadeSeconds + 0.05));
  window.setTimeout(() => nodes.forEach((node) => node.disconnect()), (fadeSeconds + 0.2) * 1000);
}

// -----------------------------------------------------------------------------
//  Music 2: psychedelic game loop
//  A step sequencer that schedules notes slightly ahead of time on the
//  audio clock, so the rhythm stays tight even if a frame stutters.
// -----------------------------------------------------------------------------

// A minor pentatonic, two octaves (Hz)
const SCALE = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99];
const ARP_PATTERN = [0, 4, 7, 4, 9, 7, 5, 2, 0, 4, 8, 4, 9, 6, 5, 3];
const BASS_PATTERN = [110, 0, 110, 0, 87.31, 0, 87.31, 0, 98, 0, 98, 0, 82.41, 0, 98, 0];

const LOOKAHEAD_SECONDS = 0.12;
const SCHEDULER_INTERVAL_MS = 25;

/** @type {{ timer: number, step: number, nextNoteTime: number, bpm: number } | null} */
let sequencer = null;

/**
 * Start the game music.
 * @param {number} [bpm=132]
 */
export function startGameMusic(bpm = 132) {
  const ctx = getAudioContext();
  if (sequencer || !ctx) return;

  sequencer = { timer: 0, step: 0, nextNoteTime: ctx.currentTime + 0.1, bpm };

  sequencer.timer = window.setInterval(() => {
    if (!sequencer) return;
    const context = getAudioContext();
    if (!context) return;

    const sixteenth = 60 / sequencer.bpm / 4;

    while (sequencer.nextNoteTime < context.currentTime + LOOKAHEAD_SECONDS) {
      scheduleStep(sequencer.step, sequencer.nextNoteTime - context.currentTime);
      sequencer.nextNoteTime += sixteenth;
      sequencer.step = (sequencer.step + 1) % 16;
    }
  }, SCHEDULER_INTERVAL_MS);
}

/**
 * Speed up the music as the game gets faster.
 * @param {number} bpm
 */
export function setGameMusicTempo(bpm) {
  if (sequencer) sequencer.bpm = Math.min(Math.max(bpm, 80), 220);
}

/** Stop the game music. */
export function stopGameMusic() {
  if (!sequencer) return;
  window.clearInterval(sequencer.timer);
  sequencer = null;
}

/**
 * Play everything that happens on one sixteenth-note step.
 * @param {number} step 0 to 15
 * @param {number} delay Seconds from now
 */
function scheduleStep(step, delay) {
  if (!isAudioReady()) return;
  const when = Math.max(0, delay);

  // Kick drum on every beat
  if (step % 4 === 0) {
    playTone({ type: 'sine', frequency: 150, frequencyEnd: 45, attack: 0.002, decay: 0.22, volume: 0.35, delay: when });
  }

  // Snare on beats 2 and 4
  if (step === 4 || step === 12) {
    playNoise({ filterType: 'highpass', frequency: 1500, decay: 0.12, volume: 0.16, delay: when });
    playTone({ type: 'triangle', frequency: 220, frequencyEnd: 160, decay: 0.08, volume: 0.08, delay: when });
  }

  // Hi-hat on the off-beats
  if (step % 2 === 1) {
    playNoise({ filterType: 'highpass', frequency: 8000, decay: 0.03, volume: 0.05, delay: when });
  }

  // Bass line
  const bass = BASS_PATTERN[step];
  if (bass) {
    playTone({ type: 'sawtooth', frequency: bass, decay: 0.18, volume: 0.13, delay: when, filter: { type: 'lowpass', frequency: 700, Q: 4 } });
  }

  // Trippy arpeggio, panning left and right
  const note = SCALE[ARP_PATTERN[step] % SCALE.length];
  playTone({
    type: 'square',
    frequency: note,
    decay: 0.12,
    volume: 0.045,
    delay: when,
    pan: Math.sin(step * 0.8) * 0.7,
    filter: { type: 'lowpass', frequency: 1800 + Math.sin(step / 2) * 1200, Q: 5 },
    reverb: 0.35,
  });
}

/** Stop all looping music (used when leaving a scene). */
export function stopAllMusic() {
  stopRealmAmbience(0.5);
  stopGameMusic();
}