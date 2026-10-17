#!/usr/bin/env bash
# Symlinks example widgets into Cockpit's widget folder. Cockpit follows the
# links and reloads a widget when its files here change, so edit them in place.
#
#   examples/widgets/install.sh                     # every example
#   examples/widgets/install.sh shortcut-stories    # just these
#
# COCKPIT_HOME overrides ~/.cockpit. Remove a widget by deleting its link.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DEST="${COCKPIT_HOME:-$HOME/.cockpit}/widgets"

if [[ $# -eq 0 ]]; then
  set -- $(cd "$HERE" && for d in */; do [[ -f "$d/widget.json" ]] && echo "${d%/}"; done)
fi

mkdir -p "$DEST"
for name in "$@"; do
  src="$HERE/$name"
  if [[ ! -f "$src/widget.json" ]]; then
    echo "no widget named \"$name\" in $HERE" >&2
    exit 1
  fi
  link="$DEST/$name"
  if [[ -e "$link" && ! -L "$link" ]]; then
    echo "$link exists and is not a symlink; leaving it alone" >&2
    exit 1
  fi
  ln -sfn "$src" "$link"
  echo "$link -> $src"
done
