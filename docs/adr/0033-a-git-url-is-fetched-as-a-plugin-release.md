# A git URL is fetched as a Plugin Release

A Plugin given by its git URL was cloned, and a clone runs the Plugin's source as it is. Node runs TypeScript with no build step, so the five Official Plugins never built anything, and every operator paid the type strip again at every start of a Plugin Server, and nexus paid it at every tool call. A Plugin also had no version, so `update` could only move a clone forward (ADR-0030). So `install` now fetches a **Plugin Release** from a git URL: a numbered, published archive of the Plugin's files, built in the Plugin's own CI. The repository still has no build step; the Plugin Release is built, the same split ADR-0017 made for FirstMate itself.

## The decision

A Plugin Release is a GitHub Release at a tag `vMAJOR.MINOR.PATCH` that is not a draft and not a prerelease, and that holds at least one `.tar.gz`. Its Release Version is the tag. A Release with no `.tar.gz` at all is a repository's notes, not an archive of the Plugin, so it is passed over: a repository that has only those is cloned, as it was before Plugin Releases. It holds one `.tar.gz` for every platform, `<name>-<version>.tar.gz`, or one for each platform, `<name>-<version>-<platform>-<arch>.tar.gz` in Node's names, and a `.sha256` beside each archive, as the App's own Release does. `install` takes the archive for its platform first. A Plugin Release that holds archives, but none for this platform and none for every platform, is refused: its author publishes Plugin Releases, and a clone is not what they published. The files are at the top of the archive. The archive's name part is the repository's name in the case GitHub gives it, which the release workflow names it by, so FirstMate reads the repository from GitHub's answer and not from the URL as typed: GitHub accepts a URL in any letter case.

`install` of a git URL asks GitHub for the newest Plugin Release. GitHub lists a hundred Releases a page, newest created first, so FirstMate reads every page: a fix to an older MAJOR can be past the first hundred. When there is none, when the URL is not on GitHub, or when GitHub answers 404 for a private repository, it clones as before, and says so in one line. A Plugin Release with no `.sha256`, or one that does not match, is refused, and nothing falls back: a release that cannot be checked is broken, not missing. A file the Plugin Release does not hold, its archive for this platform or a `.sha256`, is refused as missing (exit code 4); a hash that does not match is refused as invalid (exit code 3).

A small tar reader in core unpacks the archive, with Node's own `zlib`. It refuses a path with `..`, an absolute path and a link that points out of the Plugin directory, and it keeps the executable bit. In a `wsl` Place it writes through the root, as `install` already does, and then makes executable every file the archive marks so.

`update` of a Plugin installed from a Plugin Release takes the newest Plugin Release with the same MAJOR. A new MAJOR needs `--major`. A clone is still moved forward (ADR-0030), and a copy is still refused.

## Release Files, and the record of them

ADR-0030 refused to copy a Plugin over because FirstMate could not tell a Plugin's data from its code (ADR-0005). A Plugin Release can tell them apart: the **Release Files** are the files it put in the Plugin's directory, and every other file there is the Plugin's own data. `update` replaces the Release Files and touches nothing else. It refuses, before any change, when a new Release File would write over a file of the Plugin's data, and when the operator changed a Release File.

To know that, FirstMate keeps a file of its own in the Plugin's directory, `.firstmate-release.json`, with the SHA-256 of each Release File. This amends ADR-0002: a Plugin is still a convention and not a manifest, because the Plugin's author never writes this file, and a Plugin Release that ships it is refused. The repository and the Release Version are in the Registry row, beside the Plugin's directory, so `list` and `status` can show them without reading a Plugin's files. Their `UPDATES` column says how `update` moves each Plugin: its Release Version, `clone`, `copy`, or `unknown` when FirstMate cannot tell a clone from a copy, because the Plugin's Place is gone or its `wsl` distribution has no git.

An update stages the new Plugin Release in the Shelf, checks it, moves the old Release Files aside and the new ones into place, restarts the Plugin Server through the Host (ADR-0030), and then deletes the old files. When the move fails, the old files go back. A rename works on a running `mcp.exe`, so the Host needs no route to stop a Plugin.

## Considered Options

Commit the built `mcp.js` to each Plugin's `main`. It needs no change in FirstMate, but every diff carries built output, a build can go stale against its source, and there is still no version to update to.

Always a Plugin Release, and never a clone. It breaks every Plugin that exists on the day of the release, and every Plugin outside GitHub.

Any HTTPS URL to an archive. A URL alone cannot say which archive is newer, so FirstMate would own an index format, which ADR-0015 refused.

The system `tar`. Linux has it and Windows 10 has `tar.exe`, but its checks differ on each system, and git is the one external binary FirstMate runs (ADR-0012).

GitHub artifact attestations. They prove that CI built the archive, but checking them needs `gh` or a Sigstore library, and FirstMate keeps one dependency (ADR-0011). The `.sha256` gives the same trust a clone gives today.

## Consequences

A Plugin's author publishes a fix by pushing a tag. One reusable workflow in this repository, `plugin-release.yml`, runs the Plugin's optional `test` and `build` commands, archives `release/` or else `git archive` of the tag, and publishes the archive and its `.sha256`. The format and the reader of it change together, in one repository.

A TypeScript Plugin ships `mcp.js` and never `mcp.ts`, because the Host starts `mcp.ts` first (ADR-0028).

The Official Plugins keep their URLs (ADR-0015), and each publishes a Plugin Release before this ships.

FirstMate holds no token. GitHub's limit of 60 calls an hour for one address, and its secondary limit, which answers 403 with `retry-after`, are refused in one sentence that says when to try again.
