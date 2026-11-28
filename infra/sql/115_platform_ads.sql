-- Highlights shown on the public home page, managed by the root super-admin from the console. Portable PostgreSQL.
CREATE TABLE IF NOT EXISTS platform_ads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_fr    TEXT NOT NULL CHECK (char_length(title_fr) BETWEEN 1 AND 80),
  title_en    TEXT NOT NULL CHECK (char_length(title_en) BETWEEN 1 AND 80),
  text_fr     TEXT NOT NULL DEFAULT '' CHECK (char_length(text_fr) <= 240),
  text_en     TEXT NOT NULL DEFAULT '' CHECK (char_length(text_en) <= 240),
  link_url    TEXT CHECK (link_url IS NULL OR link_url ~ '^(/|https://)'),
  link_label_fr TEXT, link_label_en TEXT,
  theme       TEXT NOT NULL DEFAULT 'blue' CHECK (theme IN ('blue', 'violet', 'orange', 'teal', 'rose')),
  position    INT NOT NULL DEFAULT 0,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at   TIMESTAMPTZ,
  ends_at     TIMESTAMPTZ,
  created_by  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON platform_ads TO app_runtime;
  END IF;
END $$;
