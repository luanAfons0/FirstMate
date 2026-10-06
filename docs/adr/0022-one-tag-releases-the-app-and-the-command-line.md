# One tag releases the App and the command line

FirstMate 2.0 ships two things: the App, which is a Windows installer, and the command line, which is the npm package. `firstmate desktop` installs the App of its own version, so the two must never drift apart. One git tag releases both, and every package in the workspace carries the version the tag names. A tag that disagrees with any `package.json` is refused before anything is built.

The release workflow runs three parts in order. The whole check runs on Linux while the App is packaged on Windows. When both pass, the GitHub Release of the tag is published with the App's files. Only then is the command line published to npm, so a command line on npm never names a Release that is not there.

## What a Release carries

For version `<version>`, the GitHub Release of tag `v<version>` carries exactly these files:

| File | What it is |
| --- | --- |
| `FirstMate-Setup-<version>.exe` | The installer: NSIS, one click, for this user alone, unsigned for the betas. |
| `FirstMate-Setup-<version>.exe.sha256` | Its SHA-256, as `sha256sum` writes it: the hash in lower-case hex, two spaces, the installer's name. |
| `FirstMate-Setup-<version>.exe.blockmap` | The block map, by which `electron-updater` downloads only the changed parts of an update. |
| `latest.yml` | The update feed: the version, the installer's name, its SHA-512 and size. |

These names are a contract. `firstmate desktop` downloads the installer and its checksum by them, from `https://github.com/luanAfons0/FirstMate/releases/download/v<version>/`, and a command line already on npm cannot learn new ones. `electron-builder.yml` names the installer, and the workflow writes the checksum.

The checksum is SHA-256 in a file of its own, because that is what a person can check by hand on any machine. `latest.yml` carries a SHA-512 as well, and that one is `electron-updater`'s.

## Prereleases and channels

A version with a prerelease part, such as `2.0.0-beta.1`, is a prerelease everywhere: a GitHub prerelease, and npm's `next` tag. Any other version is the latest on both. So `npx @luan-afonso/firstmate desktop` installs the latest stable App, and `npx @luan-afonso/firstmate@next desktop` installs the newest beta.

Every Release carries `latest.yml`, a beta's too. `electron-builder` would name a beta's feed `beta.yml` if left to guess, so `electron-builder.yml` tells it not to. The App finds its channel from its own version, with no setting:

- A stable App does not allow prereleases. It asks GitHub for the latest Release, which is never a prerelease, and reads that Release's `latest.yml`. This is the stable channel.
- A beta App allows prereleases, because `electron-updater` allows them for any version with a prerelease part. It takes the newest Release, beta or stable, and reads its `latest.yml`; for a beta Release it asks for `beta.yml` first, finds none, and reads `latest.yml`. This is the `next` channel: a beta tester moves on to each beta and then to the stable version, and stays stable from there.

A prerelease part names `beta` or `alpha`. `electron-updater` reads any other word, `next` among them, as a channel of its own, and a beta App would never be offered the stable version.

## Considered Options

A checksum file for every asset, `SHA256SUMS`. It is what larger projects carry, but the command line wants one hash, and one file named after the installer says which hash it is.

A feed named after the channel, `next.yml`, for the betas. The App would have to set its channel, and a stable Release would have to carry both feeds for a beta App to find its way back to stable. One `latest.yml` per Release does the same with nothing to set.

The npm package first, then the Release. That is the order 1.x had, when the Release was written by hand. With `firstmate desktop`, a command line published first points at nothing for as long as the App takes to package.

## Consequences

The GitHub Release is no longer written by hand. The workflow writes it with generated notes, and the maintainer edits the notes after. A Release a maintainer made for the tag before pushing it keeps its notes and gets the files.

The betas are unsigned, and Windows may warn before the installer runs. The certificate is decided before 2.0.0 final; signing changes the workflow and none of these names.

A Release whose App failed to package is not published, and neither is its command line. Running the failed job again finishes the release.
