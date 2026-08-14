-- ============================================================================
-- ASOFAST — Schéma SQLite (100% local)
-- Traduit depuis db/migrations/*.sql (Postgres/Supabase) avec adaptations :
--   uuid        -> TEXT (généré en JS via crypto.randomUUID())
--   jsonb       -> TEXT (JSON sérialisé, parsé en JS)
--   timestamptz -> TEXT (ISO 8601 UTC)
--   text[]      -> TEXT (JSON array sérialisé)
--   enums       -> TEXT avec CHECK
--   triggers    -> gérés en JS (couche db)
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---- projects --------------------------------------------------------------
create table if not exists projects (
  id                          text primary key,
  user_id                     text not null default 'local',
  name                        text not null,
  store_identifier            text not null,
  store                       text not null check (store in ('appstore', 'playstore')),
  source_locale               text not null default 'en-US',
  app_name                    text,
  developer_name              text,
  icon_url                    text,
  competitors                 text not null default '[]',
  target_locales              text not null default '[]',
  features                    text not null default '[]',
  screenshot_style            text,
  screenshot_captions         text,
  screenshot_captions_tablet  text not null default '[]',
  privacy_policy_url          text not null default '',
  whats_new                   text,
  competitor_keywords_en      text not null default '[]',
  competitor_keywords_key     text,
  screenshot_bg_color         text,
  screenshot_text_color       text,
  created_at                  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at                  text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index if not exists projects_user_id_idx on projects (user_id);

-- ---- generations -----------------------------------------------------------
create table if not exists generations (
  id            text primary key,
  project_id    text not null references projects (id) on delete cascade,
  type          text not null check (type in ('copy', 'translation', 'screenshot')),
  status        text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  input         text not null default '{}',
  output        text,
  target_locale text,
  created_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

create index if not exists generations_project_id_idx on generations (project_id);
create index if not exists generations_status_idx on generations (status);

-- ---- listings --------------------------------------------------------------
create table if not exists listings (
  id                text primary key,
  project_id        text not null references projects (id) on delete cascade,
  locale            text not null,
  title             text not null default '',
  subtitle          text not null default '',
  short_description text not null default '',
  description       text not null default '',
  keywords          text not null default '',
  keyword_base      text not null default '[]',
  screenshots       text not null default '[]',
  screenshots_tablet text not null default '[]',
  whats_new         text,
  created_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (project_id, locale)
);

create index if not exists listings_project_id_idx on listings (project_id);

-- ---- store_credentials -----------------------------------------------------
create table if not exists store_credentials (
  id                text primary key,
  project_id        text not null references projects (id) on delete cascade,
  store             text not null check (store in ('appstore', 'playstore')),
  -- AES-256-GCM ciphertext: "ivB64.authTagB64.ciphertextB64". Opaque.
  encrypted_payload text not null,
  connected_at      text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  unique (project_id, store)
);

create index if not exists store_credentials_project_id_idx on store_credentials (project_id);

-- ---- prompts ---------------------------------------------------------------
create table if not exists prompts (
  id         text primary key,
  name       text not null unique,
  system     text not null default '',
  user       text not null default '',
  version    integer not null default 1,
  is_active  integer not null default 1,
  created_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text not null default (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
