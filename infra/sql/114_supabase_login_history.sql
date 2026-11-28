-- Supabase-only (needs the `auth` schema): sign-in history of an account and the last time its auth record changed. Applied after 113_user_rights.sql.
CREATE OR REPLACE FUNCTION admin_login_history(p_user UUID, p_limit INT DEFAULT 30)
RETURNS TABLE (at TIMESTAMPTZ, ip TEXT, action TEXT, provider TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  RETURN QUERY SELECT e.created_at, e.ip_address::TEXT, (e.payload->>'action')::TEXT, (e.payload->'traits'->>'provider')::TEXT
    FROM auth.audit_log_entries e
    WHERE (e.payload->>'actor_id') = p_user::TEXT AND (e.payload->>'action') IN ('login', 'logout', 'user_recovery_requested', 'user_modified')
    ORDER BY e.created_at DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
END $$;

CREATE OR REPLACE FUNCTION admin_auth_updated_at(p_user UUID) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
DECLARE r TIMESTAMPTZ;
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  SELECT updated_at INTO r FROM auth.users WHERE id = p_user;
  RETURN r;
END $$;

REVOKE ALL ON FUNCTION admin_login_history(UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_auth_updated_at(UUID) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION admin_login_history(UUID, INT) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_auth_updated_at(UUID) TO app_runtime;
  END IF;
END $$;
-- new public tables: same hardening as 091 (RLS + API role only)
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['user_permission_overrides', 'user_flags', 'platform_ads'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS app_runtime_all ON public.%I', t);
      EXECUTE format('CREATE POLICY app_runtime_all ON public.%I FOR ALL TO app_runtime USING (true) WITH CHECK (true)', t);
      EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
