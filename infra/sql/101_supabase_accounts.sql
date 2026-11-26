-- Supabase-only (needs the `auth` schema): account administration for the root super-admin, without any service-role key in the API.
-- The API runs as app_runtime and can only call these functions after setting app.root_bypass for the transaction.
-- Passwords are bcrypt-hashed by GoTrue's own scheme (pgcrypto crypt/bf); accounts are created confirmed so they can sign in at once.
CREATE OR REPLACE FUNCTION admin_create_account(p_email TEXT, p_password TEXT, p_role TEXT, p_school_slug TEXT DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
DECLARE v_email TEXT := lower(btrim(p_email)); v_id UUID; v_scope TEXT;
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  IF v_email !~ '^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$' THEN RAISE EXCEPTION 'invalid email'; END IF;
  IF length(COALESCE(p_password, '')) < 10 THEN RAISE EXCEPTION 'password too short'; END IF;
  SELECT scope INTO v_scope FROM roles WHERE code = p_role;
  IF v_scope IS NULL THEN RAISE EXCEPTION 'unknown role'; END IF;
  IF p_role = 'root_super_admin' THEN RAISE EXCEPTION 'the root super-admin is unique and immutable'; END IF;
  IF v_scope <> 'tenant' THEN RAISE EXCEPTION 'only school roles can be created here'; END IF;
  IF NOT EXISTS (SELECT 1 FROM tenants WHERE slug = p_school_slug) THEN RAISE EXCEPTION 'unknown school'; END IF;
  SELECT id INTO v_id FROM auth.users WHERE lower(email) = v_email;
  IF v_id IS NULL THEN
    v_id := gen_random_uuid();
    INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change_token_new, email_change)
    VALUES ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email, crypt(p_password, gen_salt('bf', 10)), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');
    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    VALUES (v_id::TEXT, v_id, jsonb_build_object('sub', v_id::TEXT, 'email', v_email, 'email_verified', TRUE, 'phone_verified', FALSE), 'email', now(), now(), now());
  END IF;
  PERFORM public.link_account(v_email, p_role, p_school_slug);
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION admin_reset_password(p_user UUID, p_password TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  IF length(COALESCE(p_password, '')) < 10 THEN RAISE EXCEPTION 'password too short'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND (is_root OR is_immutable)) THEN RAISE EXCEPTION 'the root super-admin is managed in Supabase Authentication only'; END IF;
  UPDATE auth.users SET encrypted_password = crypt(p_password, gen_salt('bf', 10)), updated_at = now() WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown account'; END IF;
  DELETE FROM auth.sessions WHERE user_id = p_user;
END $$;

CREATE OR REPLACE FUNCTION admin_set_account_active(p_user UUID, p_active BOOLEAN)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = p_user AND (is_root OR is_immutable)) THEN RAISE EXCEPTION 'the root super-admin cannot be disabled'; END IF;
  UPDATE auth.users SET banned_until = CASE WHEN p_active THEN NULL ELSE 'infinity'::timestamptz END, updated_at = now() WHERE id = p_user;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown account'; END IF;
  IF NOT p_active THEN DELETE FROM auth.sessions WHERE user_id = p_user; END IF;
END $$;

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
    WHERE p_school IS NULL OR t.slug = p_school
    ORDER BY u.is_root DESC, t.name NULLS FIRST, u.email;
END $$;

REVOKE ALL ON FUNCTION admin_create_account(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_reset_password(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_set_account_active(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION admin_list_accounts(TEXT) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION admin_create_account(TEXT, TEXT, TEXT, TEXT) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_reset_password(UUID, TEXT) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_set_account_active(UUID, BOOLEAN) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_list_accounts(TEXT) TO app_runtime;
  END IF;
END $$;
