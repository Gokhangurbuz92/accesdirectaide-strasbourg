#!/usr/bin/env bash
# R46 (D10) — a reproducible LOCAL OpenFisca-France engine for the LAB (loopback only; never a public host, never Production).
#   scripts/openfisca-local.sh install     → creates a Python virtual environment and installs the PINNED engine (the versions the protocol was verified on)
#   scripts/openfisca-local.sh serve       → serves it on 127.0.0.1:${OPENFISCA_PORT:-5011} (foreground)
#   scripts/openfisca-local.sh env         → prints the two variables the LAB server needs (no secret involved)
#   scripts/openfisca-local.sh verify      → runs scripts/openfisca-verify.mjs against the served engine (health, version, qualified outputs)
# The pins below are those of tests/fixtures/openfisca-france-176-variables.json (R14) and infrastructure/openfisca/Dockerfile; change all three together.
# OpenFisca-France and OpenFisca-Core are AGPL-3.0: hosting the engine for others is an owner / licence decision (R14.1), not a step of this script.
set -euo pipefail
OPENFISCA_FRANCE_PIN="176.1.6"
OPENFISCA_CORE_PIN="44.7.1"
HOME_DIR="${OPENFISCA_HOME:-$HOME/.cache/ada-openfisca}"
VENV="$HOME_DIR/venv-$OPENFISCA_FRANCE_PIN"
PORT="${OPENFISCA_PORT:-5011}"
PY="${PYTHON:-python3}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$PORT" in 3000) echo "port 3000 is reserved for the owner LAB; choose another OPENFISCA_PORT" >&2; exit 2;; esac
[[ "$PORT" =~ ^[0-9]+$ ]] || { echo "OPENFISCA_PORT must be a number" >&2; exit 2; }

cmd="${1:-help}"
case "$cmd" in
  install)
    "$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' || { echo "Python >= 3.9 required (set PYTHON=...)" >&2; exit 2; }
    mkdir -p "$HOME_DIR"
    [ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV"
    "$VENV/bin/python" -m pip install --disable-pip-version-check --no-input "openfisca-core[web-api]==$OPENFISCA_CORE_PIN" "openfisca-france==$OPENFISCA_FRANCE_PIN"
    "$VENV/bin/python" -m pip freeze --disable-pip-version-check > "$HOME_DIR/freeze-$OPENFISCA_FRANCE_PIN.txt"
    echo "installed openfisca-france $OPENFISCA_FRANCE_PIN / openfisca-core $OPENFISCA_CORE_PIN in $VENV (frozen list: $HOME_DIR/freeze-$OPENFISCA_FRANCE_PIN.txt)"
    ;;
  serve)
    [ -x "$VENV/bin/openfisca" ] || { echo "not installed: run scripts/openfisca-local.sh install first" >&2; exit 2; }
    exec "$VENV/bin/openfisca" serve --country-package openfisca_france --port "$PORT" --bind 127.0.0.1
    ;;
  env)
    echo "OPENFISCA_URL=http://127.0.0.1:$PORT"
    echo "OPENFISCA_FRANCE_VERSION=$OPENFISCA_FRANCE_PIN"
    ;;
  verify)
    OPENFISCA_URL="${OPENFISCA_URL:-http://127.0.0.1:$PORT}" OPENFISCA_FRANCE_VERSION="${OPENFISCA_FRANCE_VERSION:-$OPENFISCA_FRANCE_PIN}" exec node "$ROOT/scripts/openfisca-verify.mjs" "${@:2}"
    ;;
  *)
    sed -n '2,7p' "$0"; exit 2;;
esac
