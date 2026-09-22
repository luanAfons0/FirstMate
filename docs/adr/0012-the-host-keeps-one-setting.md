# The Host keeps one setting

FirstMate is growing a command that fetches a Plugin, and a fetched Plugin has to land somewhere. Where is the operator's choice: a laptop with one disk and a workstation with a separate code drive want different answers, and a directory under `/mnt/c` behaves differently from one in the home directory. So the Host remembers that choice. It is called the Shelf, it lives in `settings.json` in the Host's home directory beside the Registry and the runtime file, and it is the only setting the Host has ever kept.

This narrows ADR-0005 rather than deleting it. Everything else that decision says still stands: the Host stores a Registry, it never reads or writes a Plugin's data, and it keeps no run history, no logs and no settings for a Plugin. One sentence of it changes — the Host keeps one setting of its own, because nothing can fetch a Plugin without somewhere to put it.

The Shelf resolves in three steps: `FIRSTMATE_SHELF`, then the settings file, then a directory under the Host's home. The environment wins, because the environment is the single seam this project tests through. `src/config.ts` therefore stops promising that everything it hands back comes from the environment, and its header says the true thing instead.

The Shelf is not a plugins folder. The Host never scans it, and a directory sitting in it is not a Plugin until it is in the Registry. That is the whole of what keeps ADR-0002 true: a Plugin is registered or it does not exist.

## The Shelf is moved from a terminal, and from nowhere else

The Index Page may show the Shelf. No address on the Host may change it.

A form on the Index Page was the first design, and it does not survive the rule that a Plugin Page reaches nothing past its own Plugin. Every Plugin Page is served from the Index Page's own origin, so a Plugin Page already holds everything a same-origin write would check: the browser attaches the Host's token cookie by itself, the `Origin` it sends is genuine and cannot be suppressed, and its `Sec-Fetch-Site` really is `same-origin`. A `Referer` check does not rescue it, because a referrer policy of `origin` makes the browser send the Host's origin with the path stripped to `/`, so a test for "the Index Page sent this" passes for a request sent from `/p/evil/`. A token written into the form is no better, because that same Plugin Page can read the Index Page's HTML with an ordinary fetch.

On this Host, same-origin is not a trust boundary. The caller's right to write comes from a channel the Host owns — the terminal the command was typed into — and never from a header a same-origin page can shape. The Registry has never been writable over HTTP for this reason, and the Shelf is the same kind of state, so it gets the same answer.

## Considered Options

A key in the Registry, which is a file the Host already writes. It is the Host's record of which Plugins exist; a setting that is about no Plugin does not belong in a row or beside one, and every reader of the Registry would have to learn to ignore it.

An environment variable and nothing else, which would have kept the Host with no settings at all. It makes the operator set the variable in the service unit, in their shell, and in whatever starts the window, and it makes "where do my Plugins land" a question with three answers.

A write address on the Host, hardened with `Origin`, `Referer` and a form token. Rejected above, and pinned by a test, so that undoing it has to argue with a test rather than with a habit.

## Consequences

The Host's home directory holds a third file. It is written the way the runtime file is written — whole, through a rename, for this user alone — because a half-written settings file would be read back as a damaged one. A settings file that is not there means nothing has been chosen; a settings file that cannot be read fails loudly, as a damaged Registry does, and it fails every command rather than quietly handing back a default.

One check serves every command that takes a Shelf, so a path refused in one place is refused everywhere in the same words. Its last step is the one that matters: absoluteness and resolution are lexical, so a symlink pointing at the Host's home directory passes every lexical rule and still *is* the home directory. Both the candidate and the home are taken to their real paths before they are compared, because the home directory is not resolved anywhere else either, and resolving one side alone would compare a real path against a path that is not one. A Shelf that is, holds, or leads to the home directory is refused, because a fetched Plugin must never be written over the Registry and the runtime file.

What is stored is the real path, so what the operator reads back is what FirstMate will use. The check runs again on every run of every command that writes into the Shelf, and the stored value is never trusted as already checked: a path that was a directory yesterday can be a symlink today.

The Host prints the Shelf it read when it starts, beside the Registry it read. A terminal and a Host that disagree about where a Plugin lands is worth seeing in the journal.

The day a graphical interface should move the Shelf, it belongs in a chrome the Host does not serve — the strip above the window's content view (ADR-0011) — which moves it by running the command line, not by calling the Host.
