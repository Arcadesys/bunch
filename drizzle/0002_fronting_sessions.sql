-- Timestamped fronting is distinct from date-based confirmed coverage.
create table fronting_session (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  alter_id uuid not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fronting_session_owner_id_id_key unique (owner_id, id),
  constraint fronting_session_owner_alter_fk foreign key (owner_id, alter_id)
    references alter_profile(owner_id, id) on delete cascade,
  constraint fronting_session_valid_range check (ended_at is null or ended_at >= started_at)
);

create index fronting_session_owner_started_idx
  on fronting_session(owner_id, started_at desc);

create unique index fronting_session_one_current_per_owner
  on fronting_session(owner_id) where ended_at is null;
