# Contributing to FirstMate

Thank you for looking. This page says what is expected before you write
anything, so that nothing about your first change is a surprise.

FirstMate is MIT licensed. A change you contribute is contributed under that
same licence.

## Before you write anything

Read [`CONTEXT.md`](CONTEXT.md). It defines every word this project uses —
Host, Plugin, Plugin Page, Plugin Server, Registry, Index Page, Tray, Grant,
Tool Bus, Stopped — and lists the words to avoid for each. Use its words in
code, in comments, in tests, in issues and in commit messages. A change that
calls the Host a daemon will be sent back for that alone.

Read the ADR that covers the area you are about to touch:
[`docs/adr/`](docs/adr). These are the decisions that are expensive to reverse.
If your change contradicts one, say so out loud in the pull request. A
contradiction argued in the open is welcome. A contradiction made in silence is
not.

## What you need

Node 24, and nothing else. Node runs the TypeScript directly, so there is no
build step, no bundler and no watcher in a clone. `typescript` is a development
dependency and is used only to check the types.

The Host imports nothing outside Node. Keep it that way. The npm package is the
command line alone and has no runtime dependency (ADR-0024). The App, in
`apps/desktop`, is built with Electron, electron-vite and electron-builder, all
dev dependencies of a private package (ADR-0020). If you believe a change needs
another dependency, open an issue and make the case before you write the code.

## The check that must be green

```sh
pnpm install --frozen-lockfile
pnpm check
```

The repository is a pnpm workspace. `package.json` names the pnpm version in
`packageManager`, and pnpm switches to it on its own.

`pnpm check` checks the types, lints with Biome, checks the layout with
Prettier, looks for dead code with knip, and runs every test. It must pass
before you open a pull request. The same steps run on every pull request in the
[Check](.github/workflows/check.yml) workflow, so a machine says so too, not
only you. `pnpm format` fixes the layout for you.

Every test boots a real Host against a temporary home directory and drives it
over HTTP, exactly as a browser does. No test imports a module of the Host: the
one seam is `tests/helpers/host.ts`. Keep it that way. Add a fixture Plugin
under `tests/fixtures/` rather than a mock.

## Where FirstMate runs

FirstMate is developed from WSL Debian, for Windows. The App is a Windows
program, and CI runs the whole suite on `windows-latest` and `ubuntu-latest`.
The Host runs on plain Node anywhere, which is how the tests run it. macOS is
tested by nobody, so nobody can honestly claim it works.

This is not a rule against them. It is a statement of what has been run. If you
use FirstMate somewhere else, an issue saying what broke is useful, and a
change that makes it work is welcome — say which platform you tested on.

## Commit messages

One imperative sentence, in the project's own words. No prefix, no scope, no
ticket number.

```
Refuse every request that is not mine
Start Plugin Servers and show their state
Give the Tray an anchor
```

One commit is one whole, working change: code, tests and documentation
together.

## Cutting a release

Written down here so that it is not one person's knowledge. It is two
steps, and a machine does the rest.

The package is `@luan-afonso/firstmate` on npm. The plain `firstmate` is
refused as too similar to `first-mate`, an unrelated package. The command it
installs is still `firstmate`, because `bin` is independent of the package
name.

1. Set the version in every `package.json` (the root, `apps/cli`,
   `apps/desktop`, `packages/core` and `packages/host`), and commit it with
   everything else the release carries. They share one version, and a test
   says so when they do not. A beta is `2.0.0-beta.1`: say `beta`, not
   `next`, because the App's updater reads any other word as a channel of its
   own ([ADR-0023](docs/adr/0023-one-tag-releases-the-app-and-the-command-line.md)).
2. Tag it and push the tag:

   ```sh
   git tag -a v1.2.3 -m "FirstMate v1.2.3"
   git push origin main
   git push origin v1.2.3
   ```

Pushing the tag starts the [Release](.github/workflows/release.yml) workflow.
It refuses a tag that disagrees with any `package.json` and runs `pnpm check`
on Linux, while it packages the App on Windows. When both pass, it publishes
the GitHub Release of the tag with these files, for version `<version>`:

| File                                     | What it is                                        |
| ---------------------------------------- | ------------------------------------------------- |
| `FirstMate-Setup-<version>.exe`          | The App's installer, unsigned until SignPath signs it. |
| `FirstMate-Setup-<version>.exe.sha256`   | Its SHA-256, as `sha256sum` writes it.            |
| `FirstMate-Setup-<version>.exe.blockmap` | What the App's updater downloads parts of it by.  |
| `latest.yml`                             | The update feed, for every version, a beta's too. |

`firstmate desktop` downloads the installer and its checksum by those names,
so they do not change. Only after the Release is out does the workflow pack
`apps/cli` with pnpm and publish that tarball with npm, so a command line on
npm never names a Release that is not there.

A version with a prerelease part, such as `2.0.0-beta.1`, is a GitHub
prerelease and goes to npm's `next` tag, which `npx @luan-afonso/firstmate@next`
runs. Any other version is the latest on both. The workflow writes the
Release's notes from the merged pull requests. Edit them afterwards: say what
a Plugin is, what the version does, and what it still does not do. A Release
you write by hand before you push the tag keeps its notes, and gets the files.

**There is no npm token anywhere.** npm accepts GitHub Actions as a trusted
publisher over OIDC, so the job asks for an identity token minted for that one
run. Nothing is stored in the repository, and npm attaches a provenance
attestation saying which workflow and which commit built the tarball. If
publishing ever fails with an authentication fault, the trust is configured on
the npm package page, against this repository and `.github/workflows/release.yml`
— not by adding a secret here.

Packing always builds, so a published package can never be stale against the
source. A clone still holds no built output ([ADR-0017](docs/adr/0017-the-repository-is-a-workspace-and-the-package-is-a-bundle.md)).

## Where to help

Issues labelled `help wanted` are the ones the maintainer cannot close alone.
Start there. Issues labelled `good first issue` are the smaller ones among
them.

Questions belong in
[Discussions](https://github.com/luanAfons0/FirstMate/discussions), not in the
issue tracker.

Found a security fault? Do not open an issue. [`SECURITY.md`](SECURITY.md) says
how to report it in private.
