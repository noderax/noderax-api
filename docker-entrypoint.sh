#!/bin/sh
set -eu

STATE_DIR="${NODERAX_STATE_DIR:-/app/.noderax}"
NODE_MODULES_DIR="/app/node_modules"
PNPM_DIR="${PNPM_HOME:-/pnpm}"
FILE_ENV_SUFFIX="_FILE"

apply_file_backed_env() {
  env_file_list="$(mktemp)"
  env > "$env_file_list"

  while IFS='=' read -r key value; do
    case "$key" in
      *"${FILE_ENV_SUFFIX}")
        target_key="${key%"${FILE_ENV_SUFFIX}"}"
        if [ -n "$target_key" ] && [ -n "${value:-}" ]; then
          eval "current_value=\${$target_key:-}"
          if [ -z "${current_value:-}" ] && [ -r "$value" ]; then
            target_value="$(cat "$value")"
            export "$target_key=$target_value"
          fi
        fi
        ;;
    esac
  done < "$env_file_list"

  rm -f "$env_file_list"
}

if [ "$(id -u)" = "0" ]; then
  apply_file_backed_env
  mkdir -p "$STATE_DIR"
  mkdir -p "$NODE_MODULES_DIR"
  mkdir -p "$PNPM_DIR"
  chown -R node:node "$STATE_DIR"
  chown -R node:node "$NODE_MODULES_DIR"
  chown -R node:node "$PNPM_DIR"
  exec su-exec node "$@"
fi

exec "$@"
