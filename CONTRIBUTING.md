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

FirstMate has runtime dependencies: none. Keep it that way. If you believe a
change needs one, open an issue and make the case before you write the code.

## The check that must be green

```sh
npm ci
npm run check
```

`npm run check` checks the types, lints with Biome, checks the layout with
Prettier, looks for dead code with knip, and runs every test. It must pass
before you open a pull request. The same steps run on every pull request in the
[Check](.github/workflows/check.yml) workflow, so a machine says so too, not
only you. `npm run format` fixes the layout for you.

Every test boots a real Host against a temporary home directory and drives it
over HTTP, exactly as a browser does. No test imports a module of the Host: the
one seam is `tests/helpers/host.ts`. Keep it that way. Add a fixture Plugin
under `tests/fixtures/` rather than a mock.

## Where FirstMate runs

FirstMate is developed on WSL Debian, and only there. The Host runs under
systemd; the Tray is Windows Node. macOS and native Windows are not
tested by anyone, so nobody can honestly claim they work.

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

Written down here so that it is not one person's knowledge. It is three
commands, and a machine does the rest.

The package is `@luan-afonso/firstmate` on npm. The plain `firstmate` is
refused as too similar to `first-mate`, an unrelated package. The command it
installs is still `firstmate`, because `bin` is independent of the package
name.

1. Set the version in `package.json`, and commit it with everything else the
   release carries.
2. Tag it and push the tag:

   ```sh
   git tag -a v1.2.3 -m "FirstMate v1.2.3"
   git push origin main
   git push origin v1.2.3
   ```

3. Write the GitHub release against that tag. Say what a Plugin is, what the
   Host does, and what the version still does not do.

Pushing the tag starts the [Release](.github/workflows/release.yml) workflow.
It refuses a tag that disagrees with `package.json`, checks the types, runs the
whole suite, and only then publishes.

**There is no npm token anywhere.** npm accepts GitHub Actions as a trusted
publisher over OIDC, so the job asks for an identity token minted for that one
run. Nothing is stored in the repository, and npm attaches a provenance
attestation saying which workflow and which commit built the tarball. If
publishing ever fails with an authentication fault, the trust is configured on
the npm package page, against this repository and `.github/workflows/release.yml`
— not by adding a secret here.

Packing always builds, so a published package can never be stale against the
source. A clone still holds no built output ([ADR-0010](docs/adr/0010-the-published-package-is-built-the-repository-is-not.md)).

## Where to help

Issues labelled `help wanted` are the ones the maintainer cannot close alone.
Start there. Issues labelled `good first issue` are the smaller ones among
them.

Questions belong in
[Discussions](https://github.com/luanAfons0/FirstMate/discussions), not in the
issue tracker.

Found a security fault? Do not open an issue. [`SECURITY.md`](SECURITY.md) says
how to report it in private.
