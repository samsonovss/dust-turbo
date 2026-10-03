#!/bin/sh
# Update only the existing game Worker; never repeat the SQLite migration.
set -eu
cd "$(dirname "$0")/.."
: "${CLOUDFLARE_API_TOKEN:?Protected Cloudflare token required}"
command -v curl >/dev/null
curl --fail-with-body -sS -X PUT \
  'https://api.cloudflare.com/client/v4/accounts/4813bd2bd4af58c3dec70eee4ca07914/workers/scripts/dust-turbo' \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata={"main_module":"server.js","compatibility_date":"2026-09-01","bindings":[{"type":"durable_object_namespace","name":"LOBBY","class_name":"Lobby"}]};type=application/json' \
  -F 'server.js=@worker/server.js;type=application/javascript+module' \
  -F 'core.js=@core.js;type=application/javascript+module'
