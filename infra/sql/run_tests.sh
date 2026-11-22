#!/usr/bin/env bash
# Usage: PGHOST=... PGPORT=... PGUSER=postgres ./run_tests.sh   (creates a throw-away DB)
set -euo pipefail
cd "$(dirname "$0")"
DB=em_test_$$
createdb "$DB"; trap 'dropdb --if-exists "$DB"' EXIT
for f in 010_core.sql 020_seed_roles.sql 030_seed_countries.sql 040_tenant_template.sql 050_marketplace.sql 060_idempotency.sql; do psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"; done
psql -d "$DB" -f test_core.sql 2>&1 | tee /tmp/sql_tests.out
# Expected failures: 5 root-protection errors + roles + second root + 3 audit + 1 RLS write = see docs/PROGRESS.md
psql -d "$DB" -f test_tenant.sql 2>&1 | tee /tmp/sql_tenant.out
test "$(grep -c 'ERROR:' /tmp/sql_tenant.out)" -eq 3 && echo "TENANT SQL TESTS OK (3 expected refusals)"
test "$(grep -c 'ERROR:' /tmp/sql_tests.out)" -eq 11 && echo "SQL TESTS OK (11 expected refusals)"
