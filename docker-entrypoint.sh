#!/bin/sh
set -eu

STATE_DIR="${NODERAX_STATE_DIR:-/app/.noderax}"
NODE_MODULES_DIR="/app/node_modules"
PNPM_DIR="${PNPM_HOME:-/pnpm}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$STATE_DIR"
  mkdir -p "$NODE_MODULES_DIR"
  mkdir -p "$PNPM_DIR"
  chown -R node:node "$STATE_DIR"
  chown -R node:node "$NODE_MODULES_DIR"
  chown -R node:node "$PNPM_DIR"
  exec su-exec node "$@"
fi

exec "$@"
