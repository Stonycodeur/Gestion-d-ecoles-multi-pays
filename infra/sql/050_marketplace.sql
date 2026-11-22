-- Phase 6b: global marketplace catalogue (spec 6.19). Third-party modules are submitted as manifest + handler sources; only the root Super-Admin publishes or withdraws.
CREATE TABLE IF NOT EXISTS marketplace_modules (
  name TEXT PRIMARY KEY CHECK (name ~ '^module-[a-z0-9-]+$'),
  publisher TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','published','withdrawn')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS marketplace_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name TEXT NOT NULL REFERENCES marketplace_modules(name) ON DELETE CASCADE,
  version TEXT NOT NULL,
  manifest JSONB NOT NULL,
  handlers_source JSONB NOT NULL DEFAULT '{}',
  review JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','rejected','published','withdrawn')),
  submitted_by TEXT NOT NULL, submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by TEXT, decided_at TIMESTAMPTZ, decision_note TEXT,
  UNIQUE (module_name, version)
);
CREATE TABLE IF NOT EXISTS module_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name TEXT NOT NULL REFERENCES marketplace_modules(name) ON DELETE CASCADE,
  tenant_slug TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (module_name, tenant_slug)
);
-- The runtime role (non-superuser) writes the catalogue and the persisted module flags; created by ops/CI before this file runs.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE ON marketplace_modules, marketplace_versions, module_reviews TO app_runtime;
    GRANT SELECT, INSERT, UPDATE ON feature_flags TO app_runtime;
  END IF;
END $$;
