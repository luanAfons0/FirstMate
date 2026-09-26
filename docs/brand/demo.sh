#!/usr/bin/env bash
# Type the twenty-second demo for you, so that you never leave the terminal.
#
#   docs/brand/demo.sh check   what the take needs, before you record.
#   docs/brand/demo.sh take    the take itself. Enter runs the next command.
#   docs/brand/demo.sh reset   put the machine back, and burn the token.
#
# docs/brand/demo-script.md holds the take beat by beat, and stays the one
# place a beat is written down. This file holds the same beats as commands, and
# types them a character at a time so that the recording looks like a person at
# a keyboard. Nothing is copied out of the README: the take runs the real
# `firstmate` command, exactly as an operator does.
#
# It takes no dependency, because the Host takes none either. The typing is a
# loop and a sleep.
#
# It never puts the token on screen. `firstmate list` reads the Registry alone,
# and the state of the service is read with `is-active`, which answers one
# word. Neither `systemctl status` nor `journalctl` belongs in this file: the
# Host prints its address with the token in it at every start, and both of them
# would put that line back in the frame.
set -euo pipefail

repository="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
plugin_name='notes'
plugin_home="$HOME/firstmate-demo/notes"
# What the take types. A tilde is shorter on screen than a home directory, and
# the shell expands it into the absolute path the Registry wants.
plugin_typed='~/firstmate-demo/notes'
# The Shortcut the take binds, and presses once the window is hidden.
shortcut_keys='Ctrl+Alt+D'

# How the prompt reads in the frame, and how fast the demo types. Both are
# yours to move: a prompt that matches your shell is one less thing a viewer
# notices.
prompt="${DEMO_PROMPT:-~ $ }"
speed="${DEMO_SPEED:-0.045}"

USAGE='usage:
  docs/brand/demo.sh check   what the take needs, before you record.
  docs/brand/demo.sh take    the take itself. Enter runs the next command.
  docs/brand/demo.sh reset   take the demo Plugin out, and burn the token.

Run check first, then start the recorder, then take. The take stops where the
mouse starts and says nothing after it, so that no frame catches this script.
Run reset when the recording is saved. docs/brand/demo-script.md is the script
this file types, and holds the clicks the take leaves to you.'

# Hold until Enter. Nothing is echoed, so a stray key never reaches the frame.
hold() {
  read -r -s || true
}

# Type one command the way a person types it, then wait, then run it.
#
# The wait sits between the typing and the run, so that a slow answer never
# lands while the next command is still going down. Enter is the only key the
# operator presses in the whole take.
type_and_run() {
  local command="$1" i
  printf '%s' "$prompt"
  for (( i = 0; i < ${#command}; i++ )); do
    printf '%s' "${command:i:1}"
    sleep "$speed"
  done
  hold
  printf '\n'
  # eval, so that the shell expands the tilde as it would for a person typing.
  eval "$command"
  printf '\n'
}

check() {
  local faults=0

  if ! command -v firstmate >/dev/null; then
    printf 'firstmate: firstmate is not on the PATH. The take uses the real command.\n' >&2
    printf '           cd %s && npm pack --pack-destination /tmp\n' "$repository" >&2
    printf '           npm install -g /tmp/luan-afonso-firstmate-%s.tgz\n' \
      "$(node -p "require('$repository/package.json').version")" >&2
    faults=1
  elif ! firstmate --help 2>&1 | grep -q 'firstmate bind'; then
    printf 'firstmate: the firstmate on the PATH is older than bind. Install this repository.\n' >&2
    printf '           cd %s && npm pack --pack-destination /tmp\n' "$repository" >&2
    printf '           npm install -g /tmp/luan-afonso-firstmate-%s.tgz\n' \
      "$(node -p "require('$repository/package.json').version")" >&2
    faults=1
  fi

  if [[ ! -d "$plugin_home/web" ]]; then
    printf 'firstmate: %s has no web/ directory, so it serves no Plugin Page.\n' "$plugin_home" >&2
    faults=1
  fi
  if [[ ! -x "$plugin_home/mcp" ]]; then
    printf 'firstmate: %s/mcp is missing or is not executable, so it never reaches Running.\n' \
      "$plugin_home" >&2
    faults=1
  fi

  # is-active answers one word. status and journalctl would print the address
  # the Host logged at start, and the token is in it.
  if [[ "$(systemctl --user is-active firstmate 2>/dev/null || true)" != 'active' ]]; then
    printf 'firstmate: the Host is not running as its service. The Tray opens what the service writes.\n' >&2
    printf '           systemctl --user start firstmate\n' >&2
    faults=1
  fi

  if command -v firstmate >/dev/null; then
    local registry
    registry="$(firstmate list)"
    if ! printf '%s' "$registry" | grep -q '^nexus'; then
      printf 'firstmate: nexus is not registered. The first frame is a Registry that already exists.\n' >&2
      faults=1
    fi
    if printf '%s' "$registry" | grep -q "^$plugin_name"; then
      printf 'firstmate: %s is already registered, so add would refuse on camera. Run reset first.\n' \
        "$plugin_name" >&2
      faults=1
    fi
    if printf '%s' "$registry" | grep -q "^$shortcut_keys"$'\t'; then
      printf 'firstmate: %s is already bound, so bind would refuse on camera. Unbind it first.\n' \
        "$shortcut_keys" >&2
      faults=1
    fi
  fi

  local columns="${COLUMNS:-$(tput cols 2>/dev/null || printf '0')}"
  if (( columns < 88 || columns > 96 )); then
    printf 'firstmate: this terminal is %s columns. The take was written for about 90.\n' \
      "$columns" >&2
    faults=1
  fi

  if (( faults != 0 )); then
    printf '\nfirstmate: fix the above, then run check again.\n' >&2
    return 1
  fi
  printf 'firstmate: ready. Start the recorder, then run: docs/brand/demo.sh take\n'
  printf 'firstmate: when the recording is saved, run:    docs/brand/demo.sh reset\n'
}

take() {
  clear
  printf 'Start the recorder now. Enter begins the take.\n'
  hold
  clear

  type_and_run 'firstmate list'
  type_and_run "firstmate add $plugin_name $plugin_typed"
  type_and_run "firstmate bind $shortcut_keys $plugin_name"
  type_and_run 'systemctl --user restart firstmate'
  # Nothing is printed after the last command. The mouse has the take from
  # here, the terminal stays in the frame behind the window, and a line of
  # this script in that frame would be a line the Host never wrote. The clicks
  # that are left are in docs/brand/demo-script.md, and check says them before
  # the recorder is running.
}

reset() {
  # The Registry holds the path and nothing else, so removing the Plugin leaves
  # the directory alone, and remove takes the Shortcut with it. The restart mints a new token, which is what makes the
  # one a frame may have caught worthless.
  firstmate remove "$plugin_name"
  systemctl --user restart firstmate
  printf 'firstmate: the prop is out, and the token in the recording is dead.\n'
}

case "${1-}" in
  check) check ;;
  take) take ;;
  reset) reset ;;
  -h | --help) printf '%s\n' "$USAGE" ;;
  '')
    printf '%s\n' "$USAGE" >&2
    exit 2
    ;;
  *)
    printf 'firstmate: no such command: %s\n\n%s\n' "$1" "$USAGE" >&2
    exit 2
    ;;
esac
