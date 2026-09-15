-- No backfill: current front does not imply host.
create table system_host (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  alter_id uuid,
  version integer not null default 1,
  recorded_at timestamptz not null default now(),
  constraint system_host_one_per_owner unique (owner_id),
  constraint system_host_owner_alter_fk foreign key (owner_id, alter_id)
    references alter_profile(owner_id, id) on delete restrict,
  constraint system_host_positive_version check (version > 0)
);
