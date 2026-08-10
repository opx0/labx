#!/usr/bin/env bash
# Keep a resilient tunnel to a remote DataHub GMS.
# A plain `ssh -f -N -L` drops silently and the next request fails with a
# confusing GraphQL error, so this reconnects and reports.
set -euo pipefail
HOST="${1:-enma}"
LOCAL_PORT="${2:-18080}"
REMOTE_PORT="${3:-8080}"

while true; do
  ssh -N -o ExitOnForwardFailure=yes \
      -o ServerAliveInterval=15 -o ServerAliveCountMax=3 \
      -L "${LOCAL_PORT}:localhost:${REMOTE_PORT}" "$HOST" \
    && echo "tunnel closed cleanly" \
    || echo "tunnel dropped — reconnecting in 3s"
  sleep 3
done
