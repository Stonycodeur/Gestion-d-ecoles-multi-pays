-- Supabase Auth integration (hosted sign-in). Applied only on Supabase projects (needs the auth schema and the supabase_auth_admin role).
-- Accounts live in Supabase Auth; this file links them to the school directory and puts roles + school in the access token.
-- public.users.id MUST equal auth.users.id: the API uses the token's `sub` as the principal id.

-- Claims added to every access token: roles, tenant (school slug), is_root, class_ids, child_ids, student_id.
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid UUID := (event->>'user_id')::uuid;
  claims jsonb := COALESCE(event->'claims', '{}'::jsonb);
  u RECORD; r jsonb; slug TEXT; sch TEXT; d RECORD; got BOOLEAN;
BEGIN
  SELECT id, is_root, tenant_id INTO u FROM public.users WHERE id = uid;
  IF NOT FOUND THEN RETURN event; END IF;   -- unlinked account: token without roles, the API refuses it
  SELECT COALESCE(jsonb_agg(ro.code), '[]'::jsonb) INTO r FROM public.user_roles ur JOIN public.roles ro ON ro.id = ur.role_id WHERE ur.user_id = uid;
  claims := jsonb_set(claims, '{roles}', r);
  IF u.is_root THEN claims := jsonb_set(claims, '{is_root}', 'true'::jsonb); END IF;
  IF u.tenant_id IS NOT NULL THEN
    SELECT t.slug, t.schema_name INTO slug, sch FROM public.tenants t WHERE t.id = u.tenant_id AND t.active;
    IF slug IS NOT NULL THEN
      claims := jsonb_set(claims, '{tenant}', to_jsonb(slug));
      -- school directory: classes taught, children, own student record. Read with the tenant bypass on, inside this function only.
      PERFORM set_config('app.root_bypass', 'on', true);
      EXECUTE format('SELECT class_ids, child_ids, student_id FROM %I.directory WHERE user_id = $1', sch) INTO d USING uid;
      got := FOUND;
      PERFORM set_config('app.root_bypass', 'off', true);
      IF got THEN
        IF cardinality(d.class_ids) > 0 THEN claims := jsonb_set(claims, '{class_ids}', to_jsonb(d.class_ids)); END IF;
        IF cardinality(d.child_ids) > 0 THEN claims := jsonb_set(claims, '{child_ids}', to_jsonb(d.child_ids)); END IF;
        IF d.student_id IS NOT NULL THEN claims := jsonb_set(claims, '{student_id}', to_jsonb(d.student_id)); END IF;
      END IF;
    END IF;
  END IF;
  RETURN jsonb_set(event, '{claims}', claims);
END $$;
REVOKE ALL ON FUNCTION public.custom_access_token_hook(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb) TO supabase_auth_admin;

-- Operator functions (run by the platform owner in the SQL editor; no password ever passes through them).
-- 1) Create the account in Dashboard > Authentication > Users (Add user, auto-confirm), then link it here.
CREATE OR REPLACE FUNCTION public.link_account(p_email TEXT, p_role TEXT, p_school_slug TEXT DEFAULT NULL) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid UUID; rid INT; tid UUID;
BEGIN
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(p_email);
  IF uid IS NULL THEN RAISE EXCEPTION 'create the account in Supabase Authentication first: %', p_email; END IF;
  SELECT id INTO rid FROM public.roles WHERE code = p_role;
  IF rid IS NULL THEN RAISE EXCEPTION 'unknown role %', p_role; END IF;
  IF p_role = 'root_super_admin' THEN
    IF p_school_slug IS NOT NULL THEN RAISE EXCEPTION 'the root super-admin belongs to no school'; END IF;
    INSERT INTO public.users(id, email, password_hash, is_root, is_immutable) VALUES (uid, lower(p_email), 'managed-by-supabase-auth', TRUE, TRUE);
  ELSE
    SELECT id INTO tid FROM public.tenants WHERE slug = p_school_slug;
    IF tid IS NULL THEN RAISE EXCEPTION 'unknown school %', p_school_slug; END IF;
    INSERT INTO public.users(id, email, password_hash, tenant_id) VALUES (uid, lower(p_email), 'managed-by-supabase-auth', tid)
      ON CONFLICT (id) DO NOTHING;
  END IF;
  INSERT INTO public.user_roles(user_id, role_id, tenant_id) VALUES (uid, rid, tid) ON CONFLICT DO NOTHING;
  RETURN uid;
END $$;
REVOKE ALL ON FUNCTION public.link_account(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
