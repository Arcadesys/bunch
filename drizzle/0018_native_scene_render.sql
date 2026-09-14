create table native_scene_render (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  request_id uuid not null,
  state text not null default 'QUEUED' check(state in ('QUEUED','RUNNING','COMPLETE','FAILED')),
  model text not null,
  recipe jsonb not null,
  storage_key text unique,
  content_type text,
  content_hash text,
  width integer,
  height integer,
  error_message text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique(owner_id,request_id),
  check(state <> 'COMPLETE' or (storage_key is not null and content_type is not null and content_hash is not null and width > 0 and height > 0))
);
create unique index native_scene_render_one_active_owner on native_scene_render(owner_id) where state in ('QUEUED','RUNNING');
create index native_scene_render_owner_created on native_scene_render(owner_id,created_at desc);
create trigger pilot_access_guard before insert or update or delete on native_scene_render for each row execute function pilot_guard_owner();
