# The twenty-second demo

The recording that sits after the first paragraph of the README. One take, no
cuts, no narration. Record it again whenever the Host changes what it prints or
what the Index Page looks like.

A GIF, not a video. A GIF plays wherever the README is rendered. An uploaded
video plays on github.com alone, and is blank on npm and on every mirror.

## Before you record

- A terminal, nothing else on screen, at about 90 columns.
- Two Plugin directories ready, one with a `web/` directory and an `mcp` file.
- An empty `FIRSTMATE_HOME`, so the Registry starts empty and the run is
  reproducible.
- The browser open on a blank tab, beside the terminal or behind it.

## The take

| Seconds | What is on screen |
| ------- | ----------------- |
| 0–3     | An empty terminal. Type `npx firstmate add notes ~/plugins/notes`. |
| 3–5     | It answers `added notes` and `restart the Host to pick it up`. |
| 5–8     | Type `npx firstmate start`. |
| 8–11    | The Host answers with its address, carrying the token. |
| 11–14   | Open that address. The Index Page lists `notes`, `Running`. |
| 14–17   | Click the Plugin. Its Plugin Page fills the window, its own page, no chrome around it. |
| 17–20   | Hold on the Plugin Page. End. |

## What it has to show

Three things, in this order, and nothing else:

1. **A Plugin is a directory.** One command names it, and nothing is copied.
2. **One command runs the Host.** No configuration file, no build step.
3. **A Plugin Page is a whole page.** The Host links to it and the browser goes
   there (ADR-0008).

## Afterwards

Save it as `docs/brand/demo.gif`, under 4 MB so GitHub serves it inline, and
replace the demo slot in `README.md` with:

```md
![Registering a Plugin and opening its Plugin Page](docs/brand/demo.gif)
```

Never record a real token. Use a throwaway `FIRSTMATE_HOME`; the token is
minted per start and is worthless afterwards, but a token on screen teaches the
wrong habit.
