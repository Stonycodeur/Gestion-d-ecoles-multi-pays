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
    code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, coefficient NUMERIC NOT NULL DEFAULT 1 CHECK (coefficient > 0))$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.rooms (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    name TEXT NOT NULL UNIQUE, capacity INT)$f$, s, tid);
  EXECUTE format($f$CREATE TABLE IF NOT EXISTS %I.students (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), %s,
    first_name TEXT NOT NULL, last_name TEXT NOT NULL, birth_date DATE,
    status TEXT NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','active','transferred','graduated')),
    class_id UUID REFERENCES %I.classes(id), user_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())$f$, s, tid, s);
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

  FOREACH t IN ARRAY ARRAY['classes','subjects','rooms','students','guardians','teachers','class_subjects','schedules','schedule_slots',
    'substitutions','evaluations','grades','report_cards','absences','justifications','lessons','inspector_access','contracts','directory','threads','thread_members','messages','message_attachments','news','surveys','survey_votes','events','notifications','device_tokens','push_outbox','locker_documents'] LOOP
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
