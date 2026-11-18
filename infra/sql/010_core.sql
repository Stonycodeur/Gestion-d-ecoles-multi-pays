-- Core schema (public). Spec 4.3, 5.3, 11.2.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE countries (
  code            CHAR(2) PRIMARY KEY,
  name_fr         TEXT NOT NULL,
  name_en         TEXT NOT NULL,
  languages       TEXT[] NOT NULL,
  default_locale  TEXT NOT NULL,
  currency        CHAR(3) NOT NULL,
  timezone        TEXT NOT NULL,
  payment_providers JSONB NOT NULL DEFAULT '[]',
  legal_framework JSONB NOT NULL DEFAULT '{}',   -- data-protection law, authority, retention, minor consent
  document_templates JSONB NOT NULL DEFAULT '{}',
  ministry_connectors JSONB NOT NULL DEFAULT '[]',
  is_sample       BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE grading_scales (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  code        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('numeric','letter','mixed','competency')),
  min_value   NUMERIC NOT NULL DEFAULT 0,
  max_value   NUMERIC NOT NULL,
  step        NUMERIC NOT NULL,
  decimals    SMALLINT NOT NULL DEFAULT 0,
  pass_mark   NUMERIC NOT NULL,
  rounding    TEXT NOT NULL CHECK (rounding IN ('integer','tenth','quarter','half','none')),
  bands       JSONB NOT NULL DEFAULT '[]',        -- [{label,min,max,color,mention}] on the 0-100 base
  display_format TEXT NOT NULL,
  UNIQUE (country_code, code),
  CHECK (max_value > min_value)
);

CREATE TABLE education_systems (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  cycle       TEXT NOT NULL CHECK (cycle IN ('primary','lower_secondary','upper_secondary','higher')),
  label_fr    TEXT NOT NULL,
  label_en    TEXT NOT NULL,
  levels      JSONB NOT NULL,                     -- ordered level codes/labels
  national_exam JSONB,                            -- {code,label_fr,label_en}
  grading_scale_code TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK (period_type IN ('trimester','semester')),
  school_type TEXT NOT NULL CHECK (school_type IN ('primary','college','lycee','university')),
  UNIQUE (country_code, cycle),
  FOREIGN KEY (country_code, grading_scale_code) REFERENCES grading_scales(country_code, code)
);

CREATE TABLE academic_calendars (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  label       TEXT NOT NULL,
  periods     JSONB NOT NULL,                     -- [{code,start_month,end_month}] (dates fixed yearly by the ministry)
  UNIQUE (country_code, label)
);

CREATE TABLE tenants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9_]{2,40}$'),
  name        TEXT NOT NULL,
  school_type TEXT NOT NULL CHECK (school_type IN ('primary','college','lycee','university')),
  country_code CHAR(2) NOT NULL REFERENCES countries(code),
  schema_name TEXT UNIQUE NOT NULL,
  config      JSONB NOT NULL DEFAULT '{}',
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tenant_settings (                    -- per-school override of country scales (within country limits)
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  cycle       TEXT NOT NULL,
  grading_scale_code TEXT NOT NULL,
  color_bands JSONB,
  effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
  PRIMARY KEY (tenant_id, cycle, effective_from)
);

CREATE TABLE feature_flags (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  module_name TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  config      JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, module_name)
);

CREATE TABLE roles (
  id   SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  label_fr TEXT NOT NULL,
  label_en TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('global','tenant','none'))
);

CREATE TABLE permissions (
  id   SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL
);

CREATE TABLE role_permissions (
  role_id INT NOT NULL REFERENCES roles(id),
  permission_id INT NOT NULL REFERENCES permissions(id),
  PRIMARY KEY (role_id, permission_id)
);

-- Spec 11.2, verbatim structure.
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_root BOOLEAN DEFAULT FALSE,
    is_immutable BOOLEAN DEFAULT FALSE,
    tenant_id UUID,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Only one root can exist.
CREATE UNIQUE INDEX one_root_only ON users ((is_root)) WHERE is_root;

CREATE TABLE user_roles (
  user_id UUID NOT NULL REFERENCES users(id),
  role_id INT NOT NULL REFERENCES roles(id),
  tenant_id UUID,
  PRIMARY KEY (user_id, role_id)
);

CREATE OR REPLACE FUNCTION protect_root_admin() RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.is_root OR OLD.is_immutable THEN
            RAISE EXCEPTION 'Cannot delete root super-admin';
        END IF;
        RETURN OLD;
    END IF;
    IF OLD.is_root OR OLD.is_immutable THEN
        IF NEW.is_root IS DISTINCT FROM OLD.is_root
           OR NEW.is_immutable IS DISTINCT FROM OLD.is_immutable
           OR NEW.email IS DISTINCT FROM OLD.email
           OR NEW.password_hash IS DISTINCT FROM OLD.password_hash
           OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
            RAISE EXCEPTION 'Cannot modify root super-admin';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_protect_root_admin
    BEFORE UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION protect_root_admin();

-- Same control on role assignments tied to an immutable user (spec 11.2, last paragraph).
CREATE OR REPLACE FUNCTION protect_root_roles() RETURNS TRIGGER AS $$
DECLARE target UUID; locked BOOLEAN;
BEGIN
  target := COALESCE(OLD.user_id, NEW.user_id);
  SELECT (is_root OR is_immutable) INTO locked FROM users WHERE id = target;
  IF locked THEN
    IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;  -- initial grant allowed by bootstrap only (see below)
    RAISE EXCEPTION 'Cannot modify roles of root super-admin';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_protect_root_roles
  BEFORE UPDATE OR DELETE ON user_roles
  FOR EACH ROW EXECUTE FUNCTION protect_root_roles();

-- role_permissions of the root role cannot be altered either.
CREATE OR REPLACE FUNCTION protect_root_role_permissions() RETURNS TRIGGER AS $$
DECLARE rid INT;
BEGIN
  rid := COALESCE(OLD.role_id, NEW.role_id);
  IF (SELECT code FROM roles WHERE id = rid) = 'root_super_admin' THEN
    RAISE EXCEPTION 'Cannot modify permissions of the root super-admin role';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_protect_root_role_permissions
  BEFORE UPDATE OR DELETE ON role_permissions
  FOR EACH ROW EXECUTE FUNCTION protect_root_role_permissions();

-- Non-modifiable audit log (append only).
CREATE TABLE audit_logs (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_id UUID,
  tenant_id UUID,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}',
  ip INET
);
CREATE OR REPLACE FUNCTION audit_logs_append_only() RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER trg_audit_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  tenant_id UUID,
  ip INET, user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

-- provision_tenant_schema() lives in 040_tenant_template.sql
