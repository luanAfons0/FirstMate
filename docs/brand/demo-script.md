# The twenty-second demo

The recording that sits after the first paragraph of the README. One take, no
cuts, no narration, no mouse wandering. Record it again whenever the Host
changes what it prints or what the Index Page looks like.

A GIF, not a video. A GIF plays wherever the README is rendered. An uploaded
video plays on github.com alone, and is blank on npm and on every mirror.

## What it has to show

Five things, in this order, and nothing else:

1. **A Plugin is a directory.** One command names it. Nothing is copied.
2. **The Host picks it up** on a restart.
3. **The Tray opens it from Windows**, in one click.
4. **The Index Page** lists the Plugin and says `Running`.
5. **A Plugin Page is a whole page**, and it calls its own tools.

## Before you record

Get a real `firstmate` command. Until the package is on npm, install the
tarball, which behaves exactly as the published one will:

```sh
cd ~/.first-mate
npm pack --pack-destination /tmp
npm install -g /tmp/firstmate-1.0.0.tgz
firstmate --help          # proves it is on PATH
```

Then:

- A terminal at about 90 columns, nothing else on screen.
- The Windows browser open on a blank tab, and the Tray running.
- The demo Plugin at `~/firstmate-demo/notes`. It ships a `web/` directory and
  an executable `mcp`, so it reaches `Running` and answers one tool.
- The Host running as its service, against the real `~/.firstmate`. The Tray
  reads the runtime file from there, so a throwaway `FIRSTMATE_HOME` would
  leave the Tray with nothing to open.

## The take

| Seconds | What is on screen |
| ------- | ----------------- |
| 0–2   | `firstmate list` — one Plugin, `nexus`. A Registry already exists. |
| 2–5   | `firstmate add notes ~/firstmate-demo/notes` — it answers `added notes` and `restart the Host to pick it up`. |
| 5–8   | `systemctl --user restart firstmate` — silent, as a service should be. |
| 8–11  | Click the Tray icon in the Windows notification area. |
| 11–14 | The Index Page opens. `notes` is there, `Running`, beside `nexus`. |
| 14–17 | Click `notes`. Its Plugin Page fills the window: its own page, no chrome around it. |
| 17–20 | Click **Ask my own tools**. The answer appears. End. |

## The token

Do not read the token out and do not type it. The Tray carries it for you, and
the Host answers the first navigation with a cookie and redirects to the plain
address, so the address bar settles without it.

One frame may still catch it. A token is minted at every Host start and is
worthless after the next one, so end the session with:

```sh
systemctl --user restart firstmate
```

## Afterwards

Take the demo Plugin back out. It was a prop:

```sh
firstmate remove notes
systemctl --user restart firstmate
```

Save the recording as `docs/brand/demo.gif`: silent, about 1280 px wide, about
twenty seconds, under 10 MB. Then replace the demo slot in `README.md` with:

```md
![Registering a Plugin and opening its Plugin Page](docs/brand/demo.gif)
```
