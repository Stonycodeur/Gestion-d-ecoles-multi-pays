-- Individual rights and account flags, per user inside one school. Portable PostgreSQL (no auth schema).
-- Role defaults live in packages/shared/src/rbac.ts; role_permission_overrides holds the root's changes per role; this table holds changes for ONE person.
CREATE TABLE IF NOT EXISTS user_permission_overrides (
  user_id     TEXT NOT NULL,
  tenant_slug TEXT NOT NULL,
  permission  TEXT NOT NULL,
  granted     BOOLEAN NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, permission),
  CHECK (permission <> 'tenants:manage')
);
CREATE INDEX IF NOT EXISTS user_permission_overrides_tenant ON user_permission_overrides (tenant_slug);

CREATE TABLE IF NOT EXISTS user_flags (
  user_id              TEXT PRIMARY KEY,
  tenant_slug          TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  locked               BOOLEAN NOT NULL DEFAULT FALSE,
  locked_reason        TEXT,
  flagged_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by           TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_permission_overrides, user_flags TO app_runtime;
  END IF;
END $$;
