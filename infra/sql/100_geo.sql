-- Geography and country activation for the root super-admin (spec 6.2, 6.17). Idempotent.
-- Location of a school (continent / province / city) and "activation" of any country of the world: the country gets its reference rows
-- (education system, grading scales, calendar) cloned from a model, so adding a country stays a data operation, never a code change.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS continent_code CHAR(2);
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS region TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS city TEXT;

CREATE OR REPLACE FUNCTION admin_set_tenant_location(p_slug TEXT, p_continent TEXT, p_region TEXT, p_city TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  UPDATE tenants SET continent_code = NULLIF(p_continent, ''), region = NULLIF(p_region, ''), city = NULLIF(p_city, '') WHERE slug = p_slug;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown tenant'; END IF;
END $$;

-- Models: 'numeric' (scales of the pilot country: /10 primary, /20 secondary, /20 LMD), 'letters' (A+ to E-), 'percent' (/100).
CREATE OR REPLACE FUNCTION admin_ensure_country(p_code TEXT, p_name_fr TEXT, p_name_en TEXT, p_currency TEXT, p_timezone TEXT, p_languages TEXT[], p_locale TEXT, p_model TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_scale TEXT;
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  IF p_code !~ '^[A-Z]{2}$' THEN RAISE EXCEPTION 'invalid country code'; END IF;
  IF p_model NOT IN ('numeric', 'letters', 'percent') THEN RAISE EXCEPTION 'unknown grading model'; END IF;
  IF EXISTS (SELECT 1 FROM countries WHERE code = p_code) THEN RETURN FALSE; END IF;
  INSERT INTO countries (code, name_fr, name_en, languages, default_locale, currency, timezone, payment_providers, legal_framework, document_templates, ministry_connectors, is_sample)
  VALUES (p_code, p_name_fr, p_name_en, COALESCE(p_languages, '{fr,en}'), COALESCE(p_locale, 'fr'), COALESCE(NULLIF(p_currency, ''), 'USD'), COALESCE(NULLIF(p_timezone, ''), 'UTC'),
    '[{"code":"stripe","kind":"card","label":"Carte (Stripe)"},{"code":"bank_transfer","kind":"transfer"},{"code":"cash","kind":"cash"},{"code":"cheque","kind":"cheque"}]',
    '{"data_protection_law":"À valider (loi nationale)","authority":"À valider","gps_retention_days":30,"minor_age":18,"reference":"RGPD"}', '{}', '[]', FALSE);
  IF p_model = 'numeric' THEN
    INSERT INTO grading_scales (country_code, code, type, min_value, max_value, step, decimals, pass_mark, rounding, bands, display_format)
      SELECT p_code, code, type, min_value, max_value, step, decimals, pass_mark, rounding, bands, display_format FROM grading_scales WHERE country_code = 'GA';
  ELSIF p_model = 'letters' THEN
    INSERT INTO grading_scales (country_code, code, type, min_value, max_value, step, decimals, pass_mark, rounding, bands, display_format)
      SELECT p_code, code, type, min_value, max_value, step, decimals, pass_mark, rounding, bands, display_format FROM grading_scales WHERE country_code = 'XL';
  ELSE
    INSERT INTO grading_scales (country_code, code, type, min_value, max_value, step, decimals, pass_mark, rounding, bands, display_format)
      SELECT p_code, code, type, min_value, max_value, step, decimals, pass_mark, rounding, bands, display_format FROM grading_scales WHERE country_code = 'XL' AND code = 'num100';
  END IF;
  -- Standard four-cycle structure (levels and labels are data: adapt them per country afterwards); national exams are left empty on purpose.
  INSERT INTO education_systems (country_code, cycle, label_fr, label_en, levels, national_exam, grading_scale_code, period_type, school_type)
    SELECT p_code, e.cycle, e.label_fr, e.label_en, e.levels, NULL,
      CASE p_model WHEN 'numeric' THEN e.grading_scale_code WHEN 'letters' THEN 'letters' ELSE 'num100' END, e.period_type, e.school_type
    FROM education_systems e WHERE e.country_code = 'GA';
  INSERT INTO academic_calendars (country_code, label, periods) SELECT p_code, label, periods FROM academic_calendars WHERE country_code = 'GA';
  RETURN TRUE;
END $$;

-- Read access to the audit trail for the root console (the runtime role cannot SELECT audit_logs directly).
CREATE OR REPLACE FUNCTION admin_recent_audit(p_limit INT DEFAULT 30)
RETURNS TABLE (id BIGINT, at TIMESTAMPTZ, actor_email TEXT, tenant_slug TEXT, action TEXT, entity TEXT, details JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_setting('app.root_bypass', true) IS DISTINCT FROM 'on' THEN RAISE EXCEPTION 'root super-admin only'; END IF;
  RETURN QUERY SELECT a.id, a.at, u.email::TEXT, t.slug, a.action, a.entity, a.details
    FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id LEFT JOIN tenants t ON t.id = a.tenant_id
    ORDER BY a.id DESC LIMIT LEAST(GREATEST(COALESCE(p_limit, 30), 1), 200);
END $$;

REVOKE ALL ON FUNCTION admin_set_tenant_location(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_ensure_country(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_recent_audit(INT) FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT EXECUTE ON FUNCTION admin_set_tenant_location(TEXT, TEXT, TEXT, TEXT) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_ensure_country(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], TEXT, TEXT) TO app_runtime;
    GRANT EXECUTE ON FUNCTION admin_recent_audit(INT) TO app_runtime;
  END IF;
END $$;
