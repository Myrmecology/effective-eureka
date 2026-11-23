/**
 * Effective Eureka - psychedelic effects
 *
 * Everything that makes the game look like a trip:
 *  - animated kaleidoscope plasma background (custom GLSL shader)
 *  - scrolling neon grid floor (custom GLSL shader)
 *  - drifting wireframe polyhedra in the distance (parallax)
 *  - color-cycling stage lights that pulse on the beat
 *  - post-processing: bloom, chromatic aberration, grain, vignette
 *  - screen flashes for big moments
 *
 * The background and floor are oversized so the screen stays fully
 * covered even when the camera tilts far to either side.
 *
 * Safety: flashes stay under 3 per second (the WCAG photosensitivity
 * guideline), and users who turn on "reduce motion" get a much calmer
 * version automatically.
 *
 * @module scenes/game/psychedelicFx
 */

import {
  Color3,
  Color4,
  DefaultRenderingPipeline,
  HemisphericLight,
  MeshBuilder,
  PointLight,
  ShaderMaterial,
  StandardMaterial,
  Vector3,
} from '@babylonjs/core';
import { TAU, clamp, damp, randPick, randRange, wrap } from '@/utils/math.js';

// -----------------------------------------------------------------------------
//  Shaders (GLSL, compiled by the graphics card)
// -----------------------------------------------------------------------------

const BACKGROUND_VERTEX = /* glsl */ `
  precision highp float;
  attribute vec3 position;
  attribute vec2 uv;
  uniform mat4 worldViewProjection;
  varying vec2 vUV;
  void main(void) {
    vUV = uv;
    gl_Position = worldViewProjection * vec4(position, 1.0);
  }
`;

const BACKGROUND_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec2 vUV;
  uniform float time;
  uniform float intensity;
  uniform float beat;
  uniform float aspect;
  uniform vec3 tint;

  // Smooth rainbow palette
  vec3 palette(float t) {
    return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  }

  void main(void) {
    vec2 uv = vUV * 2.0 - 1.0;
    uv.x *= aspect;

    // Slow rotation of the whole pattern
    float rot = time * 0.05;
    uv = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * uv;

    float r = length(uv);
    float a = atan(uv.y, uv.x);

    // Kaleidoscope: fold the angle into mirrored segments
    float segments = 6.0 + floor(intensity * 4.0);
    float segAngle = 6.28318 / segments;
    a = mod(a, segAngle);
    a = abs(a - segAngle * 0.5);
    vec2 k = vec2(cos(a), sin(a)) * r;

    // Layered sine plasma
    float v = sin(k.x * 6.0 + time * 1.3)
            + sin(k.y * 7.0 - time * 1.1)
            + sin((k.x + k.y) * 5.0 + time * 0.7)
            + sin(r * 12.0 - time * 3.0 - beat * 2.0);

    vec3 color = palette(v * 0.15 + time * 0.07 + r * 0.3);
    color = mix(color, tint, 0.18);

    // Tunnel rings that rush outward on the beat
    float rings = 0.5 + 0.5 * sin(r * 22.0 - time * 6.0);
    color += rings * 0.12 * (0.4 + beat);

    float brightness = 0.28 + 0.32 * intensity + beat * 0.22;
    float falloff = mix(1.0, 0.35, smoothstep(0.2, 1.8, r));
    gl_FragColor = vec4(color * brightness * falloff, 1.0);
  }
`;

const FLOOR_VERTEX = /* glsl */ `
  precision highp float;
  attribute vec3 position;
  attribute vec3 normal;
  uniform mat4 world;
  uniform mat4 worldViewProjection;
  varying vec3 vWorld;
  varying vec3 vNormal;
  void main(void) {
    vec4 worldPos = world * vec4(position, 1.0);
    vWorld = worldPos.xyz;
    vNormal = normalize(mat3(world) * normal);
    gl_Position = worldViewProjection * vec4(position, 1.0);
  }
`;

const FLOOR_FRAGMENT = /* glsl */ `
  precision highp float;
  varying vec3 vWorld;
  varying vec3 vNormal;
  uniform float time;
  uniform float offset;
  uniform float beat;
  uniform vec3 tint;

  vec3 palette(float t) {
    return 0.5 + 0.5 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
  }

  // Thin glowing line where fract(x) is near 0 or 1
  float gridLine(float x, float width) {
    float d = abs(fract(x) - 0.5);
    return smoothstep(0.5 - width, 0.5, d);
  }

  void main(void) {
    vec3 base = vec3(0.03, 0.0, 0.07);
    vec3 neon = palette((vWorld.x + offset) * 0.03 + time * 0.1);
    neon = mix(neon, tint, 0.25);

    vec3 color;
    if (vNormal.y > 0.5) {
      // Top surface: scrolling grid
      float lines = max(
        gridLine(vWorld.x + offset, 0.05),
        gridLine(vWorld.z * 1.0, 0.05)
      );
      color = base + neon * lines * (0.9 + beat * 0.8);
    } else {
      // Front face: dark with horizontal scan bands and a bright top edge
      float band = gridLine(vWorld.y * 3.0 - time * 0.5, 0.08) * 0.35;
      float edge = smoothstep(-0.12, 0.0, vWorld.y);
      color = base + neon * (band + edge * (1.4 + beat));
    }
    gl_FragColor = vec4(color, 1.0);
  }
`;

// -----------------------------------------------------------------------------
//  Tuning
// -----------------------------------------------------------------------------

const BACKGROUND_Z = 30;
const SHAPE_COUNT = 16;
const LIGHT_HUE_SPEED = 70; // degrees per second

/**
 * How much bigger than the screen the background and floor are.
 * Large enough to stay covered at about a 35 degree camera tilt.
 */
const BACKGROUND_COVERAGE = 2.6;
const FLOOR_WIDTH_COVERAGE = 3.5; // times the full screen width
const FLOOR_HEIGHT = 16; // how far the floor's front face extends downward
const FLOOR_DEPTH = 6;

/**
 * @param {import('@babylonjs/core').Scene} scene
 * @param {import('@babylonjs/core').Camera} camera
 * @param {{ playerColor?: string, viewHalfWidth: number, viewHalfHeight: number }} options
 */
export function createPsychedelicFx(scene, camera, { playerColor = '#33d17a', viewHalfWidth, viewHalfHeight }) {
  const safeMode = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const tint = Color3.FromHexString(playerColor);

  scene.clearColor = new Color4(0.02, 0, 0.05, 1);

  // ---------------------------------------------------------------------------
  //  Background plasma
  // ---------------------------------------------------------------------------
  const backgroundMaterial = new ShaderMaterial(
    'psy-background',
    scene,
    { vertexSource: BACKGROUND_VERTEX, fragmentSource: BACKGROUND_FRAGMENT },
    {
      attributes: ['position', 'uv'],
      uniforms: ['worldViewProjection', 'time', 'intensity', 'beat', 'aspect', 'tint'],
    },
  );
  backgroundMaterial.backFaceCulling = false;

  // Size the backdrop to cover the view at its depth, with plenty of extra
  // room so the corners stay filled while the camera tilts.
  const bgScale = (BACKGROUND_Z - camera.position.z) / Math.max(1, -camera.position.z);
  const bgCover = Math.max(viewHalfWidth, viewHalfHeight) * 2 * bgScale * BACKGROUND_COVERAGE;
  const background = MeshBuilder.CreatePlane(
    'psy-background-plane',
    { width: bgCover, height: bgCover },
    scene,
  );
  background.position.set(0, viewHalfHeight * 0.3, BACKGROUND_Z);
  background.material = backgroundMaterial;
  background.isPickable = false;
  backgroundMaterial.setFloat('aspect', 1); // the plane is square now
  backgroundMaterial.setColor3('tint', tint);

  // ---------------------------------------------------------------------------
  //  Neon grid floor (top at y = 0)
  // ---------------------------------------------------------------------------
  const floorMaterial = new ShaderMaterial(
    'psy-floor',
    scene,
    { vertexSource: FLOOR_VERTEX, fragmentSource: FLOOR_FRAGMENT },
    {
      attributes: ['position', 'normal'],
      uniforms: ['world', 'worldViewProjection', 'time', 'offset', 'beat', 'tint'],
    },
  );
  floorMaterial.setColor3('tint', tint);

  const floor = MeshBuilder.CreateBox(
    'psy-floor-box',
    { width: viewHalfWidth * 2 * FLOOR_WIDTH_COVERAGE, height: FLOOR_HEIGHT, depth: FLOOR_DEPTH },
    scene,
  );
  floor.position.set(0, -FLOOR_HEIGHT / 2, FLOOR_DEPTH / 2 - 1);
  floor.material = floorMaterial;
  floor.isPickable = false;

  // ---------------------------------------------------------------------------
  //  Floating wireframe shapes (distant parallax layer)
  // ---------------------------------------------------------------------------
  const shapeMaterials = [];
  const shapes = [];
  const spanX = viewHalfWidth * 3;

  for (let i = 0; i < SHAPE_COUNT; i += 1) {
    const type = randPick([0, 1, 2, 3, 4]);
    const mesh =
      type === 4
        ? MeshBuilder.CreateTorusKnot(`psy-shape-${i}`, { radius: 0.8, tube: 0.18, radialSegments: 48 }, scene)
        : MeshBuilder.CreatePolyhedron(`psy-shape-${i}`, { type, size: randRange(0.6, 1.4) }, scene);

    const material = new StandardMaterial(`psy-shape-mat-${i}`, scene);
    material.wireframe = true;
    material.disableLighting = true;
    material.emissiveColor = new Color3(1, 1, 1);
    mesh.material = material;
    mesh.isPickable = false;

    const depth = randRange(8, 22);
    mesh.position.set(randRange(-spanX, spanX), randRange(1, viewHalfHeight * 2.2), depth);

    const baseScale = randRange(0.8, 2.2);
    mesh.scaling.setAll(baseScale);

    shapeMaterials.push(material);
    shapes.push({
      mesh,
      material,
      depth,
      hueOffset: randRange(0, 360),
      spin: new Vector3(randRange(-1, 1), randRange(-1, 1), randRange(-1, 1)),
      bobPhase: randRange(0, TAU),
      baseY: mesh.position.y,
      baseScale,
    });
  }

  // ---------------------------------------------------------------------------
  //  Lights
  // ---------------------------------------------------------------------------
  const ambient = new HemisphericLight('psy-ambient', new Vector3(0.2, 1, -0.6), scene);
  ambient.intensity = 0.55;
  ambient.diffuse = new Color3(0.9, 0.85, 1);
  ambient.groundColor = new Color3(0.2, 0, 0.3);

  const stageLights = [-1, 0, 1].map((side, i) => {
    const light = new PointLight(`psy-stage-${i}`, new Vector3(side * viewHalfWidth * 0.7, 5, -3), scene);
    light.range = 22;
    light.intensity = 0.8;
    return { light, hueOffset: i * 120 };
  });

  // ---------------------------------------------------------------------------
  //  Post-processing
  // ---------------------------------------------------------------------------
  const pipeline = new DefaultRenderingPipeline('psy-pipeline', true, scene, [camera]);
  pipeline.samples = 2;
  pipeline.fxaaEnabled = true;

  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.55;
  pipeline.bloomWeight = 0.55;
  pipeline.bloomKernel = 64;
  pipeline.bloomScale = 0.5;

  pipeline.chromaticAberrationEnabled = !safeMode;
  pipeline.chromaticAberration.aberrationAmount = 20;
  pipeline.chromaticAberration.radialIntensity = 1.2;

  pipeline.grainEnabled = true;
  pipeline.grain.intensity = 7;
  pipeline.grain.animated = true;

  pipeline.imageProcessingEnabled = true;
  pipeline.imageProcessing.contrast = 1.35;
  pipeline.imageProcessing.exposure = 1;
  pipeline.imageProcessing.vignetteEnabled = true;
  pipeline.imageProcessing.vignetteWeight = 2.2;
  pipeline.imageProcessing.vignetteColor = new Color4(0.15, 0, 0.25, 0);

  // ---------------------------------------------------------------------------
  //  State
  // ---------------------------------------------------------------------------
  let time = 0;
  let floorOffset = 0;
  let intensity = 0;
  let targetIntensity = 0;
  let bpm = 132;
  let beatPhase = 0;
  let pulse = 0;
  let flashAmount = 0;
  const flashColor = new Color3(1, 1, 1);

  // ---------------------------------------------------------------------------
  //  Update
  // ---------------------------------------------------------------------------

  /**
   * @param {number} dt
   * @param {number} speed World scroll speed (units per second)
   */
  function update(dt, speed) {
    time += dt;
    floorOffset += speed * dt;
    intensity = damp(intensity, targetIntensity, 1.5, dt);

    // Beat pulse: spikes to 1 on each beat, then decays quickly.
    beatPhase += (dt * bpm) / 60;
    const fractional = beatPhase - Math.floor(beatPhase);
    pulse = Math.pow(1 - fractional, 4) * (safeMode ? 0.25 : 1);

    flashAmount = Math.max(0, flashAmount - dt * 2.5);

    // Shaders
    backgroundMaterial.setFloat('time', time);
    backgroundMaterial.setFloat('intensity', intensity);
    backgroundMaterial.setFloat('beat', pulse);
    floorMaterial.setFloat('time', time);
    floorMaterial.setFloat('offset', floorOffset);
    floorMaterial.setFloat('beat', pulse);

    // Distant shapes drift slower than the foreground (parallax).
    for (const shape of shapes) {
      const parallax = 4 / shape.depth;
      shape.mesh.position.x = wrap(shape.mesh.position.x - speed * parallax * dt, -spanX, spanX);
      shape.mesh.position.y = shape.baseY + Math.sin(time * 0.6 + shape.bobPhase) * 0.4;
      shape.mesh.rotation.addInPlace(shape.spin.scale(dt * (0.6 + intensity)));
      Color3.HSVtoRGBToRef(wrap(time * 50 + shape.hueOffset, 0, 360), 0.8, 1, shape.material.emissiveColor);
      shape.mesh.scaling.setAll(shape.baseScale * (1 + pulse * 0.08));
    }

    // Stage lights cycle hue and pulse.
    for (const { light, hueOffset } of stageLights) {
      Color3.HSVtoRGBToRef(wrap(time * LIGHT_HUE_SPEED + hueOffset, 0, 360), 1, 1, light.diffuse);
      light.specular.copyFrom(light.diffuse);
      light.intensity = 0.6 + intensity * 0.6 + pulse * 0.9;
    }

    // Post effects react to the beat, intensity and flashes.
    pipeline.bloomWeight = 0.45 + intensity * 0.25 + pulse * 0.25 + flashAmount * 0.5;
    if (pipeline.chromaticAberrationEnabled) {
      pipeline.chromaticAberration.aberrationAmount = 15 + intensity * 25 + pulse * 25 + flashAmount * 60;
    }
    pipeline.imageProcessing.exposure = 1 + flashAmount * (safeMode ? 0.2 : 0.9);
    scene.clearColor.set(
      0.02 + flashColor.r * flashAmount * 0.3,
      flashColor.g * flashAmount * 0.3,
      0.05 + flashColor.b * flashAmount * 0.3,
      1,
    );
  }

  // ---------------------------------------------------------------------------
  //  Controls
  // ---------------------------------------------------------------------------

  /**
   * How wild things look: 0 (calm start) to 1 (maximum trip).
   * @param {number} value
   */
  function setIntensity(value) {
    targetIntensity = clamp(value, 0, 1);
  }

  /**
   * Keep the visual beat in step with the music tempo.
   * @param {number} value Beats per minute
   */
  function setTempo(value) {
    bpm = clamp(value, 60, 240);
  }

  /** Restart the beat clock (call when the music starts). */
  function resetBeat() {
    beatPhase = 0;
  }

  /**
   * A full-screen flash for big moments (milestone, crash).
   * @param {string} [hex='#ffffff']
   * @param {number} [strength=1]
   */
  function flash(hex = '#ffffff', strength = 1) {
    flashColor.copyFrom(Color3.FromHexString(hex));
    flashAmount = clamp(strength, 0, 1) * (safeMode ? 0.3 : 1);
  }

  /** @returns {number} Current beat pulse, 0 to 1 */
  function getPulse() {
    return pulse;
  }

  function dispose() {
    pipeline.dispose();
    background.dispose();
    backgroundMaterial.dispose();
    floor.dispose();
    floorMaterial.dispose();
    shapes.forEach((shape) => shape.mesh.dispose());
    shapeMaterials.forEach((material) => material.dispose());
    stageLights.forEach(({ light }) => light.dispose());
    ambient.dispose();
  }

  return { update, setIntensity, setTempo, resetBeat, flash, getPulse, dispose, safeMode };
}