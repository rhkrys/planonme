# PlanOnMe: notes for agents

Read [PLAN.md](PLAN.md) first. It has the scope, data model and the numbered build steps.

## Stack

Vite + React 19 + TypeScript (strict, `noUncheckedIndexedAccess`), Zustand for state, Dexie for
IndexedDB, pdfjs-dist for PDF slides, Web Audio for sound. Vitest + Testing Library for unit
tests (`src/**/*.test.ts(x)`, jsdom, `fake-indexeddb` available). Playwright for end-to-end tests
in `e2e/` (pinned to 1.63.0 to match the preinstalled Chromium; do not upgrade or run
`playwright install`).

## Layout

- `index.html` + `src/main.tsx`: control window. `src/App.tsx` holds the sidebar and views.
- `audience.html` + `src/audience/`: the audience popup window.
- `src/views/`: one folder or file per view (Plan, Script, Slides, Sounds, Run).
- `src/styles.css`: CSS custom properties on `:root` with a dark mode override. Reuse them.

## Rules

- Gates before every commit: `npm run format:check`, `npm run check` (lint, typecheck, unit tests).
  Run `npx playwright test` when a step touches UI flow. Run `npm run format` to fix formatting.
- Never crash the app on bad input: imported files, audio, PDFs and stored data are untrusted.
  Show an error message and carry on.
- Every interactive control needs an accessible name (label or `aria-label`) so tests and
  assistive tech can find it.
- One build step per commit. Message format: `Step N: <imperative summary>`, one line, then the
  attribution trailer lines the environment requires.
- Plain language in UI text. No em dashes.
- No assets without a clear open license. Prefer generating test media in code.
