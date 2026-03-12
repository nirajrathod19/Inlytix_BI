-- ============================================================
--  Etlytix BI – Supabase Table Creation Script
--  Run this in Supabase SQL Editor (supabase.com → SQL Editor)
-- ============================================================

-- 1. Users
CREATE TABLE IF NOT EXISTS public."user" (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(150) NOT NULL UNIQUE,
    email         VARCHAR(150) NOT NULL UNIQUE,
    password      VARCHAR(150) NOT NULL
);

-- 2. Projects  (saved chart + uploaded data configs)
CREATE TABLE IF NOT EXISTS public.project (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100)  NOT NULL,
    project_data  TEXT          NOT NULL,
    user_id       INTEGER       NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    last_modified TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 3. User activity log
CREATE TABLE IF NOT EXISTS public.user_activity (
    id            SERIAL PRIMARY KEY,
    action        VARCHAR(100)  NOT NULL,
    project_name  VARCHAR(100),
    timestamp     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    user_id       INTEGER       NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE
);

-- 4. Story points  (insight annotations)
CREATE TABLE IF NOT EXISTS public.story_point (
    id            SERIAL PRIMARY KEY,
    title         VARCHAR(100)  NOT NULL,
    insights      TEXT,
    chart_config  TEXT          NOT NULL,
    user_id       INTEGER       NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE
);

-- 5. Dashboards  (Power BI-style saved dashboard layouts)
CREATE TABLE IF NOT EXISTS public.dashboard (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100)  NOT NULL DEFAULT 'My Dashboard',
    config_json   TEXT          NOT NULL DEFAULT '[]',
    user_id       INTEGER       NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    last_modified TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_project_user       ON public.project(user_id);
CREATE INDEX IF NOT EXISTS idx_user_activity_user ON public.user_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_story_point_user   ON public.story_point(user_id);
CREATE INDEX IF NOT EXISTS idx_dashboard_user     ON public.dashboard(user_id);

-- ── auto-update last_modified on dashboard ─────────────────
CREATE OR REPLACE FUNCTION update_last_modified()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.last_modified = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_dashboard_modified ON public.dashboard;
CREATE TRIGGER trg_dashboard_modified
    BEFORE UPDATE ON public.dashboard
    FOR EACH ROW EXECUTE FUNCTION update_last_modified();

DROP TRIGGER IF EXISTS trg_project_modified ON public.project;
CREATE TRIGGER trg_project_modified
    BEFORE UPDATE ON public.project
    FOR EACH ROW EXECUTE FUNCTION update_last_modified();

-- ── Row-Level Security (optional – enable if you add JWT auth) ──
-- ALTER TABLE public."user"       ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.project      ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.story_point  ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.dashboard    ENABLE ROW LEVEL SECURITY;

-- ============================================================
--  DONE. After running this, update SUPABASE_DATABASE_URL in
--  your Replit secret to:
--    postgresql://postgres:[YOUR-PASSWORD]@db.[REF].supabase.co:5432/postgres
--  (Project Settings → Database → Connection String → URI)
-- ============================================================
