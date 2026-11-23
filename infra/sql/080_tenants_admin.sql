-- School management by the root super-admin (spec 6.2). The API runs without CREATE privileges: creation and updates go through
-- SECURITY DEFINER functions that refuse to run unless the service has set app.root_bypass for the transaction.
CREATE OR REPLACE FUNCTION admin_create_tenant(p_slug TEXT, p_name TEXT, p_type TEXT, p_country TEXT, p_config JSONB DEFAULT '{}')
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id UUID;
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  INSERT INTO tenants(slug, name, school_type, country_code, schema_name, config)
    VALUES (p_slug, p_name, p_type, p_country, 'tenant_' || p_slug, COALESCE(p_config, '{}')) RETURNING id INTO v_id;
  PERFORM provision_tenant_schema(p_slug);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION admin_update_tenant(p_slug TEXT, p_name TEXT, p_config JSONB, p_active BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  UPDATE tenants SET name = COALESCE(p_name, name), config = COALESCE(p_config, config), active = COALESCE(p_active, active) WHERE slug = p_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown tenant'; END IF;
END $$;

REVOKE ALL ON FUNCTION admin_create_tenant(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_update_tenant(TEXT, TEXT, JSONB, BOOLEAN) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION admin_create_tenant(TEXT, TEXT, TEXT, TEXT, JSONB) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_update_tenant(TEXT, TEXT, JSONB, BOOLEAN) TO app_runtime;
  END IF;
END $$;
