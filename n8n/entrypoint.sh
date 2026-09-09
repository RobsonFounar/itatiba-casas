#!/bin/sh
set -eu

# Render injeta PORT; o n8n escuta em N8N_PORT.
export N8N_PORT="${PORT:-5678}"
export N8N_LISTEN_ADDRESS="${N8N_LISTEN_ADDRESS:-0.0.0.0}"

# URL pública do serviço no Render (HTTPS na borda).
if [ -n "${RENDER_EXTERNAL_URL:-}" ]; then
  export N8N_HOST="${RENDER_EXTERNAL_HOSTNAME:-}"
  export N8N_PROTOCOL="${N8N_PROTOCOL:-https}"
  export N8N_PROXY_HOPS="${N8N_PROXY_HOPS:-1}"
  public_url="${RENDER_EXTERNAL_URL%/}"
  export WEBHOOK_URL="${public_url}/"
  export N8N_EDITOR_BASE_URL="${public_url}/"
fi

exec /docker-entrypoint.sh "$@"
