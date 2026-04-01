# gAIns

A single-file hypertrophy workout tracker built with vanilla HTML, CSS, and JavaScript. No frameworks, no build step, no server — just open `index.html` in a browser.

## Features

- **5-day split** — Push, Pull, Legs, Upper, Full Body with exercise details, RPE targets, and coaching notes
- **8-week mesocycle** — Progressive phases (Foundation → Overload → High Stimulus → Overreach → Deload) with per-week RPE and volume guidance
- **Set tracking** — Tap to complete sets, log weights per exercise, track overall session progress
- **Rest timer** — Full-screen countdown with configurable presets (1:00–3:00), background-safe with audio + OS notifications
- **Shoulder protocol** — Built-in prehab checklist on pressing/pulling days
- **Data backup** — Export/import workout data as JSON files
- **Offline-ready** — All state persists in localStorage, works without internet after first load

## Usage

Open `index.html` in any modern browser. That's it.

- Use the **day tabs** to navigate between workouts
- Tap sets to mark them complete — a rest timer starts automatically
- Enter weights in the input below each exercise's sets
- Use the **week selector** in the header to move through mesocycle phases
- Check the **Plan** tab for mesocycle details, progression rules, and glossary
- **Export** your data regularly as a backup — use **Import** to restore

## Tech

- Vanilla JS with no dependencies
- Google Fonts loaded via CDN (Bebas Neue, DM Sans, DM Mono)
- Web Audio API for timer sounds
- Web Notifications API for background alerts
- localStorage for persistence
