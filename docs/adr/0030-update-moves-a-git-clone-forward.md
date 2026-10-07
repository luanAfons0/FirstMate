# update moves a git clone forward, and nothing else

An installed Plugin could not be updated. `install` refuses a Plugin Name the Registry holds, so an operator pulled a clone by hand and ran `firstmate restart`, and a copied Plugin had no good path at all: `remove` and `install` again gave a fresh copy without the Plugin's data, which the Plugin keeps in its own directory (ADR-0005). `firstmate update <name>` closes the first gap and refuses the second on purpose. The spec is issue #200.

## The decision

A Plugin has no manifest (ADR-0002), so it has no version number to compare. The version of a Plugin is its commit. `update` updates a Plugin that is a git clone of its own, and does nothing else:

1. It fetches the clone's upstream.
2. When HEAD already holds the upstream, current or ahead with the operator's own commits, it stops and says nothing.
3. Otherwise it moves the branch forward with `merge --ff-only`. It never makes a merge, never drops a commit, and never leaves a clone in the middle of a merge.
4. It restarts the Plugin Server through the running Host, with the call `restart` uses. The Host does not take part in an update in any other way: no address on the Host changes a Plugin's files.

It refuses in one sentence that says what to do, and changes nothing, before any step that could lose something: a directory that is not the top of a git work tree of its own, a detached HEAD, a branch with no upstream, local changes to tracked files, a branch that has diverged from its upstream, and an untracked or ignored file the new commit would overwrite. The fast-forward runs with `--no-overwrite-ignore`, because git otherwise writes over an ignored file that the new commit starts to track. The files git ignores are never touched, so a Plugin that keeps its data in ignored files keeps it across an update.

A refusal that comes after the fetch, a branch that has diverged or a file the new commit would overwrite, leaves the branch and the files as they were. The fetch has moved the remote-tracking branch all the same. That loses nothing, and the next `update` or `git fetch` would move it too.

## An update runs nothing the Plugin ships

ADR-0021 says that installing a Plugin runs nothing the Plugin ships, and an update keeps that rule. A clone's shipped files cannot configure git to run a program: a hook, an fsmonitor command and a remote's URL all come from the clone's `.git` directory or from the operator's own configuration, and git never fills those from a commit. Every git command `install` and `update` run still turns off repository hooks, fsmonitor and the `ext::` transport on its command line (`core.hooksPath=/dev/null`, `core.fsmonitor=false`, `protocol.ext.allow=never`), which beats the clone's own configuration. That is defence in depth. What is guarded is the rule above: the bytes a clone ships never make git run a program. A Plugin Server that writes its own `.git/config` already runs as the operator and can do anything the operator can, so that is out of reach, and this decision does not claim to stop it.

Every git command runs in the environment `install` clones in, so git never asks on the terminal for a password or a key, and the operator's own `GIT_SSH_COMMAND` is kept when one is set. The credential helpers stay as they are: they are the operator's own, and an update needs them to fetch a private Plugin.

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
