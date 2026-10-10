<p align="center">
  <img src="docs/brand/firstmate-mark-512.png" alt="" width="120">
</p>

# FirstMate

[![Check](https://github.com/luanAfons0/FirstMate/actions/workflows/check.yml/badge.svg)](https://github.com/luanAfons0/FirstMate/actions/workflows/check.yml)
[![Licence: MIT](https://img.shields.io/badge/licence-MIT-blue)](LICENSE.md)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2024-5FA04E)](https://nodejs.org)

FirstMate is a local plugin host. It runs a person's own tools on their own
machine and gives each one a process, a page and an address, so that no tool has
to build a runtime of its own.

![Setting FirstMate up, switching Plugins in the App, and adding an Entry from a Shortcut's Popup](https://raw.githubusercontent.com/luanAfons0/FirstMate/main/docs/brand/demo.gif)

## Install it

FirstMate is an App for Windows and Linux: one program that holds the Host, the
Tray and the window. Install it with the command line, on Windows, inside WSL,
or on Linux:

```sh
npx @luan-afonso/firstmate desktop
```

`desktop` downloads the App of its own version from the GitHub Release, checks
its SHA-256, installs it for you alone with no administrator, and opens it
([The App](#the-app)). On Linux it installs the AppImage; to install the deb
instead, see [The App on Linux](#the-app-on-linux). The npm package is the command line and
nothing more: it holds no Host
([ADR-0024](docs/adr/0024-the-npm-package-is-the-command-line-only.md)). To keep
the command around:

```sh
npm install -g @luan-afonso/firstmate
firstmate desktop
```

To work on FirstMate itself, see [Work on FirstMate](#work-on-firstmate).

Coming from 1.x? See [Moving from 1.x](#moving-from-1x) and the
[2.0.0 release notes](docs/releases/2.0.0.md).

## Set it up

```sh
firstmate setup
```

`setup` asks a few questions in the terminal and does what you answer, with the
same code the plain commands use, so every step is also a command of its own.
It asks, in order:

1. **The Shelf** of this machine's Place. Enter keeps the one in force. A path
   it refuses is refused in the words `firstmate shelf` uses, and the question
   comes again.
2. **Places.** On Windows, where a `wsl` Place can run, it shows the Places and
   asks for WSL distributions to add as Places, one after another, until Enter. A
   distribution's Place is named after it, as `debian` for `Debian`.
3. **The import.** For each `wsl` Place that holds a 1.x install and no Plugin
   yet, it asks whether to bring it across, as `firstmate import` does.
4. **The [Official Plugins](#official-plugins)**, each with one line about it.
   It fetches the ones you choose by number: `1 3` or `1, 3`, and Enter for
   none. Each goes into a Place it runs in: the only one, or the one you pick.
   One already in the Registry is marked installed and is not offered, one with
   no Place to run in is not fetched and `setup` says why, and a clone that
   fails names the Plugin and the others are still fetched.
5. **Grants**, for each installed Official Plugin that calls others, such as
   `scheduler`. Every other Plugin is on the list; a Grant already given is
   shown and not offered. `setup` gives Grants and never takes one back.
6. **Shortcuts**, one after another: the keys, the Plugin by number, and the
   path, where `/` is the Plugin Page. Enter at the keys ends the step.
7. **Start at logon**, where the App is installed and does not start at logon
   yet. It is off until you say yes. Where the App is not installed, `setup`
   says to run `firstmate desktop`. On Windows the entry is the Run value
   `FirstMate`. On Linux it is the autostart entry
   `$XDG_CONFIG_HOME/autostart/firstmate.desktop` (`~/.config` when the
   variable is unset), which starts `~/Applications/FirstMate.AppImage` with
   `--at-logon`. The App's Tray and Settings View write the same entry.

When a Host runs and this run changed something, `setup` asks it to reload, as
every plain command does, and asks you nothing.

Each answer is written when it is given, so Ctrl-C keeps the steps that
finished. `setup` never removes anything, so it is safe to run again. A script
can pipe the answers in, one per line; when the input ends before every
question is answered, `setup` stops with "setup ended before it had every
answer" and exits non-zero. A step that fails, such as one clone, lets the
others go on, and `setup` then exits non-zero too. At the end it says what it
changed, and nothing when nothing changed.

## Where it runs

Evidence, not a promise. "Proved" means someone has run it.

| Platform        | App         | Host          | Plugin Server                        | Command line |
| --------------- | ----------- | ------------- | ------------------------------------ | ------------ |
| Windows         | proved      | proved        | proved, from `mcp.ts`, `mcp.cmd` or `mcp.exe` | proved |
| WSL, as a Place | —           | —             | proved, through `wsl.exe`            | proved       |
| Linux, native   | proved by CI | proved by CI | proved by CI                         | proved by CI |
| macOS           | not built   | should work, untried | should work, untried          | should work, untried |

**The App runs on Windows and Linux** (ADR-0026). A Plugin in a `wsl` Place keeps its
`mcp` file and runs inside its distribution (ADR-0021). Anywhere else a
Plugin Server can be one `mcp.ts` or `mcp.js`, which the Host runs with its own
Node (ADR-0028). On Windows a Plugin Server can also start from `mcp.cmd` or
`mcp.exe`, because Windows reads no shebang (ADR-0019). The Host runs on plain Node anywhere, which is how the tests
run it; only the App, the Tray and the window are Electron programs, for Windows and
Linux.

A Plugin is a directory and nothing more. Put a `web/` folder in it and the Host
serves it as a Plugin Page. Put an `mcp.ts` in it, or an executable named
`mcp`, and the Host starts that Plugin Server. A directory with neither is still a Plugin; it just
has nothing to show.

The words this project uses are defined in [`CONTEXT.md`](CONTEXT.md). The
decisions that are expensive to reverse are in [`docs/adr/`](docs/adr).

## What a Plugin is

A directory, named in the Registry. There is no manifest and no schema.

| In the directory   | What the Host does with it                                  |
| ------------------ | ----------------------------------------------------------- |
| `web/`             | Serves it at `/p/<name>/`, byte for byte.                   |
| `mcp.ts`, `mcp.js` | Runs it with the Host's own Node, and speaks MCP to it over stdin and stdout. |
| `mcp` (executable) | The same, run by its shebang, when there is no `mcp.ts` or `mcp.js`. |
| `mcp.exe`, `mcp.cmd` | The same, on Windows, where `mcp` is not run.             |

The Host starts the first of these it finds: `mcp.ts`, then `mcp.js`, then
`mcp` on Linux, or `mcp.exe` and then `mcp.cmd` on Windows (ADR-0028). A Node
file is started as `FIRSTMATE_NODE`, the Node that runs the Host, with the file
as its one argument and no shell, so one `mcp.ts` runs on Linux and on
Windows and needs no Node of its own. Under the App that Node is the App itself, and it
strips TypeScript's types. The shebang of `mcp` decides its language, so a
Plugin Server can still be written in anything. Windows reads no shebang, so
there the Host runs `mcp.exe`, or else `mcp.cmd` (ADR-0019). Every Plugin
Server receives `FIRSTMATE_NODE`, and its output goes
to the Host's own output and its log: `firstmate logs` prints it (ADR-0022).

A Plugin is in one of three states, and the Index Page shows which:

| State              | What it means                                              |
| ------------------ | ---------------------------------------------------------- |
| `Running`          | The Plugin Server is up and answered the MCP handshake.     |
| `Stopped`          | The Plugin Server exited, or could not be run at all.       |
| `no Plugin Server` | The Plugin ships no Plugin Server file of any form. This is allowed. |

The Host never starts a Stopped Plugin again, so a broken Plugin stays visible
instead of spinning in a restart loop. A Stopped Plugin still serves its Plugin
Page.

Writing one? [`docs/plugin-guide.md`](docs/plugin-guide.md) states the whole
contract: what the Host enforces, and what it only advises. It advises a Node
24 Plugin with an `mcp.ts`, which brings everything it needs.

## Add a Plugin

```sh
firstmate add <name> /absolute/path/to/the/directory
firstmate install /absolute/path/to/the/directory [name]
firstmate install https://example.com/someone/a-plugin.git [name]
firstmate install worklog [name]
firstmate update <name>
firstmate remove <name>
firstmate list
firstmate grant <from> <to>
firstmate revoke <from> <to>
firstmate order [<name> <position>]
```

`add` and `install` take `--place <name>` to put the Plugin in a Place other
than the default one. See [Places](#places).

`install` is `add` for a Plugin you do not have yet. A directory is copied and
a git URL is cloned; either way the files land in the Shelf and `install`
registers what it put there, under the last segment of the source, without its
`.git` suffix, or under the name you give. It runs nothing the Plugin ships —
the Plugin's own executable runs later, when the Host starts it. It refuses a
name already in the Registry and a directory already in the Shelf, and a fetch
that fails leaves the Registry untouched and the Shelf clean. Cloning needs the
`git` binary; nothing else does.

Adding neither copies nor symlinks the directory: the Registry holds the path,
so a Plugin stays in its own repository wherever it already lives. `grant` lets
`<from>` call `<to>`'s tools; a Grant is one way, so it does not let `<to>` call
`<from>`. `revoke` takes that Grant back. Both refuse a Plugin Name that is not
registered. The Host enforces a Grant on every Tool Bus call.

Every command that changes the Registry or the settings asks the running Host
to reload, so you never restart FirstMate by hand. A reload starts the Plugins
that were added, stops the ones that were removed, takes the new Grants, and
leaves every other Plugin Server alone. It never starts a Stopped Plugin again.
With no Host running, the command writes the files and says nothing more.

### Update a Plugin

```sh
firstmate update <name>
```

A Plugin's version is its commit, so `update` updates a Plugin that is a git
clone: one you installed from a git URL, or an Official Plugin you installed
by name ([ADR-0030](docs/adr/0030-update-moves-a-git-clone-forward.md)). It
fetches the clone's upstream and moves its branch forward, with no merge, then
restarts the Plugin Server through the running Host. It says
`updated <name> from <commit> to <commit>`, then what `restart` says. A Plugin
with no Plugin Server is not restarted: the Host serves its Plugin Page from
disk, so the page has changed already, and `update` says so with or without
a Host. With no Host running, the update is done, and a Plugin Server's new
code starts with the Host. When there is nothing to fetch,
or the clone is ahead with commits of your own, it says nothing and restarts
nothing.

The files git ignores, where a Plugin keeps its data, stay as they are, and
nothing the Plugin ships runs: git runs with hooks, fsmonitor and the `ext::`
transport off, and never asks on the terminal. `update` refuses in one sentence, with
exit code `3`, and changes nothing, when the directory is not a git clone of
its own, when it has local changes to tracked files, when it is at a detached
HEAD or its branch has no upstream, when the branch has diverged from its
upstream, and when the new commit would overwrite an untracked or ignored
file. Each refusal says what to do. A refusal after the fetch leaves the
branch and the files as they were; only the remote-tracking branch has moved. git not
on the PATH, or a fetch that fails, ends with exit code `1` and git's reason.
In a `wsl` Place git runs inside the distribution (see [Places](#places)), and
git not installed there ends with exit code `1` too.

A copied Plugin, one installed from a directory or registered with `add`, is
not a clone of its own, and `update` never copies over it: that would risk its
data. Update it by hand: move its data out, run `firstmate remove <name>`,
then `firstmate install` it again, and put its data back. A Plugin you
registered with `add` inside your own repository is yours to pull.

`firstmate update` updates Plugins only. The App updates itself
([The App](#the-app)), and the command line updates with npm.

### Official Plugins

The FirstMate project writes a few Plugins of its own, and FirstMate knows
where they are, so `install` takes their Plugin Name in place of a source
(ADR-0015):

| Official Plugin | What it does                                                 |
| --------------- | ------------------------------------------------------------ |
| `worklog`       | Keeps what you work on from one Meeting to the next.          |
| `scheduler`     | Calls one tool of another Plugin at a time you choose.        |
| `nexus`         | Manages the skills and global instructions of Claude and Codex. |

`install` reads a source as a git URL, then as an absolute directory, then as
the name of an Official Plugin. An Official Plugin is cloned from
`https://github.com/luanAfons0/<name>` and is then a Plugin like any other.
`scheduler` calls other Plugins, so it needs a Grant for each one it calls.

A Tool Bus call may carry a `timeoutMs` saying how long it is allowed to take.
Without one it gets thirty seconds, and `FIRSTMATE_MAX_CALL_MS` is the ceiling:
a call that asks for more is quietly given the ceiling rather than refused. A
Plugin Page's own call is not a Tool Bus call and keeps its thirty seconds.

## Places

A Place is where Plugins are installed and their Plugin Servers run
([ADR-0021](docs/adr/0021-plugins-live-in-places.md)). The default Place is this
machine: `windows` on Windows, `local` anywhere else. It is always there, and
`add`, `install` and `shelf` act in it unless `--place` names another.

```sh
firstmate place                       # every Place, its kind and its Shelf
firstmate place add <name> <kind>     # add a Place
firstmate place remove <name>         # take an empty Place away
```

A `local` Place runs its Plugin Servers on this machine. A `wsl` Place, which only Windows can hold and any other system refuses, is one
WSL distribution, and its Plugins keep their `mcp` file as it is:

```sh
firstmate place add debian wsl Debian [windows-path]
firstmate add worklog /home/me/.worklog --place debian
```

The Host starts a `wsl` Plugin as `wsl.exe -d <distribution> --cd <directory>
-- ./mcp`, and reads its files, its Plugin Page among them, through
`\\wsl.localhost\<distribution>` or the Windows path you gave. Its paths are the
distribution's own. A Plugin whose distribution is missing or will not start is
Stopped with one sentence, and nothing retries it. Its default Shelf is
`~/.firstmate/shelf` inside the distribution, and `install` makes the fetched
`mcp` executable there again. `update` runs git inside the distribution, as
`wsl.exe -d <distribution> --cd <directory> --exec env … git …`, with the same
steps, refusals and restart as in a `local` Place, so the distribution needs
git of its own. `FIRSTMATE_NODE` is not handed across, because it
names a Windows program, so a `wsl` Place starts `mcp` only: a Plugin there
with `mcp.ts` and no `mcp` is Stopped, with one sentence that says so
(ADR-0028).

Each Place has its own Shelf: the default Place's is the Shelf below, and any other's is
`shelves/<name>` in the home directory until you move it with
`shelf <directory> --place <name>`. A Plugin Name is used once across every
Place, so `/p/<name>/` is the same address wherever the Plugin runs. A Place
that holds a Plugin is not removed, and removing one touches nothing on disk.

### Moving from 1.x

```sh
firstmate place add debian wsl Debian
firstmate import debian
```

`import` reads the 1.x Registry and settings from `~/.firstmate` in that
distribution and brings across every Plugin, its Grants, the Shortcuts, the
Plugin Order and the Shelf. Each Plugin stays where its directory already is,
in the `wsl` Place. A Plugin Name already in use is refused in one sentence, and
the rest still come. When the 1.x Host runs there as a systemd service, `import`
asks before it turns the service off, because the 1.x Host holds the port the
App listens on.

Each Plugin in `registry.json` names its Place. A row with no `place`, as 1.x
wrote it, is in the default Place.

## Ask the running Host

```sh
firstmate status
firstmate status --json
firstmate restart <name>
```

`status` says whether the Host runs, and the state of each Plugin in the Plugin
Order: Running, Stopped, or no Plugin Server. It asks the running Host itself,
over loopback, with the port and the token from `runtime.json`, as the App
does. With no Host it says `no Host runs.` and ends with exit code `6`. A
`runtime.json` that a crashed Host left behind names a port nothing answers on,
and that reads as no Host too.

`restart` stops one Plugin's Plugin Server, Stopped or not, and starts it
again, after you fix it. The Host never does this by itself: a broken Plugin
stays Stopped until you say so. It says `restarted <name>. It is Running.`, or
that the Plugin is Stopped and why, which ends with exit code `1`. An unknown
Plugin Name is refused with exit code `4`, and with no Host it says `no Host
runs.` and ends with exit code `6`.

`status`, `list`, `order` and `shelf` say what they read as one JSON value with
`--json`, and print nothing else, so a script can read them. A command that
changes something prints no JSON, and refuses `--json` as typed wrong.

## Read the log

```sh
firstmate logs      # what the Host and its Plugin Servers said
firstmate logs -f   # and keep printing new lines
```

The Host keeps its output, and every Plugin Server's stderr with it, in
`firstmate.log` in its home directory
([ADR-0022](docs/adr/0022-the-host-keeps-one-log.md)). The file never grows past
two megabytes: the older half is kept as `firstmate.log.old`, and `logs` prints
it first. The token never reaches either file.

## Help and exit codes

```sh
firstmate --help
firstmate <command> --help
firstmate help <topic>
firstmate --version
```

`firstmate --help`, or `firstmate` with no words, prints one screen: every
command in its group, with a few words each. With no words it ends with exit
code `2`, because nothing was asked.

`--help` or `-h` after any command says how that command is typed and what
its words mean, and does nothing else. `firstmate help <command>` says the
same. A command typed wrong says what is wrong, then shows that same help.

A word that is no command is refused in one line. When it is within two edits
of a command's name, the line guesses that name: `firstmate: no such command:
lsit. Did you mean list?` It runs nothing, and ends with `2`.

`firstmate --version`, or `-v`, prints `firstmate <version>`, the version of
the package, and ends with `0`. The short help names it on its last line but
one.

`firstmate help` lists the help topics, and `firstmate help <topic>` says one:

| Topic         | What it says                                                    |
| ------------- | --------------------------------------------------------------- |
| `exit-codes`  | What each exit code means, as in the table below.              |
| `environment` | The variables the command line reads, and their defaults.      |
| `places`      | What a Place is, the default Place, and how to add a wsl Place. |

Every command ends with one of these exit codes, so a script can tell one
refusal from another without reading the sentence:

| Code | What it means                                                         |
| ---- | --------------------------------------------------------------------- |
| `0`  | It did what it was asked.                                             |
| `1`  | It failed: a damaged file, a fetch that went wrong, or a fault.       |
| `2`  | It was typed wrong: no such command, or the wrong words for it.       |
| `3`  | It refused a value that is not what it must be: a Plugin Name, a path, keys, a position. |
| `4`  | It refused a Plugin or a Shortcut that is not there.                  |
| `5`  | It refused a name, keys or a directory that is taken already.         |
| `6`  | It needs a running Host, and none answers.                            |

## The App

FirstMate 2.0 is an App: one program, for Windows and for Linux, that holds the
Host and shows the Index Page in its window (ADR-0020, ADR-0026). Each release
carries the Windows installer, `FirstMate-Setup-<version>.exe`, the Linux
files [The App on Linux](#the-app-on-linux) names, and each file's SHA-256 on the
[GitHub Release](https://github.com/luanAfons0/FirstMate/releases) of its tag,
with the same version as the command line on npm (ADR-0023). Install it from a
terminal on Windows, or inside WSL:

```sh
npx @luan-afonso/firstmate desktop
```

`firstmate desktop` downloads the installer of its own version and its
checksum, and refuses an installer whose SHA-256 does not match: it says so in
one sentence and runs nothing. Then it installs the App silently, for you
alone, with no administrator, and opens it. When that version is installed
already, or a newer one the App updated itself to, it only opens it. It
downloads when you run it, never when the package is installed. From WSL it
saves the installer in the Windows temp folder and runs it, and the App,
through WSL's interop with Windows. It reads which version is installed where
the installer records it for Windows: the App's uninstall key in `HKCU`. On
Linux it installs the AppImage instead, as
[The App on Linux](#the-app-on-linux) says. `FIRSTMATE_RELEASES_URL` moves
where it downloads from.

To build it yourself from a clone, on Windows, see
[Work on FirstMate](#work-on-firstmate). Both the installer and the App it
holds are unsigned, so Windows may warn before they run. How the App will be
signed is in [Code signing policy](#code-signing-policy).

To try a change to the App before it is released, you need no clone on
Windows: the Windows check of every pull request keeps the installer it built,
as the artifact `FirstMate-Setup`, for 14 days. Download it and run it, from
the run's page or from a terminal:

```sh
gh run download <run-id> --name FirstMate-Setup
```

It installs over the App you have, keeps your settings, and is replaced by the
next release when the App updates itself.

The App's Host is the one the App runs in its own process: the same home, `%APPDATA%\FirstMate` unless
`FIRSTMATE_HOME` moves it, the same port and the same runtime file, so the
command line reaches it as it reaches any other. Only one App runs for one
home; a second start shows the first window. When another program holds the
port, the App says so and does not start. Closing the window hides it: the
App and every Plugin keep running, and the Tray brings the window back. Quit,
in the Tray's menu, ends the App and stops every Plugin Server. Each Plugin
Server runs on the App's own executable as Node, so a Node Plugin needs no Node
of its own.

The strip at the top of the window is its title bar, on Windows and Linux: the
window's own buttons sit at its right end, in its colours, light or dark as
the system is. It holds FirstMate, which goes to the Plugin list; then what is
open, which opens the switcher with every Plugin in the Plugin Order; the space
you drag the window by; "N Stopped" when any Plugin is Stopped, which opens the
switcher too; and the gear, which opens the Settings View. In the switcher,
type to filter the Plugins, use the arrows to move, Enter to open and Esc to
close. A Stopped Plugin has a Restart button there, which starts its Plugin
Server again as `firstmate restart` does. Each Plugin Page you open has a view of its own and stays
loaded until the App quits, so switching to another Plugin and back loses
nothing. A link that leaves FirstMate opens in your browser.

The Settings View has a side list of its sections, Places, Plugin Order, Start
at logon, Shortcuts and Plugin Settings, and says the App's version under it. Places shows each Place with
its kind and its Shelf. There you move a Place's Shelf: type a path, or choose
a folder for a Place on this machine. You remove a Place that holds no Plugin;
the Place of this machine is always there. On Windows, Add a Place opens in
the page and adds a `wsl` Place by its distribution. Plugin Order shows each
Plugin with its position and its state; drag a row, press Alt+↑ or Alt+↓, or
use its up and down buttons, and it moves as `firstmate order` moves it. The
rows then show the order the Host gives back, and a refused move leaves them
where they were. Start at logon is one switch. Each change runs the same check
as `firstmate place`, `firstmate shelf` and `firstmate order`, and is refused
in the same sentence: the line at the top of
the view, which stays in view as you scroll, says Working…, then what was done
or why it was refused, and a refused field is marked with that sentence under
it. What you typed stays, so you can correct it. The App then has the Host
read its settings again. The Host never serves the Settings View, so no Plugin
Page can reach it. Shortcuts, Plugins and Grants change from a terminal.

Plugin Settings lists every Plugin in the Plugin Order, with its state. A
Plugin with a Plugin Page has an Open settings button: it closes the Settings
View and opens `/p/<name>/#settings` in that Plugin's own view, as the
switcher opens a Plugin Page, for a Stopped Plugin too. A Plugin that has
settings shows them there; one that has none shows its page as usual. A Plugin
with no Plugin Page says so, and has no button. Each Plugin keeps its own
settings in its own directory, and the App never reads or writes them
([ADR-0029](docs/adr/0029-a-plugins-settings-are-at-settings-of-its-plugin-page.md)).

The Tray is FirstMate's icon in the notification area. It wears the stopped
mark while any Plugin is Stopped. A click on it brings the window up, and its
menu opens the Index Page or any Plugin, restarts a Stopped one, opens the
**Settings…** view, turns **Start at logon** on and off, and quits. Start at logon is off until you turn it on; the App it starts
begins in the Tray, with the window put away.

A Notice shows as the system's own pop-up under FirstMate's name and mark, and
a click on it opens the sender's address in the window. Windows takes that
name from the installer's Start menu entry, so there the unpacked App's
Notices are filed under Electron.

The App holds every Shortcut you `bind`, and picks up a `bind` or `unbind` at
once. Pressing one opens its address in the Popup: a small window with no
frame, on top of the others. It hides when it loses focus, on Esc, on its own
Shortcut again, and when its page goes to any address other than its own.
Keys another program already holds are named in a Notice, never dropped in
silence.

The App updates itself. Five minutes after it starts, and every six hours
after, it looks at the GitHub Releases for a newer version and downloads it in
the background. When it is ready, one Notice says so, and it installs when you
quit FirstMate, never in the middle of work. A stable App follows stable
Releases; a beta follows the newest Release, beta or stable, so a beta tester
lands on the stable version and stays there (ADR-0023). An App you build and
run unpacked from a clone never updates. On Linux the AppImage updates itself
in the same way, and the deb does not: install the next deb as you installed
the first.

A Plugin Page may write to the clipboard, so its "copy" buttons work, but never
read it. It is refused every other permission, camera, location and
notifications among them, except the microphone and a capture of the screen or
a window with its sound. The first time a Plugin asks for one, the App asks you, naming the
Plugin, and keeps your answer under `permissions` in `settings.json`. To be
asked again, take that Plugin out of `permissions`. For a capture, the App
then asks which screen or window to give.

### The App on Linux

Each Release carries the App for Linux on x64 twice: as an AppImage,
`FirstMate-<version>.AppImage`, and as a deb, `firstmate_<version>_amd64.deb`,
each with its SHA-256 beside it (ADR-0023). `firstmate desktop` installs the
AppImage:

```sh
npx @luan-afonso/firstmate desktop
```

It downloads `FirstMate-<version>.AppImage` of its own version and its
checksum, refuses an AppImage whose SHA-256 does not match and runs nothing,
puts it at `~/Applications/FirstMate.AppImage`, makes it executable, and opens
it. When an AppImage of that version, or a newer one, is there already, it
only opens it, and an older one it replaces. The version is the one the
AppImage carries itself, which its runtime reads out of it without starting
the App, so an AppImage that updated itself counts as the version it is now.
A file there whose version cannot be read, put there by hand, is replaced.

To install by hand, download one from the
[GitHub Release](https://github.com/luanAfons0/FirstMate/releases), with its
`.sha256` file, and check it before you install it:

```sh
sha256sum --check firstmate_<version>_amd64.deb.sha256
```

The deb installs the App into `/opt/FirstMate`, puts `firstmate-app` on the path,
and loads an AppArmor profile that lets the App use the Chromium sandbox on
Ubuntu 24.04 and later:

```sh
sudo apt install ./firstmate_<version>_amd64.deb
```

The AppImage is one file that updates itself. Keep it at
`~/Applications/FirstMate.AppImage`, which is where `firstmate setup` looks for
the App first, and make it executable, as `firstmate desktop` does. With no
AppImage there, `setup` finds the deb's program by the desktop entry the deb
installs:

```sh
mkdir -p ~/Applications
mv FirstMate-<version>.AppImage ~/Applications/FirstMate.AppImage
chmod +x ~/Applications/FirstMate.AppImage
```

On Ubuntu 24.04 and later, AppArmor stops an unknown program from making a user
namespace, which the Chromium sandbox needs. The AppImage still starts: its
`AppRun` tries a user namespace first and, refused, starts the App with
`--no-sandbox`. To keep the sandbox, give the AppImage a profile, once, as root.
A profile is matched by the path of the program that runs, and an AppImage
runs from a new mount at each start, `/tmp/.mount_FirstM` and six random
characters, named after the first six letters of `FirstMate.AppImage`. So the
profile names `AppRun` and the App inside any such mount, and the namespace
`AppRun` tries is then allowed too:

```sh
sudo tee /etc/apparmor.d/firstmate-appimage > /dev/null <<'PROFILE'
abi <abi/4.0>,
include <tunables/global>

profile firstmate-appimage /tmp/.mount_FirstM*/{AppRun,firstmate-app} flags=(unconfined) {
  userns,
  include if exists <local/firstmate-appimage>
}
PROFILE
sudo apparmor_parser --replace /etc/apparmor.d/firstmate-appimage
```

With `TMPDIR` set, the mount is under that folder instead of `/tmp`; write that
folder in the profile. The profile allows any program in such a mount, so keep
no other AppImage whose name starts with `FirstM`. The deb needs none of this:
its program has one place, and the deb loads the profile for it.

Other things differ from Windows:

- **The Tray** is an AppIndicator. GNOME shows none without the AppIndicator
  extension: Ubuntu turns it on, and elsewhere it is the package
  `gnome-shell-extension-appindicator`. Without it the App still runs, and a
  second start of the App shows its window.
- **A capture** of a screen or a window is the picture alone. Its sound, the
  loopback audio, is on Windows only.

## Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io),
certificate by [SignPath Foundation](https://signpath.org).

The Windows App will be signed by SignPath Foundation, on SignPath's own
hardware. No signing key is in this repository or in a GitHub secret. The
release workflow builds the App from the source on GitHub, in public CI, for a
tag, and asks SignPath for a signature. Each request is signed only after an
approver approves it on SignPath's site. Every `.exe` and `.dll` of the App is
signed, apart from the two Electron ships signed by Microsoft, then the
installer that holds them. The AppImage and the deb are not
signed. Windows names "SignPath Foundation" as the signer
([ADR-0027](docs/adr/0027-the-app-is-signed-by-signpath-foundation.md)).

Signing is not on yet. Until SignPath accepts FirstMate, the betas ship
unsigned, as [The App](#the-app) says.

### The team

| Role | Who | What they do |
| --- | --- | --- |
| Committers and reviewers | Luan Afonso ([@luanAfons0](https://github.com/luanAfons0)) | Change the source on `main`, and review every pull request from anyone else before it is merged. |
| Approvers | Luan Afonso ([@luanAfons0](https://github.com/luanAfons0)) | Approve each signing request on SignPath, for a release they trust. |

Every team member uses multi-factor authentication on GitHub and on SignPath.

### Privacy

This program will not transfer any information to other networked systems
unless specifically requested by the user or the person installing or
operating it. There are two exceptions, and they are part of what you install:

- **The App's updates.** Five minutes after the App starts, and every six
  hours after, electron-updater asks the
  [GitHub Release](https://github.com/luanAfons0/FirstMate/releases) of
  `luanAfons0/FirstMate` for a newer version, and downloads it from there. The
  App sends nothing else with that request. An App you run unpacked from a
  clone, and the deb, never ask.
- **The spell checker, on Linux.** Electron checks the spelling of what you
  type in a page. On Linux it downloads the dictionary for your language from
  Google's servers the first time it needs one. On Windows it uses the
  spell checker of Windows, which downloads nothing.

What the command line sends, it sends when you run a command:

- `firstmate desktop` downloads the App and its checksum from the same GitHub
  Release, or from `FIRSTMATE_RELEASES_URL`.
- `firstmate install` clones a Plugin with `git` from the address you give, or
  from the address of the Official Plugin you name.
- `firstmate update` fetches a Plugin's clone from its upstream, the address
  it was cloned from.
- `npx` and `npm` download the command line from npm.

Nothing else leaves the machine. FirstMate has no telemetry, no crash reports
and no account. The Host listens on `127.0.0.1` alone. GitHub and npm see
each request as any web server does, under the
[GitHub General Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

A Plugin is not FirstMate. Its Plugin Page and its Plugin Server may reach the
network, and FirstMate does not look at what they send. Read the privacy
policy of each Plugin you add.

### What the App changes, and how to remove it

On Windows, the installer installs the App for you alone, with no
administrator: the App in `%LOCALAPPDATA%\Programs\FirstMate`, a Start menu
entry, a desktop shortcut, and the App's uninstall key in `HKCU`. The Host
keeps its files in `%APPDATA%\FirstMate`. Start at logon writes the Run value
`FirstMate` in `HKCU`, and only when you turn it on.

To remove the App on Windows, first turn **Start at logon** off in the Tray.
Then open Windows Settings, go to Apps, and uninstall FirstMate. The
uninstall keeps `%APPDATA%\FirstMate`, with the Registry, the settings and
every Grant; delete that folder to remove them too.

On Linux, the AppImage is one file, `~/Applications/FirstMate.AppImage`. The
deb installs the App into `/opt/FirstMate`, puts `firstmate-app` on the path,
and loads an AppArmor profile. Start at logon writes
`~/.config/autostart/firstmate.desktop`, and only when you turn it on. The
Host keeps its files in `~/.firstmate`.

To remove the App on Linux, turn **Start at logon** off, then delete the
AppImage, or remove the deb:

```sh
sudo apt remove firstmate
```

Delete `~/.firstmate` to remove the Registry, the settings and every Grant
too. Remove the command line with `npm uninstall -g @luan-afonso/firstmate`.

## Configure it

| Variable                | Default        | What it moves                                     |
| ----------------------- | -------------- | ------------------------------------------------- |
| `FIRSTMATE_HOME`        | `~/.firstmate`, or `%APPDATA%\FirstMate` on Windows | Where the Registry, the runtime file and the settings live. |
| `FIRSTMATE_PORT`        | `4747`         | The port. Zero asks the system for a free one.    |
| `FIRSTMATE_HANDSHAKE_MS`| `10000`        | How long a Plugin Server has to answer the handshake. |
| `FIRSTMATE_MAX_CALL_MS` | `600000`       | The longest a Tool Bus call may ask the Host to wait. |
| `FIRSTMATE_NOTICE_MS`   | `60000`        | How long the Host holds a Notice for `/notices.json`. |
| `FIRSTMATE_SHELF`       | `$FIRSTMATE_HOME/shelf` | The Shelf: where a fetched Plugin lands. With the default home, `~/.firstmate/shelf`, or `%APPDATA%\FirstMate\shelf` on Windows. |
| `FIRSTMATE_RELEASES_URL`| `https://github.com/luanAfons0/FirstMate/releases/download` | Where `firstmate desktop` downloads the App from: `<url>/v<version>/FirstMate-Setup-<version>.exe`, or `FirstMate-<version>.AppImage` on Linux, and its `.sha256`. |

A `_MS` variable is a whole number of milliseconds, from 1 to 2147483647 (about
24 days, the longest wait a Node timer holds). The Host refuses to start on any
other value, and says which.

## The Shelf

The Shelf is the directory a fetched Plugin lands in. Each Place has its own,
and this section is about the default Place's; `--place <name>` says or moves
another's. Say where it is, or move it:

```sh
firstmate shelf                      # where a fetched Plugin lands
firstmate shelf /absolute/directory  # move it, and remember it
```

The directory has to be there already, and it may not be, hold, or lead to the
Host's home directory, because a fetched Plugin must never be written over the
Registry and the runtime file. What is remembered is the real path, so what you
read back is what FirstMate uses.

The choice is kept in `settings.json` and survives a restart. `FIRSTMATE_SHELF`
beats it, for a test, a script, or a second FirstMate. The Index Page says nothing
of the Shelf: the Shelf is moved from a terminal or the App's Settings View and
from nowhere else, because no address on the Host changes it
([ADR-0012](docs/adr/0012-the-host-keeps-one-setting.md)). Nothing scans the
Shelf — a directory sitting there is not a Plugin until `add` or `install`
registers it.

## Shortcuts

A Shortcut is a key combination for the whole desktop, bound to one address of one
Plugin. The App holds it, and pressing it opens that address in a Popup: a
small window with no frame, on top of every other window.

```sh
firstmate bind Ctrl+Alt+N worklog new.html  # open /p/worklog/new.html
firstmate bind Ctrl+Alt+W worklog           # open the Plugin Page
firstmate unbind Ctrl+Alt+N
firstmate list                              # the Shortcuts follow the Plugins
```

The keys are one or more of `Ctrl`, `Alt`, `Shift` and `Win`, and one key: a
letter, a digit, `F1` to `F24`, or one of `Space`, `Enter`, `Tab`, `Backspace`,
`Insert`, `Delete`, `Home`, `End`, `PageUp`, `PageDown`, `Up`, `Down`, `Left`
and `Right`. Letter case and modifier order do not matter: `alt+ctrl+n` is
`Ctrl+Alt+N`, and that is how it is kept and shown. Keys with no modifier are
refused, so a plain letter is never taken away from every program.

`bind` refuses a Plugin that is not in the Registry, a path that is absolute or
leaves the Plugin's address, and keys already bound, naming the Plugin that
holds them. `unbind` of keys that are not bound fails. `remove` takes the
Plugin's Shortcuts with it and says which. The Shortcuts are kept in
`settings.json` beside the Shelf, and they are bound from a terminal and from
nowhere else: a Plugin Page cannot set one, because any Plugin could then take
a key of the whole desktop
([ADR-0013](docs/adr/0013-shortcuts-are-bound-from-a-terminal-and-held-by-the-tray.md)).

## The Plugin Order

Every list of Plugins shows them in the Plugin Order: the Index Page,
`/plugins.json`, the window's switcher and the Tray menu. You choose it.

```sh
firstmate order            # every Plugin, with its position
firstmate order worklog 1  # move worklog to the top
```

A position counts from 1 at the top, and the other Plugins keep their order. A
Plugin you never moved follows the ones you did, in the order it was added, so
a Plugin you add goes to the bottom. `order` refuses a Plugin that is not in the
Registry and a position outside the list. The order is kept in `settings.json`
under `order`, and the Host reads it on every request, so a new order shows
within a few seconds with no restart. `remove` takes the Plugin out of it, and
`list` keeps Registry order. The order changes from a terminal or from the
App's Settings View, which moves it through the same code in the App's own
process; no address on the Host changes it
([ADR-0016](docs/adr/0016-the-operator-chooses-the-plugin-order.md)).

## The home directory

- `registry.json` — the Registry: one row per Plugin, holding its Plugin Name,
  the absolute path of its directory, and its Grants.
- `runtime.json` — the port the Host listened on and the token it minted. It is
  rewritten at every start and removed when the Host stops.
- `settings.json` — the settings FirstMate remembers: the Shelf, the Places,
  the Shortcuts, the Plugin Order, and the App's permission answers. It is
  absent until you choose one of them.

## Addresses

| Address              | What it serves                                     |
| -------------------- | -------------------------------------------------- |
| `/`                  | The Index Page: every Plugin, its state. |
| `/plugins.json`      | The same list, for the App. Nothing is written.    |
| `/shortcuts.json`    | Every Shortcut and the address it opens, for the App. Nothing is written. |
| `/notices.json?after=<n>` | The Notices after `n`, for any reader. The App hears them with no poll. Nothing is written. |
| `/p/<name>/`         | That Plugin's `web/` directory, byte for byte.     |
| `POST /p/<name>/rpc` | That Plugin's tools. The body is an MCP request.   |
| `POST /reload`       | Read the Registry and the settings again. A terminal only. |
| `POST /restart/<name>` | Start that Plugin's Plugin Server again. A terminal only. |

A Plugin Page is a whole page: the Host links to it and the browser goes there,
rather than framing it under chrome of its own
([ADR-0008](docs/adr/0008-a-plugin-page-is-a-whole-page.md)).

`POST /reload` and `POST /restart/<name>` are the Host's own addresses, for the
command line. Every Plugin Page shares the Host's origin and holds its cookie,
so the Host answers them only
when the request carries no `Origin` and no `Sec-Fetch-Site`: what a browser
always sends and a terminal never does
([ADR-0018](docs/adr/0018-a-terminal-asks-the-host-to-reload.md)).

## Call a Plugin's tools

A Plugin Page calls its own tools with one ordinary request. There is no bridge
API to learn:

```js
const answer = await fetch('rpc', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
});
```

The Host forwards that body to the Plugin's Plugin Server and returns the
answer. A Plugin Page may reach only its own Plugin. From a terminal:

```sh
curl -X POST -H 'content-type: application/json'   -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'   "http://127.0.0.1:4747/p/<name>/rpc?token=<token>"
```

## Call another Plugin's tools

A Plugin Server calls another Plugin's tools over the pipe it already speaks
MCP on, and the Host carries the call only under a Grant
([ADR-0009](docs/adr/0009-the-tool-bus-runs-over-the-pipe-the-host-owns.md)).
One JSON-RPC request on its own stdout:

```json
{"jsonrpc":"2.0","id":1,"method":"firstmate/tools/call",
 "params":{"plugin":"other","name":"its-tool","arguments":{}}}
```

`firstmate/tools/list` takes `{"plugin":"other"}` and lists that Plugin's
tools. Both hand back the other Plugin's own answer, unchanged. No Plugin is
ever given the token or the port, because the Host owns the pipe and already
knows who is calling. A Plugin Page holds no end of that pipe and still reaches
its own Plugin and no other.

## Reach it

The Host mints a token when it starts and refuses every request that does not
carry it. The address it prints at startup carries the token once:

```
FirstMate: http://127.0.0.1:4747/?token=<token>
```

Open that address and the Host answers with a host-only `SameSite=Strict`
cookie and sends the browser to the same address without the parameter, so the
relative paths inside a Plugin Page are never disturbed. Every later request is
admitted on the cookie alone.

From a terminal, pass the token on every call:

```sh
curl "http://127.0.0.1:4747/p/<name>/?token=<token>"
```

The Host also refuses a request whose `Host` header it does not answer to, one
carrying an `Origin` that is not its own, one carrying the literal `Origin` of
`null`, and one a foreign site started. Each refusal is a 403 that says which
check it failed.

## Keep it running

The App keeps the Host running for as long as it runs, and it can start at
logon: turn that on from the Tray, or say yes when `setup` asks. Closing the
window keeps the App and every Plugin running; Quit ends them.

## The first Plugin

`~/.nexus` is FirstMate's first Plugin. The Host serves its `web/` directory as
a Plugin Page with every relative path unchanged, and starts its `mcp` file as
a Plugin Server. Nexus deleted its own listener, its Run File and its tray once
this replaced them, and keeps no copy of any of the three.

The migration is finished. What moved, and what it proved, is written down in
[`docs/nexus-migration.md`](docs/nexus-migration.md). What it taught the next
Plugin is in [`docs/plugin-guide.md`](docs/plugin-guide.md).

## Work on FirstMate

Everything here runs in a clone. In a clone, `node apps/cli/src/cli.ts` takes
the place of `firstmate` in every command above.

```sh
git clone https://github.com/luanAfons0/FirstMate.git
cd FirstMate
pnpm install
node packages/host/src/main.ts
```

The Host runs on plain Node 24 with no build step. It is the Host the App runs
in its own process, and how every test runs it. It listens on
`http://127.0.0.1:4747/` and on no other address, and the same environment
variables move it.

```sh
node --test
pnpm check
pnpm build
pnpm --filter @firstmate/desktop package
```

`node --test` boots a real Host against a temporary home directory and drives it
over HTTP, and no test imports a module of the Host.

`pnpm check` checks the types, lints with Biome, checks the layout with
Prettier, looks for dead code with knip, and runs every test. CI runs the same
command. `pnpm typecheck` checks the types alone.

`pnpm build` makes the bundle of `apps/cli` that goes to npm, by hand. The last
command packages the App for the system it runs on. On Windows it writes
`apps/desktop/dist/FirstMate-Setup-<version>.exe`, a one-click installer for you
alone that needs no administrator, and the same App, uninstalled, in
`apps/desktop/dist/win-unpacked/`. On Linux it writes
`apps/desktop/dist/FirstMate-<version>.AppImage` and
`apps/desktop/dist/firstmate_<version>_<arch>.deb`, and the same App, unpacked,
in `apps/desktop/dist/linux-unpacked/`.

The repository is a pnpm workspace: `packages/core` and `packages/host` are
private, and `apps/cli` is the package on npm. Node 24 runs TypeScript without a
build step, so a clone never holds built output and nothing here compiles.
Packing bundles `apps/cli`, with `core` and `host` inside it, on the way to npm
and nowhere else (ADR-0017). `pnpm build` makes the same bundle by hand.
`apps/desktop` is the App, and it is the one thing a clone builds: Electron
cannot run a clone's TypeScript. On Windows and on Linux, `node --test` packages
it and starts the packaged program, so the suite takes about a minute longer
there. On Linux the App needs a display, and the test skips on a machine with
none; CI gives it one with `xvfb-run`.
