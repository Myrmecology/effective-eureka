/**
 * Effective Eureka - standalone build
 *
 * Builds the game and packs everything (JavaScript, CSS, the 3D engine and
 * all generated sound) into ONE HTML file that runs by double-clicking it.
 * No server, no install and no internet needed. Perfect for a USB stick.
 *
 * Run with:  npm run build:standalone
 *
 * Output (inside the git-ignored build/ folder):
 *   build/Effective-Eureka.html   the game
 *   build/How to Play.txt         instructions for friends
 *
 * Security: the page's Content Security Policy still blocks all outside
 * scripts. The packed game code is allowed by its exact SHA-256 fingerprint,
 * so even other inline code could not run.
 */

import { createHash } from 'node:crypto';
import { readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// -----------------------------------------------------------------------------
//  Paths (TEMP_DIR must match STANDALONE_TEMP_DIR in vite.config.js)
// -----------------------------------------------------------------------------

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = path.join(ROOT, 'build');
const TEMP_DIR = path.join(OUTPUT_DIR, '.standalone-tmp');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'Effective-Eureka.html');
const HOW_TO_PLAY_FILE = path.join(OUTPUT_DIR, 'How to Play.txt');

const HOW_TO_PLAY = `EFFECTIVE EUREKA
================

HOW TO START
  Double-click "Effective-Eureka.html".
  It opens in your web browser. No install or internet needed.
  Best in Google Chrome, Microsoft Edge, or Firefox.

HOW TO PLAY
  Jump ............ Space, Up Arrow, W, click, or tap
  Higher jump ..... Hold the jump button
  Pause/resume .... Esc or P
  Mute ............ Speaker button (top right)

GOOD TO KNOW
  - Sound starts after you click "Enter the Realm".
  - Your profile clears every time the game is opened.
  - For the best experience, press F11 for fullscreen.

WARNING
  This game contains flashing lights and colors.

TROUBLESHOOTING
  Blank screen? Try a different browser, or make sure hardware
  acceleration is turned on in your browser's settings.
`;

// -----------------------------------------------------------------------------
//  Helpers
// -----------------------------------------------------------------------------

/** @param {string} message */
function log(message) {
  console.log(`[standalone] ${message}`);
}

/**
 * Get an attribute's value from a single HTML tag string.
 * @param {string} tag
 * @param {string} name
 * @returns {string | null}
 */
function getAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'));
  return match ? match[1] : null;
}

/**
 * Resolve an asset path like "./assets/index-abc.js" inside the temp folder.
 * Refuses paths that try to escape the folder.
 * @param {string} assetPath
 * @returns {string}
 */
function resolveAsset(assetPath) {
  const cleaned = assetPath.replace(/^\.?\//, '');
  const full = path.resolve(TEMP_DIR, cleaned);
  if (!full.startsWith(TEMP_DIR + path.sep)) {
    throw new Error(`Refusing to read an asset outside the build folder: ${assetPath}`);
  }
  return full;
}

/**
 * List files in a folder with a given extension (empty if the folder is missing).
 * @param {string} folder
 * @param {string} extension
 * @returns {Promise<string[]>}
 */
async function listFiles(folder, extension) {
  try {
    return (await readdir(folder)).filter((name) => name.endsWith(extension));
  } catch {
    return [];
  }
}

// -----------------------------------------------------------------------------
//  Build and pack
// -----------------------------------------------------------------------------

async function main() {
  log('Building the game in standalone mode…');
  await build({ root: ROOT, mode: 'standalone', logLevel: 'warn' });

  const indexPath = path.join(TEMP_DIR, 'index.html');
  let html = await readFile(indexPath, 'utf8');

  // ---- Safety check: everything must be in exactly one JS file ----
  const jsFiles = await listFiles(path.join(TEMP_DIR, 'assets'), '.js');
  if (jsFiles.length !== 1) {
    throw new Error(
      `Expected 1 JavaScript file but found ${jsFiles.length} (${jsFiles.join(', ')}). ` +
        'Check the standalone settings in vite.config.js.',
    );
  }

  // ---- Find the entry script tag ----
  const scriptTags = html.match(/<script\b[^>]*\bsrc\s*=\s*"[^"]*"[^>]*>\s*<\/script>/gi) ?? [];
  if (scriptTags.length !== 1) {
    throw new Error(`Expected 1 script tag in index.html but found ${scriptTags.length}.`);
  }
  const scriptTag = scriptTags[0];
  const scriptSrc = getAttribute(scriptTag, 'src');
  if (!scriptSrc) throw new Error('The script tag has no src attribute.');

  let js = await readFile(resolveAsset(scriptSrc), 'utf8');
  // "</script" inside the code would end the tag early; "<\/script" means the same in JavaScript.
  js = js.replace(/<\/script/gi, '<\\/script');

  // ---- Inline the stylesheet(s) ----
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const rel = (getAttribute(tag, 'rel') ?? '').toLowerCase();

    if (rel === 'stylesheet') {
      const href = getAttribute(tag, 'href');
      if (!href) continue;
      const css = (await readFile(resolveAsset(href), 'utf8')).replace(/<\/style/gi, '<\\/style');
      // A function replacement keeps "$" characters in the code from being misread.
      html = html.replace(tag, () => `<style>\n${css}\n</style>`);
    } else if (rel === 'modulepreload') {
      html = html.replace(tag, () => '');
    }
  }

  // ---- Inline the script ----
  html = html.replace(scriptTag, () => `<script type="module">\n${js}\n</script>`);

  // ---- Update the Content Security Policy ----
  // The hash must cover the exact text between the <script> tags.
  const hash = createHash('sha256').update(`\n${js}\n`, 'utf8').digest('base64');

  if (!/script-src\s+'self'/.test(html)) {
    throw new Error('Could not find "script-src \'self\'" in the Content Security Policy.');
  }
  html = html
    .replace(/script-src\s+'self'/, () => `script-src 'self' 'sha256-${hash}'`)
    // The hot-reload connection is only for the dev server; drop it.
    .replace(/\s*ws:\/\/localhost:\*/, '');

  // ---- Write the results ----
  await writeFile(OUTPUT_FILE, html, 'utf8');
  await writeFile(HOW_TO_PLAY_FILE, HOW_TO_PLAY.replace(/\n/g, '\r\n'), 'utf8'); // Windows-friendly line endings
  await rm(TEMP_DIR, { recursive: true, force: true });

  const sizeMb = ((await stat(OUTPUT_FILE)).size / (1024 * 1024)).toFixed(1);
  log('Done!');
  log(`Game:         ${path.relative(ROOT, OUTPUT_FILE)} (${sizeMb} MB)`);
  log(`Instructions: ${path.relative(ROOT, HOW_TO_PLAY_FILE)}`);
}

main().catch(async (error) => {
  console.error(`\n[standalone] Build failed: ${error instanceof Error ? error.message : error}\n`);
  await rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
  process.exitCode = 1;
});