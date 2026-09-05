#!/usr/bin/env bash
# Generate the raw PNGs that are still missing, via the codex-imagegen skill.
#
#   tools/art/run.sh [max-parallel] [spec-name ...]
#
# With no spec names it queues every spec in specs/ that has no matching PNG in
# raw/ yet — so it is safe to re-run after a Codex usage-limit interruption or a
# partial failure; already-generated images are never re-billed.
#
# Named specs are forced even if the PNG exists, which is how retries work:
#   cp specs/item--pill-qi.txt specs/item--pill-qi-v2.txt   # edit ONE variable
#   tools/art/run.sh 1 item--pill-qi-v2
# process.mjs automatically prefers the highest -vN it finds.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="$HOME/.claude/skills/codex-imagegen/scripts/batch.sh"
SPECS="$HERE/specs"
RAW="$HERE/raw"
MAXP="${1:-8}"
shift || true

[ -x "$SKILL" ] || { echo "run.sh: codex-imagegen skill not found at $SKILL" >&2; exit 127; }
mkdir -p "$RAW"

QUEUE="$(mktemp -d)"
trap 'rm -rf "$QUEUE"' EXIT

if [ $# -gt 0 ]; then
  for n in "$@"; do
    [ -f "$SPECS/$n.txt" ] || { echo "run.sh: no spec $SPECS/$n.txt" >&2; exit 2; }
    cp "$SPECS/$n.txt" "$QUEUE/"
  done
else
  shopt -s nullglob
  for spec in "$SPECS"/*.txt; do
    n="$(basename "${spec%.txt}")"
    [ -f "$RAW/$n.png" ] || cp "$spec" "$QUEUE/"
  done
fi

count=$(ls -1 "$QUEUE" 2>/dev/null | wc -l | tr -d ' ')
if [ "$count" -eq 0 ]; then echo "run.sh: nothing to generate — all specs already have a raw PNG"; exit 0; fi
echo "run.sh: $count spec(s) to generate, $MAXP at a time"

# workdir is tools/art so the codex sandbox can only ever write inside this directory
"$SKILL" "$RAW" "$QUEUE" "$MAXP" "$HERE"
