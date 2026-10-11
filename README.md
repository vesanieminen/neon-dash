# NEON DASH

A synthwave endless runner for the browser. No build step, no dependencies, no
install — it's just three files.

## Play

Open `index.html` in any modern browser (double-click it, or drag it into a
Chrome/Firefox/Safari/Edge window). That's it.

## Controls

| Action          | Solo            | Player 1 | Player 2 |
| --------------- | --------------- | -------- | -------- |
| Jump            | `W` / `Space` / `↑` | `W` / `Space` | `↑` |
| Slide / fast-fall | `S` / `↓`     | `S`      | `↓`      |

- **Double-tap jump** = double jump.
- **Hold jump** = jump higher (release early to cut the jump short).
- Press **`1`** on the title screen for Solo, **`2`** for Two Players.
- **`M`** mute, **`P` / `Esc`** pause, **`Space`** restart after a game over.

## How it works

- You run automatically while the world scrolls faster and faster.
- **Jump** over blocks, drones and tall pillars. **Slide** under laser gates.
- Collect glowing **orbs** to build a combo multiplier (up to ×8).
- Grab **power-ups**: `S` shield (survive one hit), `M` magnet (pull orbs in),
  `2x` score, `T` slow-motion.
- Best score is saved per player in your browser (localStorage).

In two-player mode you race on parallel tracks — same speed, different
obstacles. Whoever scores the most when both are down wins.

## Files

- `index.html` — page + canvas
- `style.css` — fullscreen layout
- `game.js` — the whole game (rendering, physics, spawning, WebAudio synth music/SFX)

Everything is rendered on an HTML5 canvas and all sound is generated live with
the WebAudio API, so there are no image or audio assets to load.
