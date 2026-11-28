-- Supabase-only (needs the `auth` schema): sign-in details of an account and closing its sessions, for school administrators. Applied after 111_supabase_trash.sql.
CREATE OR REPLACE FUNCTION admin_account_detail(p_user UUID)
RETURNS TABLE (mfa BOOLEAN, sessions INT, last_sign_in_at TIMESTAMPTZ, phone_country TEXT, phone_number TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  RETURN QUERY SELECT
    EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = p_user AND f.status = 'verified'),
    (SELECT COUNT(*)::INT FROM auth.sessions s WHERE s.user_id = p_user),
    (SELECT a.last_sign_in_at FROM auth.users a WHERE a.id = p_user),
    (SELECT up.phone_country::TEXT FROM public.user_profiles up WHERE up.user_id = p_user::TEXT),
    (SELECT up.phone_number FROM public.user_profiles up WHERE up.user_id = p_user::TEXT);
END $$;

CREATE OR REPLACE FUNCTION admin_close_sessions(p_user UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  DELETE FROM auth.sessions WHERE user_id = p_user;
END $$;

REVOKE ALL ON FUNCTION admin_account_detail(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_close_sessions(UUID) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION admin_account_detail(UUID) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_close_sessions(UUID) TO app_runtime;
  END IF;
END $$;
