# update moves a git clone forward, and nothing else

An installed Plugin could not be updated. `install` refuses a Plugin Name the Registry holds, so an operator pulled a clone by hand and ran `firstmate restart`, and a copied Plugin had no good path at all: `remove` and `install` again gave a fresh copy without the Plugin's data, which the Plugin keeps in its own directory (ADR-0005). `firstmate update <name>` closes the first gap and refuses the second on purpose. The spec is issue #200.

## The decision

A Plugin has no manifest (ADR-0002), so it has no version number to compare. The version of a Plugin is its commit. `update` updates a Plugin that is a git clone of its own, and does nothing else:

1. It fetches the clone's upstream.
2. When HEAD already holds the upstream, current or ahead with the operator's own commits, it stops and says nothing.
3. Otherwise it moves the branch forward with `merge --ff-only`. It never makes a merge, never drops a commit, and never leaves a clone in the middle of a merge.
4. It restarts the Plugin Server through the running Host, with the call `restart` uses. The Host does not take part in an update in any other way: no address on the Host changes a Plugin's files.

It refuses in one sentence, and changes nothing, before any step that could lose something: a directory that is not the top of a git work tree of its own, a detached HEAD, a branch with no upstream, local changes to tracked files, a branch that has diverged from its upstream, and an untracked file the new commit would overwrite. The files git ignores are never touched, so a Plugin that keeps its data in ignored files keeps it across an update.

An update runs nothing the Plugin ships, as a fetch does not (ADR-0012). Every git command runs with repository hooks and fsmonitor turned off on its command line, which beats the clone's own configuration, and in the environment `install` clones in, so git never asks on the terminal for a password or a key.

## A copied Plugin is not copied over

A Plugin installed from a directory, or registered with `add`, is refused. Copying the source over its directory again would write over files the Plugin may keep its data in, and FirstMate cannot tell the Plugin's data from its code without a manifest. The refusal says how to update it by hand: move its data out, `remove` it, and `install` it again. A Plugin registered with `add` inside the operator's own repository is the operator's to pull.

## git in a second place

git is the external binary ADR-0012 named for `install`, and `update` runs the same binary. In a `wsl` Place it runs inside the distribution, through `wsl.exe` (issue #204), because that git owns the clone and sees its files as the Plugin Server does. That is the same binary in a second place, not a second binary, so the question ADR-0012 left open does not arise. In core the steps run git through one runner, which runs one git command in the Plugin's directory, so a `wsl` Place adds a runner and changes no step and no sentence.

## Considered Options

Copy a copied Plugin over again. It risks the Plugin's data (ADR-0005), and it is out of scope.

`git pull`. It merges or rebases by the clone's own configuration, and a merge that stops half way leaves the clone for the operator to repair. A fetch and a fast-forward either move the branch or change nothing.

A version field, or a source recorded in the Registry. Both add to the Plugin contract (ADR-0002) or to the shape of `registry.json`; the clone itself already says where it came from and which commit it is at.

`firstmate update` with no name, for every Plugin. It reads as an update of the command line, and one refusal would hide among many results.

## Consequences

A Plugin's author ships a fix by pushing a commit, and an operator takes it with one command.

A Plugin should keep its data in files git ignores; the Plugin guide says so.

No `npm install` or other step runs after an update. A Plugin brings what it needs (ADR-0028).
