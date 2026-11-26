-- Supabase-only hardening, applied after 010..080 and 090 (not part of the plain-PostgreSQL CI/docker path).
-- Supabase enables RLS on every public table and exposes the schema through its REST/GraphQL API: close both doors.
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = 'tenant_isolation') THEN
      EXECUTE format('DROP POLICY IF EXISTS app_runtime_all ON public.%I', t);
      EXECUTE format('CREATE POLICY app_runtime_all ON public.%I FOR ALL TO app_runtime USING (true) WITH CHECK (true)', t);   -- the API role only; anon/authenticated get nothing
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
ALTER FUNCTION public.provision_tenant_schema(text) SET search_path = public, pg_temp;
ALTER FUNCTION public.protect_root_admin() SET search_path = public, pg_temp;
ALTER FUNCTION public.protect_root_roles() SET search_path = public, pg_temp;
ALTER FUNCTION public.protect_root_role_permissions() SET search_path = public, pg_temp;
ALTER FUNCTION public.audit_logs_append_only() SET search_path = public, pg_temp;
