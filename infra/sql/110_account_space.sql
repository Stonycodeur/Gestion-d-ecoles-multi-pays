-- Personal space, editable geography, editable role permissions and trash (phase 15). Idempotent; plain PostgreSQL and Supabase.
-- The API role (app_runtime) reaches these tables only through the API, which binds every row to the verified token; anon/authenticated get nothing (091 hardening).

-- 1. Personal space. user_id is TEXT: it is the token subject (a UUID with the real identity provider, a label in sandbox mode).
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id       TEXT PRIMARY KEY,
  full_name     TEXT CHECK (length(full_name) <= 120),
  phone_country CHAR(2),
  phone_number  TEXT CHECK (phone_number ~ '^[0-9]{4,15}$'),
  language      TEXT CHECK (language IN ('fr', 'en', 'ar')),
  avatar        TEXT CHECK (length(avatar) <= 600000),      -- small image as a data URL (png, jpeg or webp)
  preferences   JSONB NOT NULL DEFAULT '{}',                -- theme, accent colour, density… follow the person across devices
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Geography edited by the root super-admin, on top of the bundled world dataset: added entries, renamed entries, and hidden (trashed) entries.
CREATE TABLE IF NOT EXISTS geo_entries (
  id          BIGSERIAL PRIMARY KEY,
  kind        TEXT NOT NULL CHECK (kind IN ('continent', 'country', 'region', 'city')),
  code        TEXT NOT NULL,                  -- continent code / ISO 2 / region id or name key / city name
  parent      TEXT NOT NULL DEFAULT '',       -- '' for a continent, ISO 2 for region and city
  data        JSONB NOT NULL DEFAULT '{}',
  deleted_at  TIMESTAMPTZ,
  deleted_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (kind, code, parent)
);

-- 3. Permissions of the roles: the defaults live in the code (packages/shared/src/rbac.ts); this table holds only what the root changed.
CREATE TABLE IF NOT EXISTS role_permission_overrides (
  role_code   TEXT NOT NULL,
  permission  TEXT NOT NULL,
  granted     BOOLEAN NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_code, permission),
  CHECK (role_code <> 'root_super_admin'),
  CHECK (permission <> 'tenants:manage')
);

-- 4. Trash for schools (the account trash is Supabase-only: 111_supabase_trash.sql).
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE OR REPLACE FUNCTION admin_trash_tenant(p_slug TEXT, p_by TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  UPDATE tenants SET deleted_at = NOW(), deleted_by = p_by, active = FALSE WHERE slug = p_slug AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown tenant'; END IF;
END $$;

CREATE OR REPLACE FUNCTION admin_restore_tenant(p_slug TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  UPDATE tenants SET deleted_at = NULL, deleted_by = NULL, active = TRUE WHERE slug = p_slug AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'school is not in the trash'; END IF;
END $$;

-- Definitive removal: only a school already in the trash, drops its isolated schema and every role assignment tied to it.
CREATE OR REPLACE FUNCTION admin_purge_tenant(p_slug TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id UUID; v_schema TEXT;
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  SELECT id, schema_name INTO v_id, v_schema FROM tenants WHERE slug = p_slug AND deleted_at IS NOT NULL;
  IF v_id IS NULL THEN RAISE EXCEPTION 'school is not in the trash'; END IF;
  DELETE FROM user_roles WHERE tenant_id = v_id;
  UPDATE users SET tenant_id = NULL WHERE tenant_id = v_id AND NOT is_root;
  EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', v_schema);
  DELETE FROM tenants WHERE id = v_id;
END $$;

REVOKE ALL ON FUNCTION admin_trash_tenant(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_restore_tenant(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_purge_tenant(TEXT) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON user_profiles, geo_entries, role_permission_overrides TO app_runtime;
    GRANT USAGE, SELECT ON SEQUENCE geo_entries_id_seq TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_trash_tenant(TEXT, TEXT) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_restore_tenant(TEXT) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_purge_tenant(TEXT) TO app_runtime;
  END IF;
END $$;
