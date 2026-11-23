#!/bin/sh
# Container entrypoint. Hosted disks (Render, Fly) are mounted owned by root, so while still root, hand the
# database folder to the unprivileged `node` user, then drop to that user to run the server.
set -e
DATA_DIR="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR"
  exec setpriv --reuid=node --regid=node --init-groups -- "$@"
fi
exec "$@"
