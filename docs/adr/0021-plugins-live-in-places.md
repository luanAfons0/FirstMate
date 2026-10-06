# Plugins live in Places

FirstMate 2.0 runs on Windows, and the Plugins people already have run in WSL. Moving every Plugin to Windows on the day of the release would break them all at once, and a Plugin's data is its own to move (ADR-0005). So a Plugin lives in a **Place**: a named location where Plugins are installed and their Plugin Servers run. The `windows` Place is this machine. A `wsl` Place is one WSL distribution, which 2.0 adds next. Each Plugin names its Place in the Registry, and each Place has its own Shelf. This changes the shape of `registry.json`, and the 2.0 spec approved it.

A Place is data in the settings file: a name, a kind, and what that kind needs. A new kind is one more entry in that data, and the commands do not change.

## The default Place

The default Place is this machine. It is `windows` on Windows, where the App runs, and `local` anywhere else, because there it is the only Place a Host has and a Linux Place called `windows` would be a lie. It is a `local` Place, it has no entry in the settings file, and it cannot be removed. It is there before anything is written, so the Host, which writes no setting, never has to make it.

Its Shelf stays where 1.x kept the one Shelf: `shelf` at the top of the settings file, moved by `FIRSTMATE_SHELF` first (ADR-0012). A 1.x settings file therefore means the same thing in 2.0. Every other Place keeps its Shelf in its own entry, and has a directory of its own under `shelves/` in the home folder until the operator chooses one.

A Registry row with no `place` was written by 1.x, and is in the default Place, because that is where a 1.x Plugin ran. Each row a command writes names its Place.

## Rules

- A Plugin Name is used once across every Place. `/p/<name>/` is one address, wherever the Plugin runs.
- `add` and `install` act in the default Place unless `--place` names another, so the simple case needs no flag. `shelf` takes `--place` too.
- A Place that holds a Plugin is not removed, because the Plugin would be left in no Place. Removing a Place touches nothing on disk.
- A Plugin whose Place changes is a removed Plugin and an added one under the same name, as a Plugin whose directory changes already is (ADR-0018).
- There is no `move` command. Moving a Plugin's data is the Plugin's own job (ADR-0005): remove it from one Place and install it in the other.

## The wsl Place

A `wsl` Place is one WSL distribution. It stores the distribution, the Windows path its files are read through (`\\wsl.localhost\<distribution>` unless the operator gives another, which is also how a test points it at a folder of its own), and the home directory of the distribution's user, which `place add` asks `wsl.exe` for. A distribution that does not answer is refused before anything is written.

Its Plugins keep their `mcp` file unchanged. The Host starts one as `wsl.exe -d <distribution> --cd <directory> -- ./mcp`, and reads its files, its Plugin Page among them, through the root. The directory in the Registry is the distribution's own path. `FIRSTMATE_NODE` is not handed across: it names a Windows program. A root that cannot be read is a distribution that is missing or will not start, so the Plugin is Stopped with one sentence that says so, and nothing is started to retry it.

Its default Shelf is the one a 1.x Host kept there, `~/.firstmate/shelf`. `install` writes into it through the root, and then asks the distribution to make `mcp` executable again, because a file written from Windows arrives without the bit. That runs nothing the Plugin ships.

Starting the Host starts every Plugin Server, so a `wsl` Place wakes its distribution. ADR-0007's rule against waking WSL does not hold for the App.

## Moving from 1.x

A 1.x Host ran in WSL, so `firstmate import <place>` reads the 1.x Registry and settings from `~/.firstmate` in a `wsl` Place's distribution, through its root, and never writes them. Every Plugin enters that Place with the directory it already has, its Grants with it, and the Shortcuts, the Plugin Order and the 1.x Shelf follow. A Plugin Name already in use is refused in one sentence, and so is a Shortcut for a Plugin that did not come; the rest still comes, and the command ends with the exit code for a taken name. When the 1.x Host runs there as a systemd service, it would hold the port the App listens on, so `import` asks before it runs `systemctl --user disable --now firstmate`, and does nothing to the service on no.

## Considered Options

One Registry per Place. A Plugin Name would then have to be checked across files, and the Tool Bus would read Grants from several places at once.

Leave the default Place in the settings file like any other. The Host would have to write it on first start, and the Host writes no setting. The default Place's Shelf would also move away from where every 1.x settings file holds it.

## Consequences

A second `local` Place is allowed. It runs its Plugin Servers on this machine as the default one does, and differs only in its Shelf.

The Index Page shows the default Place's Shelf. The other Places and their Shelves are in `firstmate place`, and in the Settings View once it shows them.
