# PlanOnMe: build plan

One app to plan a workshop, run the script, fire music and sound effects, and show slides in a
small window you can share in Zoom without taking over the desktop.

## Scope by version

| Version | Platform | Users | Slide import | Audience window |
|---|---|---|---|---|
| **MVP (v1)** | Browser (Chrome) | Solo, no sign-in | PDF export from PPT, Google Slides, Canva, Gamma | Basic popup window |
| **v2** | Browser + Rust desktop (Tauri) | Solo + co-facilitators | Adds Google and Canva sign-in imports, Gamma API | Native always-on-top window (desktop), Document PiP (browser) |
| **v3** | Both | Teams | PPTX conversion, live embeds | Phone remote control |

## Tech stack (MVP)

- **Vite + React + TypeScript**, strict mode.
- **State:** Zustand.
- **Storage:** IndexedDB via Dexie. Everything stays in the browser, works offline.
- **Slides:** pdf.js renders each PDF page to an image once, at import.
- **Audio:** Web Audio API (loops, fades, overlapping effects, master volume).
- **Two windows:** control window plus audience popup, linked with `BroadcastChannel`.
- **Tests:** Vitest (logic) and Playwright (end-to-end in Chromium).
- **Quality gates before every commit:** `npm run lint`, `npm run typecheck`, `npm test`.
- **Build:** static site, deployable to Netlify, Vercel or Cloudflare Pages. Installable as a PWA.

## Data model

```
Workshop  { id, title, date, durationMin, blocks[], slideDeckIds[], soundIds[] }
Block     { id, title, kind (talk | exercise | break | discussion), durationMin, goal, notes, script }
Script    rich text with inline cue tokens:
            [SLIDE 4]  [SFX applause]  [MUSIC break-loop]  [STOP MUSIC]  [TIMER 5m]
SlideDeck { id, name, source (pptx | gslides | canva | gamma | pdf), slides: Blob[] (images) }
Sound     { id, name, kind (music | sfx), blob, loop, volume, hotkey, color }
```

## MVP build steps

Each step is one small commit with passing gates.

1. **Scaffold.** Vite, React, TS, ESLint, Prettier, Vitest, Playwright, app shell with a sidebar
   (Plan, Script, Slides, Sounds, Run).
2. **Storage layer.** Dexie schema for workshops, decks and sounds. Export and import a workshop as
   one `.planonme` file (JSON plus media) for backup.
3. **Planner.** Create workshops. Add, edit and drag-reorder blocks. Running total against session
   length, with an over-time warning.
4. **Script editor.** A script per block. Cue tokens are highlighted and checked (unknown slide or
   sound shows a warning). Typing `[` gives an autocomplete list of slides and sounds.
5. **Slide import.** Upload a PDF, render pages to images, show a thumbnail strip. Help text on how
   to export a PDF from PowerPoint, Google Slides, Canva and Gamma.
6. **Audience window.** "Open audience window" opens a 1280x720 popup that shows only the current
   slide on black, scaled to fit any size. It is controlled over `BroadcastChannel` and
   reconnects if reloaded. Blank-screen and logo-screen toggles.
7. **Soundboard.** Upload audio files. A grid of pads with color, hotkey, loop and volume. Music
   fades in and out; effects can overlap. A panic button stops all audio.
8. **Run mode.** A teleprompter view of the script, with the current cue highlighted. The space bar
   (GO) fires the next cue. Arrow keys move slides. Block countdown, total elapsed, and an
   ahead/behind indicator. A "next up" preview of the next slide and cue.
9. **Zoom pre-flight.** A checklist screen: audience window open, test tone, reminder to tick
   "Share sound" in Zoom, and how to share only the audience window.
10. **Polish and ship.** Keyboard shortcut help, empty states, error messages, PWA install, deploy
    guide. End-to-end test of a full sample workshop.

## v2 plan

- **Rust desktop app with Tauri.** Wraps the same React UI in a native app for macOS, Windows and
  Linux. The Rust side adds:
  - a native audience window: exact size, always on top, no popup blocker;
  - global hotkeys, so GO and sound pads work while Zoom has focus;
  - workshops and media saved as normal files in a folder;
  - signed installers and auto-update.
  The browser build stays. Shared code lives in one place; only storage and window control get a
  per-platform adapter (`platform/web.ts`, `platform/tauri.ts`).
- **Sign-in imports.** Google Slides (Slides API, slide images), Canva (Connect API export),
  Gamma (API export).
- **Co-facilitators.** Accounts and cloud sync (e.g. Supabase), shared workshops, live cursor in
  run mode.
- **Document Picture-in-Picture** audience window in Chrome as an option.

## Known limits

- Slides imported as images lose animations and embedded video. Live embeds are planned for v3.
- Zoom only hears browser audio when "Share sound" is ticked in the share dialog.
- Browser storage can be cleared by the user or browser. The export file is the backup.
