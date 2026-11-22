#!/usr/bin/env bash
# Docker init: creates the non-superuser runtime role (RLS applies to it). Password comes from APP_RUNTIME_PASSWORD, never from the repo.
set -euo pipefail
: "${APP_RUNTIME_PASSWORD:?APP_RUNTIME_PASSWORD must be set}"
psql -v ON_ERROR_STOP=1 -v pw="$APP_RUNTIME_PASSWORD" --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE app_runtime LOGIN PASSWORD :'pw' NOSUPERUSER NOBYPASSRLS;
GRANT CONNECT ON DATABASE ecolemanager TO app_runtime;
SQL
