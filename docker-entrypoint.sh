#!/bin/sh
set -eu

STATE_DIR="${NODERAX_STATE_DIR:-/app/.noderax}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$STATE_DIR"
  chown -R node:node "$STATE_DIR"
  exec su-exec node "$@"
fi

exec "$@"
