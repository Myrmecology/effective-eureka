# Effective Eureka

A 3D browser experience built with Babylon.js and Vite. Enter a realm of breathing vines, build a profile, and run through a psychedelic obstacle course as a scientist.

## Features

- Breathing 3D vines with a scroll-style roll-back transition
- Particle burst entrance with sound effects generated in code (no audio files)
- Profile builder with validation and a review screen
- Side-scrolling runner with jumping, platforms, saws, and spikes
- Procedurally generated obstacles that get harder as you play
- Psychedelic visuals: kaleidoscope background, neon grid, bloom, and beat-synced lights
- Two generated music tracks that react to the game

## Requirements

- Node.js 20.19+ or 22.12+
- A modern browser with WebGL (Chrome, Edge, or Firefox)

## Getting Started

```bash
npm install
npm run dev
```

The app opens at `http://localhost:5173`.

## Scripts

| Command           | Description                          |
| ----------------- | ------------------------------------ |
| `npm run dev`     | Start the development server         |
| `npm run build`   | Create a production build in `dist/` |
| `npm run preview` | Preview the production build         |

## Controls

| Action       | Input                          |
| ------------ | ------------------------------ |
| Jump         | Space, Up Arrow, W, click, tap |
| Higher jump  | Hold the jump input            |
| Pause/resume | Esc or P                       |
| Mute         | Speaker button (top right)     |

## Project Structure

```
src/
├── audio/      Sound engine, sound effects, and music
├── core/       Engine, scene manager, and app state
├── scenes/
│   ├── home/   Vines, burst effect, scroll transition
│   └── game/   Scientist, obstacles, effects, explosion, input
├── styles/     Global and UI styles
├── ui/         Buttons, profile form, and profile review
├── utils/      Math and storage helpers
└── main.js     App entry point
```

## Data

- The profile is kept only for the current visit and clears on every page load.
- The best score and sound setting are saved in the browser's local storage.
- No data is sent anywhere.

## Accessibility

The game includes flashing lights. Flashes are kept under three per second, and effects are reduced automatically when the system "reduce motion" setting is on.

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).