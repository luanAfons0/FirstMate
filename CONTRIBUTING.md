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

## The two commands that must be green

```sh
npm ci
npm run typecheck
npm test
```

Both must pass before you open a pull request. The same two commands run on
every pull request in the [Check](.github/workflows/check.yml) workflow, so a
machine says so too, not only you.

Every test boots a real Host against a temporary home directory and drives it
over HTTP, exactly as a browser does. No test imports a module of the Host: the
one seam is `tests/helpers/host.ts`. Keep it that way. Add a fixture Plugin
under `tests/fixtures/` rather than a mock.

## Where FirstMate runs

FirstMate is developed on WSL Debian, and only there. The Host runs under
systemd; the Tray is Windows PowerShell. macOS and native Windows are not
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

## Where to help

Issues labelled `help wanted` are the ones the maintainer cannot close alone.
Start there. Issues labelled `good first issue` are the smaller ones among
them.

Questions belong in
[Discussions](https://github.com/luanAfons0/FirstMate/discussions), not in the
issue tracker.

Found a security fault? Do not open an issue. [`SECURITY.md`](SECURITY.md) says
how to report it in private.
