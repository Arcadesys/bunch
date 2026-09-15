create type group_photo_project_status as enum ('ANALYZING', 'READY', 'BLOCKING', 'RENDERING', 'COMPLETE', 'FAILED');

create table group_photo_project (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  backplate_storage_key text not null unique,
  backplate_content_type text not null,
  scene_analysis jsonb not null,
  status group_photo_project_status not null default 'READY',
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index group_photo_project_owner_updated_idx on group_photo_project(owner_id, updated_at desc);

create table group_photo_placement (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references group_photo_project(id) on delete cascade,
  owner_id text not null,
  alter_id uuid not null,
  token_x integer not null check (token_x between 0 and 100),
  token_y integer not null check (token_y between 0 and 100),
  depth integer not null default 50 check (depth between 0 and 100),
  occupancy_zone_id text,
  relation_hints jsonb not null default '[]'::jsonb,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint group_photo_placement_project_alter_key unique(project_id, alter_id),
  constraint group_photo_placement_owner_alter_fk foreign key (owner_id, alter_id)
    references alter_profile(owner_id, id) on delete cascade
);
create index group_photo_placement_project_idx on group_photo_placement(project_id);
