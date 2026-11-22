-- Idempotency keys for replayed writes (offline queues on web and mobile resend the same request after a lost response).
CREATE TABLE IF NOT EXISTS idempotency_keys (
  scope       TEXT NOT NULL,                 -- principal id | tenant slug
  key         TEXT NOT NULL,
  fingerprint TEXT NOT NULL,                 -- sha256(method, path, body): a key reused with another request is refused
  status      INT,                           -- NULL while the first request is still running
  response    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_created ON idempotency_keys (created_at);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON idempotency_keys TO app_runtime;
  END IF;
END $$;
