-- Separate the responsibility period from independently ending fronting episodes.
-- Legacy fronting_session records remain unchanged and unclassified.
create type presence_kind as enum ('HOSTING', 'FRONTING');
create table presence_period (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  alter_id uuid not null,
  kind presence_kind not null,
  started_at timestamptz not null default date_trunc('milliseconds', clock_timestamp()),
  ended_at timestamptz,
  version integer not null default 1,
  origin text not null default 'EXPLICIT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint presence_period_owner_alter_fk foreign key (owner_id, alter_id)
    references alter_profile(owner_id, id) on delete cascade,
  constraint presence_period_positive_version check (version > 0),
  constraint presence_period_valid_range check (ended_at is null or ended_at >= started_at),
  constraint presence_period_origin check (origin in ('EXPLICIT', 'SYSTEM_HOST_SNAPSHOT'))
);
create unique index presence_period_one_host on presence_period(owner_id)
  where kind = 'HOSTING' and ended_at is null;
create unique index presence_period_one_episode_per_alter on presence_period(owner_id, alter_id)
  where kind = 'FRONTING' and ended_at is null;
create index presence_period_owner_started on presence_period(owner_id, started_at, id);

-- Only the explicitly recorded host is carried forward. No guessed earlier periods.
insert into presence_period(owner_id, alter_id, kind, started_at, origin)
  select owner_id, alter_id, 'HOSTING', recorded_at, 'SYSTEM_HOST_SNAPSHOT'
  from system_host where alter_id is not null;

-- system_host remains the versioned compatibility/current-role record. All its
-- writers update hosting history atomically; fronting episodes are untouched.
create function record_hosting_period() returns trigger language plpgsql as $$
declare boundary timestamptz;
begin
  if TG_OP = 'UPDATE' and NEW.alter_id is not distinct from OLD.alter_id then
    return NEW;
  end if;
  if TG_OP = 'DELETE' then
    boundary := date_trunc('milliseconds', clock_timestamp());
    update presence_period set ended_at = greatest(boundary, started_at),
      version = version + 1, updated_at = boundary
      where owner_id = OLD.owner_id and kind = 'HOSTING' and ended_at is null;
    return OLD;
  end if;
  boundary := NEW.recorded_at;
  update presence_period set ended_at = boundary, version = version + 1, updated_at = boundary
    where owner_id = NEW.owner_id and kind = 'HOSTING' and ended_at is null;
  if NEW.alter_id is not null then
    insert into presence_period(owner_id, alter_id, kind, started_at)
      values (NEW.owner_id, NEW.alter_id, 'HOSTING', boundary);
  end if;
  return NEW;
end;
$$;
create trigger system_host_record_period after insert or update or delete on system_host
  for each row execute function record_hosting_period();
