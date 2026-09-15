alter table group_photo_project add constraint group_photo_project_owner_id_key unique(owner_id,id);
create table group_photo_render (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  project_id uuid not null,
  request_id uuid not null,
  source_version integer not null check(source_version>0),
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
  foreign key(owner_id,project_id) references group_photo_project(owner_id,id) on delete cascade,
  unique(owner_id,request_id),
  check(state <> 'COMPLETE' or (storage_key is not null and content_type is not null and content_hash is not null and width>0 and height>0))
);
create unique index group_photo_render_one_active_owner on group_photo_render(owner_id) where state in ('QUEUED','RUNNING');
create index group_photo_render_project_created on group_photo_render(owner_id,project_id,created_at desc);
create trigger pilot_access_guard before insert or update or delete on group_photo_render for each row execute function pilot_guard_owner();
create trigger pilot_access_guard before insert or update or delete on group_photo_project for each row execute function pilot_guard_owner();
create trigger pilot_access_guard before insert or update or delete on group_photo_placement for each row execute function pilot_guard_owner();
