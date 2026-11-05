# PlanOnMe

Plan a workshop, run your script, play music and sound effects, and show your slides in a small
window you can share in Zoom, all in one browser app.

**Status: MVP.** All ten build steps in [PLAN.md](PLAN.md) are done. Everything runs in your
browser: there is no sign-in and no server, and your workshops stay on your computer.

## Features

- **Plan.** Build a workshop from blocks (talk, exercise, break, discussion). See the start time
  of each block, the running total against the session length, and a warning when you run over.
  Drag blocks to reorder them.
- **Script.** Write a script for each block with cues in square brackets: `[SLIDE 4]`,
  `[SFX applause]`, `[MUSIC break-loop]`, `[STOP MUSIC]` and `[TIMER 5m]`. Cues are highlighted
  and checked, and typing `[` suggests slides and sounds.
- **Slides.** Import a PDF exported from PowerPoint, Google Slides, Canva or Gamma. Each page
  becomes a slide image, so it looks the same everywhere.
- **Audience window.** A separate window that shows only the current slide on black. Share just
  this window in Zoom. It has blank and logo screens and reconnects if it is reloaded.
- **Sounds.** A soundboard of pads with colors, hotkeys, loop and volume. Music fades in and out,
  effects can overlap, and Esc stops everything.
- **Run mode.** A teleprompter with the current cue highlighted. Press Space (GO) to fire the next
  cue: change the slide, play a sound or start a timer. Block countdown, total time and an ahead
  or behind indicator keep you on time.
- **Pre-flight.** A checklist to run through before you go live in Zoom, with a test tone.
- **Sample workshop.** One click loads a small demo with slides, sounds and a script, so you can
  try everything in a minute.
- **Backups.** Export a workshop with all its slides and sounds as one `.planonme` file, and
  import it again on any computer.
- **Works offline.** Install it as an app from the browser. Once loaded, it works without a
  connection.
- **Keyboard first.** Press `?` in the app to see every shortcut.

## Run it on your computer

You need [Node.js](https://nodejs.org/) 20 or newer.

```sh
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173) in Chrome or Edge. Other modern
browsers work too, but Chrome is the one we test with.

Other commands:

| Command               | What it does                                         |
| --------------------- | ---------------------------------------------------- |
| `npm run build`       | Builds the static site into `dist/`                  |
| `npm run preview`     | Serves the built site, to check it before you deploy |
| `npm run check`       | Lint, type check and unit tests                      |
| `npx playwright test` | End-to-end tests in Chromium (builds the site first) |
| `npm run format`      | Formats the code with Prettier                       |

## Use it with Zoom

1. Prepare your workshop in Plan, Script, Slides and Sounds. New here? Click **Load sample
   workshop** on the empty plan to see a finished example.
2. Click **Open audience window** in the sidebar. A 1280 by 720 window opens. If the browser
   blocks it, allow popups for PlanOnMe and click again.
3. Open **Pre-flight** and work through the list. Play the test tone to check your speakers.
4. In Zoom, click **Share screen** and pick the **PlanOnMe Audience** window, not your whole
   screen. Tick **Share sound** so people hear your music and effects.
5. Go to **Run** and press **Space** to fire each cue. Shift+Space goes back, the arrow keys
   change slides, B blanks the screen and Esc stops all sound.

Zoom only shares browser audio when **Share sound** is ticked. Keep the control window on your own
screen: your script and notes stay private.

## Deploy as a static site

`npm run build` makes a plain static site in `dist/`. Any static host works. The site has two
pages (`index.html` and `audience.html`) and needs no rewrites or server code. Hosts serve it over
HTTPS, which the offline mode needs.

### Netlify

1. Push this repository to GitHub, GitLab or Bitbucket.
2. In Netlify, choose **Add new site**, then **Import an existing project**, and pick the
   repository.
3. Set the build command to `npm run build` and the publish directory to `dist`.
4. Deploy.

Or from your computer: `npm run build`, then `npx netlify-cli deploy --prod --dir dist`.

### Vercel

1. In Vercel, choose **Add New**, then **Project**, and import the repository.
2. Vercel finds Vite on its own. Check that the build command is `npm run build` and the output
   directory is `dist`.
3. Deploy.

Or from your computer: `npx vercel --prod`.

### Cloudflare Pages

1. In Cloudflare, open **Workers & Pages**, choose **Create**, then **Pages**, and connect the
   repository.
2. Pick the **Vite** preset, or set the build command to `npm run build` and the output directory
   to `dist`.
3. Deploy.

Or from your computer: `npm run build`, then `npx wrangler pages deploy dist`.

After an update, an open PlanOnMe tab keeps the old version until every PlanOnMe tab is closed.
This is on purpose, so an update never reloads the page in the middle of a live session.

## Your data

Workshops, slides and sounds are stored in your browser (IndexedDB). They never leave your
computer. Clearing your browser data deletes them, so use **Export** to keep a backup file.

## Known limits

- Slides are images, so animations and embedded videos in your deck do not play.
- Sound hotkeys and GO work while a PlanOnMe window (the control window or the audience window)
  has focus. They do not work while Zoom or another app has focus.
- See [PLAN.md](PLAN.md) for what is planned next, such as a desktop app and sign-in imports.

The earlier 2010 Rails prototype is in this repository's git history.

## License

MIT. Free and open for anyone to use, change and share. See [LICENSE](LICENSE). The app icons
are drawn in code by `scripts/make-icons.mjs`, and the sample slides and sounds are made in code
when you load the sample.
