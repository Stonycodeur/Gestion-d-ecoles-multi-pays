-- Supabase-only (needs the `auth` schema): trash for accounts. Applied after 101_supabase_accounts.sql and 110_account_space.sql.
-- A trashed account is disabled and hidden from the lists; restoring re-enables it. Purging removes it for good.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS deleted_by TEXT;

CREATE OR REPLACE FUNCTION admin_trash_account(p_user UUID, p_by TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND (is_root OR is_immutable)) THEN RAISE EXCEPTION 'the root super-admin cannot be deleted'; END IF;
  UPDATE public.users SET deleted_at = now(), deleted_by = p_by WHERE id = p_user AND deleted_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown account'; END IF;
  UPDATE auth.users SET banned_until = 'infinity'::timestamptz, updated_at = now() WHERE id = p_user;
  DELETE FROM auth.sessions WHERE user_id = p_user;
END $$;

CREATE OR REPLACE FUNCTION admin_restore_account(p_user UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  UPDATE public.users SET deleted_at = NULL, deleted_by = NULL WHERE id = p_user AND deleted_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'account is not in the trash'; END IF;
  UPDATE auth.users SET banned_until = NULL, updated_at = now() WHERE id = p_user;
END $$;

CREATE OR REPLACE FUNCTION admin_purge_account(p_user UUID) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND deleted_at IS NOT NULL AND NOT is_root AND NOT is_immutable) THEN RAISE EXCEPTION 'account is not in the trash'; END IF;
  DELETE FROM public.user_profiles WHERE user_id = p_user::TEXT;
  DELETE FROM public.user_roles WHERE user_id = p_user;
  DELETE FROM public.users WHERE id = p_user;
  DELETE FROM auth.users WHERE id = p_user;      -- identities and sessions cascade
END $$;

CREATE OR REPLACE FUNCTION admin_list_trashed_accounts()
RETURNS TABLE (id UUID, email TEXT, role TEXT, school_slug TEXT, school_name TEXT, deleted_at TIMESTAMPTZ, deleted_by TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  RETURN QUERY
    SELECT u.id, u.email::TEXT, r.code, t.slug, t.name, u.deleted_at, u.deleted_by
    FROM public.users u
    LEFT JOIN public.user_roles ur ON ur.user_id = u.id
    LEFT JOIN public.roles r ON r.id = ur.role_id
    LEFT JOIN public.tenants t ON t.id = ur.tenant_id
    WHERE u.deleted_at IS NOT NULL ORDER BY u.deleted_at DESC;
END $$;

-- The account list no longer shows trashed accounts.
CREATE OR REPLACE FUNCTION admin_list_accounts(p_school TEXT DEFAULT NULL)
RETURNS TABLE (id UUID, email TEXT, role TEXT, school_slug TEXT, school_name TEXT, is_root BOOLEAN, active BOOLEAN, last_sign_in_at TIMESTAMPTZ, created_at TIMESTAMPTZ)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  RETURN QUERY
    SELECT u.id, u.email::TEXT, r.code, t.slug, t.name, u.is_root, (a.banned_until IS NULL OR a.banned_until < now()), a.last_sign_in_at, u.created_at
    FROM public.users u
    LEFT JOIN public.user_roles ur ON ur.user_id = u.id
    LEFT JOIN public.roles r ON r.id = ur.role_id
    LEFT JOIN public.tenants t ON t.id = ur.tenant_id
    LEFT JOIN auth.users a ON a.id = u.id
    WHERE (p_school IS NULL OR t.slug = p_school) AND u.deleted_at IS NULL
    ORDER BY u.is_root DESC, t.name NULLS FIRST, u.email;
END $$;

REVOKE ALL ON FUNCTION admin_trash_account(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_restore_account(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_purge_account(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_list_trashed_accounts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_list_accounts(TEXT) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION admin_trash_account(UUID, TEXT) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_restore_account(UUID) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_purge_account(UUID) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_list_trashed_accounts() TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_list_accounts(TEXT) TO app_runtime;
  END IF;
END $$;
