-- Per-school schema template (spec 4.3, 5.3). Every table: tenant_id + forced RLS.
CREATE OR REPLACE FUNCTION provision_tenant_schema(p_slug TEXT) RETURNS TEXT AS $$
DECLARE
  s TEXT := 'tenant_' || p_slug;
  t TEXT;
  tid TEXT := $d$ tenant_id UUID NOT NULL DEFAULT NULLIF(current_setting('app.tenant_id', true), '')::uuid $d$;
BEGIN
  IF p_slug !~ '^[a-z0-9_]{2,40}$' THEN RAISE EXCEPTION 'invalid slug'; END IF;
  EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', s);

  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.classes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    name TEXT NOT NULL, level_code TEXT NOT NULL, section TEXT, school_year TEXT NOT NULL, UNIQUE (name, school_year))$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.subjects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, coefficient NUMERIC NOT NULL DEFAULT 1 CHECK (coefficient > 0),
    category TEXT NOT NULL DEFAULT 'academic' CHECK (category IN ('academic','physical','creativity','research','professional','orientation')))$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.rooms (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    name TEXT NOT NULL UNIQUE, capacity INT)$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.students (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    first_name TEXT NOT NULL, last_name TEXT NOT NULL, birth_date DATE,
    status TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','active','transferred','graduated')),
    class_id UUID REFERENCES %I.classes(id), user_id UUID, gender TEXT CHECK (gender IN ('F','M','X')), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.guardians (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE, full_name TEXT NOT NULL, relation TEXT,
    phone TEXT, email TEXT, user_id UUID)$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.teachers (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    first_name TEXT NOT NULL, last_name TEXT NOT NULL, user_id UUID, max_weekly_hours INT NOT NULL DEFAULT 24)$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.class_subjects (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    class_id UUID NOT NULL REFERENCES %I.classes(id) ON DELETE CASCADE, subject_id UUID NOT NULL REFERENCES %I.subjects(id),
    teacher_id UUID NOT NULL REFERENCES %I.teachers(id), weekly_hours INT NOT NULL CHECK (weekly_hours > 0),
    UNIQUE (class_id, subject_id))$f$, s, tid, s, s, s);

  -- Timetable: a version is draft -> validated by the head -> published. DB-level unique indexes forbid double booking.
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.schedules (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    school_year TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','validated','published')),
    validated_by UUID, validated_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.schedule_slots (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    schedule_id UUID NOT NULL REFERENCES %I.schedules(id) ON DELETE CASCADE,
    class_id UUID NOT NULL REFERENCES %I.classes(id), subject_id UUID NOT NULL REFERENCES %I.subjects(id),
    teacher_id UUID NOT NULL REFERENCES %I.teachers(id), room_id UUID REFERENCES %I.rooms(id),
    weekday SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7), period_index SMALLINT NOT NULL CHECK (period_index >= 0))$f$,
    s, tid, s, s, s, s, s);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_teacher ON %I.schedule_slots (schedule_id, teacher_id, weekday, period_index)', s);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_class ON %I.schedule_slots (schedule_id, class_id, weekday, period_index)', s);
  EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS uq_slot_room ON %I.schedule_slots (schedule_id, room_id, weekday, period_index) WHERE room_id IS NOT NULL', s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.substitutions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    slot_id UUID NOT NULL REFERENCES %I.schedule_slots(id) ON DELETE CASCADE, on_date DATE NOT NULL,
    substitute_teacher_id UUID NOT NULL REFERENCES %I.teachers(id), UNIQUE (slot_id, on_date))$f$, s, tid, s, s);

  -- Grades: the scale used at entry time is frozen with the evaluation; normalized 0-100 makes grades comparable.
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.evaluations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    class_id UUID NOT NULL REFERENCES %I.classes(id), subject_id UUID NOT NULL REFERENCES %I.subjects(id),
    period_code TEXT NOT NULL, title TEXT NOT NULL, held_on DATE NOT NULL DEFAULT CURRENT_DATE,
    coefficient NUMERIC NOT NULL DEFAULT 1 CHECK (coefficient > 0), scale_snapshot JSONB NOT NULL)$f$, s, tid, s, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.grades (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    evaluation_id UUID NOT NULL REFERENCES %I.evaluations(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES %I.students(id), raw_value TEXT NOT NULL,
    normalized NUMERIC NOT NULL CHECK (normalized BETWEEN 0 AND 100), entered_by UUID,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (evaluation_id, student_id))$f$, s, tid, s, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.report_cards (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id), period_code TEXT NOT NULL, school_year TEXT NOT NULL,
    payload JSONB NOT NULL, archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (student_id, period_code, school_year))$f$, s, tid, s);

  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.absences (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id), on_date DATE NOT NULL, period_index SMALLINT,
    kind TEXT NOT NULL CHECK (kind IN ('absence','late')), minutes_late INT,
    status TEXT NOT NULL DEFAULT 'unjustified' CHECK (status IN ('unjustified','pending','justified','rejected')),
    recorded_by UUID, UNIQUE (student_id, on_date, period_index))$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.justifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    absence_id UUID NOT NULL REFERENCES %I.absences(id) ON DELETE CASCADE, reason TEXT NOT NULL, document_key TEXT,
    submitted_by UUID, decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','rejected')),
    decided_by UUID, decided_at TIMESTAMPTZ)$f$, s, tid, s);

  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.lessons (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    class_id UUID NOT NULL REFERENCES %I.classes(id), subject_id UUID NOT NULL REFERENCES %I.subjects(id),
    teacher_id UUID REFERENCES %I.teachers(id), on_date DATE NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
    homework TEXT, homework_due DATE, is_exam BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
    visa_by UUID, visa_at TIMESTAMPTZ, attachments JSONB NOT NULL DEFAULT '[]',
    search TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,'') || ' ' || coalesce(homework,''))) STORED)$f$, s, tid, s, s, s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS lessons_search ON %I.lessons USING GIN (search)', s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.inspector_access (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    user_id UUID NOT NULL, expires_at TIMESTAMPTZ NOT NULL, created_by UUID)$f$, s, tid);

  -- Phase 2 remainder: staff contracts
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.contracts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    teacher_id UUID NOT NULL REFERENCES %I.teachers(id) ON DELETE CASCADE, kind TEXT NOT NULL, start_date DATE NOT NULL, end_date DATE,
    weekly_hours INT CHECK (weekly_hours > 0))$f$, s, tid, s);

  -- Phase 3: school directory (links accounts to teaching/family attributes used by messaging and notifications)
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.directory (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    user_id UUID NOT NULL UNIQUE, role TEXT NOT NULL, display_name TEXT NOT NULL, class_ids UUID[] NOT NULL DEFAULT '{}',
    child_ids UUID[] NOT NULL DEFAULT '{}', student_id UUID, locale TEXT NOT NULL DEFAULT 'fr', email TEXT, phone TEXT)$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.threads (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    subject TEXT NOT NULL, created_by UUID NOT NULL, context JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.thread_members (%s, thread_id UUID NOT NULL REFERENCES %I.threads(id) ON DELETE CASCADE,
    user_id UUID NOT NULL, last_read_at TIMESTAMPTZ, PRIMARY KEY (thread_id, user_id))$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.messages (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    thread_id UUID NOT NULL REFERENCES %I.threads(id) ON DELETE CASCADE, sender_id UUID NOT NULL, body_enc TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS messages_thread ON %I.messages (thread_id, created_at)', s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.message_attachments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    message_id UUID NOT NULL REFERENCES %I.messages(id) ON DELETE CASCADE, storage_key TEXT NOT NULL, filename TEXT NOT NULL,
    content_type TEXT NOT NULL, size_bytes INT NOT NULL)$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.news (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    title TEXT NOT NULL, body TEXT NOT NULL, audience TEXT NOT NULL DEFAULT 'all' CHECK (audience IN ('all','staff','students','guardians')),
    is_public BOOLEAN NOT NULL DEFAULT FALSE, published_by UUID, published_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.surveys (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    question TEXT NOT NULL, options JSONB NOT NULL, closes_at TIMESTAMPTZ, created_by UUID)$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.survey_votes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    survey_id UUID NOT NULL REFERENCES %I.surveys(id) ON DELETE CASCADE, user_id UUID NOT NULL, option_index INT NOT NULL CHECK (option_index >= 0),
    UNIQUE (survey_id, user_id))$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    title TEXT NOT NULL, description TEXT, starts_at TIMESTAMPTZ NOT NULL, ends_at TIMESTAMPTZ, location TEXT)$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.notifications (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    user_id UUID NOT NULL, type TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, data JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), read_at TIMESTAMPTZ)$f$, s, tid);
  EXECUTE format('CREATE INDEX IF NOT EXISTS notifications_user ON %I.notifications (user_id, created_at DESC)', s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.device_tokens (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    user_id UUID NOT NULL, platform TEXT NOT NULL CHECK (platform IN ('android','ios','web')), token TEXT NOT NULL, UNIQUE (user_id, token))$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.push_outbox (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    user_id UUID NOT NULL, platform TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, mode TEXT NOT NULL, sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.locker_documents (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id), kind TEXT NOT NULL, title TEXT NOT NULL, storage_key TEXT NOT NULL, content_type TEXT NOT NULL,
    retention_days INT NOT NULL CHECK (retention_days > 0), expires_at TIMESTAMPTZ NOT NULL, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);

  -- Phase 4: OAA, gamification, predictive AI
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.oaa_config (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    weights JSONB, thresholds JSONB NOT NULL DEFAULT '{"warning":50,"penalty":40}', initial_value NUMERIC NOT NULL DEFAULT 50 CHECK (initial_value BETWEEN 0 AND 100),
    ranking_enabled BOOLEAN NOT NULL DEFAULT TRUE, feed_weights JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.oaa_scores (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL UNIQUE REFERENCES %I.students(id) ON DELETE CASCADE, axes JSONB NOT NULL, score100 INT NOT NULL CHECK (score100 BETWEEN 0 AND 100),
    alert TEXT NOT NULL CHECK (alert IN ('ok','warning','penalty')), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.oaa_history (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE, axes JSONB NOT NULL, score100 INT NOT NULL, reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS oaa_history_student ON %I.oaa_history (student_id, created_at)', s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.oaa_assessments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE, axis TEXT NOT NULL, value NUMERIC NOT NULL CHECK (value BETWEEN 0 AND 100),
    label TEXT, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.oaa_penalties (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE, score100 INT NOT NULL, code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','applied','lifted','dismissed')), decided_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), decided_at TIMESTAMPTZ)$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.game_results (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('quiz','game','group_challenge','individual_challenge','exam','boss')), score100 NUMERIC NOT NULL CHECK (score100 BETWEEN 0 AND 100),
    ref TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.xp_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE, source TEXT NOT NULL, xp INT NOT NULL CHECK (xp >= 0), ref TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (student_id, source, ref))$f$, s, tid, s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS xp_events_student ON %I.xp_events (student_id, created_at)', s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.student_badges (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE, badge_code TEXT NOT NULL, earned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (student_id, badge_code))$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.challenges (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    code TEXT NOT NULL UNIQUE, title TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('individual','group')), metric TEXT NOT NULL CHECK (metric IN ('xp','quizzes','homework')),
    target INT NOT NULL CHECK (target > 0), starts_on DATE NOT NULL, ends_on DATE NOT NULL CHECK (ends_on >= starts_on), created_by UUID)$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.challenge_completions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    challenge_id UUID NOT NULL REFERENCES %I.challenges(id) ON DELETE CASCADE, student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (challenge_id, student_id))$f$, s, tid, s, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.teams (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    name TEXT NOT NULL UNIQUE, class_id UUID REFERENCES %I.classes(id))$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.team_members (%s, team_id UUID NOT NULL REFERENCES %I.teams(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE, PRIMARY KEY (team_id, student_id))$f$, s, tid, s, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.quizzes (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    title TEXT NOT NULL, subject_id UUID REFERENCES %I.subjects(id), class_id UUID NOT NULL REFERENCES %I.classes(id),
    mode TEXT NOT NULL DEFAULT 'qcm' CHECK (mode IN ('qcm','escape_game','team_quiz','boss')), time_limit_sec INT CHECK (time_limit_sec > 0),
    max_attempts INT NOT NULL DEFAULT 1 CHECK (max_attempts > 0), published BOOLEAN NOT NULL DEFAULT FALSE, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.quiz_questions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    quiz_id UUID NOT NULL REFERENCES %I.quizzes(id) ON DELETE CASCADE, position INT NOT NULL, prompt TEXT NOT NULL, choices JSONB NOT NULL,
    correct INT NOT NULL CHECK (correct >= 0), points INT NOT NULL DEFAULT 1 CHECK (points > 0))$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.quiz_attempts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    quiz_id UUID NOT NULL REFERENCES %I.quizzes(id) ON DELETE CASCADE, student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), submitted_at TIMESTAMPTZ, score100 INT, flags JSONB NOT NULL DEFAULT '[]', result JSONB)$f$, s, tid, s, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.ai_predictions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE, probability NUMERIC NOT NULL CHECK (probability BETWEEN 0 AND 1),
    level TEXT NOT NULL CHECK (level IN ('low','medium','high')), factors JSONB NOT NULL, model_version TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS ai_predictions_student ON %I.ai_predictions (student_id, created_at DESC)', s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.ai_feedback (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    prediction_id UUID NOT NULL REFERENCES %I.ai_predictions(id) ON DELETE CASCADE, user_id UUID NOT NULL, useful BOOLEAN NOT NULL, comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);

  -- Phase 5: payments (money is integer minor units) ------------------------------------------------------------------
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.fee_plans (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    level_code TEXT NOT NULL, school_year TEXT NOT NULL, label TEXT NOT NULL, amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
    installments INT NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 36), first_due_on DATE NOT NULL, UNIQUE (level_code, school_year, label))$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.invoices (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id), number TEXT NOT NULL UNIQUE, label TEXT NOT NULL, currency CHAR(3) NOT NULL,
    gross_minor BIGINT NOT NULL CHECK (gross_minor >= 0), discount_minor BIGINT NOT NULL DEFAULT 0, net_minor BIGINT NOT NULL CHECK (net_minor >= 0),
    discounts JSONB NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','overdue','cancelled')),
    issued_on DATE NOT NULL DEFAULT CURRENT_DATE, created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS invoices_student ON %I.invoices (student_id)', s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.installments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    invoice_id UUID NOT NULL REFERENCES %I.invoices(id) ON DELETE CASCADE, seq INT NOT NULL, due_on DATE NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0), paid_minor BIGINT NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
    last_reminder_on DATE, UNIQUE (invoice_id, seq))$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.payments (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    invoice_id UUID NOT NULL REFERENCES %I.invoices(id), method TEXT NOT NULL, provider TEXT NOT NULL, provider_ref TEXT NOT NULL,
    idempotency_key TEXT UNIQUE, amount_minor BIGINT NOT NULL CHECK (amount_minor > 0), currency CHAR(3) NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','refunded')), payer TEXT,
    created_by UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), confirmed_at TIMESTAMPTZ, UNIQUE (provider, provider_ref))$f$, s, tid, s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS payments_invoice ON %I.payments (invoice_id)', s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.payment_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    provider TEXT NOT NULL, event_id TEXT NOT NULL, payload JSONB NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (provider, event_id))$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.receipts (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    payment_id UUID NOT NULL UNIQUE REFERENCES %I.payments(id), number TEXT NOT NULL UNIQUE, issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);

  -- Phase 5: parent GPS tracking (positions encrypted at rest, retention purge, access log) ------------------------------
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.gps_consents (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE, guardian_user_id UUID NOT NULL, granted BOOLEAN NOT NULL,
    consent_window JSONB NOT NULL, retention_days INT NOT NULL DEFAULT 30 CHECK (retention_days BETWEEN 1 AND 365),
    granted_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE (student_id, guardian_user_id))$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.gps_geofences (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID REFERENCES %I.students(id) ON DELETE CASCADE, name TEXT NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('school','home','safe')),
    lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN -90 AND 90), lng DOUBLE PRECISION NOT NULL CHECK (lng BETWEEN -180 AND 180),
    radius_m INT NOT NULL CHECK (radius_m BETWEEN 20 AND 5000), expected_in_window BOOLEAN NOT NULL DEFAULT FALSE)$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.gps_positions (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE, enc TEXT NOT NULL, accuracy_m REAL, recorded_at TIMESTAMPTZ NOT NULL)$f$, s, tid, s);
  EXECUTE format('CREATE INDEX IF NOT EXISTS gps_positions_student ON %I.gps_positions (student_id, recorded_at DESC)', s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.gps_state (student_id UUID PRIMARY KEY REFERENCES %I.students(id) ON DELETE CASCADE, %s,
    state JSONB NOT NULL DEFAULT '{"inside":[],"out_of_zone":false}', updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.gps_events (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL REFERENCES %I.students(id) ON DELETE CASCADE, type TEXT NOT NULL CHECK (type IN ('arrival','exit','out_of_zone')),
    geofence_id UUID, occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.gps_access_log (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    student_id UUID NOT NULL, user_id UUID NOT NULL, action TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid);

  FOREACH t IN ARRAY ARRAY['classes','subjects','rooms','students','guardians','teachers','class_subjects','schedules','schedule_slots',
    'substitutions','evaluations','grades','report_cards','absences','justifications','lessons','inspector_access','contracts','directory','threads','thread_members','messages','message_attachments','news','surveys','survey_votes','events','notifications','device_tokens','push_outbox','locker_documents','oaa_config','oaa_scores','oaa_history','oaa_assessments','oaa_penalties','game_results','xp_events','student_badges','challenges','challenge_completions','teams','team_members','quizzes','quiz_questions','quiz_attempts','ai_predictions','ai_feedback','fee_plans','invoices','installments','payments','payment_events','receipts','gps_consents','gps_geofences','gps_positions','gps_state','gps_events','gps_access_log'] LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', s, t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', s, t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I.%I', s, t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON %I.%I
      USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.root_bypass', true) = 'on')
      WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid OR current_setting('app.root_bypass', true) = 'on')$f$, s, t);
  END LOOP;
  -- Runtime role (non-superuser, so RLS applies). Created by ops/CI as: CREATE ROLE app_runtime LOGIN PASSWORD '...'.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO app_runtime', s);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA %I TO app_runtime', s);
  END IF;
  RETURN s;
END;
$$ LANGUAGE plpgsql;
