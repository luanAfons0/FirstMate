# One tag releases the App and the command line

FirstMate 2.0 ships two things: the App, which is a Windows installer and, since ADR-0026, an AppImage and a deb for Linux, and the command line, which is the npm package. `firstmate desktop` installs the App of its own version, so the two must never drift apart. One git tag releases both, and every package in the workspace carries the version the tag names. A tag that disagrees with any `package.json` is refused before anything is built.

The release workflow runs three parts in order. The whole check runs on Linux while the App is packaged on Windows and on Linux, each on a runner of its own. When both pass, the GitHub Release of the tag is published with the App's files. Only then is the command line published to npm, so a command line on npm never names a Release that is not there.

## What a Release carries

For version `<version>`, the GitHub Release of tag `v<version>` carries exactly these files:

| File | What it is |
| --- | --- |
| `FirstMate-Setup-<version>.exe` | The installer: NSIS, one click, for this user alone, unsigned for the betas. |
| `FirstMate-Setup-<version>.exe.sha256` | Its SHA-256, as `sha256sum` writes it: the hash in lower-case hex, two spaces, the installer's name. |
| `FirstMate-Setup-<version>.exe.blockmap` | The block map, by which `electron-updater` downloads only the changed parts of an update. |
| `latest.yml` | The update feed: the version, the installer's name, its SHA-512 and size. |
| `FirstMate-<version>.AppImage` | The Linux App as one file, for x64. It carries its own block map, and `electron-updater` updates it. |
| `FirstMate-<version>.AppImage.sha256` | Its SHA-256, in the same form. |
| `firstmate_<version>_amd64.deb` | The Linux App as a deb, for x64, with the AppArmor profile its install script loads. The package manager updates it; the App does not. |
| `firstmate_<version>_amd64.deb.sha256` | Its SHA-256, in the same form. |
| `latest-linux.yml` | The AppImage's update feed: the version, the AppImage's name, and each Linux file's SHA-512 and size. |

These names are a contract. `firstmate desktop` downloads the installer and its checksum by them, from `https://github.com/luanAfons0/FirstMate/releases/download/v<version>/`, and a command line already on npm cannot learn new ones. `electron-builder.yml` names the installers, and the workflow writes the checksums.

The checksum is SHA-256 in a file of its own, because that is what a person can check by hand on any machine. `latest.yml` carries a SHA-512 as well, and that one is `electron-updater`'s.

## Prereleases and channels

A version with a prerelease part, such as `2.0.0-beta.1`, is a prerelease everywhere: a GitHub prerelease, and npm's `next` tag. Any other version is the latest on both. So `npx @luan-afonso/firstmate desktop` installs the latest stable App, and `npx @luan-afonso/firstmate@next desktop` installs the newest beta.

Every Release carries `latest.yml`, a beta's too. `electron-builder` would name a beta's feed `beta.yml` if left to guess, so `electron-builder.yml` tells it not to. The App finds its channel from its own version, with no setting:

- A stable App does not allow prereleases. It asks GitHub for the latest Release, which is never a prerelease, and reads that Release's `latest.yml`. This is the stable channel.
- A beta App allows prereleases, because `electron-updater` allows them for any version with a prerelease part. It takes the newest Release, beta or stable, and reads its `latest.yml`; for a beta Release it asks for `beta.yml` first, finds none, and reads `latest.yml`. This is the `next` channel: a beta tester moves on to each beta and then to the stable version, and stays stable from there.

A prerelease part names `beta` or `alpha`. `electron-updater` reads any other word, `next` among them, as a channel of its own, and a beta App would never be offered the stable version.

## How `firstmate desktop` installs the App

`firstmate desktop` reads its own version from its package's manifest and installs that App. It fetches the checksum, then the installer, from the Release of that version, or from `FIRSTMATE_RELEASES_URL` in its place. An installer whose SHA-256 differs is refused before it is written anywhere, so nothing runs. The installer runs with `/S`, silent and for this user alone, and the App is then opened on its own.

Whether the App is installed, and which version, is read where the installer records it for Windows: the uninstall key `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\<guid>`, whose `DisplayVersion` is the version, and `HKCU\Software\<guid>`, whose `InstallLocation` is the folder. `electron-builder.yml` pins the GUID, which is what electron-builder derives from the `appId`. The folder is not guessed: electron-builder names it after the packed package's name, `FirstMate` (`@firstmatedesktop` up to 2.0.0-beta.2, and kept by an update of such an install), inside a folder Windows lets a person move. `reg.exe export` reads the keys, because it writes UTF-16; `reg.exe query` writes the console's code page, and garbles a user name that is not ASCII.

On Linux outside WSL, `firstmate desktop` downloads `FirstMate-<version>.AppImage` and its checksum the same way, refuses one that does not match, and puts it at `~/Applications/FirstMate.AppImage`, executable, where `setup` and the logon entry look for it (ADR-0026). It reads the version an AppImage carries in itself: the AppImage's runtime extracts its desktop entry, whose `X-AppImage-Version` names it, and starts nothing of the App. One of this version or newer is only opened, and an older one is replaced, so an AppImage that updated itself counts as the version it is now. One whose version cannot be read is replaced. Inside WSL, `firstmate desktop` installs the Windows App, as above.

The same version is only opened, and so is a newer one. The App updates itself, so it is often ahead of a command line installed long ago, and installing the older one would take it back.

From WSL it reaches Windows through interop: `cmd.exe` names the Windows temp folder, `wslpath` turns Windows paths into paths there, and `reg.exe`, the installer and the App run as the Windows programs they are. On Linux outside WSL, and on macOS, it says in one sentence that the App runs on Windows.

No command loads the 1.x window since, so ADR-0017's line about its library as a dynamic import no longer holds. The library and the window stay in the package, unused, until the package becomes the command line alone.

## Considered Options

The App's folder, `%LOCALAPPDATA%\Programs\FirstMate`, as the record of an install. It needs no registry, but its name comes from the package's name, its parent can be moved, and nothing in it says which version it holds.

`reg.exe query` for the registry, or PowerShell. The first garbles names that are not ASCII. The second is the kind of helper 2.0 takes out.

A checksum file for every asset, `SHA256SUMS`. It is what larger projects carry, but the command line wants one hash, and one file named after the installer says which hash it is.

A feed named after the channel, `next.yml`, for the betas. The App would have to set its channel, and a stable Release would have to carry both feeds for a beta App to find its way back to stable. One `latest.yml` per Release does the same with nothing to set.

The npm package first, then the Release. That is the order 1.x had, when the Release was written by hand. With `firstmate desktop`, a command line published first points at nothing for as long as the App takes to package.

## Consequences

The GitHub Release is no longer written by hand. The workflow writes it with generated notes, and the maintainer edits the notes after. A Release a maintainer made for the tag before pushing it keeps its notes and gets the files.

The betas are unsigned, and Windows may warn before the installer runs. The certificate is decided before 2.0.0 final; signing changes the workflow and none of these names.

A Release whose App failed to package is not published, and neither is its command line. Running the failed job again finishes the release.

## Amended: Linux files (ADR-0026)

ADR-0026 amends this ADR: Linux gets an AppImage and a deb. Their rows are in the table above, and the workflow packages them on a Linux runner beside the Windows one. The Release is published only when both systems packaged, and every file the table names is there.

The deb's name is lower case, with an underscore before the version and the architecture, because that is the form Debian gives a package's file. A version's prerelease part stays in the file name as it is, `firstmate_2.0.0-beta.3_amd64.deb`; inside the deb it is `2.0.0~beta.3`, which `dpkg` sorts before `2.0.0`.

Every Linux Release carries `latest-linux.yml` for the same reason every Release carries `latest.yml`: an App finds its channel from its own version. Only an AppImage reads it. A deb carries the feed too, because packaging writes it into every Linux package, and the App does not look at it: electron-updater would ask for root to install a deb, and the deb belongs to the package manager.
