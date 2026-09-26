# The twenty-second demo

The recording that sits after the first paragraph of the README. One take, no
cuts, no narration, no mouse wandering. Record it again whenever the Host
changes what it prints or what the Index Page looks like.

A GIF, not a video. A GIF plays wherever the README is rendered. An uploaded
video plays on github.com alone, and is blank on npm and on every mirror.

`docs/brand/demo.sh` types this script for you, so that a take never needs a
second screen: `check` before you record, `take` while you record, `reset` when
the recording is saved. The beats below stay the source. The script follows
them, and has to be changed with them.

## What it has to show

Five things, in this order, and nothing else:

1. **A Plugin is a directory.** One command names it. Nothing is copied.
2. **A Shortcut is bound from a terminal**, with one more command.
3. **The Host picks both up** on a restart.
4. **The Tray opens the FirstMate window** in one click, on the Index Page,
   which lists the Plugin and says `Running`.
5. **A Plugin Page is a whole page**, and it calls its own tools.

## Before you record

`docs/brand/demo.sh check` proves every line of this section in one go.

Get a real `firstmate` command. Install the tarball of this repository, which
behaves exactly as the published package does, so the take shows the code you
have:

```sh
cd ~/.first-mate
npm pack --pack-destination /tmp
npm install -g /tmp/luan-afonso-firstmate-<version>.tgz
firstmate --help          # proves it is on PATH
```

Then:

- A terminal at about 90 columns, nothing else on screen.
- Nothing else on the Windows desktop, and the Tray running in the
  notification area: `firstmate desktop`, from Windows, with its window
  closed. It picks the Shortcut up within a few seconds of `bind`.
- `Ctrl+Alt+D` free: no Shortcut of FirstMate's and no other program holds it.
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
| 5–8   | `firstmate bind Ctrl+Alt+D notes` — it answers `bound Ctrl+Alt+D to open /p/notes/`. |
| 8–11  | `systemctl --user restart firstmate` — silent, as a service should be. |
| 11–14 | Click the FirstMate icon in the Windows notification area. |
| 14–17 | The FirstMate window opens on the Index Page. `notes` is there, `Running`, beside `nexus`. |
| 17–20 | Click `notes`. Its Plugin Page fills the window under the narrow strip: its own page, never framed. |
| 20–23 | Click **Ask my own tools**. The answer appears. End. |

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

Take the demo Plugin back out. It was a prop. `remove` takes its Shortcut with
it. `docs/brand/demo.sh reset` runs both of these:

```sh
firstmate remove notes
systemctl --user restart firstmate
```

Save the recording as `docs/brand/demo.gif`: silent, about twenty seconds,
under 10 MB, and at the width you recorded at. Never upscale a screencast: the
terminal is most of the frame, and enlarged text is the one thing a viewer
reads as blurred. The GIF in the README is 1120 px for that reason. Then
replace the demo slot in `README.md` with:

```md
![Registering a Plugin and opening its Plugin Page](docs/brand/demo.gif)
```
