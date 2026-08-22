#!/usr/bin/env bash
# Regenerate src/connection/fields.generated.js from zmk-next-messages' proto.
#
#   ./scripts/sync-messages.sh          # regenerate in place
#   ./scripts/sync-messages.sh --check  # fail if the committed file is stale
#
# The generated file is the de facto version pin between this repo and
# zmk-next-messages (see that repo's README: "Both zmk-next and
# zmk-next-configurator must pin the same tagged release or commit").
set -euo pipefail

WS="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MESSAGES="${MESSAGES:-$HOME/zmk-next-messages}"
PYTHON="${PYTHON:-$HOME/zmk-venv/bin/python3}"
PROTOC="${PROTOC:-protoc}"
OUT="$WS/src/connection/fields.generated.js"

mode="${1:-generate}"
case "$mode" in
  generate|--check) ;;
  *)
    echo "usage: $0 [--check]" >&2
    exit 2
    ;;
esac

if [ ! -d "$MESSAGES" ]; then
  echo "SKIPPED: zmk-next-messages not found at $MESSAGES (set MESSAGES=...)" >&2
  exit 0
fi
if ! command -v "$PROTOC" >/dev/null 2>&1; then
  echo "SKIPPED: protoc not found (set PROTOC=...)" >&2
  exit 0
fi
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "SKIPPED: python not found at $PYTHON (set PYTHON=...)" >&2
  exit 0
fi

if [ -n "$(git -C "$MESSAGES" status --porcelain 2>/dev/null || true)" ]; then
  echo "WARNING: $MESSAGES has uncommitted changes; stamped commit SHA won't fully describe the generated proto." >&2
fi

sha="$(git -C "$MESSAGES" rev-parse HEAD 2>/dev/null || echo unknown)"
generated="$("$PYTHON" "$MESSAGES/tools/gen_js_fields.py" --protoc "$PROTOC" --sha "$sha" "$MESSAGES/proto/zmk/studio.proto")"

if [ "$mode" = "--check" ]; then
  current="$(cat "$OUT" 2>/dev/null || true)"
  if [ "$generated" = "$current" ]; then
    echo "OK: $OUT matches zmk-next-messages @ $sha"
    exit 0
  fi
  echo "STALE: $OUT does not match zmk-next-messages @ $sha" >&2
  diff <(printf '%s' "$current") <(printf '%s' "$generated") >&2 || true
  exit 1
fi

printf '%s\n' "$generated" > "$OUT"
echo "wrote $OUT (zmk-next-messages @ $sha)"
